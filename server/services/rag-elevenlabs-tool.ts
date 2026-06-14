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
 * RAG ElevenLabs Tool Configuration
 * 
 * Configures the ask_knowledge webhook tool for ElevenLabs agents.
 * When agents need information from the knowledge base, ElevenLabs calls our webhook
 * which triggers a search through the RAG system.
 * 
 * Tool Type: "webhook" (server-side) - ElevenLabs calls our endpoint directly
 * This is required for native Twilio integration since client tools need WebSocket.
 * 
 * IMPORTANT: Tools must be created as workspace-level resources via ElevenLabs Tools API,
 * then linked to agents by tool ID. This makes tools visible in the ElevenLabs dashboard.
 * 
 * Security: Uses a shared secret token in header for webhook authentication
 */

import { RAGKnowledgeService } from "./rag-knowledge";
import { getDomain } from "../utils/domain";
import { ElevenLabsService } from "./elevenlabs";
import { ElevenLabsPoolService } from "./elevenlabs-pool";
import { getAppointmentToolForAgent } from "./appointment-elevenlabs-tool";
import crypto from "crypto";

// Generate or retrieve the RAG webhook secret
// This is used to authenticate requests from ElevenLabs
let ragWebhookSecret: string | null = null;

export function getRAGWebhookSecret(): string {
  if (!ragWebhookSecret) {
    // Use environment variable if set, otherwise generate a new one
    ragWebhookSecret = process.env.RAG_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
    if (!process.env.RAG_WEBHOOK_SECRET) {
      console.log(`📚 [RAG Tool] Generated new webhook secret (set RAG_WEBHOOK_SECRET env var for persistence)`);
    }
  }
  return ragWebhookSecret;
}

export function validateRAGWebhookToken(providedToken: string | undefined): boolean {
  if (!providedToken) {
    return false;
  }
  const secret = getRAGWebhookSecret();
  
  // Ensure both tokens have the same length for timing-safe comparison
  const providedBuffer = Buffer.from(providedToken);
  const secretBuffer = Buffer.from(secret);
  
  if (providedBuffer.length !== secretBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(providedBuffer, secretBuffer);
}

// Webhook tool configuration for ElevenLabs
export interface RAGWebhookToolConfig {
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
}

/**
 * Get the ask_knowledge webhook tool configuration for ElevenLabs
 * @param elevenLabsAgentId - The ElevenLabs agent ID to include in the webhook URL for context
 * 
 * Note: Tool name is unique per agent to prevent reusing tools with wrong URLs
 * Authentication: Token is embedded in URL path (more reliable than custom headers)
 */
export function getAskKnowledgeWebhookTool(elevenLabsAgentId: string): RAGWebhookToolConfig {
  // Build the webhook URL for this agent using ElevenLabs agent ID
  // Token is embedded in URL path for reliable authentication (ElevenLabs doesn't always forward custom headers)
  const domain = getDomain();
  const secret = getRAGWebhookSecret();
  const webhookUrl = `${domain}/api/webhooks/elevenlabs/rag-tool/${secret}/${elevenLabsAgentId}`;
  
  // Use agent-specific tool name to prevent reusing tools with wrong URLs
  // The last 8 chars of agent ID provide uniqueness while keeping name readable
  const agentIdSuffix = elevenLabsAgentId.slice(-8);
  const toolName = `ask_knowledge_${agentIdSuffix}`;
  
  console.log(`📚 [RAG Tool] Creating webhook tool config for ElevenLabs agent ${elevenLabsAgentId}`);
  console.log(`   Tool name: ${toolName}`);
  console.log(`   Webhook URL: ${webhookUrl.replace(secret, '[TOKEN]')}`);
  
  return {
    type: "webhook",
    name: toolName,
    description: "Search the company knowledge base for information. Use this tool when you need to look up specific details, facts, policies, procedures, or any information that might be stored in the knowledge base. Pass the user's question or relevant keywords as the query.",
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      request_body_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query - the question or keywords to search for in the knowledge base"
          }
        },
        required: ["query"]
      }
    }
  };
}

/**
 * Handle ask_knowledge tool call from ElevenLabs
 * This is called when the agent invokes the tool
 */
export async function handleAskKnowledgeToolCall(
  query: string,
  knowledgeBaseIds: string[],
  userId: string
): Promise<{ response: string; sources: Array<{ id: string; relevance: number }> }> {
  console.log(`[RAG Tool] Processing query: "${query.substring(0, 50)}..."`);
  
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
    return {
      response: "No knowledge base is configured for this agent.",
      sources: []
    };
  }

  try {
    const results = await RAGKnowledgeService.searchKnowledge(
      query,
      knowledgeBaseIds,
      userId,
      3 // Top 3 results for concise response
    );

    if (results.length === 0) {
      return {
        response: "I couldn't find any relevant information in the knowledge base for that question.",
        sources: []
      };
    }

    const formattedResponse = RAGKnowledgeService.formatResultsForAgent(results, 400);

    return {
      response: formattedResponse,
      sources: results.map(r => ({
        id: r.chunk.knowledgeBaseId,
        relevance: r.score
      }))
    };
  } catch (error: any) {
    console.error("[RAG Tool] Error:", error.message);
    return {
      response: "I encountered an error searching the knowledge base. Please try again.",
      sources: []
    };
  }
}

/**
 * Check if RAG knowledge system is enabled
 * Defaults to true — the RAG system is the primary KB system used by the frontend.
 * Set USE_RAG_KNOWLEDGE=false to explicitly disable it and use legacy ElevenLabs KB uploads only.
 */
