'use strict';
import { db } from '../db';
import { leads, leadStages, contacts, plivoCalls, twilioOpenaiCalls, campaigns, incomingConnections, agents } from '@shared/schema';
import { eq, and, or, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';

interface CallData {
  userId: string;
  callId: string;
  engine: 'plivo' | 'twilio-openai' | 'twilio-elevenlabs';
  sourceType: 'campaign' | 'incoming';
  campaignId?: string | null;
  incomingConnectionId?: string | null;
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  transcript?: string | null;
  aiSummary?: string | null;
  sentiment?: string | null;
  classification?: string | null;
  duration?: number | null;
  recordingUrl?: string | null;
  toolsExecuted?: {
    appointment?: boolean;
    formSubmission?: boolean;
    transfer?: boolean;
    callback?: boolean;
  };
  metadata?: Record<string, unknown>;
}

interface LeadScoreResult {
  score: number;
  stage: string;
  summary: string;
  suggestedNextAction?: string;
}

export class CRMLeadService {
  static async createLeadFromCall(callData: CallData): Promise<{ leadId: string } | null> {
    try {
      // Guard against missing identifiers
      if (callData.sourceType === 'campaign' && !callData.campaignId) {
        console.log('[CRM] Skipping lead creation - campaign call missing campaignId');
        return null;
      }
      if (callData.sourceType === 'incoming' && !callData.incomingConnectionId) {
        console.log('[CRM] Skipping lead creation - incoming call missing incomingConnectionId');
        return null;
      }

      const sourceConditions = callData.sourceType === 'campaign'
        ? and(
            eq(leads.userId, callData.userId),
            eq(leads.phone, callData.phone),
            eq(leads.sourceType, 'campaign'),
            eq(leads.campaignId, callData.campaignId!)
          )
        : and(
            eq(leads.userId, callData.userId),
            eq(leads.phone, callData.phone),
            eq(leads.sourceType, 'incoming'),
            eq(leads.incomingConnectionId, callData.incomingConnectionId!)
          );

      const existingLead = await db
        .select()
        .from(leads)
        .where(sourceConditions)
        .limit(1);

      if (existingLead.length > 0) {
        const lead = existingLead[0];
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (callData.transcript) updateData.transcript = callData.transcript;
        if (callData.aiSummary) updateData.aiSummary = callData.aiSummary;
        if (callData.sentiment) updateData.sentiment = callData.sentiment;
        if (callData.recordingUrl) updateData.recordingUrl = callData.recordingUrl;
        if (callData.engine === 'plivo') {
          updateData.plivoCallId = callData.callId;
        } else if (callData.engine === 'twilio-openai') {
          updateData.twilioOpenaiCallId = callData.callId;
        } else {
          updateData.callId = callData.callId;
        }

        if (callData.toolsExecuted) {
          if (callData.toolsExecuted.appointment) updateData.hasAppointment = true;
          if (callData.toolsExecuted.formSubmission) updateData.hasFormSubmission = true;
          if (callData.toolsExecuted.transfer) updateData.hasTransfer = true;
          if (callData.toolsExecuted.callback) updateData.hasCallback = true;
        }

        await db
          .update(leads)
          .set(updateData)
          .where(eq(leads.id, lead.id));

        if (callData.transcript && callData.transcript.length > 50) {
          await this.updateLeadScore(lead.id, callData.userId, callData.transcript);
        }

        console.log(`[CRM] Updated existing lead ${lead.id} for ${callData.phone}`);
        return { leadId: lead.id };
      }

      let defaultStage = await db
        .select()
        .from(leadStages)
        .where(and(
          eq(leadStages.userId, callData.userId),
          eq(leadStages.isDefault, true)
        ))
        .limit(1);

      if (defaultStage.length === 0) {
        defaultStage = await db
          .select()
          .from(leadStages)
          .where(eq(leadStages.userId, callData.userId))
          .orderBy(asc(leadStages.order))
          .limit(1);
      }

      const stageName = defaultStage.length > 0 ? defaultStage[0].name : 'new';
      const stageId = defaultStage.length > 0 ? defaultStage[0].id : null;

      const leadId = nanoid();
      const leadData: Record<string, unknown> = {
        id: leadId,
        userId: callData.userId,
        sourceType: callData.sourceType,
        phone: callData.phone,
        firstName: callData.firstName || null,
        lastName: callData.lastName || null,
        email: callData.email || null,
        stage: stageName,
        stageId: stageId,
        leadScore: 50,
        aiSummary: callData.aiSummary || null,
        sentiment: callData.sentiment || null,
        transcript: callData.transcript || null,
        recordingUrl: callData.recordingUrl || null,
        hasAppointment: callData.toolsExecuted?.appointment || false,
        hasFormSubmission: callData.toolsExecuted?.formSubmission || false,
        hasTransfer: callData.toolsExecuted?.transfer || false,
        hasCallback: callData.toolsExecuted?.callback || false,
        customFields: callData.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (callData.sourceType === 'campaign' && callData.campaignId) {
        leadData.campaignId = callData.campaignId;
      } else if (callData.sourceType === 'incoming' && callData.incomingConnectionId) {
        leadData.incomingConnectionId = callData.incomingConnectionId;
      }

      if (callData.engine === 'plivo') {
        leadData.plivoCallId = callData.callId;
      } else if (callData.engine === 'twilio-openai') {
        leadData.twilioOpenaiCallId = callData.callId;
      } else {
        leadData.callId = callData.callId;
      }

      await db.insert(leads).values(leadData as any);

      if (callData.transcript && callData.transcript.length > 50) {
        await this.updateLeadScore(leadId, callData.userId, callData.transcript);
      }

      console.log(`[CRM] Created new lead ${leadId} for ${callData.phone} from ${callData.sourceType}`);
      return { leadId };
    } catch (error: any) {
      console.error('[CRM] Error creating lead from call:', error.message);
      return null;
    }
  }

  static async updateLeadScore(leadId: string, userId: string, transcript: string): Promise<void> {
    try {
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        console.log('[CRM] No OpenAI API key for lead scoring');
        return;
      }

      const openai = new OpenAI({ apiKey: openaiApiKey });
      const scoreResult = await this.analyzeLeadFromTranscript(openai, transcript);

      if (scoreResult) {
        const userStages = await db
          .select()
          .from(leadStages)
          .where(eq(leadStages.userId, userId))
          .orderBy(asc(leadStages.order));

        let matchedStageId: string | null = null;
        let matchedStageName = scoreResult.stage;

        for (const stage of userStages) {
          if (stage.name.toLowerCase() === scoreResult.stage.toLowerCase()) {
            matchedStageId = stage.id;
            matchedStageName = stage.name;
            break;
          }
        }

        const updateData: Record<string, unknown> = {
          leadScore: scoreResult.score,
          aiSummary: scoreResult.summary,
          updatedAt: new Date(),
        };

        if (matchedStageId) {
          updateData.stage = matchedStageName;
          updateData.stageId = matchedStageId;
        }

        if (scoreResult.suggestedNextAction) {
          updateData.aiNextAction = scoreResult.suggestedNextAction;
        }

        await db
          .update(leads)
          .set(updateData)
          .where(eq(leads.id, leadId));

        console.log(`[CRM] Updated lead ${leadId} with score ${scoreResult.score} -> ${matchedStageName}`);
      }
    } catch (error: any) {
      console.error('[CRM] Error updating lead score:', error.message);
    }
  }

  static async analyzeLeadFromTranscript(openai: OpenAI, transcript: string): Promise<LeadScoreResult | null> {
    try {
      const prompt = `Analyze this sales/support call transcript and provide lead scoring.

TRANSCRIPT:
${transcript.substring(0, 4000)}

Analyze and return a JSON object with:
1. "score": Number 1-100 indicating lead quality/interest level
   - 80-100: Hot lead, high intent, ready to buy/book
   - 60-79: Warm lead, interested but needs follow-up
   - 40-59: Neutral, some interest but uncertain
   - 20-39: Cool lead, minimal interest
   - 1-19: Not interested or wrong number

2. "stage": One of these stages based on the conversation:
   - "hot" - Expressed strong interest or intent
   - "appointment" - Scheduled a meeting/demo
   - "form_submitted" - Provided information/signed up
   - "follow_up" - Requested callback or more info
   - "not_interested" - Declined or uninterested
   - "no_answer" - Voicemail or no response
   - "new" - Default for unclear outcomes

3. "summary": 2-3 sentence summary of the call outcome and lead status

4. "suggestedNextAction": Brief recommended next step (optional)

Return ONLY valid JSON:`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const result = JSON.parse(content);
      return {
        score: Math.max(1, Math.min(100, result.score || 50)),
        stage: result.stage || 'new',
        summary: result.summary || 'Call completed',
        suggestedNextAction: result.suggestedNextAction,
      };
    } catch (error: any) {
      console.error('[CRM] Error analyzing transcript:', error.message);
      return null;
    }
  }

  static async trackToolExecution(leadId: string, toolName: 'appointment' | 'form' | 'transfer' | 'callback'): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      switch (toolName) {
        case 'appointment':
          updateData.hasAppointment = true;
          break;
        case 'form':
          updateData.hasFormSubmission = true;
          break;
        case 'transfer':
          updateData.hasTransfer = true;
          break;
        case 'callback':
          updateData.hasCallback = true;
          break;
      }

      await db
        .update(leads)
        .set(updateData)
        .where(eq(leads.id, leadId));

      console.log(`[CRM] Tracked tool execution: ${toolName} for lead ${leadId}`);
    } catch (error: any) {
      console.error('[CRM] Error tracking tool:', error.message);
    }
  }
}
