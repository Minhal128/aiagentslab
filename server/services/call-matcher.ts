/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
/**
 * Call Matcher Service
 * 
 * Matches webhook tool invocations (form submissions, appointments) to their originating calls.
 * Since ElevenLabs webhook tools don't receive the callId dynamically, we need to find the
 * correct call using available identifiers: agent ID, phone number, and timestamp proximity.
 * 
 * CONSERVATIVE Matching Strategy (to prevent incorrect linkage):
 * 1. REQUIRED: Phone number match OR single active call for the agent
 * 2. If multiple calls exist without phone match → return null (no guessing)
 * 3. Only match completed calls if phone matches exactly
 * 
 * Call-Agent Association:
 * - Outbound calls: calls.campaignId -> campaigns.agentId
 * - Incoming calls: calls.incomingConnectionId -> incomingConnections.agentId
 */

import { db } from '../db';
import { calls, agents, contacts, campaigns, incomingConnections, sipCalls } from '../../shared/schema';
import { eq, and, desc, gte, or, sql, isNull } from 'drizzle-orm';

// Time windows for matching
const PHONE_MATCH_WINDOW_MINUTES = 30;  // Wider window when we have phone match
const ACTIVE_CALL_WINDOW_MINUTES = 5;   // Tight window for single-active-call fallback

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Remove all non-digit characters
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 6) return null; // Too short to be a valid phone
  // Take last 10 digits for comparison (strips country codes)
  return digits.slice(-10);
}

/**
 * Compare two phone numbers for equality
 * Uses multiple strategies: exact match, last 10 digits, last 7 digits (local)
 */
function phonesMatch(phone1: string | null | undefined, phone2: string | null | undefined): boolean {
  if (!phone1 || !phone2) return false;
  
  const norm1 = normalizePhone(phone1);
  const norm2 = normalizePhone(phone2);
  
  if (!norm1 || !norm2) return false;
  
  // Exact normalized match (last 10 digits)
  if (norm1 === norm2) return true;
  
  // Try last 7 digits match (handles cases where country code varies)
  const last7_1 = norm1.slice(-7);
  const last7_2 = norm2.slice(-7);
  if (last7_1.length >= 7 && last7_1 === last7_2) {
    // Only accept if one is clearly a subset of the other
    // This prevents matching unrelated numbers
    const digits1 = phone1.replace(/[^0-9]/g, '');
    const digits2 = phone2.replace(/[^0-9]/g, '');
    if (digits1.endsWith(last7_1) && digits2.endsWith(last7_2)) {
      return true;
    }
  }
  
  return false;
}

export interface MatchedCallInfo {
  callId: string;
  phoneNumber: string | null;
  contactId: string | null;
  contactName: string | null;
  verifiedContactPhone: string | null;
  matchConfidence: 'phone_match' | 'single_active_call' | 'ambiguous';
}

/**
 * Find the most likely call for a webhook tool invocation
 * 
 * CONSERVATIVE MATCHING: To prevent incorrect call linkage, this function:
 * - Requires phone number match for completed calls
 * - Only matches without phone if there's exactly ONE active call
 * - Returns null if matching is ambiguous (multiple candidates, no phone)
 * 
 * @param elevenLabsAgentId - The ElevenLabs agent ID from the webhook URL
 * @param webhookPhone - The phone number from the webhook payload (optional)
 * @param userId - The user ID who owns the agent (for security filtering)
 * @returns The matched call info or null if no confident match found
 */
