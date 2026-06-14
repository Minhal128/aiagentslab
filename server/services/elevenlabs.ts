'use strict';
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
import { Request } from "express";
import { ExternalServiceError } from '../utils/errors';
import { withServiceErrorHandling, wrapServiceError } from '../utils/service-error-wrapper';
import { getCorrelationHeaders } from '../middleware/correlation-id';
import { getAppointmentToolForAgent, getAppointmentWebhookSecret } from './appointment-elevenlabs-tool';
import { getDomain } from '../utils/domain';


import { db } from '../db';
import { sql } from 'drizzle-orm';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

export async function isAgentOnSipPhoneNumber(agentId: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT 1 FROM sip_phone_numbers WHERE agent_id = ${agentId} AND is_active = true LIMIT 1
    `);
    return (result.rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export function buildCollectCallerEmailTool(elevenLabsAgentId: string): any {
  const domain = getDomain();
  const secret = getAppointmentWebhookSecret();
  const webhookUrl = `${domain}/api/webhooks/messaging/collect-email/${secret}/${elevenLabsAgentId}`;
  const agentIdSuffix = elevenLabsAgentId.slice(-8);

  return {
    type: "webhook",
    name: `collect_caller_email_${agentIdSuffix}`,
    description: "Ask the caller for their email address and store it for post-call follow-up. Use this BEFORE any other messaging tool if a post-call email should be sent. Politely ask for the caller's email address first.",
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      request_body_schema: {
        type: "object",
        properties: {
          email_address: {
            type: "string",
            description: "The email address collected from the caller."
          },
          conversationId: {
            type: "string",
            description: "ALWAYS set this to {{system__conversation_id}} to track which call this email belongs to."
          }
        },
        required: ["email_address", "conversationId"]
      }
    }
  };
}

export function buildMessagingEmailTool(elevenLabsAgentId: string, templateNames: string[], selectedTemplate?: string): any {
  const domain = getDomain();
  const secret = getAppointmentWebhookSecret();
  const webhookUrl = `${domain}/api/webhooks/messaging/send-email/${secret}/${elevenLabsAgentId}`;
  const agentIdSuffix = elevenLabsAgentId.slice(-8);

  let templateInstruction: string;
  if (selectedTemplate) {
    templateInstruction = `You MUST use the template named "${selectedTemplate}".`;
  } else if (templateNames.length > 0) {
    templateInstruction = `Available email templates: ${templateNames.join(', ')}.`;
  } else {
    templateInstruction = 'Use the template name configured by the user.';
  }

  return {
    type: "webhook",
    name: `send_email_${agentIdSuffix}`,
    description: `Send an email to the caller. You MUST ask for their email address first before using this tool. ${templateInstruction} Fill in any dynamic variables like contact_name with information collected during the conversation.`,
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      request_body_schema: {
        type: "object",
        properties: {
          recipient_email: {
            type: "string",
            description: "The email address to send the email to. You must ask the caller for this."
          },
          template_name: {
            type: "string",
            description: selectedTemplate
              ? `The email template to use. ALWAYS use "${selectedTemplate}".`
              : `The name of the email template to use. ${templateInstruction}`
          },
          dynamic_variables: {
            type: "object",
            description: "Key-value pairs for template variable substitution (e.g., contact_name, appointment_date)"
          },
          conversationId: {
            type: "string",
            description: "ALWAYS set this to {{system__conversation_id}} to track which call this email belongs to."
          }
        },
        required: ["recipient_email", "template_name", "conversationId"]
      }
    }
  };
}

export function buildMessagingWhatsappTool(elevenLabsAgentId: string, templateNames: string[], selectedTemplate?: string, variableConfig?: string, preToolSpeech?: string): any {
  const domain = getDomain();
  const secret = getAppointmentWebhookSecret();
  const webhookUrl = `${domain}/api/webhooks/messaging/send-whatsapp/${secret}/${elevenLabsAgentId}`;
  const agentIdSuffix = elevenLabsAgentId.slice(-8);

  let templateInstruction: string;
  if (selectedTemplate) {
    templateInstruction = `You MUST use the template named "${selectedTemplate}".`;
  } else if (templateNames.length > 0) {
    templateInstruction = `Available WhatsApp templates: ${templateNames.join(', ')}.`;
  } else {
    templateInstruction = 'Use the template name configured by the user.';
  }

  let collectVarDescriptions: string[] = [];
  if (variableConfig) {
    try {
      const parsed = JSON.parse(variableConfig);
      for (const [key, val] of Object.entries(parsed)) {
        if (val && typeof val === 'object' && (val as any).mode === 'collect' && !(val as any).componentType) {
          const desc = (val as any).value || `Variable {{${key}}}`;
          collectVarDescriptions.push(`{{${key}}}: ${desc}`);
        }
      }
    } catch { }
  }

  const varDescription = collectVarDescriptions.length > 0
    ? ` This tool requires the following information to be collected from the caller before execution: ${collectVarDescriptions.join('; ')}. You MUST ask the caller for any of these values that you do not already know. Provide the collected values in the template_variables array.`
    : '';

  return {
    type: "webhook",
    name: `send_whatsapp_${agentIdSuffix}`,
    description: `Send a WhatsApp message to the caller using an approved template. The caller's phone number is automatically available. ${templateInstruction}${varDescription} CRITICAL: You MUST actually call this tool. Do not simulate or pretend to send the message. Wait for a success response before confirming to the user.`,
    pre_tool_speech: preToolSpeech || "auto",
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      request_body_schema: {
        type: "object",
        properties: {
          template_name: {
            type: "string",
            description: selectedTemplate
              ? `The WhatsApp template to send. ALWAYS use "${selectedTemplate}".`
              : `The name of the WhatsApp template to send. ${templateInstruction}`
          },
          language: {
            type: "string",
            description: "The language code for the template (default: en_US)"
          },
          phone_number: {
            type: "string",
            description: "ALWAYS set this to 'USE_CALLER_NUMBER' to use the recipient's actual phone number. Only provide a different number if the caller explicitly gives one."
          },
          template_variables: {
            type: "array",
            description: "Template variable values collected from the caller. Each item has position (1-based index), value (the collected text), and optionally componentType ('button' for URL button variables).",
            items: {
              type: "object",
              properties: {
                position: { type: "number", description: "1-based variable position in the template body" },
                value: { type: "string", description: "The value for this variable" },
                componentType: { type: "string", description: "Set to 'button' for URL button variables, omit for body variables" }
              },
              required: ["position", "value"]
            }
          },
          headerVariable: {
            type: "object",
            description: "Optional header variable for templates with dynamic headers (text or media). For media headers provide a url; for text headers provide a value.",
            properties: {
              value: { type: "string", description: "The header text value (for text headers)" },
              url: { type: "string", description: "The media URL (for image/video/document headers)" },
              type: { type: "string", description: "Header type: 'text', 'image', 'video', or 'document'" }
            }
          },
          buttonVariables: {
            type: "array",
            description: "Optional button variables for templates with dynamic URL buttons. Each item has an index (0-based button position) and the dynamic URL suffix value.",
            items: {
              type: "object",
              properties: {
                index: { type: "number", description: "0-based button index" },
                value: { type: "string", description: "The dynamic portion of the button URL" }
              },
              required: ["index", "value"]
            }
          },
          conversationId: {
            type: "string",
            description: "ALWAYS set this to {{conversation_id}} to track which call this WhatsApp message belongs to."
          }
        },
        required: ["template_name", "conversationId"]
      }
    }
  };
}

