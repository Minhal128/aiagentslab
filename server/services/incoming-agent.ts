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
 * IncomingAgentService - Isolated service for managing Incoming (inbound call) agents
 * 
 * CRITICAL: Incoming agents NEVER have workflows. Workflows cause "Invalid message received" 
 * errors with ElevenLabs native Twilio integration for inbound calls.
 * 
 * This service ensures:
 * - Creation always uses skipWorkflow: true
 * - Updates always use skipWorkflowRebuild: true
 * - No workflow logic leaks into incoming agent handling
 * - RAG knowledge base tool is automatically added when agents have knowledge bases
 */

import { ElevenLabsService, isAgentOnSipPhoneNumber, getSipTrunkOutboundAddress } from './elevenlabs';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { storage } from '../storage';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { llmModels } from '@shared/schema';
import { setupRAGToolForAgent, isRAGEnabled } from './rag-elevenlabs-tool';

const DEFAULT_VOICE_IDS = [
  "21m00Tcm4TlvDq8ikWAM", "CYw3kZ02Hs0563khs1Fj", "CwhRBWXzGAHq8TQ4Fs17",
  "IKne3meq5aSn9XLyUdCD", "SAz9YHcvj6GT2YYXdXww", "bIHbv24MWmeRgasZH58o",
  "cgSgspJ2msm6clMCkdW9", "cjVigY5qzO86Huf0OWal", "iP95p4xoKVk53GoZ742B",
  "EXAVITQu4vr4xnSDxMaL", "ErXwobaYiN019PkySvjV", "MF3mGyEYCl7XYWbV9V6O",
  "TxGEqnHWrfWFTfGW9XjX", "VR6AewLTigWG4xSOukaG", "pNInz6obpgDQGcFmaJgB",
  "yoZ06aMxZJJ28mfd3POQ", "jBpfuIE2acCO8z3wKNLl", "jsCqWAovK2LkecY7zXl4",
];

export interface IncomingAgentCreateParams {
  userId: string;
  name: string;
  systemPrompt: string;
  elevenLabsVoiceId: string;
  firstMessage?: string;
  language?: string;
  llmModel?: string;
  temperature?: number;
  personality?: string;
  voiceTone?: string;
  knowledgeBaseIds?: string[];
  transferEnabled?: boolean;
  transferPhoneNumber?: string;
  detectLanguageEnabled?: boolean;
  endConversationEnabled?: boolean;
  appointmentBookingEnabled?: boolean;
  expressiveMode?: boolean;
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  voiceSpeed?: number;
  turnTimeout?: number;
  // Database agent ID (needed for webhook tool URLs when creating with appointment booking)
  databaseAgentId?: string;
}

export interface IncomingAgentUpdateParams {
  name?: string;
  systemPrompt?: string;
  elevenLabsVoiceId?: string;
  firstMessage?: string;
  language?: string;
  llmModel?: string;
  temperature?: number;
  knowledgeBaseIds?: string[];
  transferEnabled?: boolean;
  transferPhoneNumber?: string;
  detectLanguageEnabled?: boolean;
  endConversationEnabled?: boolean;
  appointmentBookingEnabled?: boolean;
  messagingEmailEnabled?: boolean;
  messagingWhatsappEnabled?: boolean;
  messagingWhatsappTemplates?: string[];
  messagingEmailSelectedTemplate?: string;
  messagingWhatsappSelectedTemplate?: string;
  expressiveMode?: boolean;
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  voiceSpeed?: number;
  turnTimeout?: number;
  databaseAgentId?: string;
}

interface KnowledgeBaseItem {
  type: string;
  title: string;
  elevenLabsDocId: string;
}

export class IncomingAgentService {

  /**
   * Validate voice availability and log warning for multi-key pool awareness
   * Default voices are available on all ElevenLabs accounts, so no warning needed
   * Custom voices are tied to specific accounts - ensure same credential is used for calls
   */
  private static logVoicePoolInfo(voiceId: string | undefined, agentName: string): void {
    if (!voiceId || DEFAULT_VOICE_IDS.includes(voiceId)) {
      return; // Default voices are universally available
    }
    console.log(`🔊 [Incoming Agent] Voice ${voiceId} for "${agentName}" is a custom voice - agent will use the credential that created it for all calls`);
  }

  /**
   * Fetch knowledge base items by IDs
   */
  private static async fetchKnowledgeBases(knowledgeBaseIds: string[]): Promise<KnowledgeBaseItem[]> {
    const knowledgeBases: KnowledgeBaseItem[] = [];

    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
      return knowledgeBases;
    }

