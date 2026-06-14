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
 * FlowAgentService - Isolated service for managing Flow agents
 * 
 * Flow agents use ElevenLabs workflows compiled from the visual flow builder.
 * They have deterministic conversation paths based on the compiled workflow.
 * 
 * This service ensures:
 * - Workflows are properly compiled and synced to ElevenLabs
 * - First message extraction from entry Message nodes
 * - Workflow updates use updateFlowAgentWorkflow (not regular updateAgent)
 * - No incoming agent logic leaks into flow agent handling
 * - RAG knowledge base tool is automatically added when agents have knowledge bases
 */

import { ElevenLabsService, isAgentOnSipPhoneNumber } from './elevenlabs';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { ElevenLabsFlowCompiler } from './elevenlabs-flow-compiler';
import { EnhancedFlowCompiler } from './enhanced-flow-compiler';
import { storage } from '../storage';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { llmModels, flows, formFields, forms } from '@shared/schema';
import { setupRAGToolForAgent, isRAGEnabled } from './rag-elevenlabs-tool';

async function convertWorkflowTransferNodesForSIP(
  workflow: { nodes: Record<string, any>; edges: Record<string, any> },
  agentId: string
): Promise<void> {
  try {
    if (!await isAgentOnSipPhoneNumber(agentId)) return;

    // SIP agents keep conference transfer type with direct phone numbers
    // sip_refer has known issues with ElevenLabs SIP trunks, conference works reliably
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      if (node.type === 'phone_number' && node.transfer_destination?.type === 'phone') {
        node.transfer_type = 'conference';
        console.log(`   📞 [Flow SIP] Transfer node ${nodeId}: ${node.transfer_destination.phone_number} (conference)`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  [Flow SIP] Failed to process transfer nodes for agent ${agentId}:`, error);
  }
}

const DEFAULT_VOICE_IDS = [
  "21m00Tcm4TlvDq8ikWAM", "CYw3kZ02Hs0563khs1Fj", "CwhRBWXzGAHq8TQ4Fs17",
  "IKne3meq5aSn9XLyUdCD", "SAz9YHcvj6GT2YYXdXww", "bIHbv24MWmeRgasZH58o",
  "cgSgspJ2msm6clMCkdW9", "cjVigY5qzO86Huf0OWal", "iP95p4xoKVk53GoZ742B",
  "EXAVITQu4vr4xnSDxMaL", "ErXwobaYiN019PkySvjV", "MF3mGyEYCl7XYWbV9V6O",
  "TxGEqnHWrfWFTfGW9XjX", "VR6AewLTigWG4xSOukaG", "pNInz6obpgDQGcFmaJgB",
  "yoZ06aMxZJJ28mfd3POQ", "jBpfuIE2acCO8z3wKNLl", "jsCqWAovK2LkecY7zXl4",
];

/**
 * Feature flag for enhanced flow compiler
 * When enabled, uses conversation_config overrides to force exact speech
 * Now defaults to TRUE because enhanced compiler properly handles:
 * - Form nodes with field definitions from database
 * - Appointment nodes with webhook tools
 * - End nodes with proper call termination
 * Set USE_ENHANCED_FLOW_COMPILER=false to use legacy compiler if needed
 */
const USE_ENHANCED_COMPILER = process.env.USE_ENHANCED_FLOW_COMPILER !== 'false';

export interface FlowAgentCreateParams {
  userId: string;
  name: string;
  flowId: string;
  elevenLabsVoiceId: string;
  systemPrompt?: string;
  firstMessage?: string;
  language?: string;
  llmModel?: string;
  temperature?: number;
  maxDurationSeconds?: number;
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  voiceSpeed?: number;
  turnTimeout?: number;
  detectLanguageEnabled?: boolean;
  expressiveMode?: boolean;
  knowledgeBaseIds?: string[];
}

export interface FlowAgentUpdateParams {
  name?: string;
  flowId?: string;
  elevenLabsVoiceId?: string;
  systemPrompt?: string;
  firstMessage?: string;
  language?: string;
  llmModel?: string;
  temperature?: number;
  maxDurationSeconds?: number;
  detectLanguageEnabled?: boolean;
  expressiveMode?: boolean;
  knowledgeBaseIds?: string[];
  voiceStability?: number;
  voiceSimilarityBoost?: number;
  voiceSpeed?: number;
  turnTimeout?: number;
  messagingEmailEnabled?: boolean;
  messagingWhatsappEnabled?: boolean;
  messagingEmailTemplate?: string;
  messagingWhatsappTemplate?: string;
  messagingWhatsappVariables?: string;
}

interface CompiledWorkflow {
  nodes: Record<string, any>;
  edges: Record<string, any>;
}

interface FormNodeInfo {
  nodeId?: string;
  formId: string;
  formName: string;
  fields: any[];
  googleSheetId?: string;
  googleSheetName?: string;
}

interface WebhookNodeInfo {
  toolId: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  payload?: Record<string, any>;
}

interface PlayAudioNodeInfo {
  nodeId: string;
  audioUrl: string;
  audioFileName: string;
  interruptible: boolean;
  waitForComplete: boolean;
}

interface CompileResult {
  workflow: CompiledWorkflow;
  firstMessage?: string;
  hasAppointmentNodes?: boolean;
  hasFormNodes?: boolean;
  formNodes?: FormNodeInfo[];
  hasWebhookNodes?: boolean;
  webhookNodes?: WebhookNodeInfo[];
  hasPlayAudioNodes?: boolean;
  playAudioNodes?: PlayAudioNodeInfo[];
}

interface KnowledgeBaseItem {
  type: string;
  title: string;
  elevenLabsDocId: string;
}

export class FlowAgentService {

  /**
   * Validate voice availability and log warning for multi-key pool awareness
   * Default voices are available on all ElevenLabs accounts, so no warning needed
   * Custom voices are tied to specific accounts - ensure same credential is used for calls
   */
  private static logVoicePoolInfo(voiceId: string | undefined, agentName: string): void {
    if (!voiceId || DEFAULT_VOICE_IDS.includes(voiceId)) {
      return; // Default voices are universally available
    }
    console.log(`🔊 [Flow Agent] Voice ${voiceId} for "${agentName}" is a custom voice - agent will use the credential that created it for all calls`);
  }

  /**
   * Compile a flow into ElevenLabs workflow format
   * Uses EnhancedFlowCompiler when USE_ENHANCED_COMPILER is true
   */
  static compileFlow(flowNodes: any[], flowEdges: any[]): CompileResult {
    if (!flowNodes || flowNodes.length === 0) {
      return { workflow: { nodes: {}, edges: {} } };
    }

    if (USE_ENHANCED_COMPILER) {
      console.log(`🔧 [Flow Agent] Using ENHANCED flow compiler`);
      const compiler = new EnhancedFlowCompiler(flowNodes, flowEdges);
      const result = compiler.compile();

      // Validate the compiled workflow
      const validation = compiler.validate();
      if (!validation.valid) {
        console.warn(`⚠️  Workflow validation errors:`, validation.errors);
      }
      if (validation.warnings.length > 0) {
        console.warn(`⚠️  Workflow validation warnings:`, validation.warnings);
      }

      return {
        workflow: result.workflow,
        firstMessage: result.firstMessage,
        hasAppointmentNodes: result.hasAppointmentNodes,
        hasFormNodes: result.hasFormNodes,
        formNodes: result.formNodes,
        hasWebhookNodes: result.hasWebhookNodes,
        webhookNodes: result.webhookNodes,
        hasPlayAudioNodes: result.hasPlayAudioNodes,
        playAudioNodes: result.playAudioNodes
      };
    }

    // Fallback to original compiler
    console.log(`🔧 [Flow Agent] Using LEGACY flow compiler`);
    const compiler = new ElevenLabsFlowCompiler(flowNodes, flowEdges);
    return compiler.compile();
  }

  /**
   * Fetch a flow by ID and compile it
   * Also loads form fields from the database for any form nodes
   */
  static async fetchAndCompileFlow(flowId: string): Promise<CompileResult & { flow: any }> {
    const [flow] = await db
      .select()
      .from(flows)
      .where(eq(flows.id, flowId));

    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }

    let flowNodes = (flow.nodes as any[]) || [];
    const flowEdges = (flow.edges as any[]) || [];

    console.log(`🔄 [Flow Agent] Compiling flow: ${flow.name}`);
    console.log(`   Flow nodes: ${flowNodes.length}, edges: ${flowEdges.length}`);

    if (flowNodes.length === 0) {
      throw new Error("Flow has no nodes. Please add nodes to the flow before assigning it to an agent.");
    }

    // Load form fields from database for any form nodes
    // This ensures the compiler has access to field definitions for proper tool generation
    flowNodes = await this.enrichFormNodesWithFields(flowNodes);

    const compileResult = this.compileFlow(flowNodes, flowEdges);

    console.log(`   Compiled: ${Object.keys(compileResult.workflow.nodes).length} nodes, ${Object.keys(compileResult.workflow.edges).length} edges`);
    if (compileResult.firstMessage) {
      const preview = compileResult.firstMessage.length > 50
        ? compileResult.firstMessage.substring(0, 50) + '...'
        : compileResult.firstMessage;
      console.log(`   First message extracted: "${preview}"`);
    }

    return { ...compileResult, flow };
  }

  /**
   * Enrich form nodes with field definitions from the database
   * This ensures the compiler has full form field data for webhook tool generation
   * Made public so routes can call it when syncing flows to ElevenLabs
   */
  static async enrichFormNodesWithFields(flowNodes: any[]): Promise<any[]> {
    console.log(`   📋 [Form Enrichment] Processing ${flowNodes.length} nodes...`);
    const enrichedNodes = [];

    for (const node of flowNodes) {
      const nodeType = node.data?.type || node.type;

      // Check if this is a form node
      if (nodeType === 'form' || nodeType === 'form_submission' || nodeType === 'collect_info') {
        const config = node.data?.config || node.data || {};
        const formId = config.formId;

        console.log(`   📋 [Form Enrichment] Found form node ${node.id}, formId: ${formId}`);

        if (formId) {
          try {
            // Load form and fields from database
            const [form] = await db
              .select()
              .from(forms)
              .where(eq(forms.id, formId));

            console.log(`   📋 [Form Enrichment] Form lookup result: ${form ? form.name : 'NOT FOUND'}`);

            if (form) {
              const fields = await db
                .select()
                .from(formFields)
                .where(eq(formFields.formId, formId));

              console.log(`   📋 [Form Enrichment] Fields from DB: ${fields.length}`);
              if (fields.length > 0) {
                console.log(`   📋 [Form Enrichment] First field raw:`, JSON.stringify(fields[0]));
              }

              // Enrich the node config with form name and fields
              // Note: Drizzle returns camelCase property names as defined in schema
              const enrichedConfig = {
                ...config,
                formName: form.name,
                fields: fields.map(f => ({
                  id: f.id,
                  question: f.question,
                  fieldType: f.fieldType,
                  isRequired: f.isRequired,
                  options: f.options
                }))
              };

              console.log(`   📋 [Form Enrichment] Loaded form "${form.name}" with ${enrichedConfig.fields.length} fields for node ${node.id}`);

              // Create enriched node
              enrichedNodes.push({
                ...node,
                data: {
                  ...node.data,
                  config: enrichedConfig
                }
              });
              continue;
            }
          } catch (error: any) {
            console.warn(`   ⚠️ [Form Enrichment] Failed to load form ${formId}:`, error.message);
          }
        }
      }

      // For non-form nodes or if enrichment failed, keep the original
      enrichedNodes.push(node);
    }

    console.log(`   📋 [Form Enrichment] Complete. Returning ${enrichedNodes.length} nodes`);
    return enrichedNodes;
  }

  /**
   * Fetch knowledge base items by IDs
   */
  private static async fetchKnowledgeBases(knowledgeBaseIds: string[]): Promise<KnowledgeBaseItem[]> {
    const knowledgeBases: KnowledgeBaseItem[] = [];

    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
      return knowledgeBases;
    }

    console.log(`📚 [Flow] Preparing ${knowledgeBaseIds.length} knowledge base(s)`);

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
    let effectiveLlmModelId = 'gpt-4o-mini';

    if (llmModel) {
      const modelRecord = await db
        .select({ modelId: llmModels.modelId })
        .from(llmModels)
        .where(eq(llmModels.name, llmModel))
        .limit(1);

      if (modelRecord.length > 0) {
        effectiveLlmModelId = modelRecord[0].modelId;
        console.log(`📝 [Flow] LLM model: ${llmModel} → ${effectiveLlmModelId}`);
      } else {
        effectiveLlmModelId = llmModel;
        console.log(`📝 [Flow] Using LLM model ID directly: ${effectiveLlmModelId}`);
      }

      // Sanitize the model ID for ElevenLabs compatibility
      effectiveLlmModelId = ElevenLabsService.sanitizeLlmModel(effectiveLlmModelId);
    } else {
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
          console.log(`📝 [Flow] Admin default LLM: ${displayName} → ${effectiveLlmModelId}`);
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
   * Create a new Flow agent in ElevenLabs
   * Uses createFlowAgent which sets up workflow-based conversation
   * Returns both the ElevenLabs agent ID and the credential ID for multi-key pool affinity
   */
  static async createInElevenLabs(params: FlowAgentCreateParams): Promise<{ elevenLabsAgentId: string; credentialId: string }> {
    console.log(`🔄 [Flow Agent] Creating: ${params.name}`);

    // Get credential with user affinity first, then fallback to shared pool
    // This maintains quota enforcement while allowing tenants without dedicated keys to work
    let credential = await ElevenLabsPoolService.getUserCredential(params.userId);
    let credentialSource: 'user_affinity' | 'shared_pool' = 'user_affinity';
    if (!credential) {
      console.log(`   No user-specific credential found, falling back to shared pool`);
      credential = await ElevenLabsPoolService.getAvailableCredential();
      credentialSource = 'shared_pool';
    }
    if (!credential) {
      // Provide actionable error context for troubleshooting
      const error = new Error("No ElevenLabs API keys available. Please contact your administrator to add API keys to the pool.");
      (error as any).code = 'SERVICE_UNAVAILABLE';
      (error as any).status = 503;
      throw error;
    }
    console.log(`   Using credential: ${credential.name || credential.id} (source: ${credentialSource})`);

    const elevenLabsService = new ElevenLabsService(credential.apiKey);

    // Fetch and compile the flow
    const { workflow, firstMessage: flowFirstMessage, hasAppointmentNodes, hasFormNodes, formNodes, hasWebhookNodes, webhookNodes, hasPlayAudioNodes, playAudioNodes } = await this.fetchAndCompileFlow(params.flowId);

    // Validate compiled workflow
    if (!workflow || !workflow.nodes || Object.keys(workflow.nodes).length === 0) {
      throw new Error("Flow compiled to empty workflow. Please add valid nodes to the flow.");
    }

    // Resolve LLM model
    const effectiveLlmModelId = await this.resolveLlmModel(params.llmModel, params.userId);

    // Get TTS model with smart auto-selection based on language
    const adminTtsModel = await this.getSmartTtsModel(params.language || 'en');

    // Prioritize flow's extracted first message over provided firstMessage
    const effectiveFirstMessage = flowFirstMessage || params.firstMessage;

    // Fetch KB objects with full details (ElevenLabs requires type, id, and name)
    const knowledgeBases = await this.fetchKnowledgeBases(params.knowledgeBaseIds || []);

    // Build custom webhook tools BEFORE agent creation (they don't need agent ID)
    // Appointment and form tools need agent ID so they're added after
    const initialWebhookTools: any[] = [];

    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
      console.log(`🔗 [Flow Agent] Building custom webhook tools for initial creation`);

      for (const webhookNode of webhookNodes) {
        if (webhookNode.url) {
          // Map webhook method to ElevenLabs supported methods
          // ElevenLabs API only supports GET and POST for webhook tools
          const httpMethod = webhookNode.method === 'GET' ? 'GET' as const : 'POST' as const;

          // Sanitize tool name to match ElevenLabs pattern: ^[a-zA-Z0-9_-]{1,64}$
          const sanitizedToolName = webhookNode.toolId
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 64);

          // Build request body schema from payload configuration
          // POST methods ALWAYS require request_body_schema (even if empty)
          let requestBodySchema: any = undefined;
          if (webhookNode.payload && Object.keys(webhookNode.payload).length > 0) {
            requestBodySchema = {
              type: "object",
              properties: Object.fromEntries(
                Object.entries(webhookNode.payload).map(([key, value]) => {
                  // Infer type from value or default to string
                  const valueType = typeof value === 'number' ? 'number'
                    : typeof value === 'boolean' ? 'boolean'
                      : 'string';
                  return [key, { type: valueType, description: `Value for ${key}` }];
                })
              )
            };
          } else if (httpMethod === 'POST') {
            // ElevenLabs requires request_body_schema for POST methods
            requestBodySchema = {
              type: "object",
              properties: {},
              description: "Request body for webhook"
            };
          }

          const webhookTool = {
            type: "webhook" as const,
            name: sanitizedToolName,
            description: `Execute ${webhookNode.method} webhook action to ${webhookNode.toolId}`,
            api_schema: {
              url: webhookNode.url,
              method: httpMethod,
              request_headers: webhookNode.headers || { "Content-Type": "application/json" },
              ...(requestBodySchema && { request_body_schema: requestBodySchema })
            }
          };
          initialWebhookTools.push(webhookTool);
          console.log(`   Built webhook tool: ${sanitizedToolName} -> ${webhookNode.method} (mapped to ${httpMethod}) ${webhookNode.url}`);
        }
      }
    }

    // Create Flow agent in ElevenLabs with custom webhook tools included
    // Appointment/form tools are added after because they need the ElevenLabs agent ID
    const elevenLabsAgent = await elevenLabsService.createFlowAgent({
      name: params.name,
      voice_id: params.elevenLabsVoiceId,
      language: params.language || 'en',
      llmModel: effectiveLlmModelId,
      temperature: params.temperature ?? 0.3,
      maxDurationSeconds: params.maxDurationSeconds || 600,
      voiceStability: params.voiceStability ?? 0.5,
      voiceSimilarityBoost: params.voiceSimilarityBoost ?? 0.85,
      voiceSpeed: params.voiceSpeed ?? 1.0,
      turnTimeout: params.turnTimeout ?? 1.5,
      detectLanguageEnabled: params.detectLanguageEnabled || false,
      systemPrompt: params.systemPrompt || undefined,
      firstMessage: effectiveFirstMessage || undefined,
      knowledgeBases: knowledgeBases.length > 0 ? knowledgeBases.map(kb => ({
        type: kb.type === 'text' ? 'text' : 'file',
        name: kb.title,
        id: kb.elevenLabsDocId
      })) : undefined,
      ttsModel: adminTtsModel,
      suggestedAudioTags: params.expressiveMode || false,
      toolErrorHandlingMode: "relaxed",
      workflow: workflow,
      webhookTools: initialWebhookTools.length > 0 ? initialWebhookTools : undefined,
    });

    console.log(`✅ [Flow Agent] Created in ElevenLabs: ${elevenLabsAgent.agent_id}`);

    // Log voice pool info for multi-key awareness
    this.logVoicePoolInfo(params.elevenLabsVoiceId, params.name);

    // Build appointment and form tools AFTER creation (they need ElevenLabs agent ID for webhook URL)
    const postCreationTools: any[] = [];

    if (hasAppointmentNodes) {
      console.log(`📅 [Flow Agent] Preparing appointment booking webhook tool for agent ${elevenLabsAgent.agent_id}`);
      const { getAppointmentToolForAgent } = await import('./appointment-elevenlabs-tool');
      const appointmentTool = getAppointmentToolForAgent(elevenLabsAgent.agent_id);
      postCreationTools.push(appointmentTool);
    }

    if (hasFormNodes && formNodes && formNodes.length > 0) {
      console.log(`📋 [Flow Agent] Preparing form submission webhook tools for agent ${elevenLabsAgent.agent_id}`);
      const { getSubmitFormWebhookTool } = await import('./form-elevenlabs-tool');

      for (const formNode of formNodes) {
        if (formNode.formId) {
          const formTool = getSubmitFormWebhookTool(
            formNode.formId,
            formNode.formName,
            formNode.fields,
            elevenLabsAgent.agent_id,
            formNode.nodeId
          );
          postCreationTools.push(formTool);
          console.log(`   Added form tool for: ${formNode.formName} (${formNode.formId}) nodeId: ${formNode.nodeId || 'n/a'}`);
        }
      }
    }

    // Build messaging webhook tools after agent creation (they need agent ID for webhook URL)
    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
      const messagingEmailNodes = webhookNodes.filter(n => n.toolId.startsWith('send_email_'));
      const messagingWhatsappNodes = webhookNodes.filter(n => n.toolId.startsWith('send_whatsapp_'));

      if (messagingEmailNodes.length > 0) {
        console.log(`📧 [Flow Agent] Building ${messagingEmailNodes.length} email webhook tool(s) for agent ${elevenLabsAgent.agent_id}`);
        const { buildMessagingEmailTool } = await import('./elevenlabs');
        for (const emailNode of messagingEmailNodes) {
          const templateName = emailNode.payload?.template_name || 'default';
          const emailTool = buildMessagingEmailTool(elevenLabsAgent.agent_id, [templateName], templateName);
          emailTool.name = emailNode.toolId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
          postCreationTools.push(emailTool);
          console.log(`   📧 Created email webhook tool: ${emailTool.name} -> ${emailTool.api_schema.url}`);
        }
      }

      if (messagingWhatsappNodes.length > 0) {
        console.log(`💬 [Flow Agent] Building ${messagingWhatsappNodes.length} WhatsApp webhook tool(s) for agent ${elevenLabsAgent.agent_id}`);
        const { buildMessagingWhatsappTool } = await import('./elevenlabs');
        for (const waNode of messagingWhatsappNodes) {
          const templateName = waNode.payload?.template_name || 'hello_world';
          const waTool = buildMessagingWhatsappTool(elevenLabsAgent.agent_id, [templateName], templateName);
          waTool.name = waNode.toolId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
          postCreationTools.push(waTool);
          console.log(`   💬 Created WhatsApp webhook tool: ${waTool.name} -> ${waTool.api_schema.url}`);
        }
      }
    }

    // Build play audio tools after agent creation (they need agent ID for webhook URL)
    if (hasPlayAudioNodes && playAudioNodes && playAudioNodes.length > 0) {
      console.log(`🔊 [Flow Agent] Preparing play audio webhook tools for agent ${elevenLabsAgent.agent_id}`);
      const { getPlayAudioWebhookTool } = await import('./play-audio-elevenlabs-tool');

      for (const playAudioNode of playAudioNodes) {
        const playAudioTool = getPlayAudioWebhookTool(
          playAudioNode.nodeId,
          playAudioNode.audioUrl,
          playAudioNode.audioFileName,
          playAudioNode.interruptible,
          playAudioNode.waitForComplete,
          elevenLabsAgent.agent_id
        );
        postCreationTools.push(playAudioTool);
        console.log(`   🔊 Created play audio tool: ${playAudioTool.name}`);
      }
    }

    // If we have appointment/form/play-audio tools, update the agent to add them
    if (postCreationTools.length > 0) {
      try {
        // Combine initial webhook tools with post-creation tools
        const allWebhookTools = [...initialWebhookTools, ...postCreationTools];
        await elevenLabsService.updateFlowAgentWorkflow(
          elevenLabsAgent.agent_id,
          workflow,
          params.maxDurationSeconds || 600,
          undefined, // detectLanguageEnabled
          undefined, // language
          undefined, // ttsModel
          undefined, // llmModel
          undefined, // temperature
          undefined, // firstMessage
          undefined, // voiceId
          { webhookTools: allWebhookTools }
        );
        console.log(`✅ [Flow Agent] Post-creation webhook tools added (${postCreationTools.length} tools)`);
      } catch (toolError: any) {
        console.error(`❌ [Flow Agent] Failed to add post-creation webhook tools:`, toolError.message);
        // Don't fail agent creation if tool addition fails - the agent is still functional
      }
    }

    return { elevenLabsAgentId: elevenLabsAgent.agent_id, credentialId: credential.id };
  }

  /**
   * Check if error indicates a stale/invalid agent ID (API key changed or agent deleted)
   */
  private static isStaleAgentError(error: any): boolean {
    const status = error?.statusCode || error?.status || error?.response?.status || error?.context?.statusCode;
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
   * Update an existing Flow agent in ElevenLabs
   * Uses updateFlowAgentWorkflow for workflow sync + updateAgent for metadata
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
    params: FlowAgentUpdateParams
  ): Promise<{ recreated?: boolean; newElevenLabsAgentId?: string; newCredentialId?: string; messagingWhatsappTemplates?: string[] }> {
    console.log(`🔄 [Flow Agent] Updating: ${agentId}`);

    // Get credential for this agent (may be outdated if API key changed)
    let credential = await ElevenLabsPoolService.getCredentialForAgent(agentId);

    // If no credential found for agent, get a fresh one from the pool
    if (!credential) {
      console.log(`⚠️  [Flow] No credential found for agent ${agentId}, getting fresh credential`);
      credential = await ElevenLabsPoolService.getAvailableCredential();
      if (!credential) {
        throw new Error("No ElevenLabs credentials available");
      }
    }

    const elevenLabsService = new ElevenLabsService(credential.apiKey);

    // Determine which flowId to use
    const flowIdToSync = params.flowId !== undefined ? params.flowId : currentAgent.flowId;

    if (!flowIdToSync) {
      // No flow assigned - just sync metadata
      await this.updateMetadataOnly(elevenLabsService, elevenLabsAgentId, currentAgent, params);
      return {};
    }

    // Fetch and compile the flow
    const { workflow, firstMessage: flowFirstMessage, hasAppointmentNodes, hasFormNodes, formNodes, hasWebhookNodes, webhookNodes, hasPlayAudioNodes, playAudioNodes } = await this.fetchAndCompileFlow(flowIdToSync);

    // Validate compiled workflow
    if (!workflow || !workflow.nodes || Object.keys(workflow.nodes).length === 0) {
      throw new Error("Flow compiled to empty workflow. Please add valid nodes to the flow.");
    }

    // Calculate effective values
    const effectiveMaxDuration = params.maxDurationSeconds ?? currentAgent.maxDurationSeconds ?? 600;
    const effectiveDetectLanguage = params.detectLanguageEnabled ?? currentAgent.detectLanguageEnabled ?? false;
    const effectiveExpressiveMode = params.expressiveMode ?? currentAgent.expressiveMode ?? false;
    const effectiveLanguage = params.language || currentAgent.language;
    const isNonEnglish = effectiveLanguage && effectiveLanguage !== 'en';

    // Get TTS model with smart auto-selection based on language
    const adminTtsModel = await this.getSmartTtsModel(effectiveLanguage || 'en');

    // Resolve LLM model if provided
    let effectiveLlmModel: string | undefined;
    if (params.llmModel) {
      const modelRecord = await db
        .select({ modelId: llmModels.modelId })
        .from(llmModels)
        .where(eq(llmModels.name, params.llmModel))
        .limit(1);

      effectiveLlmModel = modelRecord.length > 0 ? modelRecord[0].modelId : params.llmModel;
      console.log(`📝 [Flow] LLM model update: ${params.llmModel} → ${effectiveLlmModel}`);
    }

    // Prioritize flow's extracted first message over agent's stored/provided value
    const effectiveFirstMessage = flowFirstMessage || params.firstMessage;

    // Build knowledge bases for consolidated update
    let knowledgeBases: KnowledgeBaseItem[] = [];
    let hasKnowledgeBases = false;
    if (params.knowledgeBaseIds !== undefined) {
      console.log(`📚 [Flow] Preparing ${params.knowledgeBaseIds.length} knowledge base(s) for consolidated sync`);
      knowledgeBases = await this.fetchKnowledgeBases(params.knowledgeBaseIds);
      hasKnowledgeBases = params.knowledgeBaseIds.length > 0;
      console.log(`   Total KB docs: ${knowledgeBases.length}`);
    }

    // Build RAG webhook tools for consolidated update (if RAG is enabled and has KBs)
    let webhookTools: any[] = [];
    if (hasKnowledgeBases && isRAGEnabled()) {
      const { getAskKnowledgeWebhookTool } = await import('./rag-elevenlabs-tool');
      const ragToolConfig = getAskKnowledgeWebhookTool(elevenLabsAgentId);
      webhookTools = [ragToolConfig];
      console.log(`📚 [Flow] Including RAG webhook tool in consolidated sync`);

      // Create workspace tool for dashboard visibility (optional)
      try {
        await elevenLabsService.getOrCreateWorkspaceTool(ragToolConfig);
        console.log(`📚 [Flow] RAG workspace tool created/verified`);
      } catch (wsError: any) {
        console.warn(`📚 [Flow] RAG workspace tool skipped: ${wsError.message}`);
      }
    }

    // Add appointment booking tool if flow has appointment nodes
    if (hasAppointmentNodes) {
      const { getAppointmentToolForAgent } = await import('./appointment-elevenlabs-tool');
      const appointmentTool = getAppointmentToolForAgent(elevenLabsAgentId);
      webhookTools.push(appointmentTool);
      console.log(`📅 [Flow] Including appointment booking webhook tool for ${elevenLabsAgentId}`);
    }

    // Add form submission tools if flow has form nodes
    if (hasFormNodes && formNodes && formNodes.length > 0) {
      const { getSubmitFormWebhookTool } = await import('./form-elevenlabs-tool');

      for (const formNode of formNodes) {
        if (formNode.formId) {
          const formTool = getSubmitFormWebhookTool(
            formNode.formId,
            formNode.formName,
            formNode.fields,
            elevenLabsAgentId,
            formNode.nodeId
          );
          webhookTools.push(formTool);
          console.log(`📋 [Flow] Including form submission webhook tool for ${formNode.formName} nodeId: ${formNode.nodeId || 'n/a'}`);
        }
      }
    }

    // Add play audio tools if flow has play audio nodes
    if (hasPlayAudioNodes && playAudioNodes && playAudioNodes.length > 0) {
      const { getPlayAudioWebhookTool } = await import('./play-audio-elevenlabs-tool');

      for (const playAudioNode of playAudioNodes) {
        const playAudioTool = getPlayAudioWebhookTool(
          playAudioNode.nodeId,
          playAudioNode.audioUrl,
          playAudioNode.audioFileName,
          playAudioNode.interruptible,
          playAudioNode.waitForComplete,
          elevenLabsAgentId
        );
        webhookTools.push(playAudioTool);
        console.log(`🔊 [Flow] Including play audio webhook tool for ${playAudioTool.name}`);
      }
    }

    // Add messaging webhook tools (send_email/send_whatsapp nodes need agent ID for URL)
    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
      const messagingEmailNodes = webhookNodes.filter(n => n.toolId.startsWith('send_email_'));
      const messagingWhatsappNodes = webhookNodes.filter(n => n.toolId.startsWith('send_whatsapp_'));

      if (messagingEmailNodes.length > 0) {
        const { buildMessagingEmailTool } = await import('./elevenlabs');
        for (const emailNode of messagingEmailNodes) {
          const templateName = emailNode.payload?.template_name || 'default';
          const emailTool = buildMessagingEmailTool(elevenLabsAgentId, [templateName], templateName);
          emailTool.name = emailNode.toolId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
          webhookTools.push(emailTool);
          console.log(`📧 [Flow] Including email webhook tool: ${emailTool.name}`);
        }
      }

      if (messagingWhatsappNodes.length > 0) {
        const { buildMessagingWhatsappTool } = await import('./elevenlabs');
        for (const waNode of messagingWhatsappNodes) {
          const templateName = waNode.payload?.template_name || 'hello_world';
          const waTool = buildMessagingWhatsappTool(elevenLabsAgentId, [templateName], templateName);
          waTool.name = waNode.toolId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
          webhookTools.push(waTool);
          console.log(`💬 [Flow] Including WhatsApp webhook tool: ${waTool.name}`);
        }
      }
    }

    // Add custom webhook nodes (user-defined webhooks in the flow builder)
    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
      console.log(`🔗 [Flow] Preparing custom webhook tools for agent ${elevenLabsAgentId}`);

      for (const webhookNode of webhookNodes) {
        if (webhookNode.url) {
          // Map webhook method to ElevenLabs supported methods
          // ElevenLabs API only supports GET and POST for webhook tools
          const httpMethod = webhookNode.method === 'GET' ? 'GET' as const : 'POST' as const;

          // Sanitize tool name to match ElevenLabs pattern: ^[a-zA-Z0-9_-]{1,64}$
          const sanitizedToolName = webhookNode.toolId
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 64);

          // Build request body schema from payload configuration
          // POST methods ALWAYS require request_body_schema (even if empty)
          let requestBodySchema: any = undefined;
          if (webhookNode.payload && Object.keys(webhookNode.payload).length > 0) {
            requestBodySchema = {
              type: "object",
              properties: Object.fromEntries(
                Object.entries(webhookNode.payload).map(([key, value]) => {
                  // Infer type from value or default to string
                  const valueType = typeof value === 'number' ? 'number'
                    : typeof value === 'boolean' ? 'boolean'
                      : 'string';
                  return [key, { type: valueType, description: `Value for ${key}` }];
                })
              )
            };
          } else if (httpMethod === 'POST') {
            // ElevenLabs requires request_body_schema for POST methods
            requestBodySchema = {
              type: "object",
              properties: {},
              description: "Request body for webhook"
            };
          }

          const webhookTool = {
            type: "webhook" as const,
            name: sanitizedToolName,
            description: `Execute ${webhookNode.method} webhook action to ${webhookNode.toolId}`,
            api_schema: {
              url: webhookNode.url,
              method: httpMethod,
              request_headers: webhookNode.headers || { "Content-Type": "application/json" },
              ...(requestBodySchema && { request_body_schema: requestBodySchema })
            }
          };
          webhookTools.push(webhookTool);
          console.log(`   Added custom webhook tool: ${sanitizedToolName} -> ${webhookNode.method} (mapped to ${httpMethod}) ${webhookNode.url}`);
        }
      }
    }

    // Build additional options for consolidated update
    const additionalOptions: {
      knowledgeBases?: typeof knowledgeBases;
      webhookTools?: typeof webhookTools;
      name?: string;
      basePrompt?: string;
      voiceStability?: number;
      voiceSimilarityBoost?: number;
      voiceSpeed?: number;
      suggestedAudioTags?: boolean;
    } = {};

    if (knowledgeBases.length > 0) {
      additionalOptions.knowledgeBases = knowledgeBases;
    }
    if (webhookTools.length > 0) {
      additionalOptions.webhookTools = webhookTools;
    }
    if (params.name && params.name !== currentAgent.name) {
      additionalOptions.name = params.name;
    }

    // CRITICAL: Set strict base system prompt for workflow execution
    // This prompt enforces deterministic script following and prevents improvisation
    const strictWorkflowPrompt = `You are a call agent that must strictly follow a predefined workflow.

RULES:
1. Say EXACTLY what each workflow node instructs you to say.
2. Do NOT add extra words, greetings, questions, or small talk unless specifically written.
3. After speaking a node message, STOP and wait for the user's response.
4. Move to the next workflow node only based on the workflow edge rules.
5. If the user asks a question outside the workflow, use the ask_knowledge tool to respond briefly and accurately — then return to the workflow.
6. If the user asks to speak with a human (e.g. "connect me", "transfer", "agent", "representative"), immediately trigger the transfer.
7. Do NOT improvise or generate random speech.
8. NEVER override instructions from workflow nodes.
9. IGNORE any background noise, side conversations, or ambient speech that is not directed at you. Only respond to the primary speaker who is directly addressing you on the call.
10. If you hear unrelated words or topics from the background environment, do NOT change the conversation topic or respond to them. Stay on your current workflow step.

When using a tool:
- Do not announce you are using a tool.
- Do not say "invoking tool" or similar.
- Only say a short acknowledgment if needed (e.g. "Let me check that for you.")`;

    // Merge user's custom prompt WITH strict workflow rules
    // The user's domain constraints (e.g., "Only discuss healthcare") must be preserved
    // alongside the workflow enforcement rules to prevent context drift
    const userCustomPrompt = currentAgent.systemPrompt || params.systemPrompt;
    let basePrompt: string;
    if (userCustomPrompt) {
      basePrompt = `${strictWorkflowPrompt}\n\n--- ADDITIONAL AGENT INSTRUCTIONS (provided by the agent creator) ---\nThe following instructions define your persona, domain, and behavioral constraints. You MUST follow these AT ALL TIMES, even while executing the workflow:\n\n${userCustomPrompt}\n\n--- END OF ADDITIONAL INSTRUCTIONS ---\nRemember: Follow BOTH the workflow steps AND the additional instructions above. Never deviate from your assigned domain or persona.`;
      console.log(`📝 [Flow] Merged custom prompt (${userCustomPrompt.length} chars) with strict workflow rules`);
    } else {
      basePrompt = strictWorkflowPrompt;
      console.log(`📝 [Flow] Using default strict workflow prompt`);
    }
    additionalOptions.basePrompt = basePrompt;
    console.log(`📝 [Flow] Base prompt: ${basePrompt.substring(0, 50)}...`);

    // Pass voice quality settings for more natural speech
    // Use new values or preserve existing, falling back to balanced defaults
    const voiceStability = params.voiceStability ?? currentAgent.voiceStability ?? 0.5;
    const voiceSimilarityBoost = params.voiceSimilarityBoost ?? currentAgent.voiceSimilarityBoost ?? 0.85;
    const voiceSpeed = params.voiceSpeed ?? currentAgent.voiceSpeed ?? 1.0;
    const turnTimeout = params.turnTimeout ?? currentAgent.turnTimeout ?? 1.5;

    additionalOptions.voiceStability = voiceStability;
    additionalOptions.voiceSimilarityBoost = voiceSimilarityBoost;
    additionalOptions.voiceSpeed = voiceSpeed;
    additionalOptions.turnTimeout = turnTimeout;
    if (effectiveExpressiveMode) {
      additionalOptions.suggestedAudioTags = true;
    }
    console.log(`🎙️ [Flow] Voice settings: stability=${voiceStability}, similarity=${voiceSimilarityBoost}, speed=${voiceSpeed}, expressiveMode=${effectiveExpressiveMode}`);

    // Update workflow using SINGLE consolidated API call
    // This prevents ElevenLabs PATCH from overwriting settings between multiple calls
    console.log(`🔄 [Flow] Syncing workflow to ElevenLabs (consolidated)...`);

    await convertWorkflowTransferNodesForSIP(workflow, agentId);

    try {
      await elevenLabsService.updateFlowAgentWorkflow(
        elevenLabsAgentId,
        workflow,
        effectiveMaxDuration,
        effectiveDetectLanguage,
        effectiveLanguage,
        adminTtsModel,
        effectiveLlmModel,
        params.temperature,
        effectiveFirstMessage,
        params.elevenLabsVoiceId && params.elevenLabsVoiceId !== currentAgent.elevenLabsVoiceId
          ? params.elevenLabsVoiceId : undefined,
        Object.keys(additionalOptions).length > 0 ? additionalOptions : undefined
      );

      console.log(`✅ [Flow Agent] Synced to ElevenLabs (all settings in single update)`);
      return {};
    } catch (updateError: any) {
      // Check if this is a stale agent error (API key changed, agent doesn't exist, etc.)
      if (this.isStaleAgentError(updateError)) {
        console.log(`⚠️  [Flow] Stale agent detected (${updateError.message}). Recreating agent with current API key...`);

        // Recreate the agent with FULL current agent configuration merged with updates
        // Use nullish coalescing to preserve existing values unless explicitly overridden
        const mergedParams: FlowAgentCreateParams = {
          userId: currentAgent.userId,
          name: params.name ?? currentAgent.name,
          flowId: flowIdToSync ?? currentAgent.flowId,
          elevenLabsVoiceId: params.elevenLabsVoiceId ?? currentAgent.elevenLabsVoiceId,
          systemPrompt: params.systemPrompt ?? currentAgent.systemPrompt,
          firstMessage: effectiveFirstMessage ?? currentAgent.firstMessage,
          language: effectiveLanguage ?? currentAgent.language ?? 'en',
          llmModel: effectiveLlmModel ?? currentAgent.llmModel,
          temperature: params.temperature ?? currentAgent.temperature ?? 0.3,
          maxDurationSeconds: effectiveMaxDuration ?? currentAgent.maxDurationSeconds ?? 600,
          voiceStability: params.voiceStability ?? currentAgent.voiceStability ?? 0.5,
          voiceSimilarityBoost: params.voiceSimilarityBoost ?? currentAgent.voiceSimilarityBoost ?? 0.85,
          voiceSpeed: params.voiceSpeed ?? currentAgent.voiceSpeed ?? 1.0,
          turnTimeout: params.turnTimeout ?? currentAgent.turnTimeout ?? 1.5,
          detectLanguageEnabled: effectiveDetectLanguage ?? currentAgent.detectLanguageEnabled ?? false,
          expressiveMode: effectiveExpressiveMode ?? currentAgent.expressiveMode ?? false,
          knowledgeBaseIds: params.knowledgeBaseIds ?? currentAgent.knowledgeBaseIds ?? [],
        };

        const result = await this.createInElevenLabs(mergedParams);

        // Update the database with the new ElevenLabs agent ID and credential
        await storage.updateAgent(agentId, {
          elevenLabsAgentId: result.elevenLabsAgentId,
          elevenLabsCredentialId: result.credentialId,
        });

        console.log(`✅ [Flow] Agent recreated with new ElevenLabs ID: ${result.elevenLabsAgentId}`);

        return {
          recreated: true,
          newElevenLabsAgentId: result.elevenLabsAgentId,
          newCredentialId: result.credentialId
        };
      } else {
        // Not a stale agent error - rethrow
        throw updateError;
      }
    }
  }

  /**
   * Update only metadata for Flow agents without a flow assigned
   */
  private static async updateMetadataOnly(
    elevenLabsService: ElevenLabsService,
    elevenLabsAgentId: string,
    currentAgent: any,
    params: FlowAgentUpdateParams
  ): Promise<void> {
    console.log(`🔄 [Flow] Syncing metadata only (no workflow)`);

    const effectiveLanguage = params.language || currentAgent.language;
    const isNonEnglish = effectiveLanguage && effectiveLanguage !== 'en';

    let adminTtsModel: string | undefined;
    if (isNonEnglish) {
      adminTtsModel = await this.getSmartTtsModel(effectiveLanguage);
    }

    const voiceUpdates: any = {};
    if (params.elevenLabsVoiceId && params.elevenLabsVoiceId !== currentAgent.elevenLabsVoiceId) {
      voiceUpdates.voice_id = params.elevenLabsVoiceId;
    }
    if (params.name && params.name !== currentAgent.name) {
      voiceUpdates.name = params.name;
    }

    if (isNonEnglish) {
      voiceUpdates.language = effectiveLanguage;
      voiceUpdates.tts_model = adminTtsModel;
    } else if (params.language && params.language !== currentAgent.language) {
      voiceUpdates.language = params.language;
    }

    // Sync knowledge bases if provided
    if (params.knowledgeBaseIds !== undefined) {
      console.log(`📚 [Flow] Syncing ${params.knowledgeBaseIds.length} knowledge base(s) (no workflow)`);
      const knowledgeBases = await this.fetchKnowledgeBases(params.knowledgeBaseIds);
      voiceUpdates.knowledge_bases = knowledgeBases;
      console.log(`   Total KB docs to sync: ${knowledgeBases.length}`);
      // Set flag to include RAG knowledge base instructions in prompt
      voiceUpdates.hasRAGKnowledgeBases = params.knowledgeBaseIds.length > 0 && isRAGEnabled();
    }

    if (Object.keys(voiceUpdates).length > 0) {
      // CRITICAL: skipWorkflowRebuild prevents any workflow from being added
      await elevenLabsService.updateAgent(elevenLabsAgentId, {
        ...voiceUpdates,
        skipWorkflowRebuild: true
      });
      console.log(`✅ [Flow] Metadata synced to ElevenLabs`);
    }

    // Note: RAG tool setup is handled by the caller (updateInElevenLabs)
  }

  /**
   * Sync flow workflow to an existing Flow agent
   * Called from flow-automation routes when flow is saved
   */
  static async syncFlowToAgent(
    agentId: string,
    elevenLabsAgentId: string,
    flowNodes: any[],
    flowEdges: any[],
    options?: {
      maxDurationSeconds?: number;
      detectLanguageEnabled?: boolean;
      language?: string;
      llmModel?: string;
      temperature?: number;
      firstMessage?: string;
    }
  ): Promise<void> {
    console.log(`🔄 [Flow Agent] Syncing flow to agent: ${agentId}`);

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agentId);
    if (!credential) {
      throw new Error("No ElevenLabs credential found for this agent");
    }

    const elevenLabsService = new ElevenLabsService(credential.apiKey);

    // Compile the flow
    const { workflow, firstMessage: flowFirstMessage } = this.compileFlow(flowNodes, flowEdges);

    // Validate compiled workflow
    if (!workflow || !workflow.nodes || Object.keys(workflow.nodes).length === 0) {
      throw new Error("Flow compiled to empty workflow");
    }

    console.log(`   Compiled: ${Object.keys(workflow.nodes).length} nodes, ${Object.keys(workflow.edges).length} edges`);

    // Get effective language settings
    const isNonEnglish = options?.language && options.language !== 'en';
    let adminTtsModel: string | undefined;
    if (isNonEnglish) {
      adminTtsModel = await this.getSmartTtsModel(options.language);
    }

    // Prioritize flow's extracted first message
    const effectiveFirstMessage = flowFirstMessage || options?.firstMessage;

    await convertWorkflowTransferNodesForSIP(workflow, agentId);

    // Update workflow
    await elevenLabsService.updateFlowAgentWorkflow(
      elevenLabsAgentId,
      workflow,
      options?.maxDurationSeconds,
      options?.detectLanguageEnabled,
      isNonEnglish ? options?.language : undefined,
      isNonEnglish ? adminTtsModel : undefined,
      options?.llmModel,
      options?.temperature,
      effectiveFirstMessage
    );

    console.log(`✅ [Flow Agent] Flow synced to ElevenLabs`);
  }
}