export function isRAGEnabled(): boolean {
  const val = (process.env.USE_RAG_KNOWLEDGE || '').toLowerCase().trim();
  return val !== 'false' && val !== '0' && val !== 'no';
}

/**
 * Create the RAG workspace tool (for dashboard visibility) and add it to an agent
 * 
 * Architecture:
 * 1. Create workspace tool via POST /v1/convai/tools (for ElevenLabs dashboard visibility)
 * 2. Add full inline tool config to agent (ElevenLabs requires full config, not just ID reference)
 * 
 * IMPORTANT: System tools should be passed as an ARRAY with type: "system"
 * Per ElevenLabs API: All tools (system + webhook) go in prompt.tools array
 * 
 * @param elevenLabsAgentId - The ElevenLabs agent ID
 * @param agentId - The internal agent ID (for credential lookup)
 * @param hasKnowledgeBase - Whether the agent has knowledge bases assigned
 * @param systemTools - Optional system tools array to preserve when linking webhook tools
 * @param appointmentBookingEnabled - Whether to include the appointment booking webhook tool
 */
export async function setupRAGToolForAgent(
  elevenLabsAgentId: string,
  agentId: string,
  hasKnowledgeBase: boolean,
  systemTools?: any[],
  appointmentBookingEnabled?: boolean
): Promise<void> {
  if (!isRAGEnabled()) {
    console.log(`📚 [RAG Tool] Skipping - RAG not enabled`);
    return;
  }

  // Get credential for this agent
  const credential = await ElevenLabsPoolService.getCredentialForAgent(agentId);
  if (!credential) {
    console.warn(`📚 [RAG Tool] No credential found for agent ${agentId}`);
    return;
  }

  const elevenLabsService = new ElevenLabsService(credential.apiKey);

  // Build list of webhook tools to include
  const webhookTools: any[] = [];
  
  // Add appointment booking tool if enabled
  if (appointmentBookingEnabled) {
    const appointmentTool = getAppointmentToolForAgent(elevenLabsAgentId);
    webhookTools.push(appointmentTool);
    console.log(`📅 [RAG Tool] Including appointment booking tool: ${appointmentTool.name}`);
  }

  if (!hasKnowledgeBase) {
    // No knowledge base - but still need to link appointment tool if enabled
    if (webhookTools.length === 0) {
      console.log(`📚 [RAG Tool] No knowledge base - clearing webhook tools but preserving system tools`);
    } else {
      console.log(`📚 [RAG Tool] No knowledge base - linking ${webhookTools.length} webhook tool(s) with system tools`);
    }
    try {
      await elevenLabsService.linkToolsToAgent(elevenLabsAgentId, webhookTools, systemTools);
    } catch (error: any) {
      console.warn(`📚 [RAG Tool] Failed to update tools: ${error.message}`);
    }
    return;
  }

  console.log(`📚 [RAG Tool] Setting up RAG tool for agent ${elevenLabsAgentId}`);
  if (systemTools && systemTools.length > 0) {
    console.log(`   Preserving system tools: ${systemTools.map(t => t.name).join(', ')}`);
  }

  try {
    // Get the RAG tool config
    const toolConfig = getAskKnowledgeWebhookTool(elevenLabsAgentId);
    webhookTools.push(toolConfig);

    // Create workspace tool for dashboard visibility (optional, but nice to have)
    try {
      await elevenLabsService.getOrCreateWorkspaceTool(toolConfig);
      console.log(`📚 [RAG Tool] Workspace tool created/verified for dashboard visibility`);
    } catch (wsError: any) {
      console.warn(`📚 [RAG Tool] Workspace tool creation skipped: ${wsError.message}`);
      // Continue - the inline config will still work
    }

    // Add all webhook tools (RAG + appointment if enabled) to the agent
    // Pass systemTools to preserve them (transfer, language detection, end call)
    console.log(`📚 [RAG Tool] Linking ${webhookTools.length} webhook tool(s): ${webhookTools.map(t => t.name).join(', ')}`);
    await elevenLabsService.linkToolsToAgent(elevenLabsAgentId, webhookTools, systemTools);

    console.log(`✅ [RAG Tool] Tool added to agent successfully`);
  } catch (error: any) {
    console.error(`❌ [RAG Tool] Failed to setup RAG tool: ${error.message}`);
    // Don't throw - let agent creation/update continue
  }
}

/**
 * Build tools array for an agent with RAG knowledge base
 * DEPRECATED: Use setupRAGToolForAgent instead for proper workspace tool creation
 * 
 * @param elevenLabsAgentId - The ElevenLabs agent ID for the webhook URL
 * @param hasKnowledgeBase - Whether the agent has knowledge bases assigned
 */
export function buildRAGToolsArray(
  elevenLabsAgentId: string,
  hasKnowledgeBase: boolean
): RAGWebhookToolConfig[] {
  if (!isRAGEnabled() || !hasKnowledgeBase) {
    console.log(`📚 [RAG Tool] Skipping - RAG enabled: ${isRAGEnabled()}, hasKB: ${hasKnowledgeBase}`);
    return [];
  }

  console.log(`📚 [RAG Tool] Building webhook tool for ElevenLabs agent ${elevenLabsAgentId}`);
  return [getAskKnowledgeWebhookTool(elevenLabsAgentId)];
}

export default {
  getAskKnowledgeWebhookTool,
  handleAskKnowledgeToolCall,
  isRAGEnabled,
  buildRAGToolsArray,
  setupRAGToolForAgent,
  getRAGWebhookSecret,
  validateRAGWebhookToken
};