    console.log(`📚 [Incoming] Preparing ${knowledgeBaseIds.length} knowledge base(s)`);

    for (const kbId of knowledgeBaseIds) {
      try {
        const kbItem = await storage.getKnowledgeBaseItem(kbId);

        if (!kbItem) {
          console.warn(`⚠️  Knowledge base item ${kbId} not found, skipping`);
          continue;
        }

        if (!kbItem.elevenLabsDocId) {
          console.warn(`⚠️  Knowledge base item ${kbId} has no ElevenLabs doc ID, skipping`);
          continue;
        }

        console.log(`   Adding KB "${kbItem.title}" (${kbItem.elevenLabsDocId})`);
        knowledgeBases.push({
          type: kbItem.type,
          title: kbItem.title,
          elevenLabsDocId: kbItem.elevenLabsDocId
        });
      } catch (error: any) {
        console.error(`   ❌ Failed to fetch KB ${kbId}:`, error.message);
      }
    }

    return knowledgeBases;
  }

  /**
   * Resolve LLM model name to model ID
   */
  private static async resolveLlmModel(llmModel: string | undefined, userId: string): Promise<string> {
    // Default model
    let effectiveLlmModelId = 'gpt-4o-mini';

    if (llmModel) {
      // User provided a model - look up its model_id
      const modelRecord = await db
        .select({ modelId: llmModels.modelId })
        .from(llmModels)
        .where(eq(llmModels.name, llmModel))
        .limit(1);

      if (modelRecord.length > 0) {
        effectiveLlmModelId = modelRecord[0].modelId;
        console.log(`📝 [Incoming] LLM model: ${llmModel} → ${effectiveLlmModelId}`);
      } else {
        // Maybe they passed the modelId directly
        effectiveLlmModelId = llmModel;
        console.log(`📝 [Incoming] Using LLM model ID directly: ${effectiveLlmModelId}`);
      }

      // Sanitize the model ID for ElevenLabs compatibility
      effectiveLlmModelId = ElevenLabsService.sanitizeLlmModel(effectiveLlmModelId);
    } else {
      // Use admin-configured default
      const defaultSetting = await storage.getGlobalSetting('default_llm_free');
      if (defaultSetting?.value) {
        const displayName = String(defaultSetting.value).replace(/^"|"$/g, '');

        const modelRecord = await db
          .select({ modelId: llmModels.modelId })
          .from(llmModels)
          .where(eq(llmModels.name, displayName))
          .limit(1);

        if (modelRecord.length > 0) {
          effectiveLlmModelId = modelRecord[0].modelId;
          console.log(`📝 [Incoming] Admin default LLM: ${displayName} → ${effectiveLlmModelId}`);
        }
      }
    }

    return effectiveLlmModelId;
  }

  /**
   * Get TTS model with smart auto-selection
   * V3: eleven_v3_conversational supports 70+ languages natively (no English-only restriction)
   * Uses admin-configured default from settings, falls back to eleven_v3_conversational
   */
  private static async getSmartTtsModel(language: string = 'en'): Promise<string> {
    const ttsModelSetting = await storage.getGlobalSetting('default_tts_model');
    return (ttsModelSetting?.value as string) || 'eleven_v3_conversational';
  }

  /**
   * Create a new Incoming agent in ElevenLabs
   * CRITICAL: Always uses skipWorkflow: true
   * Includes RAG knowledge base tool if agent has knowledge bases assigned
   * Returns both the ElevenLabs agent ID and the credential ID for multi-key pool affinity
   */
  static async createInElevenLabs(params: IncomingAgentCreateParams): Promise<{ elevenLabsAgentId: string; credentialId: string }> {
    console.log(`📞 [Incoming Agent] Creating: ${params.name}`);

    // Get credential from pool
    const credential = await ElevenLabsPoolService.getAvailableCredential();
    if (!credential) {
      throw new Error("No available ElevenLabs API keys");
    }

    const elevenLabsService = new ElevenLabsService(credential.apiKey);

    // Resolve LLM model
    const effectiveLlmModelId = await this.resolveLlmModel(params.llmModel, params.userId);

    // Fetch knowledge bases
    const knowledgeBases = await this.fetchKnowledgeBases(params.knowledgeBaseIds || []);

    // Create agent with skipWorkflow: true - CRITICAL for incoming agents
    const agentResponse = await elevenLabsService.createAgent({
      name: params.name,
      voice_id: params.elevenLabsVoiceId,
      prompt: params.systemPrompt,
      first_message: params.firstMessage || "Hello! How can I help you today?",
      language: params.language || "en",
      model: effectiveLlmModelId,
      temperature: params.temperature || 0.5,
      personality: params.personality || "helpful",
      voice_tone: params.voiceTone || "professional",
      knowledge_bases: knowledgeBases.length > 0 ? knowledgeBases : undefined,
      transferEnabled: params.transferEnabled || false,
      transferPhoneNumber: params.transferPhoneNumber || undefined,
      detectLanguageEnabled: params.detectLanguageEnabled || false,
      endConversationEnabled: params.endConversationEnabled || false,
      // Appointment booking webhook tool
      appointmentBookingEnabled: params.appointmentBookingEnabled || false,
      databaseAgentId: params.databaseAgentId,
      // Voice fine-tuning settings
      voiceStability: params.voiceStability,
      voiceSimilarityBoost: params.voiceSimilarityBoost,
      voiceSpeed: params.voiceSpeed,
      turnTimeout: params.turnTimeout ?? 1.5,
      suggestedAudioTags: params.expressiveMode || false,
      // CRITICAL: Skip workflow for incoming agents
      // Workflows cause "Invalid message received" errors with ElevenLabs native Twilio integration
      skipWorkflow: true,
    });

    console.log(`✅ [Incoming Agent] Created in ElevenLabs: ${agentResponse.agent_id}`);

    // Log voice pool info for multi-key awareness
    this.logVoicePoolInfo(params.elevenLabsVoiceId, params.name);

    return { elevenLabsAgentId: agentResponse.agent_id, credentialId: credential.id };
  }

  /**
   * Check if error indicates a stale/invalid agent ID (API key changed or agent deleted)
   */
  private static isStaleAgentError(error: any): boolean {
    const status = error?.status || error?.response?.status;
    const message = String(error?.message || '').toLowerCase();

    // 401: Unauthorized (API key doesn't have access)
    // 403: Forbidden (API key doesn't own this agent)
    // 404: Not found (agent doesn't exist on this account)
    if (status === 401 || status === 403 || status === 404) {
      return true;
    }

    // Also check error message for common patterns
    if (message.includes('not found') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('does not exist') ||
      message.includes('invalid agent')) {
      return true;
    }

    return false;
  }

  /**
   * Update an existing Incoming agent in ElevenLabs
   * CRITICAL: Always uses skipWorkflowRebuild: true to prevent workflow contamination
   * 
   * If the update fails due to API key change (401/403/404), this method will:
   * 1. Clear the stale ElevenLabs agent ID
   * 2. Create a fresh agent with the current credential
   * 3. Update the database with the new agent ID
   */
  static async updateInElevenLabs(
    agentId: string,
    elevenLabsAgentId: string,
    currentAgent: any,
    params: IncomingAgentUpdateParams
  ): Promise<{ recreated?: boolean; newElevenLabsAgentId?: string; newCredentialId?: string }> {
    console.log(`🔄 [Incoming Agent] Updating: ${agentId}`);

    // Get credential for this agent (may be outdated if API key changed)
    let credential = await ElevenLabsPoolService.getCredentialForAgent(agentId);

    // If no credential found for agent, get a fresh one from the pool
    if (!credential) {
      console.log(`⚠️  [Incoming] No credential found for agent ${agentId}, getting fresh credential`);
      credential = await ElevenLabsPoolService.getAvailableCredential();
      if (!credential) {
        throw new Error("No ElevenLabs credentials available");
      }
    }

    const elevenLabsService = new ElevenLabsService(credential.apiKey);

    // Determine effective language and TTS model
    const effectiveLanguage = params.language || currentAgent.language;
    const isNonEnglish = effectiveLanguage && effectiveLanguage !== 'en';

    // Get TTS model with smart auto-selection based on language
    const adminTtsModel = await this.getSmartTtsModel(effectiveLanguage || 'en');

    // Build update payload
    const elevenLabsUpdates: any = {};

    if (params.name) elevenLabsUpdates.name = params.name;
    if (params.systemPrompt) elevenLabsUpdates.prompt = params.systemPrompt;
    if (params.elevenLabsVoiceId) elevenLabsUpdates.voice_id = params.elevenLabsVoiceId;
    if (params.firstMessage) elevenLabsUpdates.first_message = params.firstMessage;

    // Handle language and TTS model
    if (effectiveLanguage) {
      elevenLabsUpdates.language = effectiveLanguage;
      elevenLabsUpdates.tts_model = adminTtsModel;
    }

    // Resolve LLM model if provided
    if (params.llmModel) {
      const modelRecord = await db
        .select({ modelId: llmModels.modelId })
        .from(llmModels)
        .where(eq(llmModels.name, params.llmModel))
        .limit(1);

      let resolvedModelId = modelRecord.length > 0 ? modelRecord[0].modelId : params.llmModel;

      // Sanitize the model ID for ElevenLabs compatibility
      resolvedModelId = ElevenLabsService.sanitizeLlmModel(resolvedModelId);
      elevenLabsUpdates.model = resolvedModelId;
    }

    if (params.temperature !== undefined) {
      elevenLabsUpdates.temperature = params.temperature;
    }

    // Voice quality settings - use new values or preserve existing
    if (params.voiceStability !== undefined || params.voiceSimilarityBoost !== undefined || params.voiceSpeed !== undefined || params.turnTimeout !== undefined) {
      elevenLabsUpdates.voiceStability = params.voiceStability ?? currentAgent.voiceStability ?? 0.5;
      elevenLabsUpdates.voiceSimilarityBoost = params.voiceSimilarityBoost ?? currentAgent.voiceSimilarityBoost ?? 0.85;
      elevenLabsUpdates.voiceSpeed = params.voiceSpeed ?? currentAgent.voiceSpeed ?? 1.0;
      elevenLabsUpdates.turnTimeout = params.turnTimeout ?? currentAgent.turnTimeout ?? 1.5;
      console.log(`🎙️ [Incoming] Voice settings: stability=${elevenLabsUpdates.voiceStability}, similarity=${elevenLabsUpdates.voiceSimilarityBoost}, speed=${elevenLabsUpdates.voiceSpeed}, turnTimeout=${elevenLabsUpdates.turnTimeout}`);
    }

    // System tools configuration - preserve existing values if not provided
    const effectiveTransferEnabled = params.transferEnabled !== undefined
      ? params.transferEnabled
      : currentAgent.transferEnabled;
    const effectiveTransferPhone = params.transferPhoneNumber !== undefined
      ? (params.transferPhoneNumber?.trim() || null)
      : (currentAgent.transferPhoneNumber?.trim() || null);
    const effectiveDetectLanguage = params.detectLanguageEnabled !== undefined
      ? params.detectLanguageEnabled
      : currentAgent.detectLanguageEnabled;
    const effectiveEndConversation = params.endConversationEnabled !== undefined
      ? params.endConversationEnabled
      : currentAgent.endConversationEnabled;

    elevenLabsUpdates.transferEnabled = effectiveTransferEnabled;
    // Only include transferPhoneNumber if it has a value - omit entirely when null to clear it
    if (effectiveTransferPhone) {
      elevenLabsUpdates.transferPhoneNumber = effectiveTransferPhone;
    }
    elevenLabsUpdates.detectLanguageEnabled = effectiveDetectLanguage;
    elevenLabsUpdates.endConversationEnabled = effectiveEndConversation;

    // Appointment booking webhook tool
    const effectiveAppointmentBooking = params.appointmentBookingEnabled !== undefined
      ? params.appointmentBookingEnabled
      : currentAgent.appointmentBookingEnabled;
    elevenLabsUpdates.appointmentBookingEnabled = effectiveAppointmentBooking;
    elevenLabsUpdates.databaseAgentId = params.databaseAgentId || agentId;

    const effectiveMessagingEmailEnabled = params.messagingEmailEnabled !== undefined
      ? params.messagingEmailEnabled
      : currentAgent.messagingEmailEnabled;
    const effectiveMessagingWhatsappEnabled = params.messagingWhatsappEnabled !== undefined
      ? params.messagingWhatsappEnabled
      : currentAgent.messagingWhatsappEnabled;
    elevenLabsUpdates.messagingEmailEnabled = effectiveMessagingEmailEnabled || false;
    elevenLabsUpdates.messagingWhatsappEnabled = effectiveMessagingWhatsappEnabled || false;
    if (params.messagingWhatsappTemplates) {
      elevenLabsUpdates.messagingWhatsappTemplates = params.messagingWhatsappTemplates;
    }
    if (params.messagingEmailSelectedTemplate) {
      elevenLabsUpdates.messagingEmailSelectedTemplate = params.messagingEmailSelectedTemplate;
    }
    if (params.messagingWhatsappSelectedTemplate) {
      elevenLabsUpdates.messagingWhatsappSelectedTemplate = params.messagingWhatsappSelectedTemplate;
    }

    const effectiveExpressiveMode = params.expressiveMode !== undefined
      ? params.expressiveMode
      : currentAgent.expressiveMode;
    elevenLabsUpdates.suggestedAudioTags = effectiveExpressiveMode || false;

    console.log(`🔧 [Incoming] System tools:`, {
      transferEnabled: effectiveTransferEnabled,
      transferPhoneNumber: effectiveTransferPhone ? `${effectiveTransferPhone.substring(0, 6)}***` : null,
      detectLanguageEnabled: effectiveDetectLanguage,
      endConversationEnabled: effectiveEndConversation,
      appointmentBookingEnabled: effectiveAppointmentBooking,
      expressiveMode: effectiveExpressiveMode
    });

    // Handle knowledge bases
    let hasKnowledgeBases = false;
    if (params.knowledgeBaseIds !== undefined) {
      console.log(`📚 [Incoming] Syncing ${params.knowledgeBaseIds.length} knowledge base(s)`);
      const knowledgeBases = await this.fetchKnowledgeBases(params.knowledgeBaseIds);
      elevenLabsUpdates.knowledge_bases = knowledgeBases;
      console.log(`   Total KB docs to sync: ${knowledgeBases.length}`);
      hasKnowledgeBases = params.knowledgeBaseIds.length > 0;
      // Set flag to include RAG knowledge base instructions in prompt
      // This is needed because RAG KBs don't have ElevenLabs doc IDs
      elevenLabsUpdates.hasRAGKnowledgeBases = hasKnowledgeBases && isRAGEnabled();
    }

    // CRITICAL: skipWorkflowRebuild prevents any workflow from being added to incoming agents
    // This is the key isolation - incoming agents must NEVER have workflows
    elevenLabsUpdates.skipWorkflowRebuild = true;

    let actualElevenLabsAgentId = elevenLabsAgentId;
    let recreatedAgent = false;
    let newCredentialId: string | undefined;

    if (Object.keys(elevenLabsUpdates).length > 1) { // > 1 because skipWorkflowRebuild is always present
      console.log(`🔄 [Incoming] Syncing to ElevenLabs: ${elevenLabsAgentId}`);

      try {
        await elevenLabsService.updateAgent(elevenLabsAgentId, elevenLabsUpdates);
        console.log(`✅ [Incoming] ElevenLabs sync complete`);
      } catch (updateError: any) {
        // Check if this is a stale agent error (API key changed, agent doesn't exist, etc.)
        if (this.isStaleAgentError(updateError)) {
          console.log(`⚠️  [Incoming] Stale agent detected (${updateError.message}). Recreating agent with current API key...`);

          // Get a fresh credential from the pool (may be new if API key was changed)
          const freshCredential = await ElevenLabsPoolService.getAvailableCredential();
          if (!freshCredential) {
            throw new Error("No ElevenLabs credentials available to recreate agent");
          }

          // Recreate the agent with FULL current agent configuration merged with updates
          // Use nullish coalescing to preserve existing values unless explicitly overridden
          const mergedParams: IncomingAgentCreateParams = {
            userId: currentAgent.userId,
            name: params.name ?? currentAgent.name,
            systemPrompt: params.systemPrompt ?? currentAgent.systemPrompt,
            elevenLabsVoiceId: params.elevenLabsVoiceId ?? currentAgent.elevenLabsVoiceId,
            firstMessage: params.firstMessage ?? currentAgent.firstMessage,
            language: effectiveLanguage ?? currentAgent.language ?? 'en',
            llmModel: params.llmModel ?? currentAgent.llmModel,
            temperature: params.temperature ?? currentAgent.temperature ?? 0.5,
            personality: currentAgent.personality ?? 'helpful',
            voiceTone: currentAgent.voiceTone ?? 'professional',
            knowledgeBaseIds: params.knowledgeBaseIds ?? currentAgent.knowledgeBaseIds ?? [],
            transferEnabled: effectiveTransferEnabled ?? currentAgent.transferEnabled ?? false,
            transferPhoneNumber: effectiveTransferPhone ?? currentAgent.transferPhoneNumber ?? undefined,
            detectLanguageEnabled: effectiveDetectLanguage ?? currentAgent.detectLanguageEnabled ?? false,
            endConversationEnabled: effectiveEndConversation ?? currentAgent.endConversationEnabled ?? false,
            appointmentBookingEnabled: effectiveAppointmentBooking ?? currentAgent.appointmentBookingEnabled ?? false,
            voiceStability: params.voiceStability ?? currentAgent.voiceStability ?? 0.5,
            voiceSimilarityBoost: params.voiceSimilarityBoost ?? currentAgent.voiceSimilarityBoost ?? 0.85,
            voiceSpeed: params.voiceSpeed ?? currentAgent.voiceSpeed ?? 1.0,
            turnTimeout: params.turnTimeout ?? currentAgent.turnTimeout ?? 1.5,
            expressiveMode: effectiveExpressiveMode ?? currentAgent.expressiveMode ?? false,
            databaseAgentId: agentId,
          };

          const result = await this.createInElevenLabs(mergedParams);
          actualElevenLabsAgentId = result.elevenLabsAgentId;
          newCredentialId = result.credentialId;
          recreatedAgent = true;

          // Update the database with the new ElevenLabs agent ID and credential
          await storage.updateAgent(agentId, {
            elevenLabsAgentId: actualElevenLabsAgentId,
            elevenLabsCredentialId: newCredentialId,
          });

          console.log(`✅ [Incoming] Agent recreated with new ElevenLabs ID: ${actualElevenLabsAgentId}`);
        } else {
          // Not a stale agent error - rethrow
          throw updateError;
        }
      }
    }

    // Setup RAG workspace tool after agent update (separate API call for proper tool creation)
    // IMPORTANT: Pass system tools as ARRAY to preserve when linking RAG webhook tools
    if (params.knowledgeBaseIds !== undefined && isRAGEnabled()) {
      // Build the system tools ARRAY to preserve when setting up RAG
      // Per ElevenLabs API: All tools go in prompt.tools array with type: "system"
      const systemTools: any[] = [];

      // Transfer to Number tool
      // SIP phone numbers require sip_refer; native Twilio/Plivo use conference
      if (effectiveTransferEnabled && effectiveTransferPhone) {
        let transferType: "conference" | "sip_refer" = "conference";
        let sipTrunkAddress: string | null = null;
        try {
          if (await isAgentOnSipPhoneNumber(agentId)) {
            transferType = "sip_refer";
            sipTrunkAddress = await getSipTrunkOutboundAddress(agentId);
            console.log(`   📞 [Incoming] SIP agent detected - using sip_refer transfer type (trunk: ${sipTrunkAddress})`);
          }
        } catch { }

        let transferDestination: any;
        if (transferType === "sip_refer" && sipTrunkAddress) {
          const phoneNumber = effectiveTransferPhone.startsWith('+')
            ? effectiveTransferPhone
            : `+${effectiveTransferPhone}`;
          const sipUri = `sip:${phoneNumber}@${sipTrunkAddress}`;
          transferDestination = { type: "sip_uri", sip_uri: sipUri };
          console.log(`   📞 [Incoming] SIP REFER: ${phoneNumber} → ${sipUri}`);
        } else {
          transferDestination = { type: "phone", phone_number: effectiveTransferPhone };
        }

        systemTools.push({
          type: "system",
          name: "transfer_to_number",
          description: "Transfer the caller to a human agent when they request it or when you cannot handle their request.",
          params: {
            system_tool_type: "transfer_to_number",
            transfers: [
              {
                transfer_destination: transferDestination,
                condition: "When the user asks to speak with a human or when the AI cannot handle the request.",
                transfer_type: transferType
              }
            ]
          }
        });
      }

      // Language Detection tool
      if (effectiveDetectLanguage) {
        systemTools.push({
          type: "system",
          name: "language_detection",
          description: "Automatically detect and switch to the user's preferred language"
        });
      }

      // End Call tool
      if (effectiveEndConversation) {
        systemTools.push({
          type: "system",
          name: "end_call",
          description: "End the call when the user is finished or says goodbye"
        });
      }

      console.log(`📚 [Incoming] Passing ${systemTools.length} system tools to RAG setup`);
      await setupRAGToolForAgent(actualElevenLabsAgentId, agentId, hasKnowledgeBases, systemTools, effectiveAppointmentBooking);
    }

    return {
      recreated: recreatedAgent,
      newElevenLabsAgentId: recreatedAgent ? actualElevenLabsAgentId : undefined,
      newCredentialId
    };
  }
}