export async function getSipTrunkOutboundAddress(agentId: string): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT st.sip_host, st.sip_port, st.transport
      FROM sip_phone_numbers sp
      JOIN sip_trunks st ON sp.sip_trunk_id = st.id
      WHERE sp.agent_id = ${agentId} AND sp.is_active = true
      LIMIT 1
    `);
    if (result.rows?.length > 0) {
      const row = result.rows[0] as any;
      const host = row.sip_host;
      if (host) {
        const defaultPort = row.transport === 'tls' ? 5061 : 5060;
        const port = row.sip_port ? Number(row.sip_port) : defaultPort;
        if (port !== defaultPort) {
          return `${host}:${port}`;
        }
        return host;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const DEFAULT_EXPRESSIVE_AUDIO_TAGS = [
  { tag: "friendly", description: "Use when greeting users or closing conversations warmly" },
  { tag: "empathetic", description: "Use when the user expresses frustration, concern, or sadness" },
  { tag: "professional", description: "Use during business discussions or technical explanations" },
  { tag: "excited", description: "Use when sharing good news, special offers, or achievements" },
  { tag: "reassuring", description: "Use when calming worried users or confirming actions" },
  { tag: "curious", description: "Use when asking clarifying questions or exploring user needs" },
  { tag: "apologetic", description: "Use when acknowledging mistakes or service issues" },
  { tag: "confident", description: "Use when providing solutions or expert recommendations" },
];

// ElevenLabs requires mixed API versions:
// - v1 for /convai/agents endpoints (agent management)
// - v2 for /voices endpoint (voice fetching)
const ELEVENLABS_V1_BASE_URL = "https://api.elevenlabs.io/v1";
const ELEVENLABS_V2_BASE_URL = "https://api.elevenlabs.io/v2";

// In-memory cache for workspace tool IDs 
// Keyed by "{apiKeyPrefix}:{toolName}" to prevent cross-workspace confusion
// Entries expire after WORKSPACE_TOOL_CACHE_TTL_MS so long-running servers
// eventually re-verify tool ids against ElevenLabs even if no explicit
// invalidation signal (e.g. "document not found" error) arrives.
const WORKSPACE_TOOL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface WorkspaceToolCacheEntry {
  value: string;
  fetchedAt: number;
}

const workspaceToolCacheStore = new Map<string, WorkspaceToolCacheEntry>();

const workspaceToolCache = {
  get(key: string): string | undefined {
    const entry = workspaceToolCacheStore.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt > WORKSPACE_TOOL_CACHE_TTL_MS) {
      workspaceToolCacheStore.delete(key);
      return undefined;
    }
    return entry.value;
  },
  set(key: string, value: string): void {
    workspaceToolCacheStore.set(key, { value, fetchedAt: Date.now() });
  },
  delete(key: string): boolean {
    return workspaceToolCacheStore.delete(key);
  },
  clear(): void {
    workspaceToolCacheStore.clear();
  },
};

/**
 * Generate a cache key that's unique per API key (workspace)
 */
function getToolCacheKey(apiKey: string, toolName: string): string {
  // Use first 8 chars of API key as workspace identifier
  const keyPrefix = apiKey.substring(0, 8);
  return `${keyPrefix}:${toolName}`;
}

/**
 * Interface for ElevenLabs workspace tool
 */
export interface ElevenLabsWorkspaceTool {
  id: string;
  tool_config: {
    type: string;
    name?: string;
    description?: string;
    api_schema?: {
      url: string;
      method: string;
      headers?: Record<string, string>;
      request_body_schema?: any;
    };
  };
}

if (!ELEVENLABS_API_KEY) {
  console.warn("⚠️  WARNING: ELEVENLABS_API_KEY not set. ElevenLabs features will not work.");
}

export interface TransferRule {
  transfer_type: "conference" | "sip_refer";
  number_type: "phone" | "sip_uri";
  destination: string;
  condition?: string;
  customer_message?: string;
  operator_message?: string;
}

export interface TransferToNumberTool {
  type: "transfer_to_number";
  description?: string;
  transfer_rules: TransferRule[];
}

interface KnowledgeBaseItem {
  type: string;
  title: string;
  elevenLabsDocId: string;
}

interface CreateAgentParams {
  name: string;
  prompt: string;
  voice_id: string;
  language?: string;
  model?: string;
  first_message?: string;
  temperature?: number;
  voice_tone?: string;
  personality?: string;
  tools?: TransferToNumberTool[];
  knowledge_bases?: KnowledgeBaseItem[];
  // Flag to indicate agent has RAG knowledge bases (even if they don't have ElevenLabs doc IDs)
  // This is used to add knowledge base tool instructions to the prompt
  hasRAGKnowledgeBases?: boolean;
  // System Tools Configuration
  transferEnabled?: boolean;
  transferPhoneNumber?: string;
  detectLanguageEnabled?: boolean;
  endConversationEnabled?: boolean;
  appointmentBookingEnabled?: boolean;
  messagingEmailEnabled?: boolean;
  messagingWhatsappEnabled?: boolean;
  messagingEmailTemplates?: string[];
  messagingWhatsappTemplates?: string[];
  messagingEmailSelectedTemplate?: string;
  messagingWhatsappSelectedTemplate?: string;
  messagingWhatsappVariables?: string;
  // Database agent ID (needed for appointment webhook tool URL)
  databaseAgentId?: string;
  // Skip workflow creation for incoming agents (workflows cause "Invalid message received" errors)
  skipWorkflow?: boolean;
  // Skip workflow rebuild during updateAgent - used for Flow agents whose workflow is managed by the flow builder
  skipWorkflowRebuild?: boolean;
  // TTS model override (admin setting)
  tts_model?: string;
  // Voice quality settings
  voiceStability?: number;  // 0-1, balanced natural vs consistent (default 0.5)
  voiceSimilarityBoost?: number;  // 0-1, voice matching (default 0.85)
  voiceSpeed?: number;  // 0.5-2.0, speech rate (default 0.92)
  turnTimeout?: number;  // Turn timeout in seconds (default 1.5)
  // Webhook tools (like RAG knowledge base tool) - added at agent root level
  webhookTools?: Array<{
    type: "webhook";
    name: string;
    description: string;
    api_schema: {
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      path_params_schema?: Record<string, any>;
      query_params_schema?: Record<string, any>;
      request_body_schema?: Record<string, any>;
    };
  }>;
  // V3 Features - all optional, additive only
  customGuardrails?: string[];
  toolErrorHandlingMode?: "default" | "relaxed" | "strict";
  dynamicVariableSanitize?: boolean;
  suggestedAudioTags?: boolean;
}

interface ElevenLabsAgent {
  agent_id: string;
  name: string;
  prompt: string;
  voice: {
    voice_id: string;
  };
  language: string;
  model: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export interface SharedVoice {
  voice_id: string;
  public_owner_id: string;
  name: string;
  description?: string;
  category?: string;
  labels?: Record<string, string>;
  accent?: string;
  age?: string;
  gender?: string;
  language?: string;
  use_case?: string;
  descriptive?: string;
  preview_url?: string;
  high_quality_base_model_ids?: string[];
  instagram_profile_url?: string;
  twitter_profile_url?: string;
  youtube_profile_url?: string;
  tiktok_profile_url?: string;
  image_url?: string;
  cloned_by_count?: number;
  usage_character_count_1y?: number;
  usage_character_count_7d?: number;
  play_api_usage_character_count_1y?: number;
  rate?: number;
  free_users_allowed?: boolean;
  live_moderation_enabled?: boolean;
  notice_period?: number;
}

// Default timeout for ElevenLabs API calls (30 seconds)
const ELEVENLABS_API_TIMEOUT_MS = 30000;

export class ElevenLabsService {
  private apiKey: string;

  /**
   * Sanitize LLM model ID for ElevenLabs API
   * Maps unsupported models (like OpenAI Realtime) to supported equivalents
   * This is necessary when an agent is configured with an OpenAI-compatible engine
   * but is being synced to ElevenLabs as a Flow agent.
   */
  static sanitizeLlmModel(modelId: string | undefined): string {
    if (!modelId) return 'gpt-4o-mini';

    const UNSUPPORTED_MAPPINGS: Record<string, string> = {
      'gpt-realtime-mini': 'gpt-4o-mini',
      'gpt-4o-mini-realtime-preview': 'gpt-4o-mini',
      'gpt-realtime': 'gpt-4o',
      'gpt-realtime-1.5': 'gpt-4o',
      'gpt-4o-realtime-preview': 'gpt-4o',
    };

    const sanitized = UNSUPPORTED_MAPPINGS[modelId] || modelId;
    if (sanitized !== modelId) {
      console.log(`🧹 [ElevenLabs] Sanitized unsupported model: ${modelId} -> ${sanitized}`);
    }
    return sanitized;
  }

  constructor(apiKey?: string) {
    this.apiKey = apiKey || ELEVENLABS_API_KEY || "";
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, useV2 = false, timeoutMs = ELEVENLABS_API_TIMEOUT_MS, retryDepth = 0): Promise<T> {
    // Use v2 for voices endpoint, v1 for everything else (agents, etc.)
    const baseUrl = useV2 ? ELEVENLABS_V2_BASE_URL : ELEVENLABS_V1_BASE_URL;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check for stale tool/document error and attempt recovery
        const isDocNotFound = errorText.includes('not found') || 
                              errorText.includes('Document with id') || 
                              errorText.includes('documents_not_found') ||
                              errorText.includes('document_not_found');
        
        const isAgentRequest = endpoint.includes('/convai/agents') && 
                               (options.method === 'PATCH' || options.method === 'POST');

        const agentIdMatch = endpoint.match(/\/convai\/agents\/([a-zA-Z0-9_-]+)/);
        const agentId = agentIdMatch ? agentIdMatch[1] : null;

        if (isDocNotFound && isAgentRequest && agentId && options.body && retryDepth < 3) {
          console.warn(`⚠️ [ElevenLabs Service] Stale tool/document ID detected in agent request:`, errorText);
          const idMatches = errorText.match(/(tool|kb)_[a-zA-Z0-9_-]+/g) || [];
          const brokenIds = new Set(idMatches);
          
          if (brokenIds.size > 0) {
            console.log(`   🛠️ Attempting to purge ${brokenIds.size} broken ID(s):`, Array.from(brokenIds));
            try {
              // 1. Fetch current agent to get existing state of tools, tool_ids and knowledge_base
              console.log(`   🔄 Fetching current configuration for agent ${agentId} to purge stale references...`);
              const currentAgent = await this.request<any>(`/convai/agents/${agentId}`, { method: 'GET' }, useV2, timeoutMs, retryDepth + 1);
              
              const currentTools = currentAgent?.conversation_config?.agent?.prompt?.tools || [];
              const currentToolIds = currentAgent?.conversation_config?.agent?.prompt?.tool_ids || [];
              const currentKb = currentAgent?.conversation_config?.agent?.prompt?.knowledge_base || [];
              
              const payload = JSON.parse(options.body as string);
              payload.conversation_config = payload.conversation_config || {};
              payload.conversation_config.agent = payload.conversation_config.agent || {};
              payload.conversation_config.agent.prompt = payload.conversation_config.agent.prompt || {};
              
              // Clean tools
              const cleanTools = (toolsArray: any[]) => toolsArray.filter(
                (t: any) => !brokenIds.has(t.id) && !brokenIds.has(t.name) && !brokenIds.has(t.tool_id)
              );
              
              const mergedTools = [...(payload.conversation_config.agent.prompt.tools || []), ...currentTools];
              payload.conversation_config.agent.prompt.tools = cleanTools(mergedTools);
              
              // Deduplicate tools by id/name
              const seenTools = new Set();
              payload.conversation_config.agent.prompt.tools = payload.conversation_config.agent.prompt.tools.filter((t: any) => {
                const key = t.id || t.name;
                if (!key || seenTools.has(key)) return false;
                seenTools.add(key);
                return true;
              });
              
              // Clean tool_ids
              const cleanToolIds = (idsArray: string[]) => idsArray.filter(
                (id: string) => !brokenIds.has(id)
              );
              
              const mergedToolIds = [...(payload.conversation_config.agent.prompt.tool_ids || []), ...currentToolIds];
              payload.conversation_config.agent.prompt.tool_ids = Array.from(new Set(cleanToolIds(mergedToolIds)));
              
              // Clean knowledge_base
              const cleanKb = (kbArray: any[]) => kbArray.filter(
                (kb: any) => !brokenIds.has(kb.id)
              );
              
              const mergedKb = [...(payload.conversation_config.agent.prompt.knowledge_base || []), ...currentKb];
              payload.conversation_config.agent.prompt.knowledge_base = cleanKb(mergedKb);
              
              // Clear cache
              workspaceToolCache.clear();
              
              console.log(`   🔄 Retrying agent request with purged and merged payload (depth ${retryDepth})...`);
              const newOptions = {
                ...options,
                body: JSON.stringify(payload)
              };
              
              clearTimeout(timeoutId);
              return this.request<T>(endpoint, newOptions, useV2, timeoutMs, retryDepth + 1);
            } catch (err: any) {
              console.error(`   ❌ Stale ID recovery failed:`, err.message);
            }
          }
        }

        throw new ExternalServiceError(
          'ElevenLabs',
          `ElevenLabs API error: ${response.status} - ${errorText}`,
          undefined,
          {
            operation: endpoint,
            statusCode: response.status,
            responseBody: errorText
          }
        );
      }

      return response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ExternalServiceError(
          'ElevenLabs',
          `ElevenLabs API timeout after ${timeoutMs}ms: ${endpoint}`,
          undefined,
          { operation: endpoint, timeout: timeoutMs }
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Builds ElevenLabs system tools as an ARRAY for prompt.tools
   * Per ElevenLabs API docs: System tools go in prompt.tools array with type: "system"
   * NOT in built_in_tools object (that's read-only, populated by ElevenLabs)
   * 
   * Available system tools: end_call, language_detection, transfer_to_number, 
   * transfer_to_agent, skip_turn, play_keypad_touch_tone, voicemail_detection
   * 
   * @param agentConfig - Agent configuration with tool enablement flags
   * @returns Array of system tool configurations for prompt.tools (empty array if none)
   */
  private buildSystemTools(agentConfig: {
    transferEnabled?: boolean;
    transferPhoneNumber?: string;
    detectLanguageEnabled?: boolean;
    endConversationEnabled?: boolean;
    transferType?: "conference" | "sip_refer";
    sipTrunkOutboundAddress?: string | null;
  }): any[] {
    const systemTools: any[] = [];

    if (agentConfig.transferEnabled && agentConfig.transferPhoneNumber) {
      const transferType = agentConfig.transferType || "conference";

      let transferDestination: any;
      if (transferType === "sip_refer" && agentConfig.sipTrunkOutboundAddress) {
        const phoneNumber = agentConfig.transferPhoneNumber.startsWith('+')
          ? agentConfig.transferPhoneNumber
          : `+${agentConfig.transferPhoneNumber}`;
        const sipUri = `sip:${phoneNumber}@${agentConfig.sipTrunkOutboundAddress}`;
        transferDestination = {
          type: "sip_uri",
          sip_uri: sipUri
        };
        console.log(`   📞 SIP REFER: Converted phone ${phoneNumber} → SIP URI: ${sipUri}`);
      } else {
        transferDestination = {
          type: "phone",
          phone_number: agentConfig.transferPhoneNumber
        };
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
      console.log(`   ✓ System Tool: transfer_to_number → ${agentConfig.transferPhoneNumber} (${transferType})`);
    }

    // Language Detection tool - enables automatic language switching
    if (agentConfig.detectLanguageEnabled) {
      systemTools.push({
        type: "system",
        name: "language_detection",
        description: "Automatically detect and switch to the user's preferred language"
      });
      console.log(`   ✓ System Tool: language_detection`);
    }

    // End Call tool - allows agent to gracefully terminate calls
    if (agentConfig.endConversationEnabled) {
      systemTools.push({
        type: "system",
        name: "end_call",
        description: "End the call when the user is finished or says goodbye"
      });
      console.log(`   ✓ System Tool: end_call`);
    }

    if (systemTools.length > 0) {
      console.log(`   📦 Built ${systemTools.length} system tool(s) for ElevenLabs agent`);
    }

    return systemTools;
  }

  /**
   * Build node-based workflow configuration for ElevenLabs agents
   * Per ElevenLabs API docs: workflow uses nodes and edges structure
   * Tool IDs must match the built-in tool names: transfer_to_number, language_detection, end_call
   */
  private buildWorkflow(agentConfig: {
    transferEnabled?: boolean;
    transferPhoneNumber?: string;
    detectLanguageEnabled?: boolean;
    endConversationEnabled?: boolean;
  }): any | null {
    // Build list of enabled tools that need workflow nodes
    const hasTransfer = agentConfig.transferEnabled && agentConfig.transferPhoneNumber;
    const hasDetectLanguage = agentConfig.detectLanguageEnabled;
    const hasEndConversation = agentConfig.endConversationEnabled;

    // Only create workflow if at least one tool is enabled
    if (!hasTransfer && !hasDetectLanguage && !hasEndConversation) {
      return null;
    }

    console.log(`   🔄 Building node-based workflow for enabled tools`);

    // Build nodes - start with conversation node
    const nodes: any = {
      start_node: {
        type: "start",
        edge_order: ["start_to_convo"]
      },
      convo_node: {
        type: "override_agent",
        label: "Agent Conversation",
        edge_order: [] as string[]
      }
    };

    const edges: any = {
      start_to_convo: {
        source: "start_node",
        target: "convo_node",
        forward_condition: { type: "unconditional" }
      }
    };

    // Add transfer node if enabled - tool_id must match "transfer_to_number"
    if (hasTransfer) {
      nodes.transfer_node = {
        type: "tool",
        label: "Transfer to Human",
        tools: [{ tool_id: "transfer_to_number" }],
        edge_order: []
      };

      nodes.convo_node.edge_order.push("to_transfer");

      edges.to_transfer = {
        source: "convo_node",
        target: "transfer_node",
        forward_condition: {
          type: "llm",
          condition: "The user asked to talk to a human agent, requested a transfer, or the AI cannot handle the request."
        }
      };

      console.log(`   ✓ Workflow Node: transfer_to_number`);
    }

    // Add detect language node if enabled - tool_id must match "language_detection"
    if (hasDetectLanguage) {
      nodes.detect_language_node = {
        type: "tool",
        label: "Detect Language",
        tools: [{ tool_id: "language_detection" }],
        edge_order: []
      };

      nodes.convo_node.edge_order.push("to_detect_language");

      edges.to_detect_language = {
        source: "convo_node",
        target: "detect_language_node",
        forward_condition: {
          type: "llm",
          condition: "The user is speaking in a different language or requested a language change."
        }
      };

      console.log(`   ✓ Workflow Node: language_detection`);
    }

    // Add end call node if enabled - tool_id must match "end_call"
    if (hasEndConversation) {
      nodes.end_call_node = {
        type: "tool",
        label: "End Call",
        tools: [{ tool_id: "end_call" }],
        edge_order: []
      };

      nodes.convo_node.edge_order.push("to_end_call");

      edges.to_end_call = {
        source: "convo_node",
        target: "end_call_node",
        forward_condition: {
          type: "llm",
          condition: "The user said goodbye, indicated they are finished, or all their needs have been addressed."
        }
      };

      console.log(`   ✓ Workflow Node: end_call`);
    }

    const workflow = { nodes, edges };

    console.log(`   ✅ Node-based workflow configured with ${Object.keys(nodes).length} nodes and ${Object.keys(edges).length} edges`);
    return workflow;
  }


  /**
   * Enhances system prompt with tool usage instructions
   * Automatically adds guidance for LLM on when/how to use enabled tools
   * 
   * @param basePrompt - Original system prompt
   * @param agentConfig - Agent configuration with tool enablement flags
   * @returns Enhanced prompt with tool instructions appended
   */
  private enhanceSystemPromptWithTools(
    basePrompt: string,
    agentConfig: {
      detectLanguageEnabled?: boolean;
      endConversationEnabled?: boolean;
      hasKnowledgeBase?: boolean;
      appointmentBookingEnabled?: boolean;
      isSipAgent?: boolean;
    }
  ): string {
    const toolInstructions: string[] = [];

    // Add knowledge base instructions if agent has knowledge bases (PRIORITY - add first)
    // These instructions must be FORCEFUL to ensure the LLM actually CALLS the tool
    // rather than just talking about searching
    if (agentConfig.hasKnowledgeBase) {
      toolInstructions.push(
        `⚠️ CRITICAL KNOWLEDGE BASE INSTRUCTION ⚠️
You have access to a knowledge base tool called "ask_knowledge".

MANDATORY BEHAVIOR:
- When the user asks ANY question that might require information from the knowledge base, you MUST call the "ask_knowledge" tool IMMEDIATELY.
- Do NOT say things like "I will search the knowledge base" or "Let me check" or "Let me look that up".
- Do NOT explain what you are doing.
- Do NOT answer from memory if information could exist in the knowledge base.
- Instead, IMMEDIATELY EXECUTE the tool with the user's question as the query, then wait for the tool response before speaking.

QUESTIONS THAT MUST TRIGGER THE TOOL:
- Any question about pricing, plans, or costs
- Any question about features or capabilities
- Any question about policies (returns, refunds, shipping, etc.)
- Any question about how the product/service works
- Any question asking "what is...", "how does...", "tell me about..."
- Any question the user might expect you to have specific information about

CORRECT BEHAVIOR: User asks "What are your pricing plans?" → CALL ask_knowledge tool with query "pricing plans" → Wait for response → Answer based on tool response.

INCORRECT BEHAVIOR: User asks "What are your pricing plans?" → Say "Let me check our pricing for you" → Never call the tool.

