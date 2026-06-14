'use strict';
/**
 * ============================================================
 * CRM Lead Processor Engine
 * ============================================================
 * 
 * Centralized service that monitors completed calls from ALL 
 * telephony engines and automatically creates qualified CRM leads.
 * 
 * Supported Engines:
 * - ElevenLabs + Twilio (calls table)
 * - Plivo + OpenAI (plivo_calls table)
 * - Twilio + OpenAI (twilio_openai_calls table)
 * 
 * Qualification Criteria (in priority order):
 * 1. appointment_booked - Appointment was scheduled
 * 2. form_submitted - Form data was collected
 * 3. call_transfer - Call was transferred to human
 * 4. need_follow_up - AI determined follow-up needed
 * 5. hot - Engagement score >= 70
 * 6. warm - Engagement score >= 40
 * 
 * Calls that don't meet any criteria are not added to CRM.
 */

import { db } from '../../db';
import { leads, calls, plivoCalls, twilioOpenaiCalls, sipCalls, appointments, AI_LEAD_CATEGORIES, type AILeadCategory } from '@shared/schema';
import { CRMStorage } from '../../storage/crm-storage';
import { eq, and, or, sql } from 'drizzle-orm';

export interface CallData {
  id: string;
  userId: string;
  phoneNumber: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  callDirection: 'incoming' | 'outgoing';
  status: string;
  duration?: number | null;
  transcript?: string | null;
  aiSummary?: string | null;
  sentiment?: string | null;
  classification?: string | null;
  wasTransferred?: boolean;
  transferredTo?: string | null;
  campaignId?: string | null;
  incomingConnectionId?: string | null;
  metadata?: Record<string, unknown> | null;
  aiInsights?: Record<string, unknown> | null;  // ElevenLabs stores insights here
  engine: 'elevenlabs-twilio' | 'plivo-openai' | 'twilio-openai' | 'elevenlabs-sip' | 'openai-sip' | string;
}

export interface LeadQualification {
  qualified: boolean;
  category: AILeadCategory | null;
  score: number;
  hasAppointment: boolean;
  hasFormSubmission: boolean;
  hasTransfer: boolean;
  hasCallback: boolean;
  appointmentData?: Record<string, unknown>;
  formData?: Record<string, unknown>;
}

export class CRMLeadProcessor {
  private static readonly LOG_PREFIX = '[CRM Lead Processor]';
  
  // Minimum quality thresholds
  private static readonly MIN_DURATION_SECONDS = 10;  // At least 10 seconds
  private static readonly MIN_TRANSCRIPT_LENGTH = 20; // At least 20 characters

  /**
   * Resolve the correct phone number based on call direction
   * For incoming calls: customer is the caller (fromNumber)
   * For outgoing calls: customer is the recipient (toNumber)
   * Handles undefined callDirection and engine-specific metadata
   */
  private static resolveLeadPhone(callData: CallData): string {
    let phone: string | null = null;
    
    // First, try engine-specific metadata fields (these are most reliable)
    const metadata = callData.metadata || {};
    if (metadata.customerPhone) {
      phone = String(metadata.customerPhone);
    } else if (metadata.callerPhone) {
      phone = String(metadata.callerPhone);
    }
    
    // If no metadata phone, resolve based on call direction
    if (!phone || !this.isValidPhone(phone)) {
      const direction = callData.callDirection?.toLowerCase();
      
      if (direction === 'incoming') {
        // For incoming calls, the customer called us - use fromNumber
        phone = callData.fromNumber || callData.phoneNumber || callData.toNumber || null;
      } else if (direction === 'outgoing') {
        // For outgoing calls, we called the customer - use toNumber
        phone = callData.toNumber || callData.phoneNumber || callData.fromNumber || null;
      } else {
        // Unknown direction - try both fields, prefer non-empty ones
        phone = callData.fromNumber || callData.toNumber || callData.phoneNumber || null;
      }
    }
    
    // Final validation, normalization and cleanup
    if (phone && this.isValidPhone(phone)) {
      return this.normalizePhone(phone);
    }
    
    return 'Unknown';
  }

