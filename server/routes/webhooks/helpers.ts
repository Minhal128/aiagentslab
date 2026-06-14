'use strict';
import { db } from '../../db';
import { calls, campaigns, contacts, incomingConnections, globalSettings, agents, flows, sipCalls, sipPhoneNumbers } from '../../../shared/schema';
import { eq, sql, and, desc } from 'drizzle-orm';
import { storage } from '../../storage';
import { webhookDeliveryService } from '../../services/webhook-delivery';
import crypto from 'crypto';
import WebSocket from 'ws';
import { CreditDeductionResult } from '../../services/credit-service';

export const MAX_WEBHOOK_ATTEMPTS = 3;

export async function sendWebSocketWithRetry(
  ws: WebSocket,
  message: any,
  maxRetries: number = 2
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
      } else {
        console.warn(`[WebSocket] Attempt ${attempt + 1}/${maxRetries + 1}: Socket not OPEN (state: ${ws.readyState})`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      console.error(`[WebSocket] Attempt ${attempt + 1}/${maxRetries + 1}: Send failed:`, error);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  return false;
}

export function classifyLeadFromTranscript(
  conversationHistory: Array<{ role: 'user' | 'agent', text: string, timestamp: Date }>
): { classification: string; summary: string } {
  const userMessages = conversationHistory.filter(m => m.role === 'user').map(m => m.text);
  const agentMessages = conversationHistory.filter(m => m.role === 'agent').map(m => m.text);
  
  let aiSummary = `Call had ${conversationHistory.length} conversation exchanges. `;
  aiSummary += `User spoke ${userMessages.length} times. `;
  aiSummary += `Agent spoke ${agentMessages.length} times.`;
  
  let classification = 'warm';
  const fullUserResponse = userMessages.join(' ').toLowerCase();
  
  const containsPhrase = (text: string, phrases: string[]): boolean => {
    return phrases.some(phrase => {
      if (phrase.includes(' ')) {
        return text.includes(phrase);
      }
      const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const wordBoundaryRegex = new RegExp(`(?<!\\p{L})${escapedPhrase}(?!\\p{L})`, 'iu');
        return wordBoundaryRegex.test(text);
      } catch (e) {
        return text.includes(phrase);
      }
    });
  };
  
  const strongInterestKeywords = [
    'tell me more', 'sounds good', 'want to know', 'looking for', 'yes please',
    'want to try', 'send details', 'how much', 'kya price', 'what cost',
    'i am interested', "i'm interested", 'sounds interesting', 'very interested',
    'would like', 'want demo', 'need demo', 'schedule demo', 'book demo',
    'interested हूँ', 'interested हूं', 'जानना चाहता', 'जानना चाहती',
    'कब मिल', 'कितना है', 'demo चाहिए', 'बताओ ज़रा', 'details भेजो',
    'interested hoon', 'jaanna chahta', 'kab mil', 'kitna hai',
    'बताओ', 'बताइए', 'हाँ', 'हां',
  ];
  
  const clearRejectionPhrases = [
    'not interested', 'no thanks', 'not thinking about', "don't want", 'no need',
    'not now', 'maybe later', 'not looking for', 'already have', 'too busy',
    'नहीं सोच रहा', 'नहीं सोच रही', 'ऐसा कुछ नहीं सोच', 
    'कोई जरूरत नहीं', 'interested नहीं', 'नहीं चाहिए',
    'अभी नहीं चाहिए', 'बाद में देखेंगे',
    'nahi soch raha', 'nahi soch rahi', 'aisa kuch nahi soch',
    'koi zarurat nahi', 'nahi chahiye', 'abhi nahi chahiye',
  ];
  
  const hasStrongInterest = containsPhrase(fullUserResponse, strongInterestKeywords);
  const hasClearRejection = containsPhrase(fullUserResponse, clearRejectionPhrases);
  
  if (hasClearRejection) {
    classification = 'lost';
    aiSummary += ` Lead not interested.`;
  } else if (hasStrongInterest && conversationHistory.length > 4) {
    classification = 'hot';
    aiSummary += ` Lead showed strong interest.`;
  } else if (hasStrongInterest) {
    classification = 'warm';
    aiSummary += ` Lead showed interest.`;
  } else if (conversationHistory.length < 3) {
    classification = 'cold';
    aiSummary += ` Limited engagement.`;
  } else {
    classification = 'warm';
    aiSummary += ` Moderate engagement.`;
  }
  
  return { classification, summary: aiSummary };
}