Remember: EXECUTE the tool first, THEN speak. Never speak about searching - just DO IT.`
      );
    }

    // Add language detection instructions if enabled
    if (agentConfig.detectLanguageEnabled) {
      toolInstructions.push(
        `You can automatically detect and switch to the user's preferred language. The system will handle language detection when the user speaks a different language or requests a language change.`
      );
    }

    // Add end conversation instructions if enabled
    if (agentConfig.endConversationEnabled) {
      toolInstructions.push(
        `You can end the conversation gracefully when the user indicates they are finished. Use the end conversation tool when the user says goodbye, expresses that they're done, or when you've fully addressed their needs.`
      );
    }

    // Add appointment booking instructions if enabled
    if (agentConfig.appointmentBookingEnabled) {
      toolInstructions.push(
        `⚠️ APPOINTMENT BOOKING TOOL ⚠️
You have a tool called "book_appointment" to schedule appointments for callers.

WHEN TO USE THIS TOOL:
- When the caller wants to schedule, book, or set up an appointment
- When the caller asks about availability or wants to meet
- When the caller says things like "I'd like to book a time", "Can I schedule a meeting", "When are you available"

HOW TO USE:
1. Collect the necessary information from the caller:
   - Their name (required)
   - Preferred date (required - can be relative like "tomorrow" or "next Monday")
   - Preferred time (required - convert to 24-hour format, e.g., "2pm" becomes "14:00")
   - Optional: email, service/reason for appointment, any notes
2. For contactPhone: You already have the caller's phone number from the call itself via {{system__caller_id}}. Do NOT ask for their phone number. Always pass "{{system__caller_id}}" as contactPhone unless they explicitly give you a different number.
3. Once you have the required information, IMMEDIATELY call the book_appointment tool
4. Confirm the booking details with the caller after the tool responds

IMPORTANT: Do NOT just say you will book the appointment - you MUST actually call the book_appointment tool to complete the booking.
IMPORTANT: Do NOT ask the caller for their phone number - you already have it from the call.`
      );
    }

    // If any tool instructions were added, append them to the base prompt
    if (toolInstructions.length > 0) {
      const enhancedPrompt = `${basePrompt}\n\n## Available Tools\n${toolInstructions.map((instr, idx) => `${idx + 1}. ${instr}`).join('\n')}`;
      console.log(`   ✏️  Enhanced system prompt with ${toolInstructions.length} tool instruction(s)`);
      return enhancedPrompt;
    }

    return basePrompt;
  }

  async createAgent(params: CreateAgentParams): Promise<ElevenLabsAgent> {
    console.log(`📝 Creating ElevenLabs agent: ${params.name}`);
    console.log(`   Voice ID: ${params.voice_id}`);
    console.log(`   Language: ${params.language || "en"}`);
    console.log(`   Model: ${params.model || "gpt-4o-mini"}`);
    console.log(`   Temperature: ${params.temperature !== undefined ? params.temperature : 0.5}`);

    // Build enhanced prompt with voice tone and personality
    let enhancedPrompt = params.prompt;
    if (params.voice_tone || params.personality) {
      const toneText = params.voice_tone ? `Voice Tone: ${params.voice_tone}.` : '';
      const personalityText = params.personality ? `Personality: ${params.personality}.` : '';
      enhancedPrompt = `${toneText}${toneText && personalityText ? ' ' : ''}${personalityText}\n\n${params.prompt}`;
    }

    // Enhance prompt with system tools instructions (including knowledge base if present)
    const hasKnowledgeBase = params.knowledge_bases && params.knowledge_bases.length > 0;
    const isSipAgent = params.databaseAgentId && await isAgentOnSipPhoneNumber(params.databaseAgentId);
    enhancedPrompt = this.enhanceSystemPromptWithTools(enhancedPrompt, {
      detectLanguageEnabled: params.detectLanguageEnabled,
      endConversationEnabled: params.endConversationEnabled,
      hasKnowledgeBase,
      appointmentBookingEnabled: params.appointmentBookingEnabled,
      isSipAgent: !!isSipAgent,
    });

    // Build system tools as ARRAY for prompt.tools (per ElevenLabs API docs)
    // All agents use conference transfer (sip_refer has known issues with ElevenLabs SIP trunks)
    if (isSipAgent) {
      console.log(`   📞 SIP agent detected - using conference transfer type (direct phone number)`);
    }
    const systemTools = this.buildSystemTools({
      transferEnabled: params.transferEnabled,
      transferPhoneNumber: params.transferPhoneNumber,
      detectLanguageEnabled: params.detectLanguageEnabled,
      endConversationEnabled: params.endConversationEnabled,
      transferType: "conference",
    });

    // Build node-based workflow for enabled tools
    // Skip workflow for incoming agents as workflows cause "Invalid message received" errors
    // with ElevenLabs native Twilio integration
    let workflow = null;
    if (!params.skipWorkflow) {
      workflow = this.buildWorkflow({
        transferEnabled: params.transferEnabled,
        transferPhoneNumber: params.transferPhoneNumber,
        detectLanguageEnabled: params.detectLanguageEnabled,
        endConversationEnabled: params.endConversationEnabled,
      });
    } else {
      console.log(`   ⏭️  Skipping workflow creation (skipWorkflow=true)`);
    }

    // Build prompt config - system tools go in prompt.tools array (NOT built_in_tools)
    const promptConfig: any = {
      prompt: enhancedPrompt,
      llm: params.model || "gpt-4o-mini",
      temperature: params.temperature !== undefined ? params.temperature : 0.5,
    };

    // Add knowledge base if provided
    if (params.knowledge_bases !== undefined && params.knowledge_bases.length > 0) {
      promptConfig.knowledge_base = params.knowledge_bases.map(kb => ({
        type: kb.type,
        name: kb.title,
        id: kb.elevenLabsDocId
      }));
      console.log(`   Knowledge bases: ${params.knowledge_bases.length} KB(s)`);
    }

    // Combine system tools with any custom tools into prompt.tools array
    // Per ElevenLabs API: All tools (system and webhook) go in prompt.tools
    // Note: Appointment booking tools are added via updateAgent after creation
    // since we need the ElevenLabs agent ID for the webhook URL
    const allPromptTools: any[] = [...systemTools];
    if (params.tools && params.tools.length > 0) {
      allPromptTools.push(...params.tools);
    }

    if (allPromptTools.length > 0) {
      promptConfig.tools = allPromptTools;
      console.log(`   Prompt tools: ${allPromptTools.length} (${systemTools.length} system + ${params.tools?.length || 0} custom)`);
    }

    const agentConfig: any = {
      prompt: promptConfig,
      first_message: params.first_message || "Hello! How can I help you today?",
      language: params.language || "en",
    };

    const requestBody: any = {
      name: params.name,
      conversation_config: {
        agent: agentConfig,
        tts: {
          voice_id: params.voice_id,
          model_id: "eleven_v3_conversational",
          agent_output_audio_format: "pcm_16000",
        },
        asr: {
          provider: "elevenlabs",
          model: "scribe_v2_realtime",
          user_input_audio_format: "pcm_16000",
        },
        conversation: {
          max_duration_seconds: 900,
          client_events: ["audio", "agent_response", "user_transcript", "interruption", "client_tool_call"],
          turn: {
            mode: "turn_v3",
            turn_timeout: params.turnTimeout ?? 1.5,
          },
        },
      },
    };

    // Add workflow at root level (per ElevenLabs API documentation)
    if (workflow) {
      requestBody.workflow = workflow;
    }

    // Add webhook tools at agent root level (per ElevenLabs API documentation)
    if (params.webhookTools && params.webhookTools.length > 0) {
      requestBody.tools = params.webhookTools;
      console.log(`   📚 Webhook tools: ${params.webhookTools.map(t => t.name).join(', ')}`);
    }

    // V3 Features (all optional, additive only)
    if (params.customGuardrails && params.customGuardrails.length > 0) {
      requestBody.conversation_config.safety = {
        guardrails: { custom: params.customGuardrails },
      };
      console.log(`   🛡️ Custom guardrails: ${params.customGuardrails.length} rules`);
    }
    if (params.toolErrorHandlingMode) {
      requestBody.tool_error_handling_mode = params.toolErrorHandlingMode;
    }
    if (params.dynamicVariableSanitize !== undefined) {
      requestBody.conversation_config.agent.dynamic_variables = {
        ...(requestBody.conversation_config.agent.dynamic_variables || {}),
        sanitize: params.dynamicVariableSanitize,
      };
    }
    if (params.suggestedAudioTags === true) {
      requestBody.conversation_config.tts.suggested_audio_tags = DEFAULT_EXPRESSIVE_AUDIO_TAGS;
    }

    console.log(`📤 Sending to ElevenLabs API:`, JSON.stringify(requestBody, null, 2));

    const result = await this.request<ElevenLabsAgent>("/convai/agents/create", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });

    console.log(`✅ ElevenLabs agent created successfully:`, result.agent_id);
    return result;
  }

  /**
   * Creates a Flow Agent in ElevenLabs with a compiled workflow from the visual flow builder.
   * Flow Agents use deterministic workflows instead of open-ended LLM conversations.
   * 
   * @param params - Flow agent configuration
   * @returns Created ElevenLabs agent
   */
  async createFlowAgent(params: {
    name: string;
    voice_id: string;
    language?: string;
    llmModel?: string;
    temperature?: number;
    maxDurationSeconds?: number;
    voiceStability?: number;
    voiceSimilarityBoost?: number;
    voiceSpeed?: number;
    turnTimeout?: number;
    detectLanguageEnabled?: boolean;
    systemPrompt?: string;
    firstMessage?: string;
    knowledgeBases?: Array<{ type: string; name: string; id: string }>;
    ttsModel?: string;
    suggestedAudioTags?: boolean;
    toolErrorHandlingMode?: "default" | "relaxed" | "strict";
    workflow: {
      nodes: Record<string, any>;
      edges: Record<string, any>;
    };
    webhookTools?: any[];
  }): Promise<ElevenLabsAgent> {
    console.log(`📝 Creating ElevenLabs Flow Agent: ${params.name}`);
    console.log(`   Voice ID: ${params.voice_id}`);
    console.log(`   Language: ${params.language || "en"}`);
    console.log(`   LLM Model: ${params.llmModel || "gpt-4o-mini"}`);
    console.log(`   Temperature: ${params.temperature ?? 0.3}`);
    console.log(`   Max Duration: ${params.maxDurationSeconds || 600} seconds`);
    console.log(`   Language Detection: ${params.detectLanguageEnabled ? "enabled" : "disabled"}`);
    console.log(`   System Prompt: ${params.systemPrompt ? 'custom' : 'default'}`);
    console.log(`   First Message: ${params.firstMessage ? 'custom' : 'default'}`);
    console.log(`   Knowledge Bases: ${params.knowledgeBases?.length || 0}`);
    console.log(`   TTS Model: ${params.ttsModel || 'auto'}`);
    console.log(`   Workflow nodes: ${Object.keys(params.workflow.nodes).length}`);
    console.log(`   Workflow edges: ${Object.keys(params.workflow.edges).length}`);

    // Workflow is already in ElevenLabs format (objects keyed by ID)
    const workflowNodes = params.workflow.nodes;
    const workflowEdges = params.workflow.edges;

    // Detect if workflow has transfer nodes (phone_number type) for logging purposes
    // Note: ElevenLabs handles transfers via workflow nodes directly, not via prompt.tools
    const hasTransferNodes = Object.values(workflowNodes).some((node: any) => node.type === 'phone_number');

    // Detect if workflow has explicit end nodes (type === 'end')
    // Only true end nodes should trigger the end_call tool, not transfer or tool nodes at leaf positions
    // This enables the agent to properly hang up when the workflow reaches an explicit end
    const hasEndNodes = Object.values(workflowNodes).some((node: any) => node.type === 'end');

    // Extract tool nodes for custom webhook tool definitions
    // ElevenLabs expects server tools with tool_id matching the workflow node reference
    // ONLY auto-generate if webhookTools are NOT provided (they have full config from compiler)
    let webhookTools: any[] = [];

    if (params.webhookTools && params.webhookTools.length > 0) {
      // Use provided webhook tools (they have correct URLs from the flow compiler)
      webhookTools = params.webhookTools;
      console.log(`   📦 Using ${webhookTools.length} pre-configured webhook tool(s)`);
    } else {
      // Fallback: Auto-generate from workflow tool nodes (legacy behavior)
      // IMPORTANT: Skip tools that are handled in phase 2 (they need agent ID for valid webhook URLs)
      const phase2Prefixes = ['play_audio', 'appointment', 'form_submit', 'submit_form', 'send_email', 'send_whatsapp', 'collect_caller_email'];
      const toolNodes = Object.entries(workflowNodes).filter(([_, node]: [string, any]) => node.type === 'tool');
      webhookTools = toolNodes.flatMap(([nodeId, node]: [string, any]) => {
        const tools = node.tools || [];
        return tools.map((tool: any) => {
          const toolId = tool.tool_id || `webhook_${nodeId}`;
          // Skip phase-2 tools - they'll be added after agent creation with valid URLs
          if (phase2Prefixes.some(prefix => toolId.startsWith(prefix))) {
            console.log(`   ⏭️ Skipping phase-2 tool: ${toolId} (will be added after agent creation)`);
            return null;
          }
          return {
            type: "webhook",
            name: toolId,
            description: `Execute webhook action for ${toolId}`,
            api_schema: {
              url: tool.webhook_url || "",
              method: tool.method || "POST",
              request_headers: {
                "Content-Type": "application/json"
              }
            }
          };
        }).filter(Boolean);
      });
      if (webhookTools.length > 0) {
        console.log(`   📦 Auto-generated ${webhookTools.length} webhook tool(s) from workflow`);
      }
    }

    // Build base prompt for Flow Agent
    // Always include the strict workflow enforcement rules
    // If user provided a custom prompt, merge it WITH the strict rules (not replace)
    const defaultStrictPrompt = `You are a SCRIPTED phone agent. You MUST follow the workflow EXACTLY.

ABSOLUTE RULES - NEVER BREAK THESE:
1. When a workflow step contains text between "---" markers, say that text VERBATIM - word for word, character for character.
2. NEVER paraphrase, summarize, translate, or modify scripted messages.
3. NEVER add your own words, greetings, small talk, or explanations.
4. NEVER improvise or respond naturally - you are reading a script.
5. If a step says "SAY THIS EXACT MESSAGE" or "ASK THIS EXACT QUESTION", output ONLY that text.
6. After saying your scripted message, STOP and wait for the user's response.
7. If the user doesn't understand, repeat the EXACT same scripted message.
8. Do NOT try to be helpful or conversational - just read the script.
9. IGNORE any background noise, side conversations, or ambient speech. Only respond to the primary speaker who is directly addressing you.
10. If you hear unrelated words or topics from the background, do NOT change the conversation topic. Stay on script.

IMPORTANT: Each workflow step will have "CRITICAL INSTRUCTION" with the exact text to say. Copy that text exactly.

You are a script reader, not a conversational AI. Execute the workflow mechanically.`;

    let basePrompt: string;
    if (params.systemPrompt) {
      basePrompt = `${defaultStrictPrompt}\n\n--- ADDITIONAL AGENT INSTRUCTIONS (provided by the agent creator) ---\nThe following instructions define your persona, domain, and behavioral constraints. You MUST follow these AT ALL TIMES, even while executing the workflow:\n\n${params.systemPrompt}\n\n--- END OF ADDITIONAL INSTRUCTIONS ---\nRemember: Follow BOTH the workflow steps AND the additional instructions above. Never deviate from your assigned domain or persona.`;
      console.log(`   ✓ Merged custom prompt (${params.systemPrompt.length} chars) with strict workflow rules`);
    } else {
      basePrompt = defaultStrictPrompt;
    }

    // Add language detection instructions if enabled
    if (params.detectLanguageEnabled) {
      basePrompt += `\n\nIMPORTANT: You have access to the language_detection tool. If the user speaks in a language other than the current conversation language, use the language_detection tool to switch to their preferred language automatically.`;
    }

    // Determine first message - use custom or default
    const firstMessage = params.firstMessage || "Hello! I'm calling to assist you today.";

    // Determine TTS model with smart auto-selection:
    // Latest models: eleven_v3_conversational (70+ langs), eleven_turbo_v2_5 (32 langs), eleven_flash_v2_5 (32 langs)
    // Legacy models kept for backward compatibility: eleven_turbo_v2, eleven_flash_v2, eleven_multilingual_v2
    const validModels = ["eleven_v3_conversational", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_turbo_v2", "eleven_flash_v2", "eleven_multilingual_v2"];
    const defaultModel = "eleven_v3_conversational";
    let ttsModel = params.ttsModel || defaultModel;

    if (!validModels.includes(ttsModel)) {
      console.log(`   ⚠️ TTS model ${ttsModel} is not valid, using ${defaultModel}`);
      ttsModel = defaultModel;
    }

    // Build system tools for Flow Agent as ARRAY for prompt.tools
    const systemTools: any[] = [];

    // Language detection system tool
    if (params.detectLanguageEnabled) {
      systemTools.push({
        type: "system",
        name: "language_detection",
        description: "Automatically detect and switch to the user's preferred language"
      });
      console.log(`   ✓ System Tool: language_detection`);
    }

    // End call system tool - allows agent to hang up when reaching workflow end
    // This is essential for Flow Agents to properly terminate calls
    if (hasEndNodes) {
      systemTools.push({
        type: "system",
        name: "end_call",
        description: "End the call when the conversation is complete, the user says goodbye, or the workflow reaches its end"
      });
      console.log(`   ✓ System Tool: end_call`);
    }

    // Note: Transfer functionality is handled by workflow phone_number nodes directly
    // ElevenLabs uses the workflow edges to determine when to transfer calls
    if (hasTransferNodes) {
      console.log(`   📞 Has transfer nodes: true (handled via workflow)`);
    }

    // Build knowledge base configuration if provided - requires type, id, and name
    const knowledgeBaseConfig = params.knowledgeBases && params.knowledgeBases.length > 0
      ? params.knowledgeBases.map(kb => ({ type: kb.type, id: kb.id, name: kb.name }))
      : undefined;

    // Combine system tools with webhook tools (already includes passed-in tools if provided)
    const allPromptTools = [
      ...systemTools,
      ...webhookTools
    ];

    const requestBody: any = {
      name: params.name,
      conversation_config: {
        agent: {
          prompt: {
            prompt: basePrompt,
            llm: params.llmModel || "gpt-4o-mini",
            temperature: params.temperature ?? 0.3, // Lower temperature for more deterministic flow execution
            ...(allPromptTools.length > 0 && { tools: allPromptTools }),
            ...(knowledgeBaseConfig && { knowledge_base: knowledgeBaseConfig }),
          },
          first_message: firstMessage,
          language: params.language || "en",
        },
        tts: {
          voice_id: params.voice_id,
          model_id: ttsModel,
          agent_output_audio_format: "pcm_16000",
          ...(ttsModel && !ttsModel.includes('v3') ? {
            stability: params.voiceStability ?? 0.65,
            similarity_boost: params.voiceSimilarityBoost ?? 0.85,
            speed: params.voiceSpeed ?? 0.92,
          } : {}),
        },
        asr: {
          provider: "elevenlabs",
          model: "scribe_v2_realtime",
          user_input_audio_format: "pcm_16000",
        },
        conversation: {
          max_duration_seconds: params.maxDurationSeconds || 600,
          client_events: ["audio", "agent_response", "user_transcript", "interruption", "client_tool_call"],
          turn: {
            mode: "turn_v3",
            turn_timeout: params.turnTimeout ?? 1.5,
          },
        },
      },
      workflow: {
        nodes: workflowNodes,
        edges: workflowEdges
      },
    };

    // Log combined prompt tools
    if (allPromptTools.length > 0) {
      const passedToolsCount = params.webhookTools?.length || 0;
      console.log(`   📦 Prompt tools: ${allPromptTools.length} (${systemTools.length} system + ${webhookTools.length} workflow + ${passedToolsCount} passed)`);
    }

    // V3 Features (all optional, additive only)
    if (params.customGuardrails && params.customGuardrails.length > 0) {
      requestBody.conversation_config.safety = {
        guardrails: { custom: params.customGuardrails },
      };
      console.log(`   🛡️ Custom guardrails: ${params.customGuardrails.length} rules`);
    }
    if (params.toolErrorHandlingMode) {
      requestBody.tool_error_handling_mode = params.toolErrorHandlingMode;
    }
    if (params.dynamicVariableSanitize !== undefined) {
      if (!requestBody.conversation_config.agent.dynamic_variables) {
        requestBody.conversation_config.agent.dynamic_variables = {};
      }
      requestBody.conversation_config.agent.dynamic_variables.sanitize = params.dynamicVariableSanitize;
    }
    if (params.suggestedAudioTags === true) {
      requestBody.conversation_config.tts.suggested_audio_tags = DEFAULT_EXPRESSIVE_AUDIO_TAGS;
    }

    console.log(`📤 Sending Flow Agent to ElevenLabs API:`, JSON.stringify(requestBody, null, 2));

    const result = await this.request<ElevenLabsAgent>("/convai/agents/create", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });

    console.log(`✅ ElevenLabs Flow Agent created successfully:`, result.agent_id);
    return result;
  }

  /**
   * Updates a Flow Agent's workflow in ElevenLabs.
   * Called when the linked flow is modified.
   * 
   * @param agentId - ElevenLabs agent ID
   * @param workflow - Compiled workflow from visual flow builder
   * @param maxDurationSeconds - Optional max duration update
   * @param detectLanguageEnabled - Optional language detection setting
   * @param language - Optional language (pass to update TTS model for non-English)
   * @param ttsModel - Optional TTS model (admin-configured model)
   * @param llmModel - Optional LLM model update
   * @param temperature - Optional temperature update
   * @param firstMessage - Optional first message (extracted from flow's first Message node)
   * @param voiceId - Optional voice ID update
   * @returns Updated ElevenLabs agent
   */
  async updateFlowAgentWorkflow(agentId: string, workflow: {
    nodes: Record<string, any>;
    edges: Record<string, any>;
  }, maxDurationSeconds?: number, detectLanguageEnabled?: boolean, language?: string, ttsModel?: string, llmModel?: string, temperature?: number, firstMessage?: string, voiceId?: string, additionalOptions?: {
    knowledgeBases?: Array<{ type: string; title: string; elevenLabsDocId: string }>;
    webhookTools?: Array<{ type: "webhook"; name: string; description: string; api_schema: any }>;
    name?: string;
    basePrompt?: string;  // Base system prompt for the agent
    voiceStability?: number;  // TTS stability (0-1, lower = more expressive)
    voiceSimilarityBoost?: number;  // TTS similarity boost (0-1)
    voiceSpeed?: number;  // TTS speed (0.5-2.0)
    turnTimeout?: number;  // Turn timeout in seconds
    suggestedAudioTags?: boolean;  // Expressive Mode
  }): Promise<ElevenLabsAgent> {
    console.log(`🔄 Updating Flow Agent workflow: ${agentId}`);
    console.log(`   Workflow nodes: ${Object.keys(workflow.nodes).length}`);
    console.log(`   Workflow edges: ${Object.keys(workflow.edges).length}`);
    console.log(`   Language Detection: ${detectLanguageEnabled ? "enabled" : "disabled"}`);
    console.log(`   Language: ${language || "not changing"}`);
    console.log(`   TTS Model: ${ttsModel || "not changing"}`);
    console.log(`   LLM Model: ${llmModel || "not changing"}`);
    console.log(`   Temperature: ${temperature !== undefined ? temperature : "not changing"}`);
    console.log(`   First Message: ${firstMessage ? `"${firstMessage.substring(0, 50)}..."` : "not changing"}`);
    console.log(`   Voice ID: ${voiceId || "not changing"}`);

    // Workflow is already in ElevenLabs format (objects keyed by ID)
    const workflowNodes = workflow.nodes;
    const workflowEdges = workflow.edges;

    const updatePayload: any = {
      workflow: {
        nodes: workflowNodes,
        edges: workflowEdges
      },
      // Always include ASR and TTS config for consistent settings
      conversation_config: {
        asr: {
          provider: "elevenlabs",
          model: "scribe_v2_realtime",  // Scribe v2 Realtime for better ASR accuracy
          user_input_audio_format: "pcm_16000",  // PCM 16kHz for Scribe
        },
        tts: {
          agent_output_audio_format: "pcm_16000",
          ...(ttsModel && !ttsModel.includes('v3') ? {
            stability: additionalOptions?.voiceStability ?? 0.65,
            similarity_boost: additionalOptions?.voiceSimilarityBoost ?? 0.85,
            speed: additionalOptions?.voiceSpeed ?? 0.92,
          } : {}),
        }
      }
    };

    // Always include conversation config with turn settings to reduce background noise sensitivity
    updatePayload.conversation_config.conversation = {
      ...(maxDurationSeconds !== undefined && { max_duration_seconds: maxDurationSeconds }),
      turn: {
        mode: "turn_v3",
        turn_timeout: additionalOptions?.turnTimeout ?? 1.5,
      },
    };

    // Include voice_id if provided
    if (voiceId) {
      updatePayload.conversation_config.tts.voice_id = voiceId;
      console.log(`   ✓ Voice ID update: ${voiceId}`);
    }

    // Set agent language if provided
    if (language) {
      if (!updatePayload.conversation_config.agent) {
        updatePayload.conversation_config.agent = {};
      }
      updatePayload.conversation_config.agent.language = language;

      // Valid models for Conversational AI (v3+ supports 70+ languages, no English-only restriction)
      const validModels = ["eleven_v3_conversational", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_turbo_v2", "eleven_flash_v2", "eleven_multilingual_v2"];
      let effectiveTtsModel = ttsModel || "eleven_v3_conversational";

      if (ttsModel && !validModels.includes(ttsModel)) {
        console.log(`   ⚠️ TTS model ${ttsModel} is not valid, using eleven_v3_conversational`);
        effectiveTtsModel = "eleven_v3_conversational";
      }

      updatePayload.conversation_config.tts.model_id = effectiveTtsModel;
      console.log(`   ✓ TTS config: model=${effectiveTtsModel}, language=${language}`);
    }

    // Include LLM model and temperature if provided
    if (llmModel !== undefined || temperature !== undefined) {
      if (!updatePayload.conversation_config) {
        updatePayload.conversation_config = {};
      }
      if (!updatePayload.conversation_config.agent) {
        updatePayload.conversation_config.agent = {};
      }
      if (!updatePayload.conversation_config.agent.prompt) {
        updatePayload.conversation_config.agent.prompt = {};
      }

      if (llmModel !== undefined) {
        updatePayload.conversation_config.agent.prompt.llm = llmModel;
        console.log(`   ✓ LLM Model update: ${llmModel}`);
      }
      if (temperature !== undefined) {
        updatePayload.conversation_config.agent.prompt.temperature = temperature;
        console.log(`   ✓ Temperature update: ${temperature}`);
      }
    }

    // Include first message if provided (extracted from flow's first Message node)
    if (firstMessage) {
      if (!updatePayload.conversation_config) {
        updatePayload.conversation_config = {};
      }
      if (!updatePayload.conversation_config.agent) {
        updatePayload.conversation_config.agent = {};
      }
      updatePayload.conversation_config.agent.first_message = firstMessage;
      console.log(`   ✓ First message set from flow`);
    }

    // Detect if workflow has transfer nodes (phone_number type) for logging purposes
    // Note: ElevenLabs handles transfers via workflow nodes directly, not via prompt.tools
    const hasTransferNodes = Object.values(workflowNodes).some((node: any) => node.type === 'phone_number');

    // Detect if workflow has explicit end nodes (type === 'end')
    // Only true end nodes should trigger the end_call tool, not transfer or tool nodes at leaf positions
    const hasEndNodes = Object.values(workflowNodes).some((node: any) => node.type === 'end');

    // Extract tool nodes for custom webhook tool definitions
    // ONLY auto-generate if webhookTools are NOT provided (they have full config from compiler)
    let webhookTools: any[] = [];

    if (additionalOptions?.webhookTools && additionalOptions.webhookTools.length > 0) {
      // Use provided webhook tools (they have correct URLs from the flow compiler)
      webhookTools = additionalOptions.webhookTools;
      console.log(`   📦 Using ${webhookTools.length} pre-configured webhook tool(s)`);
    } else {
      // Fallback: Auto-generate from workflow tool nodes (legacy behavior)
      // IMPORTANT: Skip tools that are handled in phase 2 (they need agent ID for valid webhook URLs)
      const phase2Prefixes = ['play_audio', 'appointment', 'form_submit', 'submit_form', 'send_email', 'send_whatsapp', 'collect_caller_email'];
      const toolNodes = Object.entries(workflowNodes).filter(([_, node]: [string, any]) => node.type === 'tool');
      webhookTools = toolNodes.flatMap(([nodeId, node]: [string, any]) => {
        const tools = node.tools || [];
        return tools.map((tool: any) => {
          const toolId = tool.tool_id || `webhook_${nodeId}`;
          // Skip phase-2 tools - they'll be added after agent creation with valid URLs
          if (phase2Prefixes.some(prefix => toolId.startsWith(prefix))) {
            console.log(`   ⏭️ Skipping phase-2 tool: ${toolId} (will be added after agent creation)`);
            return null;
          }
          return {
            type: "webhook",
            name: toolId,
            description: `Execute webhook action for ${toolId}`,
            api_schema: {
              url: tool.webhook_url || "",
              method: tool.method || "POST",
              request_headers: {
                "Content-Type": "application/json"
              }
            }
          };
        }).filter(Boolean);
      });
      if (webhookTools.length > 0) {
        console.log(`   📦 Auto-generated ${webhookTools.length} webhook tool(s) from workflow`);
      }
    }

    const preRegistrationSnapshot = webhookTools.length > 0 ? JSON.parse(JSON.stringify(workflow)) : null;

    if (webhookTools.length > 0) {
      try {
        await this.registerWorkflowToolsAndUpdateWorkflow(webhookTools, workflow);
      } catch (error: any) {
        const isDocNotFound = error.message?.includes('not found') || error.message?.includes('Document with id');
        if (isDocNotFound) {
          console.log(`⚠️ [Workspace Tools] Stale tool ID detected, clearing cache and retrying...`);
          workspaceToolCache.clear();
          Object.assign(workflow, preRegistrationSnapshot);
          await this.registerWorkflowToolsAndUpdateWorkflow(webhookTools, workflow);
        } else {
          throw error;
        }
      }
    }

    // Build system tools as ARRAY for prompt.tools (per ElevenLabs API)
    const systemTools: any[] = [];

    // Language detection system tool
    if (detectLanguageEnabled) {
      systemTools.push({
        type: "system",
        name: "language_detection",
        description: "Automatically detect and switch to the user's preferred language"
      });
      console.log(`   ✓ System Tool: language_detection`);
    }

    // End call system tool - allows agent to hang up when reaching workflow end
    // This is essential for Flow Agents to properly terminate calls
    if (hasEndNodes) {
      systemTools.push({
        type: "system",
        name: "end_call",
        description: "End the call when the conversation is complete, the user says goodbye, or the workflow reaches its end"
      });
      console.log(`   ✓ System Tool: end_call`);
    }

    // Note: Transfer functionality is handled by workflow phone_number nodes directly
    // ElevenLabs uses the workflow edges to determine when to transfer calls
    if (hasTransferNodes) {
      console.log(`   📞 Has transfer nodes: true (handled via workflow)`);
    }

    // TOOL PRESERVATION: Fetch existing tools and preserve RAG/other tools not being updated
    // This prevents flow updates from removing RAG tools (ask_knowledge_*) that were added separately
    let preservedTools: any[] = [];
    try {
      const existingAgent = await this.getAgent(agentId);
      const existingTools = (existingAgent as any)?.conversation_config?.agent?.prompt?.tools || [];
      console.log(`   🔍 Found ${existingTools.length} existing tool(s)`);

      // Get names of tools we're about to add/update
      const newToolNames = new Set([
        ...systemTools.map((t: any) => t.name),
        ...webhookTools.map((t: any) => t.name)
      ]);

      // Preserve ALL existing tools that are NOT being explicitly updated
      // This ensures RAG tools, custom webhooks, and any other tools remain intact
      preservedTools = existingTools.filter((tool: any) => {
        const toolName = tool.name || '';
        const toolType = tool.type || '';

        // Skip system tools - we're rebuilding those based on current settings
        if (toolType === 'system') {
          return false;
        }

        // Skip if this exact tool name is being replaced by our update
        if (newToolNames.has(toolName)) {
          console.log(`   ↺ Replacing tool: ${toolName}`);
          return false;
        }

        // CRITICAL: Skip phase-2 messaging tools to prevent duplicate tool conflicts
        // (e.g. send_whatsapp, send_email). These should ALWAYS be replaced by the current flow's tools.
        const phase2Prefixes = ['send_whatsapp', 'send_email', 'play_audio', 'collect_caller_email'];
        if (phase2Prefixes.some(prefix => toolName.startsWith(prefix))) {
          console.log(`   ↺ Clearing stale messaging tool: ${toolName}`);
          return false;
        }

        // Preserve all other webhook tools (RAG, custom, etc.)
        if (toolType === 'webhook') {
          // ALWAYS drop stale submit_form_* tools — these are flow/form-specific and
          // must be fully replaced on every flow save. Keeping old suffixed tools
          // alongside new ones causes the agent to submit data to the wrong form.
          if (toolName.startsWith('submit_form_')) {
            console.log(`   🗑️ Dropping stale form tool: ${toolName}`);
            return false;
          }

          // ALWAYS drop stale webhook_node-* tools — these are flow-specific webhook
          // nodes that must be rebuilt from the current flow definition each save.
          if (toolName.startsWith('webhook_node-')) {
            console.log(`   🗑️ Dropping stale webhook node tool: ${toolName}`);
            return false;
          }

          if (toolName.startsWith('ask_knowledge_')) {
            console.log(`   ✓ Preserving RAG tool: ${toolName}`);
          } else {
            console.log(`   ✓ Preserving webhook tool: ${toolName}`);
          }
          return true;
        }

        // Preserve any other non-system tools
        console.log(`   ✓ Preserving tool: ${toolName} (type: ${toolType})`);
        return true;
      });

      if (preservedTools.length > 0) {
        console.log(`   📦 Preserving ${preservedTools.length} existing tool(s)`);
      }
    } catch (error: any) {
      console.log(`   ⚠️ Could not fetch existing tools: ${error.message}`);
    }

    // Combine system tools + preserved tools + new webhook tools for prompt.tools array
    const allPromptTools = [...systemTools, ...preservedTools, ...webhookTools];

    // Log combined prompt tools
    if (allPromptTools.length > 0) {
      console.log(`   📦 Prompt tools: ${allPromptTools.length} (${systemTools.length} system + ${preservedTools.length} preserved + ${webhookTools.length} webhook)`);
      // Log all tool names for verification
      const toolNames = allPromptTools.map((t: any) => t.name).join(', ');
      console.log(`   📋 Final tools: [${toolNames}]`);
    }

    // Add tools to prompt config if any are defined
    if (allPromptTools.length > 0) {
      if (!updatePayload.conversation_config) {
        updatePayload.conversation_config = {};
      }
      if (!updatePayload.conversation_config.agent) {
        updatePayload.conversation_config.agent = {};
      }
      if (!updatePayload.conversation_config.agent.prompt) {
        updatePayload.conversation_config.agent.prompt = {};
      }
      updatePayload.conversation_config.agent.prompt.tools = allPromptTools;
    }

    // CRITICAL: Set ignore_default_personality UNCONDITIONALLY for flow agents
    // This prevents creative/ad-lib behavior and enforces strict script following
    if (!updatePayload.conversation_config) {
      updatePayload.conversation_config = {};
    }
    if (!updatePayload.conversation_config.agent) {
      updatePayload.conversation_config.agent = {};
    }
    if (!updatePayload.conversation_config.agent.prompt) {
      updatePayload.conversation_config.agent.prompt = {};
    }
    updatePayload.conversation_config.agent.prompt.ignore_default_personality = true;
    console.log(`   ✓ ignore_default_personality: true (scripted mode)`);

    updatePayload.tool_error_handling_mode = "relaxed";

    // Add base system prompt if provided - required for agent to speak
    if (additionalOptions?.basePrompt) {
      let finalPrompt = additionalOptions.basePrompt;
      // Ensure language detection instructions are present if enabled
      if (detectLanguageEnabled && !finalPrompt.includes('language_detection')) {
        finalPrompt += `\n\nIMPORTANT: You have access to the language_detection tool. If the user speaks in a language other than the current conversation language, use the language_detection tool to switch to their preferred language automatically.`;
        console.log(`   ✓ Appended language_detection instructions to base prompt`);
      }
      updatePayload.conversation_config.agent.prompt.prompt = finalPrompt;
      console.log(`   ✓ Base prompt set (${finalPrompt.length} chars)`);
    }

    // Include knowledge bases if provided (consolidated in single request)
    if (additionalOptions?.knowledgeBases && additionalOptions.knowledgeBases.length > 0) {
      if (!updatePayload.conversation_config) {
        updatePayload.conversation_config = {};
      }
      if (!updatePayload.conversation_config.agent) {
        updatePayload.conversation_config.agent = {};
      }
      if (!updatePayload.conversation_config.agent.prompt) {
        updatePayload.conversation_config.agent.prompt = {};
      }
      updatePayload.conversation_config.agent.prompt.knowledge_base = additionalOptions.knowledgeBases.map(kb => ({
        type: kb.type === 'text' ? 'text' : 'file',
        name: kb.title,
        id: kb.elevenLabsDocId
      }));
      console.log(`   📚 Knowledge bases: ${additionalOptions.knowledgeBases.length}`);
    }

    // Include name update if provided
    if (additionalOptions?.name) {
      updatePayload.name = additionalOptions.name;
      console.log(`   📝 Name update: ${additionalOptions.name}`);
    }

    // Include ASR config for Twilio native integration (pcm_16000 for better accuracy)
    if (!updatePayload.conversation_config) {
      updatePayload.conversation_config = {};
    }
    updatePayload.conversation_config.asr = {
      provider: "elevenlabs",
      user_input_audio_format: "pcm_16000"
    };

    if (additionalOptions?.suggestedAudioTags === true) {
      if (!updatePayload.conversation_config) {
        updatePayload.conversation_config = {};
      }
      if (!updatePayload.conversation_config.tts) {
        updatePayload.conversation_config.tts = {};
      }
      updatePayload.conversation_config.tts.suggested_audio_tags = DEFAULT_EXPRESSIVE_AUDIO_TAGS;
      console.log(`   ✓ Expressive Mode: enabled (${DEFAULT_EXPRESSIVE_AUDIO_TAGS.length} audio tags)`);
    }

    console.log(`📤 Sending Flow Agent workflow update (consolidated):`, JSON.stringify(updatePayload, null, 2));

    try {
      const result = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify(updatePayload),
      });
      console.log(`✅ Flow Agent workflow updated successfully`);
      return result;
    } catch (patchError: any) {
      const errorText = patchError.message || "";
      const isDocNotFound = errorText.includes('not found') || errorText.includes('Document with id') || errorText.includes('documents_not_found');
      
      if (isDocNotFound) {
        console.warn(`⚠️ [PATCH] Stale tool or document ID detected in ElevenLabs payload:`, errorText);
        
        // Attempt to extract the broken IDs from the error message
        // Example: "Documents with ids {'tool_xyz'} not found."
        const idMatches = errorText.match(/tool_[a-zA-Z0-9]+/g) || errorText.match(/kb_[a-zA-Z0-9]+/g) || [];
        const brokenIds = new Set(idMatches);
        
        if (brokenIds.size > 0) {
          console.log(`   🛠️ Attempting to purge ${brokenIds.size} broken ID(s):`, Array.from(brokenIds));
          
          // 1. Purge from prompt tools
          if (updatePayload.conversation_config?.agent?.prompt?.tools) {
            const originalCount = updatePayload.conversation_config.agent.prompt.tools.length;
            updatePayload.conversation_config.agent.prompt.tools = updatePayload.conversation_config.agent.prompt.tools.filter(
              (t: any) => !brokenIds.has(t.id) && !brokenIds.has(t.name)
            );
            console.log(`   🗑️ Purged ${originalCount - updatePayload.conversation_config.agent.prompt.tools.length} tool(s) from prompt`);
          }
          
          // 2. Purge from knowledge base
          if (updatePayload.conversation_config?.agent?.prompt?.knowledge_base) {
            const originalCount = updatePayload.conversation_config.agent.prompt.knowledge_base.length;
            updatePayload.conversation_config.agent.prompt.knowledge_base = updatePayload.conversation_config.agent.prompt.knowledge_base.filter(
              (kb: any) => !brokenIds.has(kb.id)
            );
            console.log(`   🗑️ Purged ${originalCount - updatePayload.conversation_config.agent.prompt.knowledge_base.length} document(s) from knowledge base`);
          }
        } else {
          console.log(`   ⚠️ Could not extract specific IDs from error, performing global cache clear`);
        }

        // 3. Clear workspace cache regardless - something is out of sync
        workspaceToolCache.clear();
        console.log(`   🧹 Workspace tool cache cleared`);

        // 4. If we have a pre-registration snapshot and webhook tools, try a full re-register
        if (webhookTools.length > 0 && preRegistrationSnapshot) {
          console.log(`   🔄 Performing full re-registration of flow tools...`);
          Object.assign(workflow, preRegistrationSnapshot);
          await this.registerWorkflowToolsAndUpdateWorkflow(webhookTools, workflow);
          updatePayload.workflow = workflow;
          
          // Update prompt tools again with newly registered IDs
          const refreshedPromptTools = [
            ...systemTools,
            ...(updatePayload.conversation_config?.agent?.prompt?.tools?.filter((t: any) => t.type !== 'webhook') || []),
            ...webhookTools // These are now enriched with new IDs from registerWorkflowToolsAndUpdateWorkflow
          ];
          updatePayload.conversation_config.agent.prompt.tools = refreshedPromptTools;
        }

        console.log(`   🔄 Retrying workflow update...`);
        try {
          const retryResult = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
            method: "PATCH",
            body: JSON.stringify(updatePayload),
          });
          console.log(`✅ Flow Agent workflow updated successfully (after robust recovery)`);
          return retryResult;
        } catch (retryError: any) {
          console.error(`❌ Workflow update failed again after recovery attempt:`, retryError.message);
          throw retryError;
        }
      }
      throw patchError;
    }
  }

  async listAgents(): Promise<{ agents: ElevenLabsAgent[] }> {
    return this.request<{ agents: ElevenLabsAgent[] }>("/convai/agents");
  }

  async getAgent(agentId: string): Promise<ElevenLabsAgent> {
    return this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`);
  }

  /**
   * Verifies agent configuration by fetching from ElevenLabs
   * Used before initiating calls to ensure agent is properly configured
   * @param agentId - ElevenLabs agent ID
   * @returns Full agent configuration from ElevenLabs
   */
  async verifyAgent(agentId: string): Promise<ElevenLabsAgent> {
    console.log(`🔍 Verifying ElevenLabs agent: ${agentId}`);
    const agent = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`);
    console.log(`✅ Agent verified: ${agent.name}`);
    const promptTools = (agent as any)?.conversation_config?.agent?.prompt?.tools;
    const systemToolCount = promptTools?.filter((t: any) => t.type === 'system').length || 0;
    const webhookToolCount = promptTools?.filter((t: any) => t.type === 'webhook').length || 0;
    console.log(`   Prompt tools: ${promptTools?.length || 0} (${systemToolCount} system, ${webhookToolCount} webhook)`);
    console.log(`   Workflow configured: ${(agent as any).workflow ? 'Yes' : 'No'}`);
    return agent;
  }

  /**
   * Updates agent tools configuration
   * Per ElevenLabs API docs: System tools go in prompt.tools array with type: "system"
   * @param agentId - ElevenLabs agent ID
   * @param toolsConfig - Tool configuration parameters
   */
  async updateAgentTools(agentId: string, toolsConfig: {
    transferEnabled?: boolean;
    transferPhoneNumber?: string;
    detectLanguageEnabled?: boolean;
    endConversationEnabled?: boolean;
    databaseAgentId?: string;
  }): Promise<ElevenLabsAgent> {
    console.log(`🔧 Updating agent tools: ${agentId}`);

    const isSipAgent = toolsConfig.databaseAgentId && await isAgentOnSipPhoneNumber(toolsConfig.databaseAgentId);
    if (isSipAgent) {
      console.log(`   📞 SIP agent detected - using conference transfer type (direct phone number)`);
    }
    const systemTools = this.buildSystemTools({ ...toolsConfig, transferType: "conference" });
    const workflow = this.buildWorkflow(toolsConfig);

    // Per ElevenLabs API docs: System tools go in prompt.tools array
    const updatePayload: any = {
      conversation_config: {
        agent: {
          prompt: {
            tools: systemTools
          }
        },
        asr: {
          provider: "elevenlabs",
          user_input_audio_format: "ulaw_8000", // µ-law format for Twilio native integration
        }
      },
      workflow: workflow || { nodes: {}, edges: {} }
    };

    console.log(`📤 Sending tools update:`, JSON.stringify(updatePayload, null, 2));

    const result = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ Agent tools updated successfully`);
    return result;
  }

  /**
   * Updates agent workflow configuration
   * Separate PATCH call for workflow only
   * @param agentId - ElevenLabs agent ID
   * @param workflowConfig - Workflow configuration parameters
   */
  /**
   * Refreshes the appointment booking tool with current date context
   * Used before SIP campaigns to ensure the AI knows today's date for "tomorrow" calculations
   * Preserves all other existing tools while updating only the appointment tool
   * @param agentId - ElevenLabs agent ID
   */
  async refreshAppointmentToolWithCurrentDate(agentId: string): Promise<void> {
    const now = new Date();
    const currentDateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    console.log(`📅 [ElevenLabs] Refreshing appointment tool with current date for agent: ${agentId}`);
    console.log(`   Today's date: ${currentDateStr}`);

    // Fetch existing agent configuration
    const existingAgent = await this.getAgent(agentId);
    const existingTools = (existingAgent as any)?.conversation_config?.agent?.prompt?.tools || [];

    console.log(`   Existing tools: ${existingTools.length}`);
    if (existingTools.length > 0) {
      console.log(`   Tool names: ${existingTools.map((t: any) => t.name || t.type || 'unnamed').join(', ')}`);
    }

    // Filter out any existing appointment booking tools (they have names like "book_appointment_XXXXXXXX")
    let removedCount = 0;
    const nonAppointmentTools = existingTools.filter((tool: any) => {
      const isAppointmentTool = tool.name?.startsWith('book_appointment_');
      if (isAppointmentTool) {
        console.log(`   Removing outdated appointment tool: ${tool.name}`);
        removedCount++;
      }
      return !isAppointmentTool;
    });

    if (removedCount === 0) {
      console.log(`   No existing appointment tool found to replace - will add fresh one`);
    }

    // Create fresh appointment tool with current date context
    const freshAppointmentTool = getAppointmentToolForAgent(agentId);
    console.log(`   Adding fresh appointment tool: ${freshAppointmentTool.name}`);

    // Combine preserved tools with fresh appointment tool
    const updatedTools = [...nonAppointmentTools, freshAppointmentTool];

    // PATCH the agent with updated tools
    const updatePayload = {
      conversation_config: {
        agent: {
          prompt: {
            tools: updatedTools
          }
        }
      }
    };

    await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(updatePayload),
    });

    // POST-REFRESH VALIDATION: Verify the tool was updated with today's date
    try {
      const verifyAgent = await this.getAgent(agentId);
      const verifyTools = (verifyAgent as any)?.conversation_config?.agent?.prompt?.tools || [];
      const appointmentTool = verifyTools.find((t: any) => t.name?.startsWith('book_appointment_'));

      if (appointmentTool && appointmentTool.description) {
        const yearStr = new Date().getFullYear().toString();
        const hasCurrentYear = appointmentTool.description.includes(yearStr);
        if (hasCurrentYear) {
          console.log(`✅ [ElevenLabs] Appointment tool verified - description includes ${yearStr}`);
        } else {
          console.warn(`⚠️ [ElevenLabs] Appointment tool description may be stale - current year ${yearStr} not found in description`);
          console.log(`   Tool description snippet: ${appointmentTool.description.substring(0, 200)}...`);
        }
      } else {
        console.warn(`⚠️ [ElevenLabs] Post-refresh validation: appointment tool not found in agent tools`);
      }
    } catch (verifyError: any) {
      console.warn(`⚠️ [ElevenLabs] Post-refresh validation failed: ${verifyError.message}`);
    }

    console.log(`✅ [ElevenLabs] Appointment tool refreshed with current date context (${updatedTools.length} total tools)`);
  }

  async updateAgentWorkflow(agentId: string, workflowConfig: {
    transferEnabled?: boolean;
    transferPhoneNumber?: string;
    detectLanguageEnabled?: boolean;
    endConversationEnabled?: boolean;
  }): Promise<ElevenLabsAgent> {
    console.log(`🔄 Updating agent workflow: ${agentId}`);

    const workflow = this.buildWorkflow(workflowConfig);

    const updatePayload: any = {
      workflow: workflow || { nodes: {}, edges: {} }
    };

    console.log(`📤 Sending workflow update:`, JSON.stringify(updatePayload, null, 2));

    const result = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ Agent workflow updated successfully`);
    return result;
  }

  async updateAgent(agentId: string, params: Partial<CreateAgentParams>): Promise<ElevenLabsAgent> {
    console.log(`📝 Updating ElevenLabs agent: ${agentId}`);
    console.log(`   Updates:`, JSON.stringify(params, null, 2));

    // Build the update payload with correct structure
    const updatePayload: any = {};

    if (params.name) {
      updatePayload.name = params.name;
    }

    // Build conversation_config updates
    const conversationConfigUpdates: any = {};

    // Build agent config
    const agentUpdates: any = {};

    // Build system tools as ARRAY for prompt.tools (per ElevenLabs API docs)
    // Check if ANY tool-related property is provided
    const hasAnyToolConfig = params.transferEnabled !== undefined ||
      params.transferPhoneNumber !== undefined ||
      params.detectLanguageEnabled !== undefined ||
      params.endConversationEnabled !== undefined ||
      params.appointmentBookingEnabled !== undefined ||
      params.messagingEmailEnabled !== undefined ||
      params.messagingWhatsappEnabled !== undefined;

    // Check SIP status once — used for transfer type
    const isSipAgent = params.databaseAgentId && await isAgentOnSipPhoneNumber(params.databaseAgentId);

    // Build system tools as ARRAY
    let systemTools: any[] = [];
    let workflowConfig: any = null;

    if (hasAnyToolConfig) {
      console.log(`🔧 Building system tools for PATCH`);

      if (isSipAgent) {
        console.log(`   📞 SIP agent detected - using conference transfer type (direct phone number)`);
      }
      systemTools = this.buildSystemTools({
        transferEnabled: params.transferEnabled,
        transferPhoneNumber: params.transferPhoneNumber,
        detectLanguageEnabled: params.detectLanguageEnabled,
        endConversationEnabled: params.endConversationEnabled,
        transferType: "conference",
      });

      // Skip workflow rebuild if flag is set (for Flow agents whose workflow is managed by flow builder)
      if (params.skipWorkflowRebuild) {
        console.log(`   ⏭️ Skipping workflow rebuild (skipWorkflowRebuild=true)`);
      } else {
        workflowConfig = this.buildWorkflow({
          transferEnabled: params.transferEnabled,
          transferPhoneNumber: params.transferPhoneNumber,
          detectLanguageEnabled: params.detectLanguageEnabled,
          endConversationEnabled: params.endConversationEnabled,
        });
      }
    }

    // Build prompt config object - system tools go in prompt.tools array
    const promptConfig: any = {};

    if (params.prompt || params.model || params.temperature !== undefined || params.voice_tone || params.personality || params.knowledge_bases !== undefined || hasAnyToolConfig) {
      // Build enhanced prompt with voice tone and personality
      let enhancedPrompt = params.prompt;
      if ((params.voice_tone || params.personality) && params.prompt) {
        const toneText = params.voice_tone ? `Voice Tone: ${params.voice_tone}.` : '';
        const personalityText = params.personality ? `Personality: ${params.personality}.` : '';
        enhancedPrompt = `${toneText}${toneText && personalityText ? ' ' : ''}${personalityText}\n\n${params.prompt}`;
      }

      // Enhance prompt with system tools instructions if prompt is being updated
      // Include knowledge base instructions if agent has RAG knowledge bases or ElevenLabs KBs
      if (enhancedPrompt) {
        // Use hasRAGKnowledgeBases flag if provided (for RAG system), otherwise check knowledge_bases array
        const hasKnowledgeBase = params.hasRAGKnowledgeBases || (params.knowledge_bases && params.knowledge_bases.length > 0);
        enhancedPrompt = this.enhanceSystemPromptWithTools(enhancedPrompt, {
          detectLanguageEnabled: params.detectLanguageEnabled,
          endConversationEnabled: params.endConversationEnabled,
          hasKnowledgeBase,
          appointmentBookingEnabled: params.appointmentBookingEnabled,
          isSipAgent: !!isSipAgent,
        });
        promptConfig.prompt = enhancedPrompt;
      }

      if (params.model) {
        promptConfig.llm = params.model;
      }

      if (params.temperature !== undefined) {
        promptConfig.temperature = params.temperature;
      }

      if (params.knowledge_bases !== undefined) {
        promptConfig.knowledge_base = params.knowledge_bases.map(kb => ({
          type: kb.type,
          name: kb.title,
          id: kb.elevenLabsDocId
        }));
      }

      // Combine system tools with any custom webhook tools into prompt.tools array
      const allPromptTools: any[] = [...systemTools];
      if (params.tools && params.tools.length > 0) {
        allPromptTools.push(...params.tools);
      }

      // Add appointment booking webhook tool if enabled
      // Use the ElevenLabs agent ID (agentId) for the webhook URL since the webhook handler 
      // looks up agents by elevenLabsAgentId to find the database record
      if (params.appointmentBookingEnabled) {
        const appointmentTool = getAppointmentToolForAgent(agentId);
        allPromptTools.push(appointmentTool);
        console.log(`   📅 Appointment booking tool: ${appointmentTool.name}`);
      }

      if (params.messagingEmailEnabled) {
        const collectEmailTool = buildCollectCallerEmailTool(agentId);
        allPromptTools.push(collectEmailTool);
        console.log(`   📬 Collect caller email tool added for post-call follow-up`);
        const emailTool = buildMessagingEmailTool(agentId, params.messagingEmailTemplates || [], params.messagingEmailSelectedTemplate);
        allPromptTools.push(emailTool);
        console.log(`   📧 Email messaging tool added${params.messagingEmailSelectedTemplate ? ` (selected: ${params.messagingEmailSelectedTemplate})` : ''}`);
      }
      if (params.messagingWhatsappEnabled) {
        const whatsappTool = buildMessagingWhatsappTool(agentId, params.messagingWhatsappTemplates || [], params.messagingWhatsappSelectedTemplate, params.messagingWhatsappVariables);
        allPromptTools.push(whatsappTool);
        console.log(`   💬 WhatsApp messaging tool added${params.messagingWhatsappSelectedTemplate ? ` (selected: ${params.messagingWhatsappSelectedTemplate})` : ''}`);
      }

      // Add combined tools to prompt.tools (per ElevenLabs API docs)
      if (allPromptTools.length > 0) {
        promptConfig.tools = allPromptTools;
        console.log(`   Prompt tools: ${allPromptTools.length} (${systemTools.length} system + ${params.tools?.length || 0} custom)`);
      } else if (hasAnyToolConfig) {
        // Explicitly set empty tools array if all tools are disabled
        promptConfig.tools = [];
        console.log(`   Prompt tools cleared (all disabled)`);
      }
    }

    // Build agent updates
    if (Object.keys(promptConfig).length > 0) {
      agentUpdates.prompt = promptConfig;
    }

    if (params.first_message) {
      agentUpdates.first_message = params.first_message;
    }

    if (params.language) {
      agentUpdates.language = params.language;
    }

    if (Object.keys(agentUpdates).length > 0) {
      conversationConfigUpdates.agent = agentUpdates;
    }

    // Include TTS config when voice_id, language, or voice quality settings are provided
    // This prevents accidentally overwriting existing TTS settings when only updating other fields
    // For non-English languages, must use multilingual-compatible models
    const hasVoiceSettings = params.voiceStability !== undefined ||
      params.voiceSimilarityBoost !== undefined ||
      params.voiceSpeed !== undefined;
    if (params.voice_id || params.language || hasVoiceSettings) {
      const ttsConfig: any = {
        // Use pcm_16000 for browser/widget compatibility (WebSocket connections)
        // ElevenLabs native telephony integration handles codec conversion separately
        agent_output_audio_format: "pcm_16000",
      };

      if (params.voice_id) {
        ttsConfig.voice_id = params.voice_id;
      }

      // Determine TTS model with smart auto-selection (before voice settings, since V3 ignores them)
      const validModels = ["eleven_v3_conversational", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_turbo_v2", "eleven_flash_v2", "eleven_multilingual_v2"];
      const requestedModel = params.tts_model;
      const smartDefault = "eleven_v3_conversational";

      if (requestedModel && validModels.includes(requestedModel)) {
        ttsConfig.model_id = requestedModel;
      } else if (requestedModel && !validModels.includes(requestedModel)) {
        console.log(`   ⚠️ TTS model ${requestedModel} is not valid, using ${smartDefault}`);
        ttsConfig.model_id = smartDefault;
      } else if (params.language || params.voice_id) {
        ttsConfig.model_id = smartDefault;
      }

      const resolvedModel = ttsConfig.model_id || smartDefault;
      const isV3Model = resolvedModel.includes('v3');

      if (hasVoiceSettings && !isV3Model) {
        ttsConfig.stability = params.voiceStability ?? 0.65;
        ttsConfig.similarity_boost = params.voiceSimilarityBoost ?? 0.85;
        ttsConfig.speed = params.voiceSpeed ?? 0.92;
        console.log(`   🎙️ Voice settings: stability=${ttsConfig.stability}, similarity=${ttsConfig.similarity_boost}, speed=${ttsConfig.speed}`);
      } else if (hasVoiceSettings && isV3Model) {
        console.log(`   🎙️ V3 model active - voice settings (stability, similarity, speed) skipped (ignored by V3)`);
      }

      conversationConfigUpdates.tts = ttsConfig;
    }

    // ALWAYS include ASR config for ElevenLabs to ensure proper audio format
    conversationConfigUpdates.asr = {
      provider: "elevenlabs",
      user_input_audio_format: "pcm_16000", // PCM 16kHz to match widget audio format
    };

    // Add conversation settings for timeout, events, and turn detection
    conversationConfigUpdates.conversation = {
      max_duration_seconds: 900,
      client_events: ["audio", "agent_response", "user_transcript", "interruption", "client_tool_call"],
      turn: {
        mode: "turn_v3",
        turn_timeout: params.turnTimeout ?? 1.5,
      },
    };

    // Add workflow at root level (per ElevenLabs API)
    // Skip workflow updates entirely if skipWorkflowRebuild is set (for Flow agents)
    if (!params.skipWorkflowRebuild) {
      if (workflowConfig) {
        updatePayload.workflow = workflowConfig;
      } else if (hasAnyToolConfig) {
        // Explicitly clear workflow when all tools disabled
        updatePayload.workflow = { nodes: {}, edges: {} };
      }
    }

    if (Object.keys(conversationConfigUpdates).length > 0) {
      updatePayload.conversation_config = conversationConfigUpdates;
    }

    // Add webhook tools at agent root level (per ElevenLabs API documentation)
    if (params.webhookTools && params.webhookTools.length > 0) {
      updatePayload.tools = params.webhookTools;
      console.log(`   📚 Webhook tools: ${params.webhookTools.map(t => t.name).join(', ')}`);
    }

    // V3 Features (all optional, additive only)
    if (params.customGuardrails && params.customGuardrails.length > 0) {
      if (!updatePayload.conversation_config) updatePayload.conversation_config = {};
      updatePayload.conversation_config.safety = {
        guardrails: { custom: params.customGuardrails },
      };
      console.log(`   🛡️ Custom guardrails: ${params.customGuardrails.length} rules`);
    }
    if (params.toolErrorHandlingMode) {
      updatePayload.tool_error_handling_mode = params.toolErrorHandlingMode;
    }
    if (params.dynamicVariableSanitize !== undefined) {
      if (!updatePayload.conversation_config) updatePayload.conversation_config = {};
      if (!updatePayload.conversation_config.agent) updatePayload.conversation_config.agent = {};
      updatePayload.conversation_config.agent.dynamic_variables = {
        ...(updatePayload.conversation_config.agent.dynamic_variables || {}),
        sanitize: params.dynamicVariableSanitize,
      };
    }
    if (params.suggestedAudioTags === true) {
      if (!updatePayload.conversation_config) updatePayload.conversation_config = {};
      if (!updatePayload.conversation_config.tts) updatePayload.conversation_config.tts = {};
      updatePayload.conversation_config.tts.suggested_audio_tags = DEFAULT_EXPRESSIVE_AUDIO_TAGS;
    }

    // Log knowledge base count if provided
    if (params.knowledge_bases !== undefined) {
      console.log(`   Knowledge bases: ${params.knowledge_bases.length} KB(s)`);
    }

    console.log(`📤 Sending update to ElevenLabs API:`, JSON.stringify(updatePayload, null, 2));

    const result = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ ElevenLabs agent updated successfully`);
    return result;
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request(`/convai/agents/${agentId}`, {
      method: "DELETE",
    });
  }

  /**
   * Raw PATCH update for an agent - used by migration engine
   * Allows setting arbitrary fields without validation
   * 
   * @param agentId - ElevenLabs agent ID
   * @param payload - Raw payload to send to ElevenLabs
   * @returns Updated agent
   */
  async patchAgentRaw(agentId: string, payload: Record<string, any>): Promise<ElevenLabsAgent> {
    console.log(`📤 Raw PATCH to agent ${agentId}:`, JSON.stringify(payload, null, 2));

    const result = await this.request<ElevenLabsAgent>(`/convai/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    console.log(`✅ Agent raw patch completed`);
    return result;
  }

  /**
   * List all workspace tools from ElevenLabs
   * GET /v1/convai/tools
   */
  async listWorkspaceTools(): Promise<ElevenLabsWorkspaceTool[]> {
    try {
      console.log(`🔧 Fetching workspace tools from ElevenLabs...`);
      const response = await this.request<{ tools: ElevenLabsWorkspaceTool[] }>('/convai/tools');
      console.log(`   Found ${response.tools?.length || 0} workspace tool(s)`);
      return response.tools || [];
    } catch (error: any) {
      console.error(`❌ Failed to list workspace tools:`, error.message);
      return [];
    }
  }

  /**
   * Create a workspace tool in ElevenLabs
   * POST /v1/convai/tools
   * 
   * @param toolConfig - The webhook tool configuration
   * @returns The created tool with its ID
   */
  async createWorkspaceTool(toolConfig: {
    type: "webhook";
    name: string;
    description: string;
    api_schema: {
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      path_params_schema?: any;
      query_params_schema?: any;
      request_body_schema?: any;
    };
  }): Promise<ElevenLabsWorkspaceTool> {
    console.log(`🔧 Creating workspace tool: ${toolConfig.name}`);
    console.log(`   URL: ${toolConfig.api_schema.url}`);

    const response = await this.request<ElevenLabsWorkspaceTool>('/convai/tools', {
      method: 'POST',
      body: JSON.stringify({ tool_config: toolConfig }),
    });

    console.log(`✅ Workspace tool created: ${response.id}`);

    // Cache the tool ID (scoped by API key to prevent cross-workspace confusion)
    const cacheKey = getToolCacheKey(this.apiKey, toolConfig.name);
    workspaceToolCache.set(cacheKey, response.id);

    return response;
  }

  /**
   * Delete a workspace tool from ElevenLabs
   * DELETE /v1/convai/tools/:tool_id
   */
  async deleteWorkspaceTool(toolId: string): Promise<void> {
    console.log(`🗑️ Deleting workspace tool: ${toolId}`);
    await this.request(`/convai/tools/${toolId}`, {
      method: 'DELETE',
    });
    console.log(`✅ Workspace tool deleted`);
  }

  /**
   * Get or create a workspace tool by name
   * Checks cache first, then lists existing tools, then creates if needed
   * 
   * @param toolConfig - The webhook tool configuration
   * @returns The tool ID
   */
  async getOrCreateWorkspaceTool(toolConfig: {
    type: "webhook";
    name: string;
    description: string;
    api_schema: {
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      path_params_schema?: any;
      query_params_schema?: any;
      request_body_schema?: any;
    };
  }): Promise<string> {
    const cacheKey = getToolCacheKey(this.apiKey, toolConfig.name);

    const existingTools = await this.listWorkspaceTools();

    const cachedId = workspaceToolCache.get(cacheKey);
    if (cachedId) {
      const stillExists = existingTools.some(t => t.id === cachedId);
      if (stillExists) {
        console.log(`🔧 Using cached workspace tool ID (validated): ${cachedId}`);
        return cachedId;
      }
      console.log(`⚠️ Cached workspace tool ${cachedId} no longer exists on ElevenLabs, invalidating cache`);
      workspaceToolCache.delete(cacheKey);
    }

    const existingTool = existingTools.find(t =>
      t.tool_config?.name === toolConfig.name &&
      t.tool_config?.api_schema?.url === toolConfig.api_schema.url
    );

    if (existingTool) {
      console.log(`🔧 Found existing workspace tool: ${existingTool.id}`);
      workspaceToolCache.set(cacheKey, existingTool.id);
      return existingTool.id;
    }

    const newTool = await this.createWorkspaceTool(toolConfig);
    return newTool.id;
  }

  /**
   * Create workspace tools for webhook nodes and update workflow to use real tool IDs
   * 
   * ElevenLabs workflow tool nodes reference tools by tool_id. For the dispatch to work,
   * these must be actual workspace tool IDs (like tool_xxx), not friendly names.
   * 
   * This function:
   * 1. Creates workspace tools for each webhook tool config
   * 2. Builds a mapping of friendly name -> workspace tool ID
   * 3. Updates the workflow nodes to use the real workspace tool IDs
   * 
   * @param webhookTools - Array of webhook tool configurations
   * @param workflow - The workflow to update (nodes will be modified in place)
   * @returns Map of friendly tool name -> workspace tool ID
   */
  async registerWorkflowToolsAndUpdateWorkflow(
    webhookTools: Array<{ type: "webhook"; name: string; description: string; api_schema: any }>,
    workflow: { nodes: Record<string, any>; edges: Record<string, any> }
  ): Promise<Map<string, string>> {
    const toolIdMapping = new Map<string, string>();

    if (!webhookTools || webhookTools.length === 0) {
      return toolIdMapping;
    }

    console.log(`🔧 [Workspace Tools] Registering ${webhookTools.length} workflow tool(s)...`);

    for (const tool of webhookTools) {
      const workspaceToolId = await this.getOrCreateWorkspaceTool({
        type: "webhook",
        name: tool.name,
        description: tool.description,
        api_schema: {
          url: tool.api_schema.url,
          method: tool.api_schema.method === 'GET' ? 'GET' : 'POST',
          headers: tool.api_schema.headers || tool.api_schema.request_headers,
          path_params_schema: tool.api_schema.path_params_schema,
          query_params_schema: tool.api_schema.query_params_schema,
          request_body_schema: tool.api_schema.request_body_schema
        }
      });

      toolIdMapping.set(tool.name, workspaceToolId);
      console.log(`   ✓ Registered: ${tool.name} -> ${workspaceToolId}`);
    }

    // Update workflow tool nodes to use actual workspace tool IDs
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      if (node.type === 'tool' && node.tools && Array.isArray(node.tools)) {
        const updatedTools = node.tools.map((tool: { tool_id: string }) => {
          const friendlyName = tool.tool_id;
          const workspaceToolId = toolIdMapping.get(friendlyName);

          if (workspaceToolId && workspaceToolId !== friendlyName) {
            console.log(`   🔄 Node ${nodeId}: ${friendlyName} -> ${workspaceToolId}`);
            return { tool_id: workspaceToolId };
          }
          return tool;
        });

        node.tools = updatedTools;
      }

      // Update override_agent nodes' additional_tool_ids (e.g. form nodes).
      // These reference tools by friendly name (e.g. "submit_form_1VwJi-GG") which
      // ElevenLabs cannot resolve — it requires the real workspace tool ID (tool_xxx).
      if (node.type === 'override_agent' && node.additional_tool_ids && Array.isArray(node.additional_tool_ids)) {
        const updatedIds = node.additional_tool_ids.map((friendlyName: string) => {
          const workspaceToolId = toolIdMapping.get(friendlyName);
          if (workspaceToolId && workspaceToolId !== friendlyName) {
            console.log(`   🔄 Node ${nodeId} additional_tool_ids: ${friendlyName} -> ${workspaceToolId}`);
            return workspaceToolId;
          }
          return friendlyName;
        });
        node.additional_tool_ids = updatedIds;
      }
    }

    console.log(`✅ [Workspace Tools] Registered ${toolIdMapping.size} tool(s) and updated workflow`);

    return toolIdMapping;
  }

  /**
   * Link webhook tools to an agent using full inline configuration
   * ElevenLabs requires full tool config when adding tools to agents
   * (Workspace tools are for dashboard visibility, but agents need inline config)
   * 
   * IMPORTANT: System tools should be passed as an array with type: "system"
   * Per ElevenLabs API: All tools (system + webhook) go in prompt.tools array
   * 
   * This function PRESERVES existing workflow webhook tools (like webhook_node-*)
   * that were set during agent creation, only adding/updating the specified tools.
   * 
   * @param agentId - The ElevenLabs agent ID
   * @param toolConfigs - Array of full webhook tool configurations to add/update
   * @param systemTools - Optional system tools array to merge with webhook tools
   */
  async linkToolsToAgent(agentId: string, toolConfigs: Array<{
    type: "webhook";
    name: string;
    description: string;
    api_schema: {
      url: string;
      method: "GET" | "POST";
      headers?: Record<string, string>;
      request_body_schema?: any;
    };
  }>, systemTools?: any[]): Promise<void> {
    console.log(`🔧 Linking tools to agent ${agentId}`);

    // Fetch existing agent to preserve workflow webhook tools
    let existingTools: any[] = [];
    try {
      const agent = await this.getAgent(agentId);
      existingTools = (agent as any)?.conversation_config?.agent?.prompt?.tools || [];
      console.log(`   Found ${existingTools.length} existing tool(s)`);
    } catch (error: any) {
      console.log(`   Could not fetch existing tools: ${error.message}`);
    }

    // Get names of tools we're about to add/update
    const newToolNames = new Set([
      ...(toolConfigs.map(t => t.name)),
      ...(systemTools?.map(t => t.name) || [])
    ]);

    // Preserve existing workflow webhook tools that we're NOT updating
    // These are typically named like "webhook_node-*" for flow webhook nodes
    const preservedTools = existingTools.filter((tool: any) => {
      if (!tool.name) return false;
      // Skip if we're updating this tool
      if (newToolNames.has(tool.name)) return false;
      // Preserve workflow webhook tools (webhook_node-* pattern)
      if (tool.type === 'webhook' && tool.name.startsWith('webhook_')) {
        console.log(`   Preserving workflow webhook: ${tool.name}`);
        return true;
      }
      return false;
    });

    // Per ElevenLabs API: All tools (system + webhook) go in prompt.tools array
    // System tools have type: "system", webhook tools have type: "webhook"
    const allTools: any[] = [];

    // Add system tools first (type: "system")
    if (systemTools && systemTools.length > 0) {
      allTools.push(...systemTools);
      console.log(`   System tools: ${systemTools.map(t => t.name).join(', ')}`);
    }

    // Add preserved workflow webhook tools
    if (preservedTools.length > 0) {
      allTools.push(...preservedTools);
      console.log(`   Preserved webhooks: ${preservedTools.map((t: any) => t.name).join(', ')}`);
    }

    // Add new webhook tools (already have type: "webhook")
    if (toolConfigs.length > 0) {
      allTools.push(...toolConfigs);
      console.log(`   New webhook tools: ${toolConfigs.map(t => t.name).join(', ')}`);
    }

    if (allTools.length === 0) {
      console.log(`🔧 No tools to link to agent ${agentId}`);
      return;
    }

    const updatePayload = {
      conversation_config: {
        agent: {
          prompt: {
            tools: allTools
          }
        }
      }
    };

    console.log(`📤 Linking ${allTools.length} tools (${systemTools?.length || 0} system + ${preservedTools.length} preserved + ${toolConfigs.length} new):`, JSON.stringify(updatePayload, null, 2));

    await this.request(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ Tools linked to agent successfully`);
  }

  /**
   * Replace all tools whose name matches a given prefix, while preserving all
   * other existing tools on the agent.  Used by startup resync jobs so they
   * don't accidentally drop RAG, appointment, or other webhook tools.
   *
   * @param agentId   - ElevenLabs agent ID
   * @param prefix    - Tool name prefix to drop before re-adding (e.g. "submit_form_")
   * @param newTools  - Replacement tools for that prefix
   */
  async replaceToolsByPrefix(
    agentId: string,
    prefix: string,
    newTools: Array<{ type: "webhook"; name: string; description: string; api_schema: any }>
  ): Promise<void> {
    console.log(`🔧 [replaceToolsByPrefix] Replacing "${prefix}" tools on agent ${agentId}`);

    let existingTools: any[] = [];
    try {
      const agentData = await this.getAgent(agentId);
      existingTools = (agentData as any)?.conversation_config?.agent?.prompt?.tools || [];
    } catch (err: any) {
      console.warn(`   Could not fetch existing tools: ${err.message}`);
    }

    const retained = existingTools.filter((t: any) => t.name && !t.name.startsWith(prefix));
    const mergedTools = [...retained, ...newTools];

    await this.request(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        conversation_config: {
          agent: { prompt: { tools: mergedTools } }
        }
      }),
    });

    console.log(`   ✅ Replaced ${newTools.length} tool(s) with prefix "${prefix}", retained ${retained.length} other tool(s)`);
  }

  /**
   * Unlink all custom tools from an agent
   * Sets conversation_config.agent.prompt.tools = []
   */
  async unlinkToolsFromAgent(agentId: string): Promise<void> {
    console.log(`🔧 Unlinking all tools from agent ${agentId}`);

    const updatePayload = {
      conversation_config: {
        agent: {
          prompt: {
            tools: []
          }
        }
      }
    };

    await this.request(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ Tools unlinked from agent`);
  }

  async listVoices(): Promise<{ voices: ElevenLabsVoice[] }> {
    try {
      console.log(`🎤 Fetching voices from ElevenLabs v2 API...`);

      // Fetch all voices using v2 API with pagination
      // v2 API uses next_page_token instead of cursor
      const allVoices: ElevenLabsVoice[] = [];
      let nextPageToken: string | null = null;
      let pageCount = 0;
      const maxPages = 10; // Fetch up to 1000 voices (100 per page)

      do {
        try {
          // Build URL with pagination token if available
          const url: string = nextPageToken
            ? `/voices?page_size=100&next_page_token=${encodeURIComponent(nextPageToken)}`
            : `/voices?page_size=100`;

          const response: {
            voices: ElevenLabsVoice[];
            has_more: boolean;
            next_page_token: string | null;
            total_count?: number;
          } = await this.request<{
            voices: ElevenLabsVoice[];
            has_more: boolean;
            next_page_token: string | null;
            total_count?: number;
          }>(url, {}, true); // Use v2 API for voices

          if (response.voices && response.voices.length > 0) {
            allVoices.push(...response.voices);
            console.log(`📄 Page ${pageCount + 1}: Fetched ${response.voices.length} voices (Total so far: ${allVoices.length})`);

            // Log total count if available
            if (pageCount === 0 && response.total_count !== undefined) {
              console.log(`📊 Total available voices: ${response.total_count}`);
            }
          }

          // Update pagination state
          nextPageToken = response.has_more && response.next_page_token ? response.next_page_token : null;
          pageCount++;

          // Safety check to prevent infinite loops
          if (pageCount >= maxPages) {
            console.log(`⚠️ Reached maximum page limit (${maxPages} pages). Stopping pagination.`);
            break;
          }
        } catch (pageError: any) {
          console.error(`⚠️ Failed to fetch voices page ${pageCount + 1}:`, pageError.message);
          break; // Stop pagination on error
        }
      } while (nextPageToken !== null);

      // Deduplicate voices by voice_id (just in case)
      const voiceMap = new Map<string, ElevenLabsVoice>();
      allVoices.forEach(voice => {
        if (voice.voice_id && !voiceMap.has(voice.voice_id)) {
          voiceMap.set(voice.voice_id, voice);
        }
      });

      const uniqueVoices = Array.from(voiceMap.values());
      console.log(`✅ Total unique voices fetched: ${uniqueVoices.length} (across ${pageCount} pages)`);

      // Print conversational voices in tabular format
      this.printConversationalVoices(uniqueVoices);

      return { voices: uniqueVoices };
    } catch (error: any) {
      console.error('❌ Error fetching voices from v2 API:', error);
      throw error;
    }
  }

  private printConversationalVoices(voices: ElevenLabsVoice[]): void {
    // Filter voices suitable for conversational/dialogue use
    const conversationalKeywords = ['conversational', 'chat', 'dialogue', 'natural', 'friendly', 'casual'];
    const conversationalVoices = voices.filter(voice => {
      const name = voice.name?.toLowerCase() || '';
      const category = voice.category?.toLowerCase() || '';
      const labels = Object.values(voice.labels || {}).join(' ').toLowerCase();

      return conversationalKeywords.some(keyword =>
        name.includes(keyword) || category.includes(keyword) || labels.includes(keyword)
      );
    });

    if (conversationalVoices.length > 0) {
      console.log(`\n${'='.repeat(100)}`);
      console.log(`🗣️  CONVERSATIONAL VOICES (${conversationalVoices.length} found)`);
      console.log(`${'='.repeat(100)}`);
      console.log(`${'voice_id'.padEnd(25)} | ${'name'.padEnd(30)} | ${'language'.padEnd(12)} | ${'category'.padEnd(15)}`);
      console.log(`${'-'.repeat(100)}`);

      conversationalVoices.forEach(voice => {
        const voiceId = (voice.voice_id || 'N/A').substring(0, 24).padEnd(25);
        const name = (voice.name || 'Unnamed').substring(0, 29).padEnd(30);
        const language = (voice.labels?.language || 'en').substring(0, 11).padEnd(12);
        const category = (voice.category || 'N/A').substring(0, 14).padEnd(15);

        console.log(`${voiceId} | ${name} | ${language} | ${category}`);
      });

      console.log(`${'='.repeat(100)}\n`);
    } else {
      console.log(`\n⚠️  No voices with conversational/dialogue keywords found.`);
    }
  }

  /**
   * Generate voice preview audio using ElevenLabs TTS API
   * Returns audio buffer in mp3 format
   */
  async generateVoicePreview(params: {
    voiceId: string;
    text: string;
    voiceSettings?: {
      stability?: number;
      similarity_boost?: number;
      speed?: number;
      use_speaker_boost?: boolean;
    };
    modelId?: string;
  }): Promise<Buffer> {
    const { voiceId, text, voiceSettings, modelId } = params;

    // Use v1 TTS endpoint
    const url = `${ELEVENLABS_V1_BASE_URL}/text-to-speech/${voiceId}`;

    const requestBody: any = {
      text: text,
      model_id: modelId || "eleven_multilingual_v2",
    };

    // Add voice settings if provided (style excluded - not supported by Conversational AI)
    if (voiceSettings) {
      let stability = voiceSettings.stability ?? 0.5;
      const effectiveModel = requestBody.model_id;
      if (effectiveModel && effectiveModel.includes('v3')) {
        const validValues = [0.0, 0.5, 1.0];
        stability = validValues.reduce((prev, curr) =>
          Math.abs(curr - stability) < Math.abs(prev - stability) ? curr : prev
        );
      }
      requestBody.voice_settings = {
        stability,
        similarity_boost: voiceSettings.similarity_boost ?? 0.75,
        speed: voiceSettings.speed ?? 1.0,
        use_speaker_boost: voiceSettings.use_speaker_boost ?? true,
      };
    }

    console.log(`🎤 Generating voice preview for voice ${voiceId}...`);
    console.log(`   Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    console.log(`   Model: ${requestBody.model_id}`);
    if (voiceSettings) {
      console.log(`   Settings: stability=${voiceSettings.stability}, similarity=${voiceSettings.similarity_boost}, speed=${voiceSettings.speed}`);
    }

    // Create AbortController for timeout (60 seconds for TTS which can be slow)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Voice preview generation failed: ${response.status} - ${errorText}`);
        throw new ExternalServiceError(
          'ElevenLabs',
          `Failed to generate voice preview: ${response.status} - ${errorText}`,
          undefined,
          { operation: 'voice_preview', statusCode: response.status }
        );
      }

      // Get audio as buffer
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      console.log(`✅ Voice preview generated: ${audioBuffer.length} bytes`);

      return audioBuffer;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ExternalServiceError(
          'ElevenLabs',
          `Voice preview generation timeout after 60s`,
          undefined,
          { operation: 'voice_preview', timeout: 60000 }
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get subscription info including voice slot usage and limits
   * Returns voice_count, max_voice_count and other subscription details
   */
  async getSubscription(): Promise<{
    voice_slots_used: number;
    voice_limit: number;
    professional_voice_slots_used: number;
    professional_voice_limit: number;
    tier: string;
    character_count: number;
    character_limit: number;
    can_extend_voice_limit: boolean;
  }> {
    try {
      const response = await this.request<{
        voice_slots_used: number;
        voice_limit: number;
        professional_voice_slots_used: number;
        professional_voice_limit: number;
        tier: string;
        character_count: number;
        character_limit: number;
        can_extend_voice_limit: boolean;
      }>('/user/subscription');

      return response;
    } catch (error: any) {
      console.error('❌ Error fetching subscription info:', error.message);
      throw error;
    }
  }

  /**
   * Fetch shared voices from ElevenLabs Voice Library
   * This returns community-shared voices (5000+) that can be added to any account
   */
  async listSharedVoices(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    language?: string;
    gender?: string;
    age?: string;
    accent?: string;
    category?: string;
    useCases?: string[];
  } = {}): Promise<{
    voices: SharedVoice[];
    hasMore: boolean;
    totalCount?: number;
  }> {
    try {
      const params = new URLSearchParams();

      // Pagination
      params.append('page_size', String(options.pageSize || 100));
      if (options.page !== undefined) {
        params.append('page', String(options.page));
      }

      // Filters
      if (options.search) {
        params.append('search', options.search);
      }
      if (options.language) {
        params.append('language', options.language);
      }
      if (options.gender) {
        params.append('gender', options.gender);
      }
      if (options.age) {
        params.append('age', options.age);
      }
      if (options.accent) {
        params.append('accent', options.accent);
      }
      if (options.category) {
        params.append('category', options.category);
      }
      if (options.useCases && options.useCases.length > 0) {
        options.useCases.forEach(uc => params.append('use_cases', uc));
      }

      console.log(`🎤 Fetching shared voices from ElevenLabs library...`);

      const response = await this.request<{
        voices: SharedVoice[];
        has_more: boolean;
        last_sort_id?: string;
      }>(`/shared-voices?${params.toString()}`);

      console.log(`✅ Fetched ${response.voices?.length || 0} shared voices`);

      return {
        voices: response.voices || [],
        hasMore: response.has_more || false,
      };
    } catch (error: any) {
      console.error('❌ Error fetching shared voices:', error);
      throw error;
    }
  }

  /**
   * Add a shared voice from the library to the current account
   */
  async addSharedVoice(publicOwnerId: string, voiceId: string, newName?: string): Promise<{ voice_id: string }> {
    console.log(`➕ Adding shared voice ${voiceId} from owner ${publicOwnerId}...`);

    const response = await this.request<{ voice_id: string }>(
      `/voices/add/${publicOwnerId}/${voiceId}`,
      {
        method: 'POST',
        body: JSON.stringify(newName ? { new_name: newName } : {}),
      }
    );

    console.log(`✅ Voice added successfully with ID: ${response.voice_id}`);
    return response;
  }

  async createBatchCall(params: {
    agent_id: string;
    phone_number_id: string;
    recipients: Array<{ phone_number: string; name?: string }>;
  }): Promise<{ batch_id: string }> {
    return this.request<{ batch_id: string }>("/convai/batch-calling/create", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async getConversationWebSocketAuth(
    agentId: string,
    customLlmWsUrl?: string
  ): Promise<{ signed_url: string; agent_id?: string }> {
    console.log(`🔐 Getting signed URL for ElevenLabs agent: ${agentId}`);

    // Proactively check and heal any stale tool/document IDs on the agent to prevent 3000 WebSession closure
    try {
      const agent = await this.getAgent(agentId);
      const currentToolIds: string[] = (agent as any)?.conversation_config?.agent?.prompt?.tool_ids || [];
      const currentTools: any[] = (agent as any)?.conversation_config?.agent?.prompt?.tools || [];
      
      const workspaceTools = await this.listWorkspaceTools();
      const validToolIds = new Set(workspaceTools.map(t => t.id));
      
      const staleToolIds = currentToolIds.filter(id => id.startsWith('tool_') && !validToolIds.has(id));
      
      if (staleToolIds.length > 0) {
        console.warn(`⚠️ [ElevenLabs Service] Proactively detected ${staleToolIds.length} stale tool ID(s) on agent ${agentId} before WebSession:`, staleToolIds);
        
        const cleanToolIds = currentToolIds.filter(id => !staleToolIds.includes(id));
        const cleanTools = currentTools.filter(t => !t.id || !staleToolIds.includes(t.id));
        
        const updatePayload = {
          conversation_config: {
            agent: {
              prompt: {
                tool_ids: cleanToolIds,
                tools: cleanTools
              }
            }
          }
        };
        
        console.log(`   🛠️ Proactively purging stale tools from agent ${agentId}...`);
        await this.request<any>(`/convai/agents/${agentId}`, {
          method: 'PATCH',
          body: JSON.stringify(updatePayload)
        });
        console.log(`   ✅ Agent ${agentId} stale tools successfully purged.`);
      }
    } catch (err: any) {
      console.error(`⚠️ [ElevenLabs Service] Proactive stale tool check failed for agent ${agentId}:`, err.message);
    }

    // Build query parameters
    const params = new URLSearchParams({ agent_id: agentId });
    if (customLlmWsUrl) {
      params.append('custom_llm_ws_url', customLlmWsUrl);
    }

    try {
      const result = await this.request<{ signed_url: string; agent_id?: string }>(
        `/convai/conversation/get_signed_url?${params.toString()}`,
        {
          method: 'GET',
        }
      );

      console.log(`✅ Got signed URL for agent ${agentId} (expires in 15 minutes)`);
      return result;
    } catch (error: any) {
      console.error(`❌ Failed to get signed URL for agent ${agentId}:`, error);
      throw error;
    }
  }

  async addKnowledgeToAgent(agentId: string, knowledgeBaseId: string): Promise<void> {
    await this.request(`/convai/agents/${agentId}/add-to-knowledge-base`, {
      method: 'POST',
      body: JSON.stringify({
        knowledge_base_id: knowledgeBaseId
      }),
    });
  }

  async uploadKnowledgeBaseFile(file: Buffer, filename: string, name?: string): Promise<{ id: string; name: string }> {
    console.log(`📤 Uploading knowledge base file: ${filename}`);

    // Determine MIME type from file extension
    const ext = filename.toLowerCase().split('.').pop();
    let mimeType = 'application/octet-stream';

    switch (ext) {
      case 'pdf':
        mimeType = 'application/pdf';
        break;
      case 'txt':
        mimeType = 'text/plain';
        break;
      case 'docx':
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
      case 'html':
        mimeType = 'text/html';
        break;
      case 'epub':
        mimeType = 'application/epub+zip';
        break;
    }

    console.log(`   MIME type: ${mimeType}`);

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(file)], { type: mimeType });
    formData.append('file', blob, filename);

    if (name) {
      formData.append('name', name);
    }

    // Create AbortController for timeout (60 seconds for file upload)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${ELEVENLABS_V1_BASE_URL}/convai/knowledge-base`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'xi-api-key': this.apiKey,
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to upload file: ${response.status} - ${error}`);
      }

      const result = await response.json();
      console.log(`✅ Knowledge base file uploaded: ${result.id}`);
      return result;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ExternalServiceError(
          'ElevenLabs',
          `Knowledge base file upload timeout after 60s`,
          undefined,
          { operation: 'knowledge_base_upload', timeout: 60000 }
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async addKnowledgeBaseFromUrl(url: string, name?: string): Promise<{ id: string; name: string }> {
    console.log(`📤 Adding knowledge base from URL: ${url}`);

    const result = await this.request<{ id: string; name: string }>('/convai/knowledge-base/url', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    });

    console.log(`✅ Knowledge base URL added: ${result.id}`);
    return result;
  }

  async addKnowledgeBaseFromText(text: string, name: string): Promise<{ id: string; name: string }> {
    console.log(`📤 Adding knowledge base from text: ${name}`);

    const result = await this.request<{ id: string; name: string }>('/convai/knowledge-base/text', {
      method: 'POST',
      body: JSON.stringify({ text, name }),
    });

    console.log(`✅ Knowledge base text added: ${result.id}`);
    return result;
  }

  async listKnowledgeBases(params?: {
    page_size?: number;
    search?: string;
    show_only_owned_documents?: boolean;
  }): Promise<{ documents: Array<{ id: string; name: string; type: string; created_at: string }> }> {
    const queryParams = new URLSearchParams();

    if (params?.page_size) queryParams.append('page_size', params.page_size.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.show_only_owned_documents !== undefined) {
      queryParams.append('show_only_owned_documents', params.show_only_owned_documents.toString());
    }

    const endpoint = `/convai/knowledge-base${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return this.request<{ documents: Array<{ id: string; name: string; type: string; created_at: string }> }>(endpoint);
  }

  async getKnowledgeBase(documentId: string): Promise<{ id: string; name: string; type: string; created_at: string }> {
    return this.request<{ id: string; name: string; type: string; created_at: string }>(
      `/convai/knowledge-base/${documentId}`
    );
  }

  async updateKnowledgeBase(documentId: string, name: string): Promise<void> {
    await this.request(`/convai/knowledge-base/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async deleteKnowledgeBase(documentId: string): Promise<void> {
    console.log(`🗑️  Deleting knowledge base document: ${documentId}`);
    await this.request(`/convai/knowledge-base/${documentId}`, {
      method: 'DELETE',
    });
    console.log(`✅ Knowledge base document deleted`);
  }

  async getLLMPricing(params?: {
    promptLength?: number;
    numberOfPages?: number;
    ragEnabled?: boolean;
  }): Promise<{
    llm_prices: Array<{
      model: string;
      provider: string;
      cost_per_million_input_tokens: number;
      cost_per_million_output_tokens: number;
      cost_per_million_input_cache_read_tokens?: number;
      cost_per_million_input_cache_write_tokens?: number;
      recommended_for?: string[];
      tags?: string[];
    }>;
  }> {
    console.log(`💰 Fetching LLM pricing information from ElevenLabs`);

    const result = await this.request<{
      llm_prices: Array<{
        model: string;
        provider: string;
        cost_per_million_input_tokens: number;
        cost_per_million_output_tokens: number;
        cost_per_million_input_cache_read_tokens?: number;
        cost_per_million_input_cache_write_tokens?: number;
        recommended_for?: string[];
        tags?: string[];
      }>;
    }>('/llm-usage/calculate', {
      method: 'POST',
      body: JSON.stringify({
        prompt_length: params?.promptLength || 500,
        number_of_pages: params?.numberOfPages || 0,
        rag_enabled: params?.ragEnabled || false,
      }),
    });

    console.log(`✅ Fetched pricing for ${result.llm_prices.length} LLM models`);
    return result;
  }

  async syncPhoneNumberToElevenLabs(params: {
    phoneNumber: string;
    twilioAccountSid: string;
    twilioAuthToken: string;
    label?: string;
    enableOutbound?: boolean;
  }): Promise<{ phone_number_id: string }> {
    console.log(`📞 Syncing phone number to ElevenLabs: ${params.phoneNumber}`);

    const result = await this.request<{ phone_number_id: string }>('/convai/phone-numbers', {
      method: 'POST',
      body: JSON.stringify({
        phone_number: params.phoneNumber,
        sid: params.twilioAccountSid,
        token: params.twilioAuthToken,
        label: params.label || params.phoneNumber,
      }),
    });

    console.log(`✅ Phone number synced to ElevenLabs: ${result.phone_number_id}`);

    // Enable outbound support after syncing (default true for purchased numbers)
    if (params.enableOutbound !== false) {
      console.log(`📞 Enabling outbound support for phone number`);
      await this.updatePhoneNumber(result.phone_number_id, {
        supportsOutbound: true,
      });
      console.log(`✅ Outbound support enabled`);
    }

    return result;
  }

  async listPhoneNumbers(): Promise<{
    phone_numbers: Array<{
      phone_number_id: string;
      phone_number: string;
      label: string;
      agent_id?: string;
    }>;
  }> {
    console.log(`📞 Fetching phone numbers from ElevenLabs`);
    const result = await this.request<{
      phone_numbers: Array<{
        phone_number_id: string;
        phone_number: string;
        label: string;
        agent_id?: string;
      }>;
    }>('/convai/phone-numbers');
    console.log(`✅ Fetched ${result.phone_numbers.length} phone number(s)`);
    return result;
  }

  async getPhoneNumber(phoneNumberId: string): Promise<{
    phone_number_id: string;
    phone_number: string;
    label: string;
    agent_id?: string;
  }> {
    return this.request<{
      phone_number_id: string;
      phone_number: string;
      label: string;
      agent_id?: string;
    }>(`/convai/phone-numbers/${phoneNumberId}`);
  }

  async updatePhoneNumber(phoneNumberId: string, params: {
    label?: string;
    agentId?: string | null;
    supportsInbound?: boolean;
    supportsOutbound?: boolean;
    inboundAgentId?: string | null;
  }): Promise<void> {
    console.log(`📞 Updating phone number in ElevenLabs: ${phoneNumberId}`);
    const body: any = {};

    if (params.label !== undefined) {
      body.label = params.label;
    }
    if (params.agentId !== undefined) {
      body.agent_id = params.agentId;
    }
    if (params.supportsInbound !== undefined) {
      body.supports_inbound = params.supportsInbound;
    }
    if (params.supportsOutbound !== undefined) {
      body.supports_outbound = params.supportsOutbound;
    }
    if (params.inboundAgentId !== undefined) {
      body.inbound_agent_id = params.inboundAgentId;
    }

    console.log(`📞 Update payload:`, JSON.stringify(body));

    await this.request(`/convai/phone-numbers/${phoneNumberId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    console.log(`✅ Phone number updated in ElevenLabs`);
  }

  async deletePhoneNumber(phoneNumberId: string): Promise<void> {
    console.log(`📞 Deleting phone number from ElevenLabs: ${phoneNumberId}`);
    await this.request(`/convai/phone-numbers/${phoneNumberId}`, {
      method: 'DELETE',
    });
    console.log(`✅ Phone number deleted from ElevenLabs`);
  }

  async assignAgentToPhoneNumber(phoneNumberId: string, agentId: string, forInbound: boolean = true): Promise<void> {
    console.log(`📞 Assigning agent ${agentId} to phone number ${phoneNumberId} (inbound: ${forInbound})`);

    if (forInbound) {
      await this.updatePhoneNumber(phoneNumberId, {
        agentId,
        inboundAgentId: agentId,
        supportsInbound: true,
      });
    } else {
      await this.updatePhoneNumber(phoneNumberId, { agentId });
    }

    console.log(`✅ Agent assigned to phone number`);
  }

  async unassignAgentFromPhoneNumber(phoneNumberId: string): Promise<void> {
    console.log(`📞 Unassigning agent from phone number ${phoneNumberId}`);
    await this.updatePhoneNumber(phoneNumberId, {
      agentId: null,
      inboundAgentId: null,
      supportsInbound: false,
    });
    console.log(`✅ Agent unassigned from phone number`);
  }

  // ============================================================================
  // CALL INITIATION & CONVERSATION APIs
  // ElevenLabs handles calls directly via native Twilio integration
  // ============================================================================

  /**
   * Initiate an outbound call via ElevenLabs Twilio integration
   * POST /v1/twilio/outbound-call
   * 
   * @see https://elevenlabs.io/docs/api-reference/twilio/outbound-call
   * 
   * @param phoneNumberId - ElevenLabs phone number ID (the "from" number)
   * @param toNumber - Recipient phone number in E.164 format (+1234567890)
   * @param agentId - ElevenLabs agent ID to use for the call
   * @param customSystemPrompt - Optional custom system prompt override
   * @param firstMessage - Optional custom first message
   * @returns Conversation ID and Call SID from ElevenLabs
   */
  async initiateOutboundCall(params: {
    phoneNumberId: string;
    toNumber: string;
    agentId: string;
    customSystemPrompt?: string;
    firstMessage?: string;
    dynamicData?: Record<string, string>;
    workflow?: any;
    webhookTools?: any[];
  }): Promise<{
    conversation_id: string | null;
    call_sid?: string;
  }> {
    console.log(`📞 Initiating outbound call via ElevenLabs Twilio API`);
    console.log(`   From (phone_number_id): ${params.phoneNumberId}`);
    console.log(`   To: ${params.toNumber}`);
    console.log(`   Agent: ${params.agentId}`);
    if (params.dynamicData) {
      console.log(`   Dynamic data keys: ${Object.keys(params.dynamicData).join(', ')}`);
    }

    const requestBody: any = {
      agent_id: params.agentId,
      agent_phone_number_id: params.phoneNumberId,
      to_number: params.toNumber,
    };

    // Add optional overrides via conversation_initiation_client_data
    if (params.customSystemPrompt || params.firstMessage || params.dynamicData || params.workflow || params.webhookTools) {
      requestBody.conversation_initiation_client_data = {};

      const configOverride: any = {
        agent: {
          ...(params.customSystemPrompt && {
            prompt: {
              prompt: params.customSystemPrompt,
            },
          }),
          ...(params.firstMessage && {
            first_message: params.firstMessage,
          }),
        }
      };

      // Add workflow override if provided
      if (params.workflow) {
        configOverride.workflow = params.workflow;
      }

      requestBody.conversation_initiation_client_data.conversation_config_override = configOverride;

      // Add webhook tools override if provided
      // Note: webhook_tools are passed at the root of conversation_initiation_client_data, not in config_override
      if (params.webhookTools && params.webhookTools.length > 0) {
        requestBody.conversation_initiation_client_data.webhook_tools = params.webhookTools;
      }

      if (params.dynamicData && Object.keys(params.dynamicData).length > 0) {
        requestBody.conversation_initiation_client_data.dynamic_variables = params.dynamicData;
        console.log(`   Dynamic data for variable substitution:`, JSON.stringify(params.dynamicData));
      }
    }

    console.log(`📤 Sending outbound call request to /twilio/outbound-call:`, JSON.stringify(requestBody, null, 2));

    // Use the correct Twilio outbound call endpoint
    const result = await this.request<{
      success: boolean;
      message: string;
      conversation_id: string | null;
      callSid: string | null;
    }>(`/twilio/outbound-call`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    console.log(`✅ Outbound call initiated`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Conversation ID: ${result.conversation_id}`);
    if (result.callSid) {
      console.log(`   Call SID: ${result.callSid}`);
    }

    // Map API response to expected return format
    return {
      conversation_id: result.conversation_id || null,
      call_sid: result.callSid || undefined,
    };
  }

  /**
   * Get list of conversations from ElevenLabs
   * GET /v1/convai/conversations
   * 
   * @param agentId - Optional filter by agent ID
   * @param cursor - Optional pagination cursor
   * @param pageSize - Number of results per page (default 30, max 100)
   * @returns List of conversations with pagination info
   */
  async getConversations(params?: {
    agentId?: string;
    cursor?: string;
    pageSize?: number;
  }): Promise<{
    conversations: Array<{
      conversation_id: string;
      agent_id: string;
      status: 'processing' | 'done' | 'failed';
      start_time_unix_secs: number;
      end_time_unix_secs?: number;
      call_duration_secs?: number;
      message_count?: number;
      metadata?: Record<string, any>;
    }>;
    next_cursor?: string;
    has_more: boolean;
  }> {
    console.log(`📋 Fetching conversations from ElevenLabs`);

    const queryParams = new URLSearchParams();
    if (params?.agentId) {
      queryParams.append('agent_id', params.agentId);
    }
    if (params?.cursor) {
      queryParams.append('cursor', params.cursor);
    }
    if (params?.pageSize) {
      queryParams.append('page_size', params.pageSize.toString());
    }

    const endpoint = `/convai/conversations${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    const result = await this.request<{
      conversations: Array<{
        conversation_id: string;
        agent_id: string;
        status: 'processing' | 'done' | 'failed';
        start_time_unix_secs: number;
        end_time_unix_secs?: number;
        call_duration_secs?: number;
        message_count?: number;
        metadata?: Record<string, any>;
      }>;
      next_cursor?: string;
      has_more: boolean;
    }>(endpoint);

    console.log(`✅ Fetched ${result.conversations.length} conversation(s)`);
    return result;
  }

  /**
   * Get detailed conversation information including transcript and recording
   * GET /v1/convai/conversations/{conversation_id}
   * 
   * @param conversationId - ElevenLabs conversation ID
   * @returns Full conversation details with transcript and recording URL
   */
  async getConversationDetails(conversationId: string): Promise<{
    conversation_id: string;
    agent_id: string;
    status: 'processing' | 'done' | 'failed';
    start_time_unix_secs: number;
    end_time_unix_secs?: number;
    call_duration_secs?: number;
    transcript: Array<{
      role: 'agent' | 'user';
      message: string;
      time_in_call_secs: number;
    }>;
    metadata?: {
      call_sid?: string;
      from_number?: string;
      to_number?: string;
      direction?: 'inbound' | 'outbound';
      [key: string]: any;
    };
    analysis?: {
      call_successful?: boolean;
      transcript_summary?: string;
      summary?: string;
      data_collected?: Record<string, any>;
      data_collection_results?: Record<string, any>;
      evaluation_criteria_results?: Record<string, {
        result: string;
        reason: string;
      }>;
    };
    recording_url?: string;
    has_audio?: boolean;
    has_user_audio?: boolean;
    has_response_audio?: boolean;
  }> {
    console.log(`📞 Fetching conversation details: ${conversationId}`);

    const result = await this.request<{
      conversation_id: string;
      agent_id: string;
      status: 'processing' | 'done' | 'failed';
      start_time_unix_secs: number;
      end_time_unix_secs?: number;
      call_duration_secs?: number;
      transcript: Array<{
        role: 'agent' | 'user';
        message: string;
        time_in_call_secs: number;
      }>;
      metadata?: {
        call_sid?: string;
        from_number?: string;
        to_number?: string;
        direction?: 'inbound' | 'outbound';
        [key: string]: any;
      };
      analysis?: {
        call_successful?: boolean;
        transcript_summary?: string;
        summary?: string;
        data_collected?: Record<string, any>;
        data_collection_results?: Record<string, any>;
        evaluation_criteria_results?: Record<string, {
          result: string;
          reason: string;
        }>;
      };
      recording_url?: string;
      has_audio?: boolean;
      has_user_audio?: boolean;
      has_response_audio?: boolean;
    }>(`/convai/conversations/${conversationId}`);

    console.log(`✅ Fetched conversation details`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Duration: ${result.call_duration_secs || 0}s`);
    console.log(`   Transcript entries: ${result.transcript?.length || 0}`);
    console.log(`   Has recording: ${result.recording_url ? 'Yes' : 'No'}`);

    return result;
  }

  /**
   * Get conversation audio recording
   * GET /v1/convai/conversations/{conversation_id}/audio
   * 
   * @param conversationId - ElevenLabs conversation ID
   * @returns Audio buffer and content type for direct streaming
   */
  async getConversationAudio(conversationId: string): Promise<{
    audioBuffer: Buffer | null;
    contentType: string;
    error?: string;
  }> {
    console.log(`🎙️  Fetching conversation audio: ${conversationId}`);

    // Create AbortController for timeout (60 seconds for audio download)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const audioUrl = `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`;

      const response = await fetch(audioUrl, {
        signal: controller.signal,
        headers: {
          'xi-api-key': this.apiKey,
          ...getCorrelationHeaders(), // Propagate correlation ID for distributed tracing
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ElevenLabs audio fetch failed: ${response.status} - ${errorText}`);
        return {
          audioBuffer: null,
          contentType: 'audio/mpeg',
          error: `Audio not available: ${response.status}`,
        };
      }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      console.log(`✅ Audio fetched: ${audioBuffer.length} bytes`);
      return {
        audioBuffer,
        contentType,
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error(`❌ ElevenLabs audio fetch timeout after 60s`);
        return {
          audioBuffer: null,
          contentType: 'audio/mpeg',
          error: 'Audio fetch timeout after 60s',
        };
      }
      console.error(`❌ ElevenLabs audio fetch error:`, error.message);
      return {
        audioBuffer: null,
        contentType: 'audio/mpeg',
        error: error.message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Delete a conversation from ElevenLabs
   * DELETE /v1/convai/conversations/{conversation_id}
   * 
   * @param conversationId - ElevenLabs conversation ID
   */
  async deleteConversation(conversationId: string): Promise<void> {
    console.log(`🗑️  Deleting conversation: ${conversationId}`);

    await this.request(`/convai/conversations/${conversationId}`, {
      method: 'DELETE',
    });

    console.log(`✅ Conversation deleted`);
  }

  /**
   * Get agent webhook configuration
   * Used to configure conversation.completed and other webhooks
   * 
   * @param agentId - ElevenLabs agent ID
   * @returns Current webhook configuration
   */
  async getAgentWebhook(agentId: string): Promise<{
    webhook?: {
      url: string;
      events: string[];
      secret?: string;
    };
  }> {
    console.log(`🔗 Fetching webhook config for agent: ${agentId}`);

    const agent = await this.getAgent(agentId);
    const webhookConfig = (agent as any).webhook;

    console.log(`✅ Webhook config: ${webhookConfig ? JSON.stringify(webhookConfig) : 'Not configured'}`);
    return { webhook: webhookConfig };
  }

  /**
   * Configure webhook for agent to receive call completion notifications
   * PATCH /v1/convai/agents/{agent_id}
   * 
   * @param agentId - ElevenLabs agent ID
   * @param webhookUrl - URL to receive webhook notifications
   * @param events - Array of events to subscribe to (default: ['conversation.completed'])
   * @param secret - Optional secret for webhook signature verification
   */
  async configureAgentWebhook(agentId: string, params: {
    webhookUrl: string;
    events?: string[];
    secret?: string;
  }): Promise<void> {
    console.log(`🔗 Configuring webhook for agent: ${agentId}`);
    console.log(`   URL: ${params.webhookUrl}`);
    console.log(`   Events: ${params.events?.join(', ') || 'conversation.completed'}`);

    const updatePayload = {
      webhook: {
        url: params.webhookUrl,
        events: params.events || ['conversation.completed'],
        ...(params.secret && { secret: params.secret }),
      },
    };

    await this.request(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(updatePayload),
    });

    console.log(`✅ Webhook configured for agent`);
  }

  /**
   * Remove webhook configuration from agent
   * 
   * @param agentId - ElevenLabs agent ID
   */
  async removeAgentWebhook(agentId: string): Promise<void> {
    console.log(`🔗 Removing webhook from agent: ${agentId}`);

    await this.request(`/convai/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        webhook: null,
      }),
    });

    console.log(`✅ Webhook removed from agent`);
  }
}

export const elevenLabsService = new ElevenLabsService();