  /**
   * Check if a phone number is valid dialable number
   * Rejects SIP identifiers, client IDs, and non-phone strings
   */
  private static isValidPhone(phone: string | null | undefined): boolean {
    if (!phone) return false;
    const cleaned = phone.trim().toLowerCase();
    
    // Reject common placeholder values
    if (cleaned === '' || 
        cleaned === 'unknown' || 
        cleaned === 'anonymous' || 
        cleaned === 'null' || 
        cleaned === 'undefined') {
      return false;
    }
    
    // Reject SIP/client identifiers (Twilio warm-transfer uses these)
    if (cleaned.startsWith('client:') || 
        cleaned.startsWith('sip:') || 
        cleaned.startsWith('agent:') ||
        cleaned.includes('@')) {
      return false;
    }
    
    // Extract just the digits from the phone number
    const digitsOnly = phone.replace(/\D/g, '');
    
    // Must have at least 5 digits (covers short codes) and at most 15 (E.164 max)
    if (digitsOnly.length < 5 || digitsOnly.length > 15) {
      return false;
    }
    
    // Must have at least 50% digits (to reject strings like "CallAgent123")
    const digitRatio = digitsOnly.length / cleaned.replace(/\s/g, '').length;
    if (digitRatio < 0.5) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Normalize phone number to E.164 format for consistent deduplication
   * Always outputs +<digits> format when possible
   */
  private static normalizePhone(phone: string): string {
    // Remove common prefixes
    let normalized = phone.trim();
    
    // Remove whatsapp/tel prefixes
    normalized = normalized.replace(/^(whatsapp:|tel:|phone:)/i, '');
    
    // Extract all digits
    const digitsOnly = normalized.replace(/[^\d]/g, '');
    
    // Determine if original had + prefix
    const hadPlus = normalized.startsWith('+');
    
    // For E.164 compliance, always add + prefix for international numbers
    if (digitsOnly.length >= 10) {
      // If already had +, keep it; otherwise add it for 10+ digit numbers
      return '+' + digitsOnly;
    } else if (digitsOnly.length >= 5) {
      // Short codes or local numbers - preserve original format but clean
      return hadPlus ? '+' + digitsOnly : digitsOnly;
    }
    
    // Fallback - return cleaned version
    return digitsOnly || normalized;
  }

  /**
   * Check if a call meets minimum quality standards for lead creation
   * Requires either meaningful duration OR transcript content OR high-value signals
   */
  private static meetsQualityThreshold(callData: CallData): { passed: boolean; reason: string } {
    // Check for high-value signals that bypass duration/transcript requirements
    // These indicate valid business outcomes even on short/failed-transcription calls
    const metadata = callData.metadata || {};
    const aiInsights = (callData.aiInsights || metadata.aiInsights || {}) as Record<string, unknown>;
    
    // Check for appointment booking indicators
    const hasAppointment = 
      metadata.appointmentBooked === true ||
      metadata.hasAppointment === true ||
      aiInsights.primaryOutcome === 'appointment_booked' ||
      aiInsights.appointmentBooked === true ||
      metadata.appointmentDetails !== undefined ||
      metadata.appointmentData !== undefined;
    
    // Check for form submission indicators
    const hasForm = 
      metadata.formSubmitted === true ||
      metadata.hasFormSubmission === true ||
      aiInsights.primaryOutcome === 'form_submitted' ||
      aiInsights.formSubmitted === true ||
      metadata.formData !== undefined ||
      metadata.collectedData !== undefined;
    
    // Check for transfer/callback indicators
    const hasTransfer = callData.wasTransferred === true || aiInsights.primaryOutcome === 'call_transfer';
    const hasCallback = aiInsights.primaryOutcome === 'need_follow_up' || aiInsights.needsFollowUp === true;
    
    // High-value signals bypass duration/transcript requirements
    if (hasAppointment || hasForm || hasTransfer || hasCallback) {
      return { passed: true, reason: 'Has high-value business outcome' };
    }
    
    // Check if there's a meaningful transcript
    const hasTranscript = callData.transcript && callData.transcript.trim().length >= this.MIN_TRANSCRIPT_LENGTH;
    
    // Check if there's meaningful duration
    const hasDuration = callData.duration && callData.duration >= this.MIN_DURATION_SECONDS;
    
    // Check for explicit qualification signals (these bypass duration/transcript requirements)
    const hasExplicitSignal = 
      (callData.aiSummary && callData.aiSummary.trim().length > 10) ||
      (callData.classification && callData.classification.trim() !== '') ||
      (callData.sentiment && callData.sentiment.trim() !== '');
    
    if (hasTranscript || hasDuration || hasExplicitSignal) {
      return { passed: true, reason: 'Meets quality threshold' };
    }
    
    return { 
      passed: false, 
      reason: `Call too short (${callData.duration || 0}s) and no transcript (${callData.transcript?.length || 0} chars)`
    };
  }

  /**
   * Process a completed call and create a lead if it qualifies
   */
  static async processCall(callData: CallData): Promise<{ leadId: string | null; qualification: LeadQualification }> {
    console.log(`${this.LOG_PREFIX} Processing call ${callData.id} from engine: ${callData.engine}`);
    
    // Check minimum quality threshold first
    const qualityCheck = this.meetsQualityThreshold(callData);
    if (!qualityCheck.passed) {
      console.log(`${this.LOG_PREFIX} Call ${callData.id} rejected: ${qualityCheck.reason}`);
      return { 
        leadId: null, 
        qualification: {
          qualified: false,
          category: null,
          score: 0,
          hasAppointment: false,
          hasFormSubmission: false,
          hasTransfer: false,
          hasCallback: false,
        }
      };
    }

    try {
      // Qualify the call first
      const qualification = await this.qualifyCall(callData);
      
      if (!qualification.qualified) {
        console.log(`${this.LOG_PREFIX} Call ${callData.id} does not qualify for CRM (no category matched)`);
        return { leadId: null, qualification };
      }

      // Check if lead already exists for this call (by phone number)
      const existingLead = await this.findExistingLead(callData);
      if (existingLead) {
        // Update existing lead with new call data and qualification
        const updatedLead = await this.updateExistingLead(existingLead, callData, qualification);
        if (updatedLead) {
          const categoryChanged = existingLead.aiCategory !== updatedLead.aiCategory;
          console.log(`${this.LOG_PREFIX} Updated existing lead ${updatedLead.id} - aiCategory: ${existingLead.aiCategory || 'none'} -> ${updatedLead.aiCategory || qualification.category}${categoryChanged ? ' (changed)' : ''}`);
          return {
            leadId: updatedLead.id,
            qualification,
          };
        }
        // Fall through to create new lead if update failed
        console.log(`${this.LOG_PREFIX} Update returned null, creating new lead`);
      }

      // Create new lead
      const lead = await this.createLeadFromCall(callData, qualification);
      if (!lead) {
        console.log(`${this.LOG_PREFIX} Failed to create lead for call ${callData.id} - createLeadFromCall returned null`);
        return { leadId: null, qualification };
      }
      console.log(`${this.LOG_PREFIX} Created lead ${lead.id} with category: ${qualification.category}`);

      // Log activity
      try {
        await CRMStorage.createActivity({
          userId: callData.userId,
          leadId: lead.id,
          activityType: 'call',
          title: `Auto-created from ${callData.engine} call`,
          description: `Lead auto-created from ${callData.engine} ${callData.callDirection} call`,
          metadata: {
            callId: callData.id,
          } as any,
        });
      } catch (activityError) {
        console.error(`${this.LOG_PREFIX} Failed to create activity:`, activityError);
      }

      return { leadId: lead.id, qualification };
    } catch (error) {
      console.error(`${this.LOG_PREFIX} Error processing call ${callData.id}:`, error);
      throw error;
    }
  }

  /**
   * Qualify a call and determine its CRM category
   * Priority order: appointment_booked > form_submitted > call_transfer > need_follow_up > hot > warm
   */
  static async qualifyCall(callData: CallData): Promise<LeadQualification> {
    const metadata = callData.metadata || {};
    
    // Extract insights from multiple sources - callData.aiInsights takes priority (ElevenLabs stores here)
    // Then check metadata.aiInsights, then metadata itself
    const aiInsights = (callData.aiInsights || metadata.aiInsights || metadata) as Record<string, unknown>;
    
    // Merge aiInsights into metadata for downstream checks
    const mergedMetadata = { ...metadata, ...aiInsights } as Record<string, unknown>;
    const primaryOutcome = aiInsights.primaryOutcome as string | undefined;
    const engagementScore = this.extractEngagementScore(callData, aiInsights);
    
    // Check for appointment booking - use mergedMetadata for comprehensive check
    let hasAppointment = this.checkAppointmentBooked(callData, mergedMetadata);
    let appointmentData = hasAppointment ? this.extractAppointmentData(mergedMetadata) : undefined;
    
    if (!hasAppointment) {
      const dbAppointment = await this.checkAppointmentInDatabase(callData);
      if (dbAppointment) {
        hasAppointment = true;
        appointmentData = dbAppointment;
      }
    }
    
    // Check for form submission - use mergedMetadata for comprehensive check
    const hasFormSubmission = this.checkFormSubmitted(callData, mergedMetadata);
    const formData = hasFormSubmission ? this.extractFormData(mergedMetadata) : undefined;
    
    // Check for call transfer
    const hasTransfer = callData.wasTransferred === true || primaryOutcome === 'call_transfer';
    
    // Check for callback/follow-up needed
    const hasCallback = primaryOutcome === 'need_follow_up' || 
                        this.checkNeedsFollowUp(callData, aiInsights);

    // Determine category based on priority
    let category: AILeadCategory | null = null;

    if (hasAppointment) {
      category = AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED;
    } else if (hasFormSubmission) {
      category = AI_LEAD_CATEGORIES.FORM_SUBMITTED;
    } else if (hasTransfer) {
      category = AI_LEAD_CATEGORIES.CALL_TRANSFER;
    } else if (hasCallback) {
      category = AI_LEAD_CATEGORIES.NEED_FOLLOW_UP;
    } else if (engagementScore >= 70) {
      category = AI_LEAD_CATEGORIES.HOT;
    } else if (engagementScore >= 40) {
      category = AI_LEAD_CATEGORIES.WARM;
    }

    const qualified = category !== null;

    console.log(`${this.LOG_PREFIX} Qualification result for call ${callData.id}:`, {
      qualified,
      category,
      score: engagementScore,
      hasAppointment,
      hasFormSubmission,
      hasTransfer,
      hasCallback,
      primaryOutcome,
    });

    return {
      qualified,
      category,
      score: engagementScore,
      hasAppointment,
      hasFormSubmission,
      hasTransfer,
      hasCallback,
      appointmentData,
      formData,
    };
  }

  /**
   * Extract engagement score from call data or AI insights
   */
  private static extractEngagementScore(callData: CallData, aiInsights: Record<string, unknown>): number {
    // Try to get score from various sources
    const sources = [
      aiInsights.engagementScore,
      aiInsights.leadScore,
      aiInsights.score,
      (callData.metadata as any)?.leadScore,
      (callData.metadata as any)?.engagementScore,
    ];

    for (const source of sources) {
      if (typeof source === 'number' && source >= 0 && source <= 100) {
        return source;
      }
    }

    // Calculate score based on sentiment and classification if no explicit score
    return this.calculateScoreFromSentiment(callData);
  }

  /**
   * Calculate engagement score based on sentiment, classification, and call quality
   * Balanced scoring - requires signals to qualify but tolerant of formatting differences
   */
  private static calculateScoreFromSentiment(callData: CallData): number {
    // Start with a moderate base score
    let score = 30;
    let hasAnySignal = false;

    // Normalize and trim sentiment for case-insensitive matching
    const sentiment = (callData.sentiment || '').trim().toLowerCase();
    if (sentiment === 'positive' || sentiment === 'pos' || sentiment.includes('positive')) {
      score += 30;
      hasAnySignal = true;
    } else if (sentiment === 'neutral' || sentiment.includes('neutral')) {
      score += 15;
      hasAnySignal = true;
    } else if (sentiment === 'negative' || sentiment === 'neg' || sentiment.includes('negative')) {
      score -= 10;
      hasAnySignal = true;
    }

    // Normalize and trim classification for case-insensitive matching
    const classification = (callData.classification || '').trim().toLowerCase();
    if (classification === 'hot' || classification === 'interested' || classification === 'qualified' || 
        classification.includes('hot') || classification.includes('interested')) {
      score += 25;
      hasAnySignal = true;
    } else if (classification === 'warm' || classification.includes('warm')) {
      score += 15;
      hasAnySignal = true;
    } else if (classification === 'cold' || classification === 'not_interested' || 
               classification.includes('cold') || classification.includes('not interested')) {
      score -= 10;
      hasAnySignal = true;
    }

    // Adjust based on call duration (longer calls often indicate interest)
    if (callData.duration) {
      if (callData.duration >= 180) {
        score += 20; // 3+ minute call - strong engagement
        hasAnySignal = true;
      } else if (callData.duration >= 120) {
        score += 15; // 2+ minute call
        hasAnySignal = true;
      } else if (callData.duration >= 60) {
        score += 10; // 1+ minute call
        hasAnySignal = true;
      } else if (callData.duration >= 30) {
        score += 5; // 30+ seconds
        hasAnySignal = true;
      }
    }

    // Bonus for having transcript (indicates meaningful conversation)
    if (callData.transcript && callData.transcript.trim().length > 50) {
      score += 10;
      hasAnySignal = true;
    }

    // Bonus for having AI summary (indicates analyzed call)
    if (callData.aiSummary && callData.aiSummary.trim().length > 20) {
      score += 5;
      hasAnySignal = true;
    }

    // If no signals at all, keep score below warm threshold
    if (!hasAnySignal) {
      score = 25; // Below warm threshold (40)
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if appointment was booked during the call
   */
  private static checkAppointmentBooked(callData: CallData, metadata: Record<string, unknown>): boolean {
    // Check explicit flags
    if (metadata.appointmentBooked === true) return true;
    if (metadata.hasAppointment === true) return true;
    
    // Check aiInsights
    const aiInsights = metadata.aiInsights as Record<string, unknown> | undefined;
    if (aiInsights?.primaryOutcome === 'appointment_booked') return true;
    if (aiInsights?.appointmentBooked === true) return true;

    // Check for appointment data presence
    if (metadata.appointmentDetails || metadata.appointmentData) return true;

    // Check transcript for appointment keywords if available
    if (callData.aiSummary) {
      const summary = callData.aiSummary.toLowerCase();
      if (summary.includes('appointment scheduled') || 
          summary.includes('meeting booked') ||
          summary.includes('appointment booked') ||
          summary.includes('scheduled for')) {
        return true;
      }
    }

    return false;
  }

  private static async checkAppointmentInDatabase(callData: CallData): Promise<Record<string, unknown> | null> {
    try {
      const formatAppt = (appt: any, matchedBy: string) => {
        console.log(`${this.LOG_PREFIX} Found appointment ${appt.id} in database for call ${callData.id} (matched by: ${matchedBy})`);
        return {
          appointmentId: appt.id,
          contactName: appt.contactName,
          contactPhone: appt.contactPhone,
          date: appt.appointmentDate,
          time: appt.appointmentTime,
          bookedAt: appt.createdAt?.toISOString(),
        };
      };

      const byCallId = await db
        .select()
        .from(appointments)
        .where(eq(appointments.callId, callData.id))
        .limit(1);

      if (byCallId.length > 0) {
        return formatAppt(byCallId[0], 'callId');
      }

      const phone = callData.phoneNumber || callData.fromNumber || callData.toNumber;
      if (!phone) return null;

      const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
      if (normalizedPhone.length < 7) return null;

      const byPhone = await db
        .select()
        .from(appointments)
        .where(and(
          eq(appointments.userId, callData.userId),
          sql`${appointments.createdAt} > NOW() - INTERVAL '30 minutes'`,
          sql`RIGHT(REGEXP_REPLACE(${appointments.contactPhone}, '[^0-9]', '', 'g'), 10) = ${normalizedPhone}`
        ))
        .limit(1);

      if (byPhone.length > 0) {
        return formatAppt(byPhone[0], `userId+phone(${normalizedPhone})`);
      }

      return null;
    } catch (error: any) {
      console.warn(`${this.LOG_PREFIX} Appointment DB check failed for call ${callData.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if form was submitted during the call
   */
  private static checkFormSubmitted(callData: CallData, metadata: Record<string, unknown>): boolean {
    // Check explicit flags
    if (metadata.formSubmitted === true) return true;
    if (metadata.hasFormSubmission === true) return true;
    
    // Check aiInsights
    const aiInsights = metadata.aiInsights as Record<string, unknown> | undefined;
    if (aiInsights?.primaryOutcome === 'form_submitted') return true;
    if (aiInsights?.formSubmitted === true) return true;

    // Check for form data presence
    if (metadata.formData || metadata.collectedData) return true;
    if (aiInsights?.formData || aiInsights?.collectedData) return true;

    return false;
  }

  /**
   * Check if call needs follow-up
   */
  private static checkNeedsFollowUp(callData: CallData, aiInsights: Record<string, unknown>): boolean {
    // Check classification
    const classification = (callData.classification || '').toLowerCase();
    if (classification === 'follow_up' || classification === 'callback') return true;

    // Check AI insights
    if (aiInsights.needsFollowUp === true) return true;
    if (aiInsights.followUpRequired === true) return true;
    if (aiInsights.callbackRequested === true) return true;

    // Check aiNextAction suggestion
    const nextAction = (aiInsights.aiNextAction || aiInsights.nextAction || '') as string;
    if (nextAction.toLowerCase().includes('follow') || 
        nextAction.toLowerCase().includes('callback') ||
        nextAction.toLowerCase().includes('call back')) {
      return true;
    }

    return false;
  }

  /**
   * Extract appointment data from metadata
   */
  private static extractAppointmentData(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
    return (metadata.appointmentDetails || metadata.appointmentData || 
            (metadata.aiInsights as any)?.appointmentDetails) as Record<string, unknown> | undefined;
  }

  /**
   * Extract form data from metadata
   */
  private static extractFormData(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
    return (metadata.formData || metadata.collectedData || 
            (metadata.aiInsights as any)?.formData || 
            (metadata.aiInsights as any)?.collectedData) as Record<string, unknown> | undefined;
  }

  /**
   * Find existing lead for a call
   * Respects campaign/incoming scope to prevent collapsing different campaigns' leads
   */
  private static async findExistingLead(callData: CallData): Promise<typeof leads.$inferSelect | null> {
    const phoneNumber = this.resolveLeadPhone(callData);
    const hasValidPhone = phoneNumber && phoneNumber !== 'Unknown';

    // For ElevenLabs-Twilio engine, check callId first
    if (callData.engine === 'elevenlabs-twilio') {
      const [existingByCallId] = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.userId, callData.userId),
          eq(leads.callId, callData.id)
        ))
        .limit(1);
      
      if (existingByCallId) return existingByCallId;
    }

    // For campaign calls, scope by campaignId to prevent different campaigns from sharing leads
    if (callData.campaignId && hasValidPhone) {
      const [existingByCampaign] = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.userId, callData.userId),
          eq(leads.phone, phoneNumber),
          eq(leads.campaignId, callData.campaignId)
        ))
        .limit(1);
      
      if (existingByCampaign) return existingByCampaign;
    }

    // For incoming calls, scope by incomingConnectionId if available
    if (callData.incomingConnectionId && hasValidPhone) {
      const [existingByConnection] = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.userId, callData.userId),
          eq(leads.phone, phoneNumber),
          eq(leads.incomingConnectionId, callData.incomingConnectionId)
        ))
        .limit(1);
      
      if (existingByConnection) return existingByConnection;
    }

    // Fallback: Check by phone number without source scope (for incoming without connection ID)
    if (hasValidPhone && !callData.campaignId) {
      const [existingByPhone] = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.userId, callData.userId),
          eq(leads.phone, phoneNumber),
          eq(leads.sourceType, 'incoming')
        ))
        .limit(1);

      return existingByPhone || null;
    }

    return null;
  }

  /**
   * Create a lead from call data
   */
  private static async createLeadFromCall(
    callData: CallData, 
    qualification: LeadQualification
  ): Promise<typeof leads.$inferSelect> {
    // Use the centralized phone resolution helper
    const phoneNumber = this.resolveLeadPhone(callData);

    // Determine source type and IDs
    const sourceType = callData.campaignId ? 'campaign' : 'incoming';

    const leadData = {
      userId: callData.userId,
      sourceType,
      campaignId: callData.campaignId || null,
      incomingConnectionId: callData.incomingConnectionId || null,
      phone: phoneNumber,
      stage: 'new',
      leadScore: qualification.score,
      aiSummary: callData.aiSummary,
      aiNextAction: this.generateNextAction(qualification),
      sentiment: callData.sentiment,
      aiCategory: qualification.category,
      hasAppointment: qualification.hasAppointment,
      hasFormSubmission: qualification.hasFormSubmission,
      hasTransfer: qualification.hasTransfer,
      hasCallback: qualification.hasCallback,
      appointmentDetails: qualification.appointmentData,
      formData: qualification.formData,
      transferredTo: callData.transferredTo,
      transferredAt: callData.wasTransferred ? new Date() : null,
      callId: callData.engine === 'elevenlabs-twilio' ? callData.id : null,
    };

    return CRMStorage.createLead(leadData as any);
  }

  /**
   * Update an existing lead with new call data and qualification
   */
  private static async updateExistingLead(
    existingLead: typeof leads.$inferSelect,
    callData: CallData,
    qualification: LeadQualification
  ): Promise<typeof leads.$inferSelect | null> {
    const updates: Record<string, unknown> = {};

    // Update score if higher
    if (qualification.score > (existingLead.leadScore || 0)) {
      updates.leadScore = qualification.score;
    }

    // Update category based on outcome type:
    // - "Action" categories (appointment, form, transfer, follow_up) always update - these represent specific call outcomes
    // - "Sentiment" categories (hot, warm) only update if current category is also sentiment-based or null
    // This ensures action outcomes are always visible while preserving high-value leads
    const actionCategories: string[] = [
      AI_LEAD_CATEGORIES.APPOINTMENT_BOOKED,
      AI_LEAD_CATEGORIES.FORM_SUBMITTED,
      AI_LEAD_CATEGORIES.CALL_TRANSFER,
      AI_LEAD_CATEGORIES.NEED_FOLLOW_UP,
    ];
    const sentimentCategories: string[] = [
      AI_LEAD_CATEGORIES.HOT,
      AI_LEAD_CATEGORIES.WARM,
    ];
    
    const isNewCategoryAction = qualification.category && actionCategories.includes(qualification.category);
    const isExistingCategorySentiment = !existingLead.aiCategory || sentimentCategories.includes(existingLead.aiCategory);
    
    // Always update for action categories, or update sentiment if current is also sentiment/null
    if (qualification.category && (isNewCategoryAction || isExistingCategorySentiment)) {
      updates.aiCategory = qualification.category;
      updates.aiNextAction = this.generateNextAction(qualification);
    }

    // Update flags - only set to true, never false (accumulate)
    if (qualification.hasAppointment && !existingLead.hasAppointment) {
      updates.hasAppointment = true;
      if (qualification.appointmentData) {
        updates.appointmentDetails = qualification.appointmentData;
      }
    }
    if (qualification.hasFormSubmission && !existingLead.hasFormSubmission) {
      updates.hasFormSubmission = true;
      if (qualification.formData) {
        updates.formData = qualification.formData;
      }
    }
    if (qualification.hasTransfer && !existingLead.hasTransfer) {
      updates.hasTransfer = true;
      if (callData.transferredTo) {
        updates.transferredTo = callData.transferredTo;
        updates.transferredAt = new Date();
      }
    }
    if (qualification.hasCallback && !existingLead.hasCallback) {
      updates.hasCallback = true;
    }

    // Update summary/sentiment if newer call has them
    if (callData.aiSummary) {
      updates.aiSummary = callData.aiSummary;
    }
    if (callData.sentiment) {
      updates.sentiment = callData.sentiment;
    }

    // Update source IDs if not already set
    if (!existingLead.campaignId && callData.campaignId) {
      updates.campaignId = callData.campaignId;
      updates.sourceType = 'campaign';
    }
    if (!existingLead.incomingConnectionId && callData.incomingConnectionId) {
      updates.incomingConnectionId = callData.incomingConnectionId;
    }
    if (!existingLead.callId && callData.engine === 'elevenlabs-twilio') {
      updates.callId = callData.id;
    }

    if (Object.keys(updates).length > 0) {
      return CRMStorage.updateLead(existingLead.id, callData.userId, updates);
    }

    return existingLead;
  }

  /**
   * Generate suggested next action based on qualification
   */
  private static generateNextAction(qualification: LeadQualification): string {
    if (qualification.hasAppointment) {
      return 'Confirm appointment details and send reminder';
    }
    if (qualification.hasFormSubmission) {
      return 'Review submitted form data and follow up';
    }
    if (qualification.hasTransfer) {
      return 'Review call transfer outcome with agent';
    }
    if (qualification.hasCallback) {
      return 'Schedule follow-up call';
    }
    if (qualification.category === AI_LEAD_CATEGORIES.HOT) {
      return 'High priority - contact immediately';
    }
    if (qualification.category === AI_LEAD_CATEGORIES.WARM) {
      return 'Nurture lead with relevant content';
    }
    return 'Review call and determine next steps';
  }

  /**
   * Process a call from the ElevenLabs-Twilio engine (calls table)
   */
  static async processElevenLabsTwilioCall(callId: string): Promise<{ leadId: string | null; qualification: LeadQualification } | null> {
    const [call] = await db
      .select()
      .from(calls)
      .where(eq(calls.id, callId))
      .limit(1);

    if (!call || !call.userId) {
      console.log(`${this.LOG_PREFIX} Call not found or no user: ${callId}`);
      return null;
    }

    // Only process completed calls
    if (call.status !== 'completed' && call.status !== 'done') {
      console.log(`${this.LOG_PREFIX} Call ${callId} not completed (status: ${call.status})`);
      return null;
    }

    // For ElevenLabs-Twilio, extract aiInsights from metadata if available
    const elevenLabsMetadata = call.metadata as Record<string, unknown> || {};
    const elevenLabsAiInsights = elevenLabsMetadata.aiInsights || this.parseAiSummaryAsInsights(call.aiSummary);

    const callData: CallData = {
      id: call.id,
      userId: call.userId,
      phoneNumber: call.phoneNumber || '',
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      callDirection: call.callDirection as 'incoming' | 'outgoing',
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
      aiSummary: call.aiSummary,
      sentiment: call.sentiment,
      classification: call.classification,
      wasTransferred: call.wasTransferred || false,
      transferredTo: call.transferredTo,
      campaignId: call.campaignId,
      incomingConnectionId: call.incomingConnectionId,
      metadata: elevenLabsMetadata,
      aiInsights: elevenLabsAiInsights as Record<string, unknown>,  // ElevenLabs stores insights in metadata
      engine: 'elevenlabs-twilio',
    };

    return this.processCall(callData);
  }

  /**
   * Process a call from the Plivo+OpenAI engine (plivo_calls table)
   */
  static async processPlivoOpenAICall(callId: string): Promise<{ leadId: string | null; qualification: LeadQualification } | null> {
    const [call] = await db
      .select()
      .from(plivoCalls)
      .where(eq(plivoCalls.id, callId))
      .limit(1);

    if (!call || !call.userId) {
      console.log(`${this.LOG_PREFIX} Plivo call not found or no user: ${callId}`);
      return null;
    }

    // Only process completed calls
    if (call.status !== 'completed' && call.status !== 'done') {
      console.log(`${this.LOG_PREFIX} Plivo call ${callId} not completed (status: ${call.status})`);
      return null;
    }

    // For Plivo+OpenAI, extract aiInsights from metadata if available
    const plivoMetadata = call.metadata as Record<string, unknown> || {};
    const plivoAiInsights = plivoMetadata.aiInsights || this.parseAiSummaryAsInsights(call.aiSummary);

    const callData: CallData = {
      id: call.id,
      userId: call.userId,
      phoneNumber: call.fromNumber || call.toNumber || '',
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      callDirection: call.callDirection as 'incoming' | 'outgoing',
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
      aiSummary: call.aiSummary,
      sentiment: call.sentiment,
      classification: call.classification,
      wasTransferred: call.wasTransferred || false,
      transferredTo: call.transferredTo,
      campaignId: call.campaignId,
      incomingConnectionId: null, // Plivo uses plivoPhoneNumberId instead
      metadata: plivoMetadata,
      aiInsights: plivoAiInsights as Record<string, unknown>,
      engine: 'plivo-openai',
    };

    return this.processCall(callData);
  }

  /**
   * Process a call from the Twilio+OpenAI engine (twilio_openai_calls table)
   */
  static async processTwilioOpenAICall(callId: string): Promise<{ leadId: string | null; qualification: LeadQualification } | null> {
    const [call] = await db
      .select()
      .from(twilioOpenaiCalls)
      .where(eq(twilioOpenaiCalls.id, callId))
      .limit(1);

    if (!call || !call.userId) {
      console.log(`${this.LOG_PREFIX} Twilio-OpenAI call not found or no user: ${callId}`);
      return null;
    }

    // Only process completed calls
    if (call.status !== 'completed' && call.status !== 'done') {
      console.log(`${this.LOG_PREFIX} Twilio-OpenAI call ${callId} not completed (status: ${call.status})`);
      return null;
    }

    // For Twilio+OpenAI, extract aiInsights from metadata if available
    const twilioMetadata = call.metadata as Record<string, unknown> || {};
    const twilioAiInsights = twilioMetadata.aiInsights || this.parseAiSummaryAsInsights(call.aiSummary);

    const callData: CallData = {
      id: call.id,
      userId: call.userId,
      phoneNumber: call.fromNumber || call.toNumber || '',
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      callDirection: call.callDirection as 'incoming' | 'outgoing',
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
      aiSummary: call.aiSummary,
      sentiment: call.sentiment,
      classification: call.classification,
      wasTransferred: call.wasTransferred || false,
      transferredTo: call.transferredTo,
      campaignId: call.campaignId,
      incomingConnectionId: null, // Twilio-OpenAI uses twilioPhoneNumberId instead
      metadata: twilioMetadata,
      aiInsights: twilioAiInsights as Record<string, unknown>,
      engine: 'twilio-openai',
    };

    return this.processCall(callData);
  }

  /**
   * Process a call from the SIP engine (sip_calls table)
   */
  static async processSipCall(callId: string): Promise<{ leadId: string | null; qualification: LeadQualification } | null> {
    const [call] = await db
      .select()
      .from(sipCalls)
      .where(eq(sipCalls.id, callId))
      .limit(1);

    if (!call || !call.userId) {
      console.log(`${this.LOG_PREFIX} SIP call not found or no user: ${callId}`);
      return null;
    }

    if (call.status !== 'completed' && call.status !== 'done') {
      console.log(`${this.LOG_PREFIX} SIP call ${callId} not completed (status: ${call.status})`);
      return null;
    }

    const sipMetadata = call.metadata as Record<string, unknown> || {};
    const sipAiInsights = sipMetadata.aiInsights || this.parseAiSummaryAsInsights(call.aiSummary);

    const callData: CallData = {
      id: call.id,
      userId: call.userId,
      phoneNumber: call.direction === 'inbound' ? (call.fromNumber || '') : (call.toNumber || ''),
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      callDirection: call.direction === 'inbound' ? 'incoming' : 'outgoing',
      status: call.status || 'completed',
      duration: call.durationSeconds,
      transcript: call.transcript ? (typeof call.transcript === 'string' ? call.transcript : JSON.stringify(call.transcript)) : null,
      aiSummary: call.aiSummary,
      sentiment: call.sentiment,
      classification: call.classification,
      wasTransferred: false,
      transferredTo: null,
      campaignId: call.campaignId,
      incomingConnectionId: null,
      metadata: sipMetadata,
      aiInsights: sipAiInsights as Record<string, unknown>,
      engine: call.engine || 'elevenlabs-sip',
    };

    return this.processCall(callData);
  }

  /**
   * Parse AI summary as insights if it's a JSON string
   */
  private static parseAiSummaryAsInsights(aiSummary: string | null): Record<string, unknown> | null {
    if (!aiSummary) return null;
    
    try {
      // Check if aiSummary is JSON (sometimes it's stored as stringified JSON)
      const parsed = JSON.parse(aiSummary);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // Not JSON, ignore
    }
    
    return null;
  }
}

export default CRMLeadProcessor;