export async function findCallForWebhook(
  elevenLabsAgentId: string,
  webhookPhone: string | null | undefined,
  userId: string
): Promise<MatchedCallInfo | null> {
  const phoneMatchWindowStart = new Date(Date.now() - PHONE_MATCH_WINDOW_MINUTES * 60 * 1000);
  const activeCallWindowStart = new Date(Date.now() - ACTIVE_CALL_WINDOW_MINUTES * 60 * 1000);
  const normalizedSearchPhone = normalizePhone(webhookPhone);
  
  console.log(`🔍 [Call Matcher] Looking for call matching:`);
  console.log(`   Agent (ElevenLabs): ${elevenLabsAgentId}`);
  console.log(`   Phone: ${webhookPhone} (normalized: ${normalizedSearchPhone})`);
  console.log(`   User: ${userId}`);
  console.log(`   Phone match window: last ${PHONE_MATCH_WINDOW_MINUTES} minutes`);
  console.log(`   Active call window: last ${ACTIVE_CALL_WINDOW_MINUTES} minutes`);
  
  const agentResult = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.elevenLabsAgentId, elevenLabsAgentId))
    .limit(1);
  
  if (agentResult.length === 0) {
    console.warn(`🔍 [Call Matcher] No agent found with ElevenLabs ID ${elevenLabsAgentId}`);
    return null;
  }
  
  const dbAgentId = agentResult[0].id;
  
  // Query 1: Find outbound calls via campaigns with this agent (wider window for phone matching)
  const outboundCalls = await db
    .select({
      id: calls.id,
      phoneNumber: calls.phoneNumber,
      contactId: calls.contactId,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      status: calls.status
    })
    .from(calls)
    .leftJoin(campaigns, eq(calls.campaignId, campaigns.id))
    .where(and(
      eq(calls.userId, userId),
      eq(campaigns.agentId, dbAgentId),
      gte(calls.startedAt, phoneMatchWindowStart)
    ))
    .orderBy(desc(calls.startedAt))
    .limit(20);
  
  // Query 2: Find incoming calls via incomingConnections with this agent
  const incomingCalls = await db
    .select({
      id: calls.id,
      phoneNumber: calls.phoneNumber,
      contactId: calls.contactId,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      status: calls.status
    })
    .from(calls)
    .leftJoin(incomingConnections, eq(calls.incomingConnectionId, incomingConnections.id))
    .where(and(
      eq(calls.userId, userId),
      eq(incomingConnections.agentId, dbAgentId),
      gte(calls.startedAt, phoneMatchWindowStart)
    ))
    .orderBy(desc(calls.startedAt))
    .limit(20);
  
  // Query 3: Find calls via metadata containing elevenLabsAgentId (batch calls, SIP calls)
  // This catches calls where agent is stored in metadata rather than campaign/connection join
  const metadataCalls = await db
    .select({
      id: calls.id,
      phoneNumber: calls.phoneNumber,
      contactId: calls.contactId,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      status: calls.status
    })
    .from(calls)
    .where(and(
      eq(calls.userId, userId),
      gte(calls.startedAt, phoneMatchWindowStart),
      sql`${calls.metadata}->>'elevenLabsAgentId' = ${elevenLabsAgentId}`
    ))
    .orderBy(desc(calls.startedAt))
    .limit(20);
  
  // Query 4: Find SIP calls with this agent (ElevenLabs SIP or OpenAI SIP)
  // SIP calls are stored in a separate table and need to be included for appointment matching
  const sipCallsResult = await db
    .select({
      id: sipCalls.id,
      phoneNumber: sipCalls.fromNumber, // For incoming SIP calls, fromNumber is the caller's phone
      toNumber: sipCalls.toNumber,
      contactId: sipCalls.contactId,
      startedAt: sipCalls.startedAt,
      endedAt: sipCalls.endedAt,
      status: sipCalls.status,
      direction: sipCalls.direction,
      isSipCall: sql<boolean>`true`.as('is_sip_call')
    })
    .from(sipCalls)
    .where(and(
      eq(sipCalls.userId, userId),
      eq(sipCalls.agentId, dbAgentId),
      gte(sipCalls.startedAt, phoneMatchWindowStart)
    ))
    .orderBy(desc(sipCalls.startedAt))
    .limit(20);
  
  console.log(`🔍 [Call Matcher] Query results: outbound=${outboundCalls.length}, incoming=${incomingCalls.length}, metadata=${metadataCalls.length}, sip=${sipCallsResult.length}`);
  
  // Merge and deduplicate regular calls
  const callMap = new Map<string, typeof outboundCalls[0]>();
  [...outboundCalls, ...incomingCalls, ...metadataCalls].forEach(call => {
    if (!callMap.has(call.id)) {
      callMap.set(call.id, call);
    }
  });
  
  // Add SIP calls to the map (they have a different structure)
  // For SIP calls: use fromNumber for inbound (caller's phone), toNumber for outbound (recipient's phone)
  sipCallsResult.forEach(sipCall => {
    const effectivePhone = sipCall.direction === 'inbound' ? sipCall.phoneNumber : sipCall.toNumber;
    if (!callMap.has(sipCall.id)) {
      callMap.set(sipCall.id, {
        id: sipCall.id,
        phoneNumber: effectivePhone || null,
        contactId: sipCall.contactId,
        startedAt: sipCall.startedAt,
        endedAt: sipCall.endedAt,
        status: sipCall.status || 'unknown'
      });
    }
  });
  
  // Sort by startedAt descending
  const recentCalls = Array.from(callMap.values())
    .sort((a, b) => {
      const aTime = a.startedAt?.getTime() || 0;
      const bTime = b.startedAt?.getTime() || 0;
      return bTime - aTime;
    });
  
  console.log(`🔍 [Call Matcher] Found ${recentCalls.length} recent calls for agent (including ${sipCallsResult.length} SIP calls)`);
  
  if (recentCalls.length === 0) {
    console.log(`🔍 [Call Matcher] No recent calls found - cannot match`);
    return null;
  }
  
  // STRATEGY 1: Find phone match (highest confidence)
  // Phone numbers are unique identifiers - this is the safest match
  // We accept any call status (even completed) if phone matches
  // Uses flexible matching: exact, last 10 digits, or last 7 digits
  if (webhookPhone) {
    // First pass: prefer active calls with phone match
    for (const call of recentCalls) {
      const isActive = (call.status === 'in-progress' || call.status === 'ringing') && call.endedAt === null;
      if (phonesMatch(call.phoneNumber, webhookPhone) && isActive) {
        console.log(`🔍 [Call Matcher] ✅ Phone match found (active): ${call.id}`);
        console.log(`   Matched: ${call.phoneNumber} ~ ${webhookPhone}`);
        return await buildMatchResult(call, 'phone_match');
      }
    }
    
    // Second pass: accept completed calls with phone match (webhook may arrive after call ends)
    for (const call of recentCalls) {
      if (phonesMatch(call.phoneNumber, webhookPhone)) {
        console.log(`🔍 [Call Matcher] ✅ Phone match found (completed): ${call.id}`);
        console.log(`   Matched: ${call.phoneNumber} ~ ${webhookPhone}`);
        return await buildMatchResult(call, 'phone_match');
      }
    }
    console.log(`🔍 [Call Matcher] No phone match found among ${recentCalls.length} calls for ${webhookPhone}`);
  }
  
  // STRATEGY 2: If no phone provided/matched, only match if there's exactly ONE truly active call
  // STRICT CRITERIA for active calls:
  // - endedAt must be NULL (not just status in-progress)
  // - status must be 'in-progress' or 'ringing' 
  // - startedAt must be within tight window (5 minutes)
  const activeCalls = recentCalls.filter(c => {
    const isActive = (c.status === 'in-progress' || c.status === 'ringing') && c.endedAt === null;
    const isRecent = c.startedAt && c.startedAt >= activeCallWindowStart;
    return isActive && isRecent;
  });
  
  console.log(`🔍 [Call Matcher] Found ${activeCalls.length} truly active calls (within ${ACTIVE_CALL_WINDOW_MINUTES}min, endedAt=null)`);
  
  if (activeCalls.length === 1) {
    const singleActiveCall = activeCalls[0];
    console.log(`🔍 [Call Matcher] ✅ Single active call found: ${singleActiveCall.id}`);
    console.log(`   Started: ${singleActiveCall.startedAt?.toISOString()}`);
    console.log(`   Status: ${singleActiveCall.status}`);
    return await buildMatchResult(singleActiveCall, 'single_active_call');
  }
  
  if (activeCalls.length > 1) {
    console.warn(`🔍 [Call Matcher] ⚠️ Multiple active calls (${activeCalls.length}) - ambiguous match, returning null`);
    console.warn(`   Call IDs: ${activeCalls.map(c => c.id).join(', ')}`);
    return null;
  }
  
  // STRATEGY 3: No active calls - fall back to most recent call if there's exactly one
  // This handles cases where the tool webhook arrives after call ends (e.g., long calls)
  // Only use this if there's exactly ONE call in the window to avoid ambiguity
  if (recentCalls.length === 1) {
    const singleRecentCall = recentCalls[0];
    console.log(`🔍 [Call Matcher] ✅ Single recent call fallback: ${singleRecentCall.id}`);
    console.log(`   Started: ${singleRecentCall.startedAt?.toISOString()}`);
    console.log(`   Status: ${singleRecentCall.status}`);
    console.log(`   Note: Call may have ended, but it's the only one for this agent`);
    return await buildMatchResult(singleRecentCall, 'single_active_call');
  }
  
  // STRATEGY 4: No phone match, no active calls, multiple recent calls - cannot match
  console.warn(`🔍 [Call Matcher] ⚠️ No phone match, no active calls, multiple recent calls - cannot confidently match`);
  console.warn(`   Total calls in window: ${recentCalls.length}, Active: ${activeCalls.length}`);
  return null;
}

/**
 * Build the match result with contact information
 */
async function buildMatchResult(
  call: { id: string; phoneNumber: string | null; contactId: string | null; status: string },
  confidence: MatchedCallInfo['matchConfidence']
): Promise<MatchedCallInfo> {
  let contactName: string | null = null;
  let verifiedContactPhone: string | null = null;
  
  if (call.contactId) {
    const contactRecord = await db
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone
      })
      .from(contacts)
      .where(eq(contacts.id, call.contactId))
      .limit(1);
    
    if (contactRecord.length > 0) {
      contactName = [contactRecord[0].firstName, contactRecord[0].lastName].filter(Boolean).join(' ');
      verifiedContactPhone = contactRecord[0].phone || null;
    }
  }
  
  console.log(`🔍 [Call Matcher] Match result:`);
  console.log(`   Call ID: ${call.id}`);
  console.log(`   Phone: ${call.phoneNumber}`);
  console.log(`   Contact: ${contactName || 'N/A'}`);
  console.log(`   Confidence: ${confidence}`);
  
  return {
    callId: call.id,
    phoneNumber: call.phoneNumber,
    contactId: call.contactId,
    contactName,
    verifiedContactPhone,
    matchConfidence: confidence
  };
}