export async function formatAndSaveTranscript(
  callId: string | null,
  conversationHistory: Array<{ role: 'user' | 'agent', text: string, timestamp: Date }>
): Promise<void> {
  if (!callId || conversationHistory.length === 0) {
    console.log(`[Transcript] Skipping save - callId: ${!!callId}, history length: ${conversationHistory.length}`);
    return;
  }

  try {
    const [existingCall] = await db
      .select({ transcript: calls.transcript, aiSummary: calls.aiSummary, classification: calls.classification })
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);
    
    const existingTranscript = existingCall?.transcript || '';
    
    const userTurnCount = (existingTranscript.match(/\[USER\]:|USER \(/gi) || []).length;
    const agentTurnCount = (existingTranscript.match(/\[AGENT\]:|AGENT \(/gi) || []).length;
    
    const totalTurns = userTurnCount + agentTurnCount;
    const isExistingMeaningful = totalTurns >= 2 && userTurnCount >= 1 && agentTurnCount >= 1;
    
    if (isExistingMeaningful) {
      console.log(`[Transcript] Skipping save - call ${callId} already has meaningful synced transcript (${totalTurns} turns, ${existingTranscript.length} chars)`);
      return;
    }
    
    if (existingTranscript && !isExistingMeaningful) {
      console.log(`[Transcript] Overwriting non-meaningful transcript (${existingTranscript.length} chars, ${userTurnCount} user turns, ${agentTurnCount} agent turns)`);
    }
    
    const formattedTranscript = conversationHistory
      .map(msg => `[${msg.role.toUpperCase()}]: ${msg.text}`)
      .join('\n');
    
    console.log(`💾 [Saving Transcript] Call ${callId} - ${conversationHistory.length} messages`);
    
    const updates: Record<string, any> = {
      transcript: formattedTranscript,
      sentiment: 'neutral'
    };
    
    if (!existingCall?.aiSummary || !existingCall?.classification) {
      const { classification, summary } = classifyLeadFromTranscript(conversationHistory);
      if (!existingCall?.aiSummary) {
        updates.aiSummary = summary;
      }
      if (!existingCall?.classification) {
        updates.classification = classification;
      }
    }
    
    await db.update(calls)
      .set(updates)
      .where(eq(calls.id, callId));
    
    console.log(`✅ [Transcript Saved] Call ${callId}`);
  } catch (error) {
    console.error(`❌ [Transcript Save Error] Call ${callId}:`, error);
  }
}

/**
 * Shared retry scheduling helper — called from all three engine webhook handlers
 * (ElevenLabs, Twilio+OpenAI, Plivo) whenever a call reaches a terminal status.
 *
 * Responsibilities:
 *  1. Increment the contact's attemptCount and stamp lastAttemptAt
 *  2. If the campaign has retryEnabled and the terminal status matches the
 *     configured retry-on flags, set nextRetryAt on the contact so the
 *     30-second poller in campaign-scheduler picks it up.
 */
export async function scheduleContactRetry(
  contactId: string,
  campaignId: string,
  callStatus: string
): Promise<void> {
  try {
    // Only act on terminal statuses
    const terminalStatuses = ['completed', 'failed', 'no-answer', 'busy', 'cancelled', 'canceled'];
    if (!terminalStatuses.includes(callStatus)) return;

    // Normalize cancelled → canceled for consistency in contact status
    const normalizedStatus = callStatus === 'canceled' ? 'cancelled' : callStatus;

    // Fetch the contact BEFORE any updates to read current attemptCount
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) return;

    // Skip if already has a retry scheduled (avoid double-scheduling)
    if (contact.nextRetryAt) return;

    // Increment attemptCount to reflect this completed call and update status + lastAttemptAt.
    // The guard check uses the PRE-increment value so that maxAttempts semantics are correct:
    //   default=1 (attempt 1 in progress), each call-end increments by 1.
    const currentCount = contact.attemptCount ?? 1;
    const newCount = currentCount + 1;
    await db
      .update(contacts)
      .set({
        status: normalizedStatus,
        lastAttemptAt: new Date(),
        attemptCount: newCount,
      })
      .where(eq(contacts.id, contactId));

    // Sync terminal status to the canonical calls table row so the campaign scheduler
    // and campaign detail page immediately reflect the actual outcome.
    // We target the MOST RECENTLY CREATED row (DESC createdAt) to correctly handle
    // retries — each retry creates a new calls row, and we must only update the latest one.
    try {
      const [latestCallsRow] = await db
        .select({ id: calls.id })
        .from(calls)
        .where(and(
          eq(calls.campaignId, campaignId),
          eq(calls.contactId, contactId)
        ))
        .orderBy(desc(calls.createdAt))
        .limit(1);
      if (latestCallsRow) {
        await db
          .update(calls)
          .set({ status: normalizedStatus, endedAt: new Date() })
          .where(eq(calls.id, latestCallsRow.id));
      } else {
        console.warn(`⚠️ [Retry] No calls row found for contact ${contactId} campaign ${campaignId} — calls status not synced`);
      }
    } catch (callsSyncErr: any) {
      console.error(`⚠️ [Retry] Failed to sync calls table for contact ${contactId}: ${callsSyncErr.message}`);
    }

    // Fetch campaign config to decide if this contact should be retried
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.retryEnabled) return;

    // Check if this status qualifies for a retry
    const retryStatuses: string[] = [];
    if (campaign.retryOnNoAnswer !== false) retryStatuses.push('no-answer');
    if (campaign.retryOnBusy === true) retryStatuses.push('busy');
    if (campaign.retryOnFailed === true) retryStatuses.push('failed');

    if (!retryStatuses.includes(normalizedStatus)) return;

    // Guard on PRE-increment count: if currentCount >= maxAttempts, this call
    // was already the last allowed attempt — do not schedule another retry.
    const maxAttempts = campaign.retryMaxAttempts ?? 3;
    if (currentCount >= maxAttempts) {
      console.log(`📊 [Retry] Contact ${contactId} has reached max attempts (${currentCount}/${maxAttempts})`);
      return;
    }

    // Schedule the next retry
    const intervalMinutes = campaign.retryIntervalMinutes ?? 60;
    const nextRetryAt = new Date(Date.now() + intervalMinutes * 60 * 1000);

    await db
      .update(contacts)
      .set({ nextRetryAt })
      .where(eq(contacts.id, contactId));

    console.log(`🔄 [Retry] Contact ${contactId} scheduled for retry at ${nextRetryAt.toISOString()} (attempt ${currentCount} of ${maxAttempts})`);
  } catch (err: any) {
    console.error(`⚠️ [Retry] scheduleContactRetry failed for contact ${contactId}: ${err.message}`);
  }
}

export async function updateCampaignStats(callId: string, callStatus: string): Promise<void> {
  try {
    console.log(`📊 [Campaign Stats] Updating stats for call ${callId} with status ${callStatus}`);
    
    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    
    if (call && call.campaignId) {
      const campaignCalls = await db.select().from(calls).where(eq(calls.campaignId, call.campaignId));
      
      const completedCallsCount = campaignCalls.filter(c => 
        ['completed', 'failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      const successfulCallsCount = campaignCalls.filter(c => c.status === 'completed').length;
      const failedCallsCount = campaignCalls.filter(c => 
        ['failed', 'busy', 'no-answer'].includes(c.status)
      ).length;
      
      await db.update(campaigns)
        .set({
          completedCalls: completedCallsCount,
          successfulCalls: successfulCallsCount,
          failedCalls: failedCallsCount
        })
        .where(eq(campaigns.id, call.campaignId));
      
      console.log(`📊 [Campaign Stats Updated] Campaign ${call.campaignId}: ${completedCallsCount}/${campaignCalls.length} calls completed`);

      // Update contact attempt tracking and schedule retry if eligible
      if (call.contactId && call.campaignId) {
        scheduleContactRetry(call.contactId, call.campaignId, callStatus).catch(err => {
          console.warn(`⚠️ [Contact Retry] scheduleContactRetry failed: ${err.message}`);
        });
      }
      
      if (call.userId) {
        const contact = call.contactId ? await storage.getContact(call.contactId) : null;
        const campaign = await storage.getCampaign(call.campaignId);
        
        if (callStatus === 'completed') {
          webhookDeliveryService.triggerEvent(call.userId, 'call.completed', {
            campaign: campaign ? { id: campaign.id, name: campaign.name, type: campaign.type } : null,
            contact: contact ? {
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              phone: contact.phone,
              email: contact.email,
              customFields: contact.customFields,
            } : { phone: call.phoneNumber },
            call: {
              id: call.id,
              status: call.status,
              duration: call.duration,
              phoneNumber: call.phoneNumber,
              startedAt: call.startedAt,
              endedAt: call.endedAt,
              leadClassification: call.classification,
              classification: call.classification,
              sentiment: call.sentiment,
              transcript: call.transcript,
              aiSummary: call.aiSummary,
              recordingUrl: call.recordingUrl,
            }
          }, call.campaignId).catch(err => {
            console.error('❌ [Webhook] Error triggering call.completed event:', err);
          });
        }

        if (call.incomingAgentId && ['completed', 'failed', 'busy', 'no-answer'].includes(callStatus)) {
          try {
            const [agent] = await db
              .select()
              .from(agents)
              .where(eq(agents.id, call.incomingAgentId))
              .limit(1);
            
            if (agent && agent.type === 'flow' && agent.flowId) {
              const [flow] = await db
                .select()
                .from(flows)
                .where(eq(flows.id, agent.flowId))
                .limit(1);
              
              if (flow) {
                const flowEventType = callStatus === 'completed' ? 'flow.completed' : 'flow.failed';
                const flowDuration = call.duration || 
                  (call.startedAt && call.endedAt 
                    ? Math.ceil((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
                    : undefined);

                const flowPayload: Record<string, unknown> = {
                  flowId: flow.id,
                  flowName: flow.name,
                  callId: call.id,
                  callSid: call.twilioSid,
                  agentId: agent.id,
                  userId: call.userId,
                };

                if (callStatus === 'completed') {
                  flowPayload.duration = flowDuration;
                  flowPayload.nodesExecuted = (flow.nodes as any[])?.length || 0;
                } else {
                  flowPayload.error = {
                    code: 'CALL_FAILED',
                    message: callStatus,
                  };
                }

                await webhookDeliveryService.triggerEvent(call.userId, flowEventType, flowPayload, call.campaignId);
                console.log(`✅ [Webhook] Triggered ${flowEventType} for call ${call.id}, flow ${flow.name}`);
              }
            }
          } catch (flowWebhookError: any) {
            console.error(`❌ [Webhook] Error triggering flow webhook:`, flowWebhookError.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error updating campaign stats:', error);
  }
}

export async function fireWebhook(webhookId: string, callId: string, attempt: number = 1): Promise<void> {
  try {
    const webhook = await storage.getWebhook(webhookId);
    if (!webhook || !webhook.isActive) {
      console.log(`🔕 [Webhook] Webhook ${webhookId} not found or inactive`);
      return;
    }

    const call = await storage.getCall(callId);
    if (!call) {
      console.log(`❌ [Webhook] Call ${callId} not found`);
      return;
    }

    if (!call.campaignId) {
      console.log(`❌ [Webhook] Call ${callId} has no campaign ID`);
      return;
    }
    const campaign = await storage.getCampaign(call.campaignId);
    if (!campaign) {
      console.log(`❌ [Webhook] Campaign ${call.campaignId} not found`);
      return;
    }

    let contact = null;
    if (call.contactId) {
      contact = await storage.getContact(call.contactId);
    }

    const payload = {
      event: "call.completed",
      timestamp: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name,
      },
      contact: contact ? {
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
      } : {
        phone: call.phoneNumber,
      },
      call: {
        id: call.id,
        status: call.status,
        duration: call.duration,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        leadClassification: call.classification,
        sentiment: call.sentiment,
        transcript: call.transcript,
        aiSummary: call.aiSummary,
      }
    };

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    console.log(`📤 [Webhook] Firing webhook to ${webhook.url} (attempt ${attempt}/${MAX_WEBHOOK_ATTEMPTS})`);

    const startTime = Date.now();
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': new Date().toISOString(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const responseText = await response.text();
    const responseTime = Date.now() - startTime;

    if (response.ok) {
      await storage.createWebhookLog({
        webhookId: webhook.id,
        event: 'call.completed',
        payload: payload as any,
        success: true,
        httpStatus: response.status,
        responseBody: responseText.substring(0, 2000),
        responseTime,
        error: null,
        attemptNumber: attempt,
        maxAttempts: MAX_WEBHOOK_ATTEMPTS,
      });
      
      console.log(`✅ [Webhook] Successfully delivered to ${webhook.url}`);
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error: any) {
    console.error(`❌ [Webhook] Delivery failed (attempt ${attempt}/${MAX_WEBHOOK_ATTEMPTS}):`, error.message);

    try {
      const webhook = await storage.getWebhook(webhookId);
      const call = await storage.getCall(callId);
      
      if (webhook && call) {
        const nextRetryAt = attempt < MAX_WEBHOOK_ATTEMPTS 
          ? new Date(Date.now() + Math.pow(2, attempt) * 1000)
          : null;
          
        await storage.createWebhookLog({
          webhookId: webhook.id,
          event: 'call.completed',
          payload: { event: "call.completed", callId } as any,
          success: false,
          httpStatus: null,
          responseBody: null,
          responseTime: null,
          error: error.message,
          attemptNumber: attempt,
          maxAttempts: MAX_WEBHOOK_ATTEMPTS,
          nextRetryAt,
        });
      }
    } catch (logError) {
      console.error('Failed to log webhook delivery:', logError);
    }

    if (attempt < MAX_WEBHOOK_ATTEMPTS) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`🔄 [Webhook] Retrying in ${delay}ms...`);
      setTimeout(() => fireWebhook(webhookId, callId, attempt + 1), delay);
    }
  }
}

export async function deductCallCreditsForElevenLabs(callId: string, duration: number): Promise<CreditDeductionResult> {
  try {
    const [creditPriceSetting] = await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'credit_price_per_minute'))
      .limit(1);
    
    let creditPricePerMinute = 1;
    if (creditPriceSetting?.value) {
      const parsed = Number(creditPriceSetting.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        creditPricePerMinute = parsed;
      } else {
        console.warn(`⚠️ [Credit Deduction] Invalid credit_price_per_minute setting: ${creditPriceSetting.value}. Using default: 1`);
      }
    }
    
    const minutes = Math.ceil(duration / 60);
    const creditsToDeduct = Math.ceil(minutes * creditPricePerMinute);
    
    console.log(`💳 [Credit Deduction] Duration: ${duration}s (${minutes} min) × ${creditPricePerMinute} = ${creditsToDeduct} credits (rounded up)`);
    
    const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
    
    if (!call) {
      console.error(`❌ [Credit Deduction] Call ${callId} not found`);
      return { success: false, creditsDeducted: 0, error: 'Call not found' };
    }
    
    if (call.widgetId) {
      console.log(`⏭️ [Credit Deduction] Skipping for widget call ${callId} - already billed via widget session`);
      return { success: true, creditsDeducted: 0, alreadyDeducted: true };
    }
    
    let userId: string | null = null;
    const callDirection = call.callDirection || 'unknown';
    const fromNumber = call.fromNumber || 'Unknown';
    const toNumber = call.toNumber || call.phoneNumber || 'unknown';
    
    if (call.campaignId) {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, call.campaignId)).limit(1);
      if (campaign && campaign.userId) {
        userId = campaign.userId;
      }
    } else if (call.incomingConnectionId) {
      const [connection] = await db
        .select()
        .from(incomingConnections)
        .where(eq(incomingConnections.id, call.incomingConnectionId))
        .limit(1);
      
      if (connection && connection.userId) {
        userId = connection.userId;
      }
    } else if (call.userId) {
      userId = call.userId;
    }
    
    if (userId) {
      const { deductCallCredits } = await import('../../services/credit-service');
      const result = await deductCallCredits({
        userId,
        creditsToDeduct,
        callId: call.id,
        fromNumber,
        toNumber,
        durationSeconds: duration,
        engine: 'elevenlabs-twilio',
      });
      return result;
    } else {
      console.warn(`⚠️ [Credit Deduction] Could not determine user for call ${callId}`);
      return { success: false, creditsDeducted: 0, error: 'Could not determine user for call' };
    }
  } catch (error: any) {
    console.error('❌ [Credit Deduction Error]:', error);
    return { success: false, creditsDeducted: 0, error: error.message || 'Unknown error' };
  }
}

export async function deductCallCreditsForSip(
  sipCallId: string, 
  duration: number, 
  engine: 'elevenlabs-sip' | 'openai-sip'
): Promise<CreditDeductionResult> {
  try {
    const [creditPriceSetting] = await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.key, 'credit_price_per_minute'))
      .limit(1);
    
    let creditPricePerMinute = 1;
    if (creditPriceSetting?.value) {
      const parsed = Number(creditPriceSetting.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        creditPricePerMinute = parsed;
      } else {
        console.warn(`⚠️ [SIP Credit Deduction] Invalid credit_price_per_minute setting: ${creditPriceSetting.value}. Using default: 1`);
      }
    }
    
    const minutes = Math.ceil(duration / 60);
    const creditsToDeduct = Math.ceil(minutes * creditPricePerMinute);
    
    console.log(`💳 [SIP Credit Deduction] Duration: ${duration}s (${minutes} min) × ${creditPricePerMinute} = ${creditsToDeduct} credits (rounded up)`);
    
    const [sipCall] = await db.select().from(sipCalls).where(eq(sipCalls.id, sipCallId)).limit(1);
    
    if (!sipCall) {
      console.error(`❌ [SIP Credit Deduction] SIP Call ${sipCallId} not found`);
      return { success: false, creditsDeducted: 0, error: 'SIP Call not found' };
    }
    
    const userId = sipCall.userId;
    const fromNumber = sipCall.fromNumber || 'Unknown';
    const toNumber = sipCall.toNumber || 'unknown';
    
    if (userId) {
      const { deductCallCredits } = await import('../../services/credit-service');
      const result = await deductCallCredits({
        userId,
        creditsToDeduct,
        callId: sipCall.id,
        fromNumber,
        toNumber,
        durationSeconds: duration,
        engine: engine,
      });
      
      if (result.success) {
        await db.execute(sql`
          UPDATE sip_calls 
          SET credits_used = ${creditsToDeduct}, updated_at = NOW()
          WHERE id = ${sipCallId}
        `);
        console.log(`✅ [SIP Credit Deduction] Updated sip_calls.credits_used: ${creditsToDeduct}`);
      }
      
      return result;
    } else {
      console.warn(`⚠️ [SIP Credit Deduction] Could not determine user for SIP call ${sipCallId}`);
      return { success: false, creditsDeducted: 0, error: 'Could not determine user for SIP call' };
    }
  } catch (error: any) {
    console.error('❌ [SIP Credit Deduction Error]:', error);
    return { success: false, creditsDeducted: 0, error: error.message || 'Unknown error' };
  }
}
