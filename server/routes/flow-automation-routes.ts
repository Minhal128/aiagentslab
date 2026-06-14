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
import { Router, Response } from "express";
import { db } from "../db";
import { type AuthRequest } from "../middleware/auth";
import {
  flows, createFlowSchema,
  webhooks, createWebhookSchema,
  webhookLogs,
  appointments, createAppointmentSchema,
  appointmentSettings, createAppointmentSettingsSchema,
  forms, createFormSchema,
  formFields, insertFormFieldSchema,
  formSubmissions, insertFormSubmissionSchema,
  flowExecutions, flowTestQueue,
  phoneNumbers, calls, agents, contacts,
  incomingConnections, campaigns,
  plivoPhoneNumbers, plivoCalls,
  sipPhoneNumbers, sipCalls, twilioOpenaiCalls
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { webhookDeliveryService } from "../services/webhook-delivery";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  isCalendarSyncEnabled,
} from "../services/google-calendar/google-calendar.service";
import { flowTemplates } from "../services/flow-templates";
import { storage } from "../storage";
import { ElevenLabsService } from "../services/elevenlabs";
import { ElevenLabsPoolService } from "../services/elevenlabs-pool";
import { FlowAgentService } from "../services/flow-agent";
import { OutboundCallService } from "../services/outbound-call-service";
import { PhoneMigrator } from "../engines/elevenlabs-migration";
import { TwilioOpenAICallService } from "../engines/twilio-openai/services/twilio-openai-call.service";
import { PlivoCallService } from "../engines/plivo/services/plivo-call.service";
import { OpenAIAgentFactory } from "../engines/plivo/services/openai-agent-factory";
import type { CompiledFlowConfig } from "../engines/plivo/types";
import { OpenAIVoiceAgentCompiler } from "../services/openai-voice-agent";
import type { FlowNode, FlowEdge } from "../services/openai-voice-agent";
import { getPluginStatus } from "../plugins/loader";

const router = Router();

// Default working hours - used when user hasn't configured settings
const DEFAULT_WORKING_HOURS: Record<string, { start: string; end: string; enabled: boolean }> = {
  monday: { start: "09:00", end: "17:00", enabled: true },
  tuesday: { start: "09:00", end: "17:00", enabled: true },
  wednesday: { start: "09:00", end: "17:00", enabled: true },
  thursday: { start: "09:00", end: "17:00", enabled: true },
  friday: { start: "09:00", end: "17:00", enabled: true },
  saturday: { start: "09:00", end: "17:00", enabled: false },
  sunday: { start: "09:00", end: "17:00", enabled: false },
};

/**
 * Validates if an appointment date/time falls within the user's working hours settings.
 * Returns { valid: true } if valid, or { valid: false, message: string } if not.
 */
async function validateWorkingHours(
  userId: string,
  appointmentDate: string,
  appointmentTime: string,
  duration: number = 30
): Promise<{ valid: true } | { valid: false; message: string }> {
  try {
    const [userSettings] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, userId));

    // Parse the date to get day of week
    const parsedDate = new Date(appointmentDate + 'T12:00:00');
    if (isNaN(parsedDate.getTime())) {
      console.log(`📅 [Working Hours] Could not parse date: ${appointmentDate}`);
      return {
        valid: false,
        message: `I couldn't understand the date "${appointmentDate}". Please provide a valid date in YYYY-MM-DD format.`
      };
    }

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const dayOfWeek = parsedDate.getDay();
    const dayName = dayNames[dayOfWeek];

    // Merge user settings with defaults per-day
    const userWorkingHours = userSettings?.workingHours as Record<string, { start: string; end: string; enabled: boolean }> | undefined;
    const daySettings = userWorkingHours?.[dayName]
      ? { ...DEFAULT_WORKING_HOURS[dayName], ...userWorkingHours[dayName] }
      : DEFAULT_WORKING_HOURS[dayName];

    console.log(`📅 [Working Hours] Checking ${dayName} (${appointmentDate} ${appointmentTime}):`, daySettings);

    // Check if day is enabled
    if (!daySettings?.enabled) {
      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      console.log(`📅 [Working Hours] Rejected: ${dayName} is not available for appointments`);
      return {
        valid: false,
        message: `We're not available on ${capitalizedDay}s. Please choose a different day.`
      };
    }

    // Parse and check time
    const parseTimeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':');
      if (parts.length !== 2) throw new Error(`Invalid time format: ${timeStr}`);
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (isNaN(hours) || isNaN(minutes)) throw new Error(`Invalid time values: ${timeStr}`);
      return hours * 60 + minutes;
    };

    const requestedMinutes = parseTimeToMinutes(appointmentTime);
    const startMinutes = parseTimeToMinutes(daySettings.start || "09:00");
    const endMinutes = parseTimeToMinutes(daySettings.end || "17:00");
    const appointmentEndMinutes = requestedMinutes + duration;

    if (requestedMinutes < startMinutes || appointmentEndMinutes > endMinutes) {
      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      console.log(`📅 [Working Hours] Rejected: ${appointmentTime} (duration: ${duration}min) is outside working hours (${daySettings.start} - ${daySettings.end})`);
      return {
        valid: false,
        message: `${appointmentTime} is outside our available hours on ${capitalizedDay}. We're available from ${daySettings.start} to ${daySettings.end}.`
      };
    }

    console.log(`📅 [Working Hours] Validated: ${appointmentTime} is within ${daySettings.start} - ${daySettings.end}`);
    return { valid: true };
  } catch (error: any) {
    console.error(`📅 [Working Hours] Validation error:`, error.message);
    return {
      valid: false,
      message: `I'm having trouble validating the appointment time. Please provide the time in HH:MM format (like "14:00" or "2:30 PM").`
    };
  }
}

router.get("/flows", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    const userFlows = await db
      .select()
      .from(flows)
      .where(eq(flows.userId, userId))
      .orderBy(desc(flows.updatedAt));

    res.json(userFlows);
  } catch (error: any) {
    console.error("Error fetching flows:", error);
    res.status(500).json({ error: "Failed to fetch flows" });
  }
});

router.get("/flows/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const [flow] = await db
      .select()
      .from(flows)
      .where(and(eq(flows.id, id), eq(flows.userId, userId)));

    if (!flow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    res.json(flow);
  } catch (error: any) {
    console.error("Error fetching flow:", error);
    res.status(500).json({ error: "Failed to fetch flow" });
  }
});

router.post("/flows", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    // Check flow limit (999 or -1 means unlimited)
    const effectiveLimits = await storage.getUserEffectiveLimits(userId);
    const currentFlowCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(flows)
      .where(eq(flows.userId, userId));

    const flowCount = Number(currentFlowCount[0]?.count || 0);
    // Ensure maxFlows is a concrete number (default to 3 if somehow undefined)
    const maxFlows = typeof effectiveLimits.maxFlows === 'number' ? effectiveLimits.maxFlows : 3;
    // Skip limit check if explicitly unlimited (999 or -1)
    if (maxFlows !== 999 && maxFlows !== -1 && flowCount >= maxFlows) {
      return res.status(403).json({
        error: "Flow limit reached",
        message: `You have reached your maximum of ${maxFlows} flows. Please upgrade your plan or delete existing flows.`,
        limit: maxFlows,
        current: flowCount
      });
    }

    const validatedData = createFlowSchema.parse(req.body);

    const flowId = nanoid();
    // TODO: Drizzle type inference - validatedData from Zod schema doesn't perfectly match
    // the insert type due to optional fields and defaults. Using explicit type assertion.
    const [newFlow] = await db
      .insert(flows)
      .values({
        id: flowId,
        userId,
        ...validatedData,
      } as typeof flows.$inferInsert)
      .returning();

    res.json(newFlow);
  } catch (error: any) {
    console.error("Error creating flow:", error);
    res.status(500).json({ error: "Failed to create flow" });
  }
});

router.patch("/flows/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const [existingFlow] = await db
      .select()
      .from(flows)
      .where(and(eq(flows.id, id), eq(flows.userId, userId)));

    if (!existingFlow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    const [updatedFlow] = await db
      .update(flows)
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(eq(flows.id, id))
      .returning();

    // ── Google Sheets: auto-write header row on flow save ─────────────────────
    // Run fire-and-forget so a Sheets failure never blocks the save response.
    (async () => {
      try {
        const flowNodes = (updatedFlow.nodes || []) as any[];
        const formNodesWithSheet = flowNodes.filter((node: any) => {
          const nodeType = node.data?.type || node.type;
          if (nodeType !== 'form' && nodeType !== 'form_submission' && nodeType !== 'collect_info') return false;
          const cfg = node.data?.config || node.data || {};
          return !!cfg.googleSheetId;
        });

        if (formNodesWithSheet.length > 0) {
          const { ensureSheetHeaders, listSheetTabs } = await import('../services/google-sheets/google-sheets.service');

          for (const node of formNodesWithSheet) {
            const cfg = node.data?.config || node.data || {};
            const sheetId: string = cfg.googleSheetId;
            let sheetName: string = cfg.googleSheetName || '';
            const formId: string = cfg.formId;

            if (!formId) continue;

            // Resolve the worksheet tab name if not explicitly set
            if (!sheetName) {
              try {
                const tabs = await listSheetTabs(userId, sheetId);
                sheetName = tabs.length > 0 ? tabs[0].title : 'Sheet1';
              } catch {
                sheetName = 'Sheet1';
              }
            }

            // Load form fields to build column header labels
            const fields = await db
              .select()
              .from(formFields)
              .where(eq(formFields.formId, formId))
              .orderBy(formFields.order);

            const headerRow = [
              'Contact Name',
              'Contact Phone',
              ...fields.map((f: any) => f.question || f.label || f.id),
              'Call ID',
              'Submitted At',
            ];

            const wrote = await ensureSheetHeaders(userId, sheetId, sheetName, headerRow);
            if (wrote) {
              console.log(`📋 [Flow Save] Google Sheets header row written for form "${formId}" → sheet "${sheetName}" (${sheetId})`);
            }
          }
        }
      } catch (sheetErr: any) {
        console.warn(`📋 [Flow Save] Google Sheets header init failed (non-fatal):`, sheetErr.message);
      }
    })();
    // ──────────────────────────────────────────────────────────────────────────

    const flowAgentId = updatedFlow.agentId || req.body.agentId;
    if (flowAgentId) {
      try {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, flowAgentId));

        if (agent && agent.type === 'flow') {
          // Check if this is an OpenAI-based flow agent (Plivo or Twilio+OpenAI)
          const isOpenAIProvider = agent.telephonyProvider === 'plivo' || agent.telephonyProvider === 'twilio_openai';

          if (isOpenAIProvider) {
            // OpenAI-based flow agents - compile flow using shared OpenAI Voice Agent service
            console.log(`🔄 [Flow Save] OpenAI-based flow agent (${agent.telephonyProvider}) - compiling for OpenAI Realtime`);
            console.log(`   Agent: ${agent.name} (${agent.id})`);
            console.log(`   Flow: ${updatedFlow.name} (${updatedFlow.id})`);
            console.log(`   Voice: ${agent.openaiVoice || 'alloy'}`);

            // Compile flow for OpenAI engines and store in database
            try {
              const flowNodes = (updatedFlow.nodes || []) as FlowNode[];
              const flowEdges = (updatedFlow.edges || []) as FlowEdge[];

              if (flowNodes.length > 0) {
                const compiled = OpenAIVoiceAgentCompiler.compileFlow(flowNodes, flowEdges, {
                  language: agent.language || 'en',
                  voice: agent.openaiVoice || 'alloy',
                  model: agent.openaiModel || 'gpt-realtime-1.5',
                  agentName: agent.name,
                  agentPersonality: agent.systemPrompt || undefined,
                  knowledgeBaseIds: agent.knowledgeBaseIds || [],
                  transferPhoneNumber: agent.transferPhoneNumber || undefined,
                  transferEnabled: agent.transferEnabled || false,
                  endConversationEnabled: agent.endConversationEnabled ?? true,
                });

                await db.update(flows).set({
                  compiledSystemPrompt: compiled.systemPrompt,
                  compiledFirstMessage: compiled.firstMessage || null,
                  compiledStates: compiled.conversationStates,
                  compiledTools: compiled.tools,
                }).where(eq(flows.id, id));

                console.log(`✅ [Flow Save] Compiled for OpenAI: ${compiled.conversationStates.length} states, ${compiled.tools.length} tools`);
              } else {
                console.log(`⚠️ [Flow Save] Flow has no nodes, skipping OpenAI compilation`);
              }
            } catch (compileError: any) {
              console.error(`❌ [Flow Save] OpenAI compilation error:`, compileError.message);
            }
          } else {
            // ElevenLabs/Twilio flow agent - sync to ElevenLabs
            console.log(`🔄 [Flow Save] Syncing Flow agent to ElevenLabs...`);
            console.log(`   Agent: ${agent.name} (${agent.id})`);
            console.log(`   Flow: ${updatedFlow.name} (${updatedFlow.id})`);

            if (!agent.elevenLabsVoiceId) {
              console.log(`⚠️ [Flow Save] Agent missing voice configuration, skipping ElevenLabs sync`);
            } else {
              const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
              if (!credential) {
                console.log(`⚠️ [Flow Save] No ElevenLabs credential found for agent, skipping sync`);
              } else {
                const elevenlabsService = new ElevenLabsService(credential.apiKey);

                let flowNodes = (updatedFlow.nodes || []) as import('@shared/schema').FlowNode[];
                const flowEdges = (updatedFlow.edges || []) as import('@shared/schema').FlowEdge[];

                if (flowNodes.length > 0) {
                  // Enrich form nodes with field definitions from database before compiling
                  flowNodes = await FlowAgentService.enrichFormNodesWithFields(flowNodes);
                  const compileResult = FlowAgentService.compileFlow(flowNodes, flowEdges);
                  const { workflow: compiledWorkflow, firstMessage: flowFirstMessage, hasAppointmentNodes, hasFormNodes, formNodes, hasWebhookNodes, webhookNodes, hasPlayAudioNodes, playAudioNodes } = compileResult;

                  console.log(`   Compiled workflow: ${Object.keys(compiledWorkflow.nodes).length} nodes, ${Object.keys(compiledWorkflow.edges).length} edges`);
                  if (flowFirstMessage) {
                    console.log(`   First message from flow: "${flowFirstMessage.substring(0, 50)}..."`);
                  }
                  if (hasAppointmentNodes) {
                    console.log(`   📅 Flow contains appointment nodes`);
                  }
                  if (hasFormNodes) {
                    console.log(`   📋 Flow contains form nodes (${formNodes?.length || 0} forms)`);
                  }
                  if (hasWebhookNodes) {
                    console.log(`   🔗 Flow contains webhook nodes (${webhookNodes?.length || 0} webhooks)`);
                  }
                  if (hasPlayAudioNodes) {
                    console.log(`   🔊 Flow contains play audio nodes (${playAudioNodes?.length || 0} audio files)`);
                  }

                  if (!agent.elevenLabsAgentId) {
                    console.log(`   Creating new ElevenLabs Flow agent...`);
                    const elevenLabsAgent = await elevenlabsService.createFlowAgent({
                      name: agent.name,
                      voice_id: agent.elevenLabsVoiceId,
                      language: agent.language || 'en',
                      maxDurationSeconds: agent.maxDurationSeconds || 900,
                      detectLanguageEnabled: agent.detectLanguageEnabled || false,
                      workflow: compiledWorkflow,
                      firstMessage: flowFirstMessage,
                    });

                    await db
                      .update(agents)
                      .set({ elevenLabsAgentId: elevenLabsAgent.agent_id })
                      .where(eq(agents.id, agent.id));

                    console.log(`✅ [Flow Save] Created ElevenLabs agent: ${elevenLabsAgent.agent_id}`);

                    // Build webhook tools array for new agents
                    let newAgentWebhookTools: any[] = [];

                    // Add RAG tool if agent has knowledge bases assigned
                    if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
                      const { isRAGEnabled, getAskKnowledgeWebhookTool } = await import('../services/rag-elevenlabs-tool');
                      if (isRAGEnabled()) {
                        const ragTool = getAskKnowledgeWebhookTool(elevenLabsAgent.agent_id);
                        newAgentWebhookTools.push(ragTool);
                        console.log(`📚 [Flow Save] Adding RAG knowledge tool to new agent`);
                      }
                    }

                    // Add appointment booking tool if flow has appointment nodes
                    if (hasAppointmentNodes) {
                      console.log(`📅 [Flow Save] Adding appointment booking tool to agent ${elevenLabsAgent.agent_id}`);
                      const { getAppointmentToolForAgent } = await import('../services/appointment-elevenlabs-tool');
                      const appointmentTool = getAppointmentToolForAgent(elevenLabsAgent.agent_id);
                      newAgentWebhookTools.push(appointmentTool);
                    }

                    // Add form submission tools if flow has form nodes
                    if (hasFormNodes && formNodes && formNodes.length > 0) {
                      console.log(`📋 [Flow Save] Adding form submission tools (${formNodes.length} forms) to agent ${elevenLabsAgent.agent_id}`);
                      const { getSubmitFormWebhookTool } = await import('../services/form-elevenlabs-tool');
                      for (const formInfo of formNodes) {
                        const formTool = getSubmitFormWebhookTool(
                          formInfo.formId,
                          formInfo.formName,
                          formInfo.fields,
                          elevenLabsAgent.agent_id,
                          formInfo.nodeId
                        );
                        newAgentWebhookTools.push(formTool);
                        console.log(`   📋 Added submit_form tool for "${formInfo.formName}" nodeId: ${formInfo.nodeId || 'n/a'}`);
                      }
                    }

                    // Add messaging tools for send_email/send_whatsapp nodes in the flow
                    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
                      const { buildMessagingEmailTool, buildMessagingWhatsappTool } = await import('../services/elevenlabs');
                      for (const webhookNode of webhookNodes) {
                        if (webhookNode.toolId.startsWith('send_email_') && !webhookNode.url) {
                          const templateName = webhookNode.payload?.template_name || 'default';
                          const emailTool = buildMessagingEmailTool(elevenLabsAgent.agent_id, [templateName], templateName);
                          emailTool.name = webhookNode.toolId;
                          newAgentWebhookTools.push(emailTool);
                          console.log(`   📧 Added email messaging tool: ${webhookNode.toolId} -> template="${templateName}"`);
                        } else if (webhookNode.toolId.startsWith('send_whatsapp_') && !webhookNode.url) {
                          const templateName = webhookNode.payload?.template_name || 'hello_world';
                          const whatsappTool = buildMessagingWhatsappTool(elevenLabsAgent.agent_id, [templateName], templateName);
                          whatsappTool.name = webhookNode.toolId;
                          newAgentWebhookTools.push(whatsappTool);
                          console.log(`   💬 Added WhatsApp messaging tool: ${webhookNode.toolId} -> template="${templateName}"`);
                        }
                      }
                    }

                    // Add custom webhook tools from flow builder (user-defined webhooks)
                    // Uses universal webhook builder to automatically include caller phone, conversation data, etc.
                    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
                      console.log(`🔗 [Flow Save] Adding universal webhook tools (${webhookNodes.length} webhooks) to agent ${elevenLabsAgent.agent_id}`);
                      const { buildUniversalWebhookTool } = await import('../services/universal-webhook-tool');
                      for (const webhookNode of webhookNodes) {
                        if (webhookNode.url) {
                          const webhookTool = buildUniversalWebhookTool({
                            toolId: webhookNode.toolId,
                            url: webhookNode.url,
                            method: webhookNode.method || 'POST',
                            headers: webhookNode.headers,
                            payload: webhookNode.payload
                          });
                          newAgentWebhookTools.push(webhookTool);
                          console.log(`   🔗 Added universal webhook tool: ${webhookNode.toolId} -> ${webhookNode.method} ${webhookNode.url}`);
                        }
                      }
                    }

                    // Add play audio tools if flow has play_audio nodes
                    if (hasPlayAudioNodes && playAudioNodes && playAudioNodes.length > 0) {
                      console.log(`🔊 [Flow Save] Adding play audio tools (${playAudioNodes.length} nodes) to agent ${elevenLabsAgent.agent_id}`);
                      const { getPlayAudioWebhookTool } = await import('../services/play-audio-elevenlabs-tool');
                      for (const playAudioNode of playAudioNodes) {
                        const playAudioTool = getPlayAudioWebhookTool(
                          playAudioNode.nodeId,
                          playAudioNode.audioUrl,
                          playAudioNode.audioFileName,
                          playAudioNode.interruptible,
                          playAudioNode.waitForComplete,
                          elevenLabsAgent.agent_id
                        );
                        newAgentWebhookTools.push(playAudioTool);
                        console.log(`   🔊 Added play audio tool: ${playAudioTool.name}`);
                      }
                    }

                    // Update agent with webhook tools if any
                    if (newAgentWebhookTools.length > 0) {
                      try {
                        await elevenlabsService.updateFlowAgentWorkflow(
                          elevenLabsAgent.agent_id,
                          compiledWorkflow,
                          agent.maxDurationSeconds || 900,
                          undefined, // detectLanguageEnabled
                          undefined, // language
                          undefined, // ttsModel
                          undefined, // llmModel
                          undefined, // temperature
                          undefined, // firstMessage
                          undefined, // voiceId
                          { webhookTools: newAgentWebhookTools }
                        );
                        console.log(`✅ [Flow Save] Webhook tools added (${newAgentWebhookTools.length} tools)`);
                      } catch (toolError: any) {
                        console.error(`❌ [Flow Save] Failed to add webhook tools:`, toolError.message);
                      }
                    }
                  } else {
                    console.log(`   Updating existing ElevenLabs agent: ${agent.elevenLabsAgentId}`);

                    // Build webhook tools array
                    let webhookTools: any[] = [];

                    // Add RAG tool if agent has knowledge bases assigned
                    // This ensures KB tool is retained when flow is saved from flow editor
                    if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
                      const { isRAGEnabled, getAskKnowledgeWebhookTool } = await import('../services/rag-elevenlabs-tool');
                      if (isRAGEnabled()) {
                        const ragTool = getAskKnowledgeWebhookTool(agent.elevenLabsAgentId);
                        webhookTools.push(ragTool);
                        console.log(`📚 [Flow Save] Including RAG knowledge tool in update`);
                      }
                    }

                    if (hasAppointmentNodes) {
                      const { getAppointmentToolForAgent } = await import('../services/appointment-elevenlabs-tool');
                      const appointmentTool = getAppointmentToolForAgent(agent.elevenLabsAgentId);
                      webhookTools.push(appointmentTool);
                      console.log(`📅 [Flow Save] Including appointment booking tool in update`);
                    }

                    // Add form submission tools if flow has form nodes
                    if (hasFormNodes && formNodes && formNodes.length > 0) {
                      console.log(`📋 [Flow Save] Including form submission tools (${formNodes.length} forms) in update`);
                      const { getSubmitFormWebhookTool } = await import('../services/form-elevenlabs-tool');
                      for (const formInfo of formNodes) {
                        const formTool = getSubmitFormWebhookTool(
                          formInfo.formId,
                          formInfo.formName,
                          formInfo.fields,
                          agent.elevenLabsAgentId,
                          formInfo.nodeId
                        );
                        webhookTools.push(formTool);
                        console.log(`   📋 Added submit_form tool for "${formInfo.formName}" nodeId: ${formInfo.nodeId || 'n/a'}`);
                      }
                    }

                    // Add messaging tools for send_email/send_whatsapp nodes in the flow (update path)
                    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
                      const { buildMessagingEmailTool, buildMessagingWhatsappTool } = await import('../services/elevenlabs');
                      for (const webhookNode of webhookNodes) {
                        if (webhookNode.toolId.startsWith('send_email_') && !webhookNode.url) {
                          const templateName = webhookNode.payload?.template_name || 'default';
                          const emailTool = buildMessagingEmailTool(agent.elevenLabsAgentId, [templateName], templateName);
                          emailTool.name = webhookNode.toolId;
                          webhookTools.push(emailTool);
                          console.log(`   📧 Added email messaging tool: ${webhookNode.toolId} -> template="${templateName}"`);
                        } else if (webhookNode.toolId.startsWith('send_whatsapp_') && !webhookNode.url) {
                          const templateName = webhookNode.payload?.template_name || 'hello_world';
                          const whatsappTool = buildMessagingWhatsappTool(agent.elevenLabsAgentId, [templateName], templateName);
                          whatsappTool.name = webhookNode.toolId;
                          webhookTools.push(whatsappTool);
                          console.log(`   💬 Added WhatsApp messaging tool: ${webhookNode.toolId} -> template="${templateName}"`);
                        }
                      }
                    }

                    // Add custom webhook tools from flow builder (user-defined webhooks)
                    // Uses universal webhook builder to automatically include caller phone, conversation data, etc.
                    if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
                      console.log(`🔗 [Flow Save] Including universal webhook tools (${webhookNodes.length} webhooks) in update`);
                      const { buildUniversalWebhookTool } = await import('../services/universal-webhook-tool');
                      for (const webhookNode of webhookNodes) {
                        if (webhookNode.url) {
                          const webhookTool = buildUniversalWebhookTool({
                            toolId: webhookNode.toolId,
                            url: webhookNode.url,
                            method: webhookNode.method || 'POST',
                            headers: webhookNode.headers,
                            payload: webhookNode.payload
                          });
                          webhookTools.push(webhookTool);
                          console.log(`   🔗 Added universal webhook tool: ${webhookNode.toolId} -> ${webhookNode.method} ${webhookNode.url}`);
                        }
                      }
                    }

                    // Add play audio tools if flow has play_audio nodes
                    if (hasPlayAudioNodes && playAudioNodes && playAudioNodes.length > 0) {
                      console.log(`🔊 [Flow Save] Including play audio tools (${playAudioNodes.length} nodes) in update`);
                      const { getPlayAudioWebhookTool } = await import('../services/play-audio-elevenlabs-tool');
                      for (const playAudioNode of playAudioNodes) {
                        const playAudioTool = getPlayAudioWebhookTool(
                          playAudioNode.nodeId,
                          playAudioNode.audioUrl,
                          playAudioNode.audioFileName,
                          playAudioNode.interruptible,
                          playAudioNode.waitForComplete,
                          agent.elevenLabsAgentId
                        );
                        webhookTools.push(playAudioTool);
                        console.log(`   🔊 Added play audio tool: ${playAudioTool.name}`);
                      }
                    }

                    await elevenlabsService.updateFlowAgentWorkflow(
                      agent.elevenLabsAgentId,
                      compiledWorkflow,
                      agent.maxDurationSeconds || 900,
                      agent.detectLanguageEnabled || false,
                      agent.language || undefined,
                      undefined, // ttsModel
                      undefined, // llmModel
                      undefined, // temperature
                      flowFirstMessage,
                      undefined, // voiceId
                      webhookTools.length > 0 ? { webhookTools } : undefined
                    );

                    console.log(`✅ [Flow Save] Updated ElevenLabs agent workflow`);
                    if (webhookTools.length > 0) {
                      console.log(`   📦 Included ${webhookTools.length} webhook tools`);
                    }
                  }
                } else {
                  console.log(`⚠️ [Flow Save] Flow has no nodes, skipping ElevenLabs sync`);
                }
              }
            }
          }
        }
      } catch (syncError: any) {
        console.error(`❌ [Flow Save] ElevenLabs sync error:`, syncError.message);
      }
    }

    res.json(updatedFlow);
  } catch (error: any) {
    console.error("Error updating flow:", error);
    res.status(500).json({ error: "Failed to update flow" });
  }
});

router.delete("/flows/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    // Verify the flow belongs to this user before touching related records
    const [existingFlow] = await db
      .select({ id: flows.id })
      .from(flows)
      .where(and(eq(flows.id, id), eq(flows.userId, userId)))
      .limit(1);

    if (!existingFlow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    // Remove FK-constrained child records before deleting the flow row.
    // flowExecutions.flowId: NOT NULL + NO ACTION → must be hard-deleted first.
    // flowTestQueue.flowId: NOT NULL + CASCADE → handled by DB, but deleted
    //   explicitly here for clarity.
    // appointments.flowId + agents.flowId: nullable + NO ACTION → nullified.
    await db.delete(flowTestQueue).where(eq(flowTestQueue.flowId, id));
    await db.delete(flowExecutions).where(eq(flowExecutions.flowId, id));
    await db.update(appointments).set({ flowId: null }).where(eq(appointments.flowId, id));
    await db.update(agents).set({ flowId: null }).where(eq(agents.flowId, id));

    await db.delete(flows).where(eq(flows.id, id));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting flow:", error);
    res.status(500).json({ error: "This flow cannot be deleted — please try again or contact support." });
  }
});

// Admin endpoint to resync a flow agent's first message to ElevenLabs
// This is useful when the ElevenLabs agent's first_message doesn't match the flow's compiled message
router.post("/flows/:id/resync-first-message", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const [flow] = await db
      .select()
      .from(flows)
      .where(eq(flows.id, id))
      .limit(1);

    if (!flow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, flow.agentId as string))
      .limit(1);

    if (!agent?.elevenLabsAgentId) {
      return res.status(400).json({ error: "Agent not synced with ElevenLabs" });
    }

    // Get the correct first message from flow nodes (entry node message)
    const flowNodes = (flow.nodes || []) as any[];
    let firstMessageFromFlow = flow.compiledFirstMessage as string | null;

    // If no compiled first message, extract from entry node
    if (!firstMessageFromFlow && flowNodes.length > 0) {
      const entryNode = flowNodes.find((n: any) => n.type === 'message' && n.data?.isEntry);
      if (entryNode?.data?.config?.message) {
        firstMessageFromFlow = entryNode.data.config.message;
      } else {
        // Try first node as entry
        const firstNode = flowNodes[0];
        if (firstNode?.data?.config?.message) {
          firstMessageFromFlow = firstNode.data.config.message;
        }
      }
    }

    if (!firstMessageFromFlow) {
      return res.status(400).json({ error: "No first message found in flow" });
    }

    console.log(`📝 [Resync] Updating ElevenLabs agent ${agent.elevenLabsAgentId} first_message`);
    console.log(`   Current flow compiled_first_message: "${firstMessageFromFlow}"`);

    // Get ElevenLabs credential and update agent
    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      return res.status(400).json({ error: "No ElevenLabs credential found for agent" });
    }

    const elevenlabsService = new ElevenLabsService(credential.apiKey);
    await elevenlabsService.updateAgent(agent.elevenLabsAgentId, {
      first_message: firstMessageFromFlow,
    });

    console.log(`✅ [Resync] Successfully updated ElevenLabs agent first_message`);

    res.json({
      success: true,
      message: "First message resynced to ElevenLabs",
      firstMessage: firstMessageFromFlow
    });
  } catch (error: any) {
    console.error("Error resyncing first message:", error);
    res.status(500).json({ error: "Failed to resync first message" });
  }
});

class FlowTestHttpError extends Error {
  constructor(public statusCode: number, public body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'Flow test error');
  }
}

async function placeFlowTestCall({
  userId,
  flowId,
  toPhone,
  queueEntryId,
}: {
  userId: string;
  flowId: string;
  toPhone: string;
  queueEntryId?: string;
}): Promise<Record<string, unknown>> {
  const phoneNumber = toPhone;
  const id = flowId;

  let queueProcessed = false;
  const completeQueue = async (resolvedCallId: string) => {
    if (!queueEntryId || queueProcessed) return;
    queueProcessed = true;
    try {
      await db.update(flowTestQueue)
        .set({ status: 'completed', callId: resolvedCallId, processedAt: new Date() })
        .where(and(
          eq(flowTestQueue.id, queueEntryId),
          eq(flowTestQueue.userId, userId),
          eq(flowTestQueue.status, 'processing')
        ));
    } catch (e) { console.error('[Queue] Failed to mark completed:', e); }
  };
  const failQueue = async (reason: string) => {
    if (!queueEntryId || queueProcessed) return;
    queueProcessed = true;
    try {
      await db.update(flowTestQueue)
        .set({ status: 'failed', errorMessage: reason, processedAt: new Date() })
        .where(and(
          eq(flowTestQueue.id, queueEntryId),
          eq(flowTestQueue.userId, userId),
          eq(flowTestQueue.status, 'processing')
        ));
    } catch (e) { console.error('[Queue] Failed to mark failed:', e); }
  };

  try {

    const [flow] = await db
      .select()
      .from(flows)
      .where(and(eq(flows.id, id), eq(flows.userId, userId)));

    if (!flow) {
      throw new FlowTestHttpError(404, { error: "Flow not found" });
    }

    if (!flow.isActive) {
      throw new FlowTestHttpError(400, { error: "Flow must be active to test" });
    }

    if (!flow.agentId) {
      throw new FlowTestHttpError(400, {
        error: "Flow must have an agent assigned before testing",
        message: "Please assign an agent to this flow in the flow builder settings.",
      });
    }

    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, flow.agentId));

    if (!agent) {
      throw new FlowTestHttpError(400, {
        error: "Agent not found",
        message: "The agent assigned to this flow no longer exists.",
      });
    }

    // ========================================
    // ELEVENLABS SIP PATH - Uses SIP phone numbers from plugin
    // Must be checked BEFORE regular phone number selection
    // ========================================
    if (agent.telephonyProvider === 'elevenlabs-sip') {
      console.log(`📞 [Flow Test] ElevenLabs SIP agent detected, using SIP phone numbers`);

      const plugins = await getPluginStatus();
      const sipPlugin = plugins.find(p => p.name === 'sip-engine');
      if (!sipPlugin?.enabled) {
        throw new FlowTestHttpError(400, {
          error: "SIP Engine plugin not enabled",
          message: "The SIP Engine plugin must be enabled to use ElevenLabs SIP agents. Please contact your administrator.",
        });
      }

      // Auto-select user's first available SIP phone number with ElevenLabs engine
      const [sipPhone] = await db
        .select()
        .from(sipPhoneNumbers)
        .where(and(
          eq(sipPhoneNumbers.userId, userId),
          eq(sipPhoneNumbers.engine, 'elevenlabs-sip'),
          eq(sipPhoneNumbers.isActive, true),
          eq(sipPhoneNumbers.outboundEnabled, true)
        ))
        .limit(1);

      if (!sipPhone) {
        throw new FlowTestHttpError(400, {
          error: "No SIP phone number available",
          message: "Please import a phone number from your SIP trunk in the Phone Numbers section before making test calls.",
        });
      }

      if (!sipPhone.externalElevenLabsPhoneId) {
        throw new FlowTestHttpError(400, {
          error: "SIP phone number not provisioned",
          message: "This SIP phone number has not been provisioned with ElevenLabs. Please check your SIP trunk configuration.",
        });
      }

      if (!agent.elevenLabsAgentId) {
        throw new FlowTestHttpError(400, {
          error: "Agent not synced with ElevenLabs",
          message: "Please configure and sync the agent with ElevenLabs in the Agents section first.",
        });
      }

      try {
        // Use the plugin's ElevenLabsSipService.makeOutboundCall
        const { importPlugin } = await import('../utils/plugin-import');
        const { ElevenLabsSipService } = await importPlugin('plugins/sip-engine/services/elevenlabs-sip.service.ts');

        console.log(`📞 [Flow Test] Initiating SIP test call via ElevenLabs SIP Trunk API`);
        console.log(`   From SIP Phone: ${sipPhone.phoneNumber} (ElevenLabs ID: ${sipPhone.externalElevenLabsPhoneId})`);
        console.log(`   To: ${phoneNumber}`);
        console.log(`   Agent (ElevenLabs ID): ${agent.elevenLabsAgentId}`);

        // Extract dynamic variable placeholders from flow's first message
        // For test calls without a contact, pass placeholder values so ElevenLabs doesn't reject
        let sipFlowFirstMessage = '';
        if (flow.compiledFirstMessage) {
          sipFlowFirstMessage = flow.compiledFirstMessage as string;
        } else {
          const sipFirstMsgNode = (flow.nodes as any[]).find((n: any) => n.type === 'message');
          if (sipFirstMsgNode?.data?.config?.message) {
            sipFlowFirstMessage = sipFirstMsgNode.data.config.message;
          } else if (sipFirstMsgNode?.data?.message) {
            sipFlowFirstMessage = sipFirstMsgNode.data.message;
          } else {
            sipFlowFirstMessage = agent.firstMessage || '';
          }
        }
        console.log(`   [SIP Test] First message for variable extraction: "${sipFlowFirstMessage?.substring(0, 80)}..."`);

        const sipVarPattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        const sipDynamicVars: Record<string, string> = {};
        let sipMatch;
        while ((sipMatch = sipVarPattern.exec(sipFlowFirstMessage)) !== null) {
          const varName = sipMatch[1];
          if (varName === 'contact_name' || varName === 'name') {
            sipDynamicVars[varName] = 'Test User';
          } else if (varName === 'contact_first_name' || varName === 'first_name' || varName === 'firstName') {
            sipDynamicVars[varName] = 'Test';
          } else if (varName === 'contact_last_name' || varName === 'last_name' || varName === 'lastName') {
            sipDynamicVars[varName] = 'User';
          } else if (varName === 'contact_phone' || varName === 'phone') {
            sipDynamicVars[varName] = phoneNumber;
          } else if (varName === 'contact_email' || varName === 'email') {
            sipDynamicVars[varName] = 'test@example.com';
          } else {
            sipDynamicVars[varName] = `[${varName}]`;
          }
        }

        if (Object.keys(sipDynamicVars).length > 0) {
          console.log(`   Detected dynamic variables in first message, passing placeholders:`, JSON.stringify(sipDynamicVars));
        }

        // Always ensure contact_phone is in dynamic vars — prevents the agent asking
        // the caller for their own number during form collection.
        if (!sipDynamicVars.contact_phone && !sipDynamicVars.phone) {
          sipDynamicVars.contact_phone = phoneNumber;
        }

        const sipClientData: Record<string, unknown> = {
          source: 'flow_test',
          flowId: flow.id,
          flowName: flow.name,
          testCall: true,
        };
        sipClientData.dynamic_variables = sipDynamicVars;

        const result = await ElevenLabsSipService.makeOutboundCall(
          userId,
          sipPhone as any,
          phoneNumber,
          agent.id,
          sipClientData
        );

        if (!result.success) {
          throw new FlowTestHttpError(400, {
            error: "SIP call initiation failed",
            message: result.error || "Failed to initiate call via ElevenLabs SIP Trunk",
          });
        }

        console.log(`✅ [Flow Test] ElevenLabs SIP outbound call initiated`);
        console.log(`   Conversation ID: ${result.conversationId}`);
        console.log(`   Call ID: ${result.callId}`);

        // Create SIP call record
        const [insertedSipCall] = await db.insert(sipCalls).values({
          sipPhoneNumberId: sipPhone.id,
          userId: userId,
          agentId: agent.id,
          direction: 'outbound',
          engine: 'elevenlabs-sip',
          toNumber: phoneNumber,
          fromNumber: sipPhone.phoneNumber,
          externalCallId: result.conversationId || result.callId || null,
          status: 'initiated',
          startedAt: new Date(),
          metadata: {
            source: 'flow_test',
            flowId: flow.id,
            flowName: flow.name,
            testCall: true,
            conversationId: result.conversationId,
          },
        }).returning();

        // Create flow execution record
        await db.insert(flowExecutions).values({
          id: nanoid(),
          callId: insertedSipCall.id,
          flowId: flow.id,
          currentNodeId: null,
          status: 'running',
          variables: {},
          pathTaken: [],
          startedAt: new Date(),
          metadata: {
            campaignId: null,
            campaignName: null,
            contactPhone: phoneNumber,
            nativeExecution: true,
            telephonyProvider: 'elevenlabs-sip',
            testCall: true,
            conversationId: result.conversationId,
          },
        });

        await completeQueue(insertedSipCall.id);
        return {
          success: true,
          callId: insertedSipCall.id,
          conversationId: result.conversationId,
          callSid: result.callId,
          flowId: flow.id,
          flowName: flow.name,
          fromNumber: sipPhone.phoneNumber,
          toNumber: phoneNumber,
          message: "Test call initiated successfully via ElevenLabs SIP Trunk. The agent will execute the workflow.",
          engine: 'elevenlabs_sip',
        };

      } catch (sipError: any) {
        console.error(`❌ [Flow Test] ElevenLabs SIP call error:`, sipError);
        throw new FlowTestHttpError(400, {
          error: "SIP call initiation failed",
          message: "Failed to initiate call via ElevenLabs SIP Trunk",
        });
      }
    }

    // ========================================
    // SIMPLE PHONE NUMBER SELECTION (for non-SIP engines)
    // Match agent's telephonyProvider to the correct phone table
    // ========================================

    // Get all phone numbers connected to incoming agents (to exclude them)
    const incomingConnectedPhoneIds = await db
      .select({ phoneNumberId: incomingConnections.phoneNumberId })
      .from(incomingConnections);
    const connectedPhoneIdSet = new Set(incomingConnectedPhoneIds.map(ic => ic.phoneNumberId));

    // Helper to get connected agent names for error messages
    const getConnectedAgentNames = async (phoneIds: string[]) => {
      if (phoneIds.length === 0) return "";
      const connectedAgents = await db
        .select({ name: agents.name })
        .from(agents)
        .innerJoin(incomingConnections, eq(incomingConnections.agentId, agents.id))
        .where(inArray(incomingConnections.phoneNumberId, phoneIds));
      return connectedAgents.map(a => a.name).join(", ");
    };

    let fromPhone: any;

    // ========================================
    // PLIVO AGENT - Use Plivo phone numbers only
    // ========================================
    if (agent.telephonyProvider === 'plivo') {
      console.log(`📞 [Flow Test] Plivo agent detected, looking for Plivo phone numbers`);

      const userPlivoPhones = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(and(
          eq(plivoPhoneNumbers.userId, userId),
          eq(plivoPhoneNumbers.status, 'active')
        ));

      if (userPlivoPhones.length === 0) {
        throw new FlowTestHttpError(400, {
          error: "No Plivo phone number available",
          message: "This agent uses Plivo + OpenAI Realtime but you don't have any Plivo phone numbers. Please purchase a Plivo phone number in the Phone Numbers section.",
          needsPhonePurchase: true,
          provider: 'plivo',
        });
      }

      // Use first available Plivo phone (Plivo phones don't have incoming connections like Twilio)
      fromPhone = userPlivoPhones[0];
      console.log(`📞 [Flow Test] Using Plivo phone: ${fromPhone.phoneNumber}`);
    }

    // ========================================
    // TWILIO+OPENAI AGENT - Use Twilio phone numbers only
    // ========================================
    else if (agent.telephonyProvider === 'twilio_openai') {
      console.log(`📞 [Flow Test] Twilio+OpenAI agent detected, looking for Twilio phone numbers`);

      const userTwilioPhones = await db
        .select()
        .from(phoneNumbers)
        .where(and(
          eq(phoneNumbers.userId, userId),
          inArray(phoneNumbers.status, ["active", "assigned"])
        ));

      if (userTwilioPhones.length === 0) {
        // No user phones, check system pool
        const systemPoolPhones = await db
          .select()
          .from(phoneNumbers)
          .where(and(
            eq(phoneNumbers.isSystemPool, true),
            eq(phoneNumbers.status, "available"),
            isNull(phoneNumbers.userId)
          ))
          .orderBy(desc(phoneNumbers.purchasedAt));

        const availableSystemPhones = systemPoolPhones.filter(p => !connectedPhoneIdSet.has(p.id));

        if (availableSystemPhones.length > 0) {
          // Check which pool numbers are currently busy (have active calls)
          const activeCallRows = await db
            .select({ fromNumber: calls.fromNumber })
            .from(calls)
            .where(inArray(calls.status, ['pending', 'initiated', 'ringing', 'in-progress']));
          const busyNumbers = new Set(activeCallRows.map(r => r.fromNumber).filter(Boolean));
          const freeSystemPhones = availableSystemPhones.filter(p => !busyNumbers.has(p.phoneNumber));

          if (freeSystemPhones.length === 0) {
            if (queueEntryId) {
              await failQueue("All phone numbers became busy. Please try again.");
              throw new FlowTestHttpError(503, {
                error: "No phone numbers available",
                message: "All phone numbers became busy. Please try again in a moment.",
              });
            }
            const [queueEntry] = await db.insert(flowTestQueue).values({
              userId,
              flowId: flow.id,
              toPhone: phoneNumber,
              status: 'waiting',
            }).returning();
            const [{ count }] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(flowTestQueue)
              .where(eq(flowTestQueue.status, 'waiting'));
            console.log(`⏳ [Flow Test] All pool numbers busy, queued as entry ${queueEntry.id} (position ${count})`);
            throw new FlowTestHttpError(202, {
              queued: true,
              queueEntryId: queueEntry.id,
              position: count ?? 1,
              message: "All phone numbers are currently busy. You have been added to the queue.",
            });
          }

          fromPhone = freeSystemPhones[0];
          console.log(`📞 [Flow Test] Using system pool Twilio phone: ${fromPhone.phoneNumber}`);
        } else {
          throw new FlowTestHttpError(400, {
            error: "No Twilio phone number available",
            message: "This agent uses Twilio + OpenAI Realtime but you don't have any Twilio phone numbers available. Please purchase a Twilio phone number in the Phone Numbers section.",
            needsPhonePurchase: true,
            provider: 'twilio',
          });
        }
      } else {
        const availableUserPhones = userTwilioPhones.filter(p => !connectedPhoneIdSet.has(p.id));
        if (availableUserPhones.length > 0) {
          fromPhone = availableUserPhones[0];
          console.log(`📞 [Flow Test] Using Twilio phone: ${fromPhone.phoneNumber}`);
        } else {
          const agentNames = await getConnectedAgentNames(userTwilioPhones.map(p => p.id));
          throw new FlowTestHttpError(409, {
            error: "Phone number conflict",
            message: `All your Twilio phone numbers are connected to incoming agents (${agentNames}). A phone number can only be used for either incoming calls OR outbound campaigns/tests, not both.`,
            suggestion: "Please purchase a new Twilio phone number for outbound calls, or disconnect one of your numbers from the incoming agent first.",
            conflictType: "incoming_connection",
            connectedAgentName: agentNames,
          });
        }
      }
    }

    // ELEVENLABS AGENT (default) - Use Twilio phone numbers
    else {
      console.log(`📞 [Flow Test] ElevenLabs agent detected, looking for Twilio phone numbers`);

      const userTwilioPhones = await db
        .select()
        .from(phoneNumbers)
        .where(and(
          eq(phoneNumbers.userId, userId),
          inArray(phoneNumbers.status, ["active", "assigned"])
        ));

      if (userTwilioPhones.length === 0) {
        // No user phones, check system pool
        const systemPoolPhones = await db
          .select()
          .from(phoneNumbers)
          .where(and(
            eq(phoneNumbers.isSystemPool, true),
            eq(phoneNumbers.status, "available"),
            isNull(phoneNumbers.userId)
          ))
          .orderBy(desc(phoneNumbers.purchasedAt));

        const availableSystemPhones = systemPoolPhones.filter(p => !connectedPhoneIdSet.has(p.id));

        if (availableSystemPhones.length > 0) {
          // Check which pool numbers are currently busy (have active calls)
          const activeCallRows = await db
            .select({ fromNumber: calls.fromNumber })
            .from(calls)
            .where(inArray(calls.status, ['pending', 'initiated', 'ringing', 'in-progress']));
          const busyNumbers = new Set(activeCallRows.map(r => r.fromNumber).filter(Boolean));
          const freeSystemPhones = availableSystemPhones.filter(p => !busyNumbers.has(p.phoneNumber));

          if (freeSystemPhones.length === 0) {
            if (queueEntryId) {
              await failQueue("All phone numbers became busy. Please try again.");
              throw new FlowTestHttpError(503, {
                error: "No phone numbers available",
                message: "All phone numbers became busy. Please try again in a moment.",
              });
            }
            const [queueEntry] = await db.insert(flowTestQueue).values({
              userId,
              flowId: flow.id,
              toPhone: phoneNumber,
              status: 'waiting',
            }).returning();
            const [{ count }] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(flowTestQueue)
              .where(eq(flowTestQueue.status, 'waiting'));
            console.log(`⏳ [Flow Test] All pool numbers busy, queued as entry ${queueEntry.id} (position ${count})`);
            throw new FlowTestHttpError(202, {
              queued: true,
              queueEntryId: queueEntry.id,
              position: count ?? 1,
              message: "All phone numbers are currently busy. You have been added to the queue.",
            });
          }

          fromPhone = freeSystemPhones[0];
          console.log(`📞 [Flow Test] Using system pool Twilio phone: ${fromPhone.phoneNumber}`);
        } else {
          throw new FlowTestHttpError(400, {
            error: "No phone number available",
            message: "You need to purchase or rent a phone number before making test calls. Visit the Phone Numbers page to get started.",
            needsPhonePurchase: true,
            provider: 'twilio',
          });
        }
      } else {
        const availableUserPhones = userTwilioPhones.filter(p => !connectedPhoneIdSet.has(p.id));
        if (availableUserPhones.length > 0) {
          fromPhone = availableUserPhones[0];
          console.log(`📞 [Flow Test] Using Twilio phone: ${fromPhone.phoneNumber}`);
        } else {
          const agentNames = await getConnectedAgentNames(userTwilioPhones.map(p => p.id));
          throw new FlowTestHttpError(409, {
            error: "Phone number conflict",
            message: `All your Twilio phone numbers are connected to incoming agents (${agentNames}). A phone number can only be used for either incoming calls OR outbound campaigns/tests, not both.`,
            suggestion: "Please purchase a new Twilio phone number for outbound calls, or disconnect one of your numbers from the incoming agent first.",
            conflictType: "incoming_connection",
            connectedAgentName: agentNames,
          });
        }
      }
    }

    // ========================================
    // CHECK FOR ACTIVE CAMPAIGN WARNING
    // Warn user if selected phone is attached to an active/running campaign
    // ========================================
    let activeCampaignWarning: { message: string; campaignName: string } | null = null;

    const activeCampaignsUsingPhone = await db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.phoneNumberId, fromPhone.id),
          inArray(campaigns.status, ["running", "active", "in_progress"])
        )
      );

    if (activeCampaignsUsingPhone.length > 0) {
      const campaignNames = activeCampaignsUsingPhone.map(c => c.name).join(", ");
      activeCampaignWarning = {
        message: `Warning: This phone number is currently being used by an active campaign (${campaignNames}). Running this test may affect the ongoing campaign.`,
        campaignName: campaignNames
      };
      console.log(`⚠️ [Flow Test] Phone ${fromPhone.phoneNumber} is attached to active campaign(s): ${campaignNames}`);
    }

    // Check if this is an OpenAI-based flow agent (Plivo or Twilio+OpenAI)
    // OpenAI providers use twilioOpenaiCalls table, ElevenLabs uses calls table
    const isOpenAIProvider = agent.telephonyProvider === 'plivo' || agent.telephonyProvider === 'twilio_openai';

    // Only create calls table record for ElevenLabs provider
    // OpenAI provider creates its own record in twilioOpenaiCalls table via TwilioOpenAICallService
    let callId: string | null = null;
    let callRecord: any = null;

    if (!isOpenAIProvider) {
      callId = nanoid();
      const [record] = await db
        .insert(calls)
        .values({
          id: callId,
          userId: userId,
          agentId: agent.id,
          campaignId: null,
          contactId: null,
          phoneNumber: phoneNumber,
          fromNumber: fromPhone.phoneNumber,
          toNumber: phoneNumber,
          status: "initiated",
          callDirection: "outgoing",
          startedAt: new Date(),
          metadata: {
            source: "flow_test",
            flowId: flow.id,
            flowName: flow.name,
            fromNumber: fromPhone.phoneNumber,
            testCall: true,
          }
        })
        .returning();
      callRecord = record;

      // NOTE: pathTaken is left empty because ElevenLabs runs flows natively and
      // does not provide step-by-step execution telemetry. The UI will explain this
      // limitation and emphasize reliable data (variables, AI summary).
      const executionId = nanoid();
      await db.insert(flowExecutions).values({
        id: executionId,
        callId: callRecord.id,
        flowId: flow.id,
        currentNodeId: null,
        status: "running",
        variables: {},
        pathTaken: [],
        metadata: {
          testCall: true,
          phoneNumber,
          nativeElevenLabsExecution: true,
        }
      });
    }

    if (isOpenAIProvider) {
      if (!agent.openaiVoice) {
        throw new FlowTestHttpError(400, {
          error: "Flow agent missing OpenAI voice configuration",
          message: "Please select an OpenAI voice for this Flow agent in the Agents section.",
        });
      }
    } else {
      if (!agent.elevenLabsAgentId) {
        throw new FlowTestHttpError(400, {
          error: "Agent not synced with ElevenLabs",
          message: "Please configure and sync the agent in the Agents section first.",
        });
      }
      if (agent.type === 'flow' && !agent.elevenLabsVoiceId) {
        throw new FlowTestHttpError(400, {
          error: "Flow agent missing voice configuration",
          message: "Please select a voice for this Flow agent in the Agents section.",
        });
      }
      if (!fromPhone.elevenLabsPhoneNumberId) {
        throw new FlowTestHttpError(400, {
          error: "Phone number not synced with ElevenLabs",
          message: "Please sync your phone numbers with ElevenLabs in the Phone Numbers section before making test calls.",
        });
      }
    }

    if (!flow.nodes || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
      throw new FlowTestHttpError(400, {
        error: "Flow has no nodes defined",
        message: "Please add nodes to your flow in the visual flow builder.",
      });
    }

    if (!flow.edges || !Array.isArray(flow.edges)) {
      throw new FlowTestHttpError(400, {
        error: "Flow has no edges defined",
        message: "Please connect nodes in your flow in the visual flow builder.",
      });
    }

    console.log(`🔀 [Flow Test] Flow validation passed`);
    console.log(`   Nodes: ${flow.nodes.length}`);
    console.log(`   Edges: ${flow.edges.length}`);

    // Route to appropriate call service based on agent's telephonyProvider
    if (agent.telephonyProvider === 'plivo') {
      // ========================================
      // PLIVO + OPENAI REALTIME PATH
      // Uses PlivoCallService with OpenAI Realtime for voice AI
      // ========================================
      console.log(`   Using Plivo + OpenAI Realtime API`);

      try {
        // Get a Plivo phone number for this user
        const [plivoPhone] = await db
          .select()
          .from(plivoPhoneNumbers)
          .where(and(
            eq(plivoPhoneNumbers.userId, userId),
            eq(plivoPhoneNumbers.status, 'active')
          ))
          .limit(1);

        if (!plivoPhone) {
          throw new FlowTestHttpError(400, {
            error: "No Plivo phone number available",
            message: "Please purchase a Plivo phone number first in the Phone Numbers section.",
          });
        }

        // Use pre-compiled flow data if available, otherwise compile at runtime
        const validatedVoice = OpenAIAgentFactory.validateVoice(agent.openaiVoice || 'sage');
        const validatedModel = OpenAIAgentFactory.validateModel(
          (agent.config as any)?.openaiModel || agent.openaiModel || 'gpt-realtime-1.5',
          'pro'
        );

        let compiledConfig: any;

        // Generate a temporary call ID for tool context (will be replaced by actual call ID after initiation)
        const tempCallId = nanoid();

        if (flow.compiledSystemPrompt && flow.compiledTools && flow.compiledStates) {
          // Use pre-compiled flow data (compiled at save time)
          console.log(`   Using pre-compiled flow data (${(flow.compiledTools as any[]).length} tools, ${(flow.compiledStates as any[]).length} states)`);

          const { hydrateCompiledFlow } = await import('../services/openai-voice-agent/hydrator');
          compiledConfig = hydrateCompiledFlow({
            compiledSystemPrompt: flow.compiledSystemPrompt,
            compiledFirstMessage: flow.compiledFirstMessage || null,
            compiledTools: flow.compiledTools as any[],
            compiledStates: flow.compiledStates as any[],
            voice: validatedVoice,
            model: validatedModel,
            temperature: agent.temperature ?? 0.7,
            toolContext: {
              userId,
              agentId: agent.id,
              callId: tempCallId,
            },
            language: agent.language || 'en',
            knowledgeBaseIds: agent.knowledgeBaseIds || [],
            transferPhoneNumber: agent.transferPhoneNumber || undefined,
            transferEnabled: agent.transferEnabled || false,
          });
        } else {
          // Fall back to runtime compilation (legacy flows)
          console.log(`   Compiling flow at runtime (no pre-compiled data)`);

          const flowConfig: CompiledFlowConfig = {
            nodes: flow.nodes as any[],
            edges: flow.edges as any[],
            variables: {},
          };

          compiledConfig = await OpenAIAgentFactory.compileFlow(flowConfig, {
            voice: validatedVoice,
            model: validatedModel,
            userId,
            agentId: agent.id,
            temperature: agent.temperature ?? 0.7,
          });
        }

        const { callUuid, plivoCall } = await PlivoCallService.initiateCall({
          fromNumber: plivoPhone.phoneNumber,
          toNumber: phoneNumber,
          userId,
          agentId: agent.id,
          plivoPhoneNumberId: plivoPhone.id,
          flowId: flow.id, // Pass the tested flowId (not agent's default flow)
          agentConfig: {
            voice: compiledConfig.voice,
            model: compiledConfig.model,
            systemPrompt: compiledConfig.systemPrompt,
            firstMessage: compiledConfig.firstMessage,
            tools: compiledConfig.tools,
          },
        });

        console.log(`✅ [Flow Test] Plivo outbound call initiated`);
        console.log(`   Call ID: ${plivoCall.id}`);
        console.log(`   Plivo UUID: ${callUuid}`);
        console.log(`   Flow: ${flow.name} (${flow.id})`);
        console.log(`   From: ${plivoPhone.phoneNumber} -> To: ${phoneNumber}`);

        // Create flow execution record for test call
        try {
          await db.insert(flowExecutions).values({
            id: nanoid(),
            callId: plivoCall.id,
            flowId: flow.id,
            currentNodeId: null,
            status: 'running',
            variables: {},
            pathTaken: [],
            startedAt: new Date(),
            metadata: {
              campaignId: null,
              campaignName: null,
              contactPhone: phoneNumber,
              nativeExecution: true,
              telephonyProvider: 'plivo',
              testCall: true,
            },
          });
          console.log(`🔀 [Flow Test] Created flow execution for Plivo test call`);
        } catch (flowExecError: any) {
          console.warn(`⚠️ [Flow Test] Error creating flow execution:`, flowExecError.message);
        }

        await completeQueue(plivoCall.id);
        return {
          success: true,
          callId: plivoCall.id,
          conversationId: plivoCall.id,
          plivoUuid: callUuid,
          flowId: flow.id,
          flowName: flow.name,
          fromNumber: plivoPhone.phoneNumber,
          toNumber: phoneNumber,
          message: "Test call initiated successfully via Plivo + OpenAI Realtime. The agent will execute the workflow.",
          engine: 'plivo_openai',
          ...(activeCampaignWarning && { warning: activeCampaignWarning }),
        };

      } catch (plivoError: any) {
        console.error(`❌ [Flow Test] Plivo call error:`, plivoError);
        throw new FlowTestHttpError(400, {
          error: "Call initiation failed",
          message: "Failed to initiate call via Plivo",
        });
      }
    }

    if (agent.telephonyProvider === 'twilio_openai') {
      // ========================================
      // TWILIO + OPENAI REALTIME PATH
      // Creates record directly in twilioOpenaiCalls table (not calls table)
      // ========================================
      console.log(`   Using Twilio + OpenAI Realtime API`);

      try {
        const callResult = await TwilioOpenAICallService.initiateCall({
          userId,
          agentId: agent.id,
          toNumber: phoneNumber,
          fromNumberId: fromPhone.id,
          campaignId: undefined,
          contactId: undefined,
          flowId: flow.id,
          metadata: {
            source: 'flow_test',
            flowId: flow.id,
            flowName: flow.name,
            testCall: true,
          }
        });

        if (!callResult.success) {
          console.error(`❌ [Flow Test] Twilio+OpenAI call initiation failed:`, callResult.error);
          throw new FlowTestHttpError(400, {
            error: "Call initiation failed",
            message: callResult.error || "Failed to initiate call via Twilio+OpenAI Realtime",
          });
        }

        console.log(`✅ [Flow Test] Twilio+OpenAI outbound call initiated`);
        console.log(`   Call ID: ${callResult.callId}`);
        console.log(`   Twilio SID: ${callResult.twilioCallSid}`);
        console.log(`   Flow: ${flow.name} (${flow.id})`);
        console.log(`   From: ${fromPhone.phoneNumber} -> To: ${phoneNumber}`);

        // Create flow execution record for test call
        if (callResult.callId) {
          try {
            await db.insert(flowExecutions).values({
              id: nanoid(),
              callId: callResult.callId,
              flowId: flow.id,
              currentNodeId: null,
              status: 'running',
              variables: {},
              pathTaken: [],
              startedAt: new Date(),
              metadata: {
                campaignId: null,
                campaignName: null,
                contactPhone: phoneNumber,
                nativeExecution: true,
                telephonyProvider: 'twilio-openai',
                testCall: true,
                twilioSid: callResult.twilioCallSid,
              },
            });
            console.log(`🔀 [Flow Test] Created flow execution for Twilio+OpenAI test call`);
          } catch (flowExecError: any) {
            console.warn(`⚠️ [Flow Test] Error creating flow execution:`, flowExecError.message);
          }
        }

        // OpenAI calls use twilioOpenaiCalls table, return the callId from that table
        await completeQueue(callResult.callId!);
        return {
          success: true,
          callId: callResult.callId,
          conversationId: callResult.callId,
          twilioSid: callResult.twilioCallSid,
          flowId: flow.id,
          flowName: flow.name,
          fromNumber: fromPhone.phoneNumber,
          toNumber: phoneNumber,
          message: "Test call initiated successfully via Twilio+OpenAI Realtime. The agent will execute the workflow.",
          engine: 'twilio_openai',
          ...(activeCampaignWarning && { warning: activeCampaignWarning }),
        };

      } catch (openaiError: any) {
        if (openaiError instanceof FlowTestHttpError) throw openaiError;
        console.error(`❌ [Flow Test] Twilio+OpenAI call error:`, openaiError);
        await failQueue("Failed to initiate call via Twilio+OpenAI");
        throw new FlowTestHttpError(400, {
          error: "Call initiation failed",
          message: "Failed to initiate call via Twilio+OpenAI",
        });
      }
    }

    // ========================================
    // ELEVENLABS PATH (Default)
    // ========================================
    // PROVIDER GUARD: Explicitly verify this is an ElevenLabs agent before proceeding
    // This prevents provider mismatch if earlier branches fail or fall through
    if (agent.telephonyProvider && ['plivo', 'twilio_openai'].includes(agent.telephonyProvider)) {
      console.error(`❌ [Flow Test] Provider mismatch - agent is ${agent.telephonyProvider} but reached ElevenLabs path`);
      throw new FlowTestHttpError(400, {
        error: "Provider mismatch",
        message: `This agent uses ${agent.telephonyProvider === 'plivo' ? 'Plivo' : 'Twilio+OpenAI'} but the test call routing failed. Please try again.`,
      });
    }

    console.log(`   Using ElevenLabs native outbound call API`);

    const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
    if (!credential) {
      throw new FlowTestHttpError(400, {
        error: "No ElevenLabs credential available",
        message: "Please configure ElevenLabs API keys in the admin settings.",
      });
    }

    let currentPhoneElevenLabsId = fromPhone.elevenLabsPhoneNumberId;

    if (!agent.elevenLabsCredentialId) {
      throw new FlowTestHttpError(400, {
        error: "Agent not assigned to credential",
        message: "This agent is not assigned to an ElevenLabs credential. Please configure ElevenLabs credentials in admin settings.",
      });
    }

    const isSystemPoolNumber = fromPhone.isSystemPool === true && fromPhone.userId === null;
    if (!isSystemPoolNumber && fromPhone.userId !== userId) {
      console.warn(`⚠️ [Flow Test] Phone ${fromPhone.id} does not belong to user ${userId}`);
      throw new FlowTestHttpError(403, {
        error: "Phone number access denied",
        message: "You do not have access to this phone number.",
      });
    }

    // If phone lacks credential, try full migration via PhoneMigrator
    // PhoneMigrator handles proper credential ownership verification and ElevenLabs sync
    if (!fromPhone.elevenLabsCredentialId) {
      console.log(`📞 [Flow Test] Phone missing credential - attempting full sync via PhoneMigrator`);
      try {
        const migrationResult = await PhoneMigrator.syncPhoneToAgentCredential(
          fromPhone.id,
          agent.id
        );

        if (migrationResult.success && migrationResult.newElevenLabsPhoneId) {
          console.log(`✅ [Flow Test] Phone synced successfully via PhoneMigrator`);
          currentPhoneElevenLabsId = migrationResult.newElevenLabsPhoneId;
          // Re-fetch updated phone record to ensure we have correct state
          const [updatedPhone] = await db
            .select()
            .from(phoneNumbers)
            .where(eq(phoneNumbers.id, fromPhone.id))
            .limit(1);
          if (updatedPhone) {
            fromPhone = updatedPhone;
          }
          // Validate refreshed phone has expected credential after sync
          if (!fromPhone.elevenLabsCredentialId || !fromPhone.elevenLabsPhoneNumberId) {
            console.error(`❌ [Flow Test] Phone sync returned success but DB state invalid`);
            throw new FlowTestHttpError(500, {
              error: "Phone sync inconsistent",
              message: "Phone sync reported success but database state is invalid. Please try again.",
            });
          }
        } else {
          throw new FlowTestHttpError(400, {
            error: "Phone not synced with ElevenLabs",
            message: "This phone number could not be synced with ElevenLabs. Please try syncing from the Phone Numbers page, or purchase a new phone number.",
            suggestion: "Visit Phone Numbers page and click 'Sync to ElevenLabs' for this number.",
          });
        }
      } catch (syncError: any) {
        if (syncError instanceof FlowTestHttpError) throw syncError;
        console.error(`❌ [Flow Test] Phone sync failed:`, syncError);
        throw new FlowTestHttpError(400, {
          error: "Phone sync failed",
          message: "Failed to sync phone number with ElevenLabs. Please try again or purchase a new phone number.",
        });
      }
    } else if (fromPhone.elevenLabsCredentialId !== agent.elevenLabsCredentialId) {
      console.log(`📞 [Flow Test] Phone credential mismatch detected - initiating migration`);
      console.log(`   Phone credential: ${fromPhone.elevenLabsCredentialId}`);
      console.log(`   Agent credential: ${agent.elevenLabsCredentialId}`);

      try {
        const migrationResult = await PhoneMigrator.syncPhoneToAgentCredential(
          fromPhone.id,
          agent.id
        );

        if (!migrationResult.success) {
          console.error(`❌ [Flow Test] Phone migration failed:`, migrationResult.error);
          throw new FlowTestHttpError(400, {
            error: "Phone number migration failed",
            message: "Could not migrate phone number to agent's credential",
          });
        }

        console.log(`✅ [Flow Test] Phone migrated successfully`);
        console.log(`   Old ElevenLabs ID: ${migrationResult.oldElevenLabsPhoneId}`);
        console.log(`   New ElevenLabs ID: ${migrationResult.newElevenLabsPhoneId}`);

        if (!migrationResult.newElevenLabsPhoneId) {
          throw new FlowTestHttpError(400, {
            error: "Phone number migration incomplete",
            message: "Migration succeeded but new ElevenLabs phone ID was not returned",
          });
        }
        currentPhoneElevenLabsId = migrationResult.newElevenLabsPhoneId;

      } catch (migrationError: any) {
        if (migrationError instanceof FlowTestHttpError) throw migrationError;
        console.error(`❌ [Flow Test] Phone migration error:`, migrationError);
        throw new FlowTestHttpError(500, {
          error: "Phone number migration failed",
          message: "Failed to migrate phone number to agent's credential",
        });
      }
    } else {
      console.log(`✅ [Flow Test] Phone and agent on same credential: ${agent.elevenLabsCredentialId}`);
    }

    // PRE-FLIGHT CHECK 2: Verify phone actually exists on ElevenLabs
    // The database may have a stale elevenLabsPhoneNumberId that no longer exists
    console.log(`📞 [Flow Test] Verifying phone exists on ElevenLabs...`);
    const verifyResult = await PhoneMigrator.verifyAndEnsurePhoneExists(
      fromPhone.id,
      agent.elevenLabsCredentialId,
      agent.elevenLabsAgentId || undefined // Pass agent ID for assignment after re-import
    );

    if (!verifyResult.success) {
      console.error(`❌ [Flow Test] Phone verification failed:`, verifyResult.error);
      throw new FlowTestHttpError(400, {
        error: "Phone number not available on ElevenLabs",
        message: verifyResult.error || "Could not verify or re-import phone number. Please check your Twilio configuration.",
      });
    }

    if (verifyResult.wasReimported) {
      console.log(`✅ [Flow Test] Phone was re-imported from Twilio`);
      console.log(`   New ElevenLabs ID: ${verifyResult.elevenLabsPhoneId}`);
    }

    // Use the verified (or re-imported) phone ID
    currentPhoneElevenLabsId = verifyResult.elevenLabsPhoneId!;

    // Create OutboundCallService with the agent's credential (separate from ElevenLabsService)
    const outboundCallService = new OutboundCallService(credential.apiKey);

    let conversationId: string;
    let callSid: string | undefined;

    try {
      console.log(`📞 [Flow Test] Initiating test call via ElevenLabs Twilio API`);
      console.log(`   From Phone (ElevenLabs ID): ${currentPhoneElevenLabsId}`);
      console.log(`   To: ${phoneNumber}`);
      console.log(`   Agent (ElevenLabs ID): ${agent.elevenLabsAgentId}`);
      console.log(`   Flow ID: ${flow.id}`);

      // Compile the flow at runtime for ElevenLabs test calls
      // This ensures we test the current state of the flow in the builder, even if not yet "published"
      let testNodes = (flow.nodes || []) as import('@shared/schema').FlowNode[];
      const testEdges = (flow.edges || []) as import('@shared/schema').FlowEdge[];

      // Enrich form nodes with field definitions from database before compiling
      testNodes = await FlowAgentService.enrichFormNodesWithFields(testNodes);
      const compileResult = FlowAgentService.compileFlow(testNodes, testEdges);
      const { workflow: testWorkflow, firstMessage: flowFirstMessageResult, hasAppointmentNodes, hasFormNodes, formNodes, hasWebhookNodes, webhookNodes } = compileResult;

      console.log(`   Compiled temporary workflow: ${Object.keys(testWorkflow.nodes).length} nodes, ${Object.keys(testWorkflow.edges).length} edges`);

      // Extract contact variable placeholders from flow's compiled first message, agent first message, or flow nodes
      // For test calls without a contact, we need to pass placeholder dynamic_data
      // Priority: flow's extracted message (most accurate) > compiledFirstMessage (pre-saved) > agent.firstMessage
      let flowFirstMessage = '';

      if (flowFirstMessageResult) {
        flowFirstMessage = flowFirstMessageResult;
      } else if (flow.compiledFirstMessage) {
        flowFirstMessage = flow.compiledFirstMessage as string;
      } else {
        // Fallback: look for first message node in flow nodes
        const flowFirstMessageNode = (flow.nodes as any[]).find((n: any) => n.type === 'message');
        if (flowFirstMessageNode?.data?.config?.message) {
          flowFirstMessage = flowFirstMessageNode.data.config.message;
        } else if (flowFirstMessageNode?.data?.message) {
          flowFirstMessage = flowFirstMessageNode.data.message;
        } else {
          // Final fallback: agent's first message
          flowFirstMessage = agent.firstMessage || '';
        }
      }

      // Extract {{variable_name}} patterns from the message
      const variablePattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
      const dynamicData: Record<string, string> = {};
      let match;
      while ((match = variablePattern.exec(flowFirstMessage)) !== null) {
        const varName = match[1];
        // Provide placeholder values for test calls
        if (varName === 'contact_name' || varName === 'name') {
          dynamicData[varName] = 'Test User';
        } else if (varName === 'contact_first_name' || varName === 'first_name' || varName === 'firstName') {
          dynamicData[varName] = 'Test';
        } else if (varName === 'contact_last_name' || varName === 'last_name' || varName === 'lastName') {
          dynamicData[varName] = 'User';
        } else if (varName === 'contact_phone' || varName === 'phone') {
          dynamicData[varName] = phoneNumber;
        } else if (varName === 'contact_email' || varName === 'email') {
          dynamicData[varName] = 'test@example.com';
        } else {
          // For any other custom variable, leave it empty so the agent is forced to ask/collect it
          // Note: system placeholders like studentName/schoolName are now removed to allow conversational collection
        }
      }

      // Always ensure contact_phone is in dynamic vars — prevents the agent asking
      // the caller for their own number during form collection.
      if (!dynamicData.contact_phone && !dynamicData.phone) {
        dynamicData.contact_phone = phoneNumber;
      }

      if (Object.keys(dynamicData).length > 0) {
        console.log(`   📝 Passing dynamic_data to outbound call:`, JSON.stringify(dynamicData));
      }

      // Build necessary webhook tools for test execution
      let testWebhookTools: any[] = [];
      const { buildMessagingEmailTool, buildMessagingWhatsappTool } = await import('../services/elevenlabs');

      if (hasWebhookNodes && webhookNodes && webhookNodes.length > 0) {
        for (const webhookNode of webhookNodes) {
          if (webhookNode.toolId.startsWith('send_email_') && !webhookNode.url) {
            const templateName = webhookNode.payload?.template_name || 'default';
            const emailTool = buildMessagingEmailTool(agent.elevenLabsAgentId!, [templateName], templateName);
            emailTool.name = webhookNode.toolId;
            testWebhookTools.push(emailTool);
            console.log(`   📧 Prepared test email tool: ${webhookNode.toolId}`);
          } else if (webhookNode.toolId.startsWith('send_whatsapp') && !webhookNode.url) {
            const templateName = webhookNode.payload?.template_name || 'hello_world';
            const whatsappTool = buildMessagingWhatsappTool(agent.elevenLabsAgentId!, [templateName], templateName, undefined, "auto");
            whatsappTool.name = webhookNode.toolId;
            testWebhookTools.push(whatsappTool);
            console.log(`   💬 Prepared test WhatsApp tool: ${webhookNode.toolId}`);
          } else if (webhookNode.url) {
            const { buildUniversalWebhookTool } = await import('../services/universal-webhook-tool');
            const webhookTool = buildUniversalWebhookTool({
              toolId: webhookNode.toolId,
              url: webhookNode.url,
              method: webhookNode.method || 'POST',
              headers: webhookNode.headers,
              payload: webhookNode.payload
            });
            testWebhookTools.push(webhookTool);
            console.log(`   🔗 Prepared test universal webhook tool: ${webhookNode.toolId}`);
          }
        }
      }

      if (hasFormNodes && formNodes && formNodes.length > 0) {
        const { getSubmitFormWebhookTool } = await import('../services/form-elevenlabs-tool');
        for (const formInfo of formNodes) {
          const formTool = getSubmitFormWebhookTool(
            formInfo.formId,
            formInfo.formName,
            formInfo.fields,
            agent.elevenLabsAgentId!,
            formInfo.nodeId
          );
          testWebhookTools.push(formTool);
          console.log(`   📋 Prepared test form tool: ${formInfo.formName}`);
        }
      }

      if (hasAppointmentNodes) {
        const { getAppointmentToolForAgent } = await import('../services/appointment-elevenlabs-tool');
        const appointmentTool = getAppointmentToolForAgent(agent.elevenLabsAgentId!);
        testWebhookTools.push(appointmentTool);
        console.log(`   📅 Prepared test appointment tool`);
      }

      // ── PRE-FLIGHT: Push recompiled workflow to ElevenLabs agent ──
      // ElevenLabs ignores conversation_config_override.workflow for outbound calls
      // (the agent always uses its saved workflow). So we PATCH the agent first.
      console.log(`   🔄 Pushing recompiled workflow to ElevenLabs agent before call...`);
      try {
        const elevenlabsService = new (await import('../services/elevenlabs')).ElevenLabsService(credential.apiKey);
        await elevenlabsService.updateFlowAgentWorkflow(
          agent.elevenLabsAgentId!,
          testWorkflow,
          agent.maxDurationSeconds || 900,
          agent.detectLanguageEnabled || false,
          agent.language || undefined,
          undefined, // ttsModel
          undefined, // llmModel
          undefined, // temperature
          flowFirstMessage || undefined,
          undefined, // voiceId
          testWebhookTools.length > 0 ? { webhookTools: testWebhookTools } : undefined
        );
        console.log(`   ✅ Agent workflow updated on ElevenLabs (${Object.keys(testWorkflow.nodes).length} nodes, ${testWebhookTools.length} tools)`);
      } catch (updateError: any) {
        console.error(`   ⚠️ Failed to update agent workflow (call may use stale workflow):`, updateError.message);
      }

      // Use OutboundCallService for ElevenLabs Twilio outbound calls
      // Note: workflow override removed — ElevenLabs uses the agent's saved workflow (updated above)
      const result = await outboundCallService.initiateCall({
        agentId: agent.elevenLabsAgentId!,
        agentPhoneNumberId: currentPhoneElevenLabsId!,
        toNumber: phoneNumber,
        firstMessage: flowFirstMessage || undefined,
        dynamicData,
      });

      console.log(`✅ [Flow Test Call] Call initiated:`, JSON.stringify(result));
      
      conversationId = result.conversationId || '';
      callSid = result.callSid || undefined;

      // CRITICAL: Update the call record with the ElevenLabs conversation ID immediately
      // This allows the WhatsApp webhook (which hits during the call) to find the phone number
      if (conversationId && callId) {
        try {
          const { sql } = await import('drizzle-orm');
          await db.execute(sql`
            UPDATE calls 
            SET elevenlabs_conversation_id = ${conversationId},
                twilio_sid = ${callSid || null}
            WHERE id = ${callId}
          `);
          console.log(`   ✅ Call record ${callId} updated with ElevenLabs conversation ID: ${conversationId}`);
        } catch (dbError: any) {
          console.error(`   ⚠️ Failed to update call record with conversation ID:`, dbError.message);
        }
      }

      console.log(`✅ [Flow Test] ElevenLabs outbound call initiated`);
      console.log(`   Conversation ID: ${conversationId}`);
      if (callSid) {
        console.log(`   Call SID: ${callSid}`);
      }

      // Create flow execution record for ElevenLabs test call
      if (callId) {
        try {
          await db.insert(flowExecutions).values({
            id: nanoid(),
            callId: callId,
            flowId: flow.id,
            currentNodeId: null,
            status: 'running',
            variables: {},
            pathTaken: [],
            startedAt: new Date(),
            metadata: {
              campaignId: null,
              campaignName: null,
              contactPhone: phoneNumber,
              nativeExecution: true,
              telephonyProvider: 'elevenlabs',
              testCall: true,
              conversationId: conversationId,
            },
          });
          console.log(`🔀 [Flow Test] Created flow execution for ElevenLabs test call`);
        } catch (flowExecError: any) {
          console.warn(`⚠️ [Flow Test] Error creating flow execution:`, flowExecError.message);
        }
      }

      // Update call record with ElevenLabs conversation ID and Twilio SID
      // Note: callId is guaranteed to be set in ElevenLabs path (we only reach here when !isOpenAIProvider)
      const existingMetadata = (callRecord.metadata ?? {}) as import('@shared/schema').CallMetadata;
      await db
        .update(calls)
        .set({
          twilioSid: callSid || null,
          elevenLabsConversationId: conversationId,
          metadata: {
            ...existingMetadata,
            elevenLabsNative: true,
            conversationId: conversationId,
          }
        })
        .where(eq(calls.id, callId!));

    } catch (elevenLabsError: any) {
      if (elevenLabsError instanceof FlowTestHttpError) throw elevenLabsError;
      console.error(`❌ [Flow Test] ElevenLabs call initiation failed:`, elevenLabsError);

      const failedMetadata = (callRecord.metadata ?? {}) as import('@shared/schema').CallMetadata;
      await db
        .update(calls)
        .set({
          status: 'failed',
          endedAt: new Date(),
          metadata: { ...failedMetadata, error: 'ElevenLabs call initiation failed' },
        })
        .where(eq(calls.id, callId!));

      throw new FlowTestHttpError(400, {
        error: "Call initiation failed",
        message: "Failed to initiate call via ElevenLabs",
      });
    }

    console.log(`✅ [Flow Test] Test call initiated successfully`);
    console.log(`   Call ID: ${callRecord.id}`);
    console.log(`   Conversation ID: ${conversationId}`);
    console.log(`   Flow: ${flow.name} (${flow.id})`);
    console.log(`   From: ${fromPhone.phoneNumber} -> To: ${phoneNumber}`);

    await completeQueue(callRecord.id);
    return {
      success: true,
      callId: callRecord.id,
      conversationId: conversationId,
      twilioSid: callSid,
      flowId: flow.id,
      flowName: flow.name,
      fromNumber: fromPhone.phoneNumber,
      toNumber: phoneNumber,
      message: "Test call initiated successfully via ElevenLabs. The agent will execute the workflow natively.",
      ...(activeCampaignWarning && { warning: activeCampaignWarning }),
    };
  } catch (error: any) {
    if (error instanceof FlowTestHttpError) throw error;
    console.error("Error testing flow:", error);
    await failQueue(error?.message || "Test call failed");
    throw new FlowTestHttpError(500, { error: "Failed to test flow" });
  }
}

// ── POST /flows/:id/test ──────────────────────────────────────────────────────
router.post("/flows/:id/test", async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
  const { phoneNumber, queueEntryId } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });
  if (!phoneNumber.startsWith("+") || phoneNumber.length < 11) {
    return res.status(400).json({
      error: "Invalid phone number format. Must be in E.164 format (e.g., +12025551234)",
    });
  }
  try {
    const result = await placeFlowTestCall({
      userId: req.userId,
      flowId: req.params.id,
      toPhone: phoneNumber,
      queueEntryId,
    });
    return res.json(result);
  } catch (err: any) {
    if (err instanceof FlowTestHttpError) {
      return res.status(err.statusCode).json(err.body);
    }
    console.error("Error testing flow:", err);
    return res.status(500).json({ error: "Failed to test flow" });
  }
});

// ── Queue status endpoint ────────────────────────────────────────────────────
// Polls the status of a queued test-call entry. Lifecycle:
//   waiting → (atomic claim here) → processing (placeFlowTestCall fired) → completed | failed
//   waiting → (15 min timeout) → failed
//
// When position is 1 and a free pool number exists, this endpoint:
//   1. Atomically moves the entry to 'processing'
//   2. Fires placeFlowTestCall as a background job (setImmediate, no req/res)
//   3. Returns { status:'processing', ready:false } immediately
// placeFlowTestCall calls completeQueue/failQueue which update the DB entry.
// The frontend polls until it sees 'completed' (with callId) or 'failed'.
router.get("/queue/:entryId", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { entryId } = req.params;

    const [entry] = await db
      .select()
      .from(flowTestQueue)
      .where(and(eq(flowTestQueue.id, entryId), eq(flowTestQueue.userId, userId)));

    if (!entry) return res.status(404).json({ error: "Queue entry not found" });

    // ── Terminal statuses: return immediately ──────────────────────────────
    if (entry.status === 'completed') {
      return res.json({ status: 'completed', position: 0, ready: false, callId: entry.callId });
    }
    if (entry.status === 'failed') {
      return res.json({ status: 'failed', position: 0, ready: false, errorMessage: entry.errorMessage });
    }
    if (entry.status === 'cancelled') {
      return res.json({ status: 'cancelled', position: 0, ready: false, message: entry.errorMessage || 'Queue entry was cancelled.' });
    }

    // ── Processing: already claimed, re-submit is in flight ────────────────
    if (entry.status === 'processing') {
      // Auto-fail if processing for > 3 minutes (re-submit never came or hung)
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
      if (entry.processedAt && entry.processedAt < threeMinAgo) {
        await db.update(flowTestQueue)
          .set({ status: 'failed', errorMessage: 'Call placement timed out. Please try again.' })
          .where(eq(flowTestQueue.id, entryId));
        return res.json({ status: 'failed', position: 0, ready: false, errorMessage: 'Call placement timed out. Please try again.' });
      }
      // Normal processing — re-submit is in-flight, keep polling
      return res.json({ status: 'processing', position: 0, ready: false });
    }

    // ── Waiting: check position and availability ────────────────────────────

    // GLOBAL proactive stale cleanup: expire ALL waiting entries older than 15 minutes.
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    await db.update(flowTestQueue)
      .set({ status: 'failed', errorMessage: 'Queue timeout: abandoned (15 minutes).' })
      .where(and(
        eq(flowTestQueue.status, 'waiting'),
        sql`${flowTestQueue.createdAt} < ${fifteenMinsAgo}`
      ));

    if (entry.createdAt < fifteenMinsAgo) {
      return res.json({
        status: 'failed', position: 0, ready: false,
        errorMessage: 'Queue timeout exceeded (15 minutes). Please try again.',
      });
    }

    // Calculate position (entries created before this one that are still waiting), +1
    // Position is accurate because stale entries were cleaned up above.
    const [{ count: ahead }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(flowTestQueue)
      .where(and(
        eq(flowTestQueue.status, 'waiting'),
        sql`${flowTestQueue.createdAt} < ${entry.createdAt}`
      ));
    const position = (ahead ?? 0) + 1;

    if (position > 1) {
      // Not at front of queue yet
      return res.json({ status: 'waiting', position, ready: false });
    }

    // ── Position 1: check if a pool phone is free ──────────────────────────
    // Exclude phones connected to incoming agents (same filter the test endpoint applies)
    const connectedPhoneIds = await db
      .select({ id: incomingConnections.phoneNumberId })
      .from(incomingConnections);
    const connectedIdSet = new Set(connectedPhoneIds.map(ic => ic.id).filter(Boolean));

    const poolPhones = await db
      .select()
      .from(phoneNumbers)
      .where(and(
        eq(phoneNumbers.isSystemPool, true),
        eq(phoneNumbers.status, 'available'),
        isNull(phoneNumbers.userId)
      ));
    const availablePoolPhones = poolPhones.filter(p => !connectedIdSet.has(p.id));

    const activeCallRows = await db
      .select({ fromNumber: calls.fromNumber })
      .from(calls)
      .where(inArray(calls.status, ['pending', 'initiated', 'ringing', 'in-progress']));
    const busySet = new Set(activeCallRows.map(r => r.fromNumber).filter(Boolean));
    const freePhones = availablePoolPhones.filter(p => !busySet.has(p.phoneNumber));

    if (freePhones.length === 0) {
      // Still waiting at position 1 but no free phone yet
      return res.json({ status: 'waiting', position: 1, ready: false });
    }

    // ── Atomically claim the entry (waiting → processing) ─────────────────
    const [claimed] = await db
      .update(flowTestQueue)
      .set({ status: 'processing', processedAt: new Date() })
      .where(and(eq(flowTestQueue.id, entryId), eq(flowTestQueue.status, 'waiting')))
      .returning();

    if (!claimed) {
      // Another concurrent poll already claimed it — return processing (in-flight)
      return res.json({ status: 'processing', position: 0, ready: false });
    }

    // ── Server-side call placement: fire & forget ──────────────────────────
    console.log(`⚡ [Queue] Entry ${entryId} claimed → triggering server-side call placement.`);

    setImmediate(() =>
      placeFlowTestCall({
        userId: claimed.userId,
        flowId: claimed.flowId,
        toPhone: claimed.toPhone,
        queueEntryId: claimed.id,
      }).catch((err: any) => {
        console.error(`[Queue] Background test call error for ${claimed.id}:`, err);
        db.update(flowTestQueue)
          .set({ status: 'failed', errorMessage: err?.message || 'Unexpected error during call placement' })
          .where(and(eq(flowTestQueue.id, claimed.id), eq(flowTestQueue.status, 'processing')))
          .then(() => { }).catch(() => { });
      })
    );

    return res.json({ status: 'processing', position: 0, ready: false });

  } catch (error: any) {
    console.error("Error fetching queue status:", error);
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

// ── Cancel queue entry ───────────────────────────────────────────────────────
router.delete("/queue/:entryId", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { entryId } = req.params;

    // Allow cancelling both 'waiting' and 'processing' entries (user may leave queue after atomic claim)
    const [updated] = await db
      .update(flowTestQueue)
      .set({ status: 'cancelled', errorMessage: 'Cancelled by user.' })
      .where(
        and(
          eq(flowTestQueue.id, entryId),
          eq(flowTestQueue.userId, userId),
          inArray(flowTestQueue.status, ['waiting', 'processing'])
        )
      )
      .returning();

    if (!updated) {
      // Entry may be completed/failed — that's OK, not an error
      return res.json({ success: true, note: 'Entry was already in a terminal state.' });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error("Error cancelling queue entry:", error);
    return res.status(500).json({ error: "Failed to cancel queue entry" });
  }
});

router.get("/flow-templates", async (req: AuthRequest, res: Response) => {
  try {
    const templates = flowTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      isTemplate: template.isTemplate,
      nodeCount: template.nodes.length,
      preview: template.nodes.slice(0, 3).map((n) => n.type),
    }));

    res.json(templates);
  } catch (error: any) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.post("/flow-templates/:templateId/clone", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { templateId } = req.params;
    const { name } = req.body;

    // Enforce flow limit before cloning
    const effectiveLimits = await storage.getUserEffectiveLimits(userId);
    const currentFlowCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(flows)
      .where(eq(flows.userId, userId));
    const flowCount = Number(currentFlowCount[0]?.count || 0);
    const maxFlows = typeof effectiveLimits.maxFlows === 'number' ? effectiveLimits.maxFlows : 3;
    if (maxFlows !== 999 && maxFlows !== -1 && flowCount >= maxFlows) {
      return res.status(403).json({
        error: "Flow limit reached",
        message: `You have reached your maximum of ${maxFlows} flows. Please upgrade your plan or delete existing flows.`,
        limit: maxFlows,
        current: flowCount
      });
    }

    const template = flowTemplates.find((t) => t.id === templateId);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    const newFlowId = nanoid();
    const now = new Date();
    // TODO: Drizzle type inference - template nodes/edges are typed but Drizzle insert expects exact match
    const [newFlow] = await db
      .insert(flows)
      .values({
        id: newFlowId,
        userId,
        name: name || template.name,
        description: template.description || null,
        nodes: template.nodes,
        edges: template.edges,
        isActive: false,
        isTemplate: false,
        createdAt: now,
        updatedAt: now,
      } as typeof flows.$inferInsert)
      .returning();

    res.json(newFlow);
  } catch (error: any) {
    console.error("Error cloning template:", error);
    res.status(500).json({ error: "Failed to clone template" });
  }
});

router.post("/flows/:id/clone", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    // Enforce flow limit before cloning
    const effectiveLimits = await storage.getUserEffectiveLimits(userId);
    const currentFlowCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(flows)
      .where(eq(flows.userId, userId));
    const flowCount = Number(currentFlowCount[0]?.count || 0);
    const maxFlows = typeof effectiveLimits.maxFlows === 'number' ? effectiveLimits.maxFlows : 3;
    if (maxFlows !== 999 && maxFlows !== -1 && flowCount >= maxFlows) {
      return res.status(403).json({
        error: "Flow limit reached",
        message: `You have reached your maximum of ${maxFlows} flows. Please upgrade your plan or delete existing flows.`,
        limit: maxFlows,
        current: flowCount
      });
    }

    const [originalFlow] = await db
      .select()
      .from(flows)
      .where(and(
        eq(flows.id, id),
        sql`(${flows.userId} = ${userId} OR ${flows.isTemplate} = true)`
      ));

    if (!originalFlow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    const newFlowId = nanoid();
    // TODO: Drizzle type inference - cloning flow with nodes/edges from existing record
    const [clonedFlow] = await db
      .insert(flows)
      .values({
        id: newFlowId,
        userId,
        name: `${originalFlow.name} (Copy)`,
        description: originalFlow.description,
        nodes: originalFlow.nodes,
        edges: originalFlow.edges,
        isActive: false,
        isTemplate: false,
      } as typeof flows.$inferInsert)
      .returning();

    res.json(clonedFlow);
  } catch (error: any) {
    console.error("Error cloning flow:", error);
    res.status(500).json({ error: "Failed to clone flow" });
  }
});

router.get("/webhooks", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    const userWebhooks = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .orderBy(desc(webhooks.createdAt));

    res.json(userWebhooks);
  } catch (error: any) {
    console.error("Error fetching webhooks:", error);
    res.status(500).json({ error: "Failed to fetch webhooks" });
  }
});

router.post("/webhooks", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const validatedData = createWebhookSchema.parse(req.body);

    const webhookId = nanoid();
    // TODO: Drizzle type inference - Zod validated data doesn't perfectly match insert type
    const [newWebhook] = await db
      .insert(webhooks)
      .values({
        id: webhookId,
        userId,
        ...validatedData,
      } as typeof webhooks.$inferInsert)
      .returning();

    res.json(newWebhook);
  } catch (error: any) {
    console.error("Error creating webhook:", error);
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

router.patch("/webhooks/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const [updatedWebhook] = await db
      .update(webhooks)
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
      .returning();

    if (!updatedWebhook) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    res.json(updatedWebhook);
  } catch (error: any) {
    console.error("Error updating webhook:", error);
    res.status(500).json({ error: "Failed to update webhook" });
  }
});

router.delete("/webhooks/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting webhook:", error);
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

router.get("/webhooks/:id/logs", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const [webhook] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));

    if (!webhook) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    const logs = await db
      .select()
      .from(webhookLogs)
      .where(eq(webhookLogs.webhookId, id))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit);

    res.json(logs);
  } catch (error: any) {
    console.error("Error fetching webhook logs:", error);
    res.status(500).json({ error: "Failed to fetch webhook logs" });
  }
});

router.post("/webhooks/:id/test", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const result = await webhookDeliveryService.testWebhook(id, userId);

    res.json(result);
  } catch (error: any) {
    console.error("Error testing webhook:", error);
    res.status(500).json({ error: "Failed to test webhook" });
  }
});

router.post("/webhooks/logs/:logId/retry", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { logId } = req.params;

    const result = await webhookDeliveryService.retryWebhook(parseInt(logId, 10), userId);

    res.json(result);
  } catch (error: any) {
    console.error("Error retrying webhook:", error);
    res.status(500).json({ error: "Failed to retry webhook" });
  }
});

router.get("/appointments", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { startDate, endDate, status } = req.query;

    const conditions: any[] = [eq(appointments.userId, userId)];

    if (startDate && typeof startDate === 'string') {
      const parsedStartDate = new Date(startDate);
      if (!isNaN(parsedStartDate.getTime())) {
        conditions.push(gte(appointments.appointmentDate, parsedStartDate.toISOString().split('T')[0]));
      }
    }
    if (endDate && typeof endDate === 'string') {
      const parsedEndDate = new Date(endDate);
      if (!isNaN(parsedEndDate.getTime())) {
        conditions.push(lte(appointments.appointmentDate, parsedEndDate.toISOString().split('T')[0]));
      }
    }
    if (status) {
      conditions.push(eq(appointments.status, status as string));
    }

    const result = await db
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(appointments.appointmentDate, appointments.appointmentTime);

    const appointmentsWithScheduledFor = result.map(apt => ({
      ...apt,
      scheduledFor: `${apt.appointmentDate}T${apt.appointmentTime}`,
    }));

    res.json(appointmentsWithScheduledFor);
  } catch (error: any) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

router.post("/appointments", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const validatedData = createAppointmentSchema.parse(req.body);

    // Validate working hours
    const workingHoursResult = await validateWorkingHours(
      userId,
      validatedData.appointmentDate,
      validatedData.appointmentTime,
      validatedData.duration || 30
    );

    if (!workingHoursResult.valid) {
      return res.status(400).json({ error: workingHoursResult.message });
    }

    const [settings] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, userId));

    if (settings && !settings.allowOverlapping) {
      const existing = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.userId, userId),
            eq(appointments.appointmentDate, validatedData.appointmentDate),
            eq(appointments.appointmentTime, validatedData.appointmentTime),
            eq(appointments.status, "scheduled")
          )
        );

      if (existing.length > 0) {
        return res.status(409).json({
          error: "Appointment slot already booked",
          conflictingAppointment: existing[0]
        });
      }
    }

    const appointmentId = nanoid();
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        id: appointmentId,
        userId,
        ...validatedData,
      })
      .returning();

    res.json(newAppointment);
  } catch (error: any) {
    console.error("Error creating appointment:", error);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

router.patch("/appointments/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    // Fetch the original appointment to detect changes
    const [originalAppointment] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)));

    if (!originalAppointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const [updatedAppointment] = await db
      .update(appointments)
      .set({
        ...req.body,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)))
      .returning();

    if (!updatedAppointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Build common webhook payload
    const buildAppointmentPayload = (apt: typeof updatedAppointment) => ({
      appointmentId: apt.id,
      contactName: apt.contactName || null,
      contactPhone: apt.contactPhone || null,
      contactEmail: apt.contactEmail || null,
      date: apt.appointmentDate,
      time: apt.appointmentTime,
      duration: apt.duration || 30,
      serviceName: apt.serviceName || null,
      notes: apt.notes || null,
      status: apt.status,
      flowId: apt.flowId || null,
      callId: apt.callId || null,
    });

    // Trigger webhook events based on status changes
    const oldStatus = originalAppointment.status;
    const newStatus = updatedAppointment.status;
    const oldDate = originalAppointment.appointmentDate;
    const oldTime = originalAppointment.appointmentTime;
    const newDate = updatedAppointment.appointmentDate;
    const newTime = updatedAppointment.appointmentTime;

    // Check for reschedule (date or time changed)
    if ((oldDate !== newDate || oldTime !== newTime) && newStatus !== 'cancelled') {
      try {
        await webhookDeliveryService.triggerEvent(userId, 'appointment.rescheduled', {
          appointment: buildAppointmentPayload(updatedAppointment),
          previousDate: oldDate,
          previousTime: oldTime,
          newDate: newDate,
          newTime: newTime,
          rescheduledAt: new Date().toISOString(),
        });
        console.log(`📅 [Appointment Webhook] Triggered appointment.rescheduled for ${id}`);
      } catch (webhookError: any) {
        console.error(`📅 [Appointment Webhook] Failed to trigger rescheduled webhook:`, webhookError.message);
      }
    }

    // Check for status changes and trigger corresponding webhooks
    if (oldStatus !== newStatus) {
      try {
        switch (newStatus) {
          case 'confirmed':
            await webhookDeliveryService.triggerEvent(userId, 'appointment.confirmed', {
              appointment: buildAppointmentPayload(updatedAppointment),
              confirmedAt: new Date().toISOString(),
            });
            console.log(`📅 [Appointment Webhook] Triggered appointment.confirmed for ${id}`);
            break;

          case 'cancelled':
            await webhookDeliveryService.triggerEvent(userId, 'appointment.cancelled', {
              appointment: buildAppointmentPayload(updatedAppointment),
              cancelReason: req.body.cancelReason || null,
              cancelledAt: new Date().toISOString(),
            });
            console.log(`📅 [Appointment Webhook] Triggered appointment.cancelled for ${id}`);
            break;

          case 'completed':
            await webhookDeliveryService.triggerEvent(userId, 'appointment.completed', {
              appointment: buildAppointmentPayload(updatedAppointment),
              completedAt: new Date().toISOString(),
            });
            console.log(`📅 [Appointment Webhook] Triggered appointment.completed for ${id}`);
            break;

          case 'no_show':
          case 'noshow':
          case 'no-show':
            await webhookDeliveryService.triggerEvent(userId, 'appointment.no_show', {
              appointment: buildAppointmentPayload(updatedAppointment),
              markedNoShowAt: new Date().toISOString(),
            });
            console.log(`📅 [Appointment Webhook] Triggered appointment.no_show for ${id}`);
            break;
        }
      } catch (webhookError: any) {
        console.error(`📅 [Appointment Webhook] Failed to trigger ${newStatus} webhook:`, webhookError.message);
      }
    }

    // Sync to Google Calendar if connected
    try {
      const calendarApt = {
        id: updatedAppointment.id,
        contactName: updatedAppointment.contactName,
        contactPhone: updatedAppointment.contactPhone,
        contactEmail: updatedAppointment.contactEmail,
        appointmentDate: updatedAppointment.appointmentDate,
        appointmentTime: updatedAppointment.appointmentTime,
        duration: updatedAppointment.duration,
        serviceName: updatedAppointment.serviceName,
        notes: updatedAppointment.notes,
        status: updatedAppointment.status,
      };
      const existingEventId = updatedAppointment.googleCalendarEventId;

      if (updatedAppointment.status === "cancelled" && existingEventId) {
        const deleted = await deleteCalendarEvent(userId, existingEventId);
        if (deleted) {
          await db.update(appointments)
            .set({ googleCalendarEventId: null, updatedAt: new Date() })
            .where(eq(appointments.id, id));
        } else {
          console.warn(`[GoogleCalendar] Delete failed for event ${existingEventId} on cancel — keeping ID for retry`);
        }
      } else if (existingEventId) {
        await updateCalendarEvent(userId, existingEventId, calendarApt);
      }
    } catch (calErr: any) {
      console.error(`📅 [GoogleCalendar] Sync error on PATCH for ${id}:`, calErr.message);
    }

    res.json({
      ...updatedAppointment,
      scheduledFor: `${updatedAppointment.appointmentDate}T${updatedAppointment.appointmentTime}`,
    });
  } catch (error: any) {
    console.error("Error updating appointment:", error);
    res.status(500).json({ error: "Failed to update appointment" });
  }
});

router.post("/appointments/:id/sync-calendar", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
    const userId = req.userId!;
    const { id } = req.params;

    const [apt] = await db.select().from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)));
    if (!apt) return res.status(404).json({ error: "Appointment not found" });

    const calendarApt = {
      id: apt.id,
      contactName: apt.contactName,
      contactPhone: apt.contactPhone,
      contactEmail: apt.contactEmail,
      appointmentDate: apt.appointmentDate,
      appointmentTime: apt.appointmentTime,
      duration: apt.duration,
      serviceName: apt.serviceName,
      notes: apt.notes,
      status: apt.status,
    };

    let eventId = apt.googleCalendarEventId;
    if (eventId) {
      await updateCalendarEvent(userId, eventId, calendarApt);
    } else {
      eventId = await createCalendarEvent(userId, calendarApt);
      if (eventId) {
        await db.update(appointments)
          .set({ googleCalendarEventId: eventId, updatedAt: new Date() })
          .where(eq(appointments.id, id));
      }
    }

    if (!eventId) {
      return res.status(502).json({ error: "Failed to sync to Google Calendar. Please check your connection." });
    }

    const [updated] = await db.select().from(appointments).where(eq(appointments.id, id));
    res.json({
      ...updated,
      scheduledFor: `${updated.appointmentDate}T${updated.appointmentTime}`,
    });
  } catch (error: any) {
    console.error("Error syncing appointment to calendar:", error);
    res.status(500).json({ error: "Failed to sync to Google Calendar" });
  }
});

router.delete("/appointments/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    // Fetch the appointment before deletion to trigger webhook
    const [appointmentToDelete] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)));

    if (!appointmentToDelete) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Trigger appointment.cancelled webhook before deletion
    try {
      await webhookDeliveryService.triggerEvent(userId, 'appointment.cancelled', {
        appointment: {
          appointmentId: appointmentToDelete.id,
          contactName: appointmentToDelete.contactName || null,
          contactPhone: appointmentToDelete.contactPhone || null,
          contactEmail: appointmentToDelete.contactEmail || null,
          date: appointmentToDelete.appointmentDate,
          time: appointmentToDelete.appointmentTime,
          duration: appointmentToDelete.duration || 30,
          serviceName: appointmentToDelete.serviceName || null,
          notes: appointmentToDelete.notes || null,
          status: 'cancelled',
          flowId: appointmentToDelete.flowId || null,
          callId: appointmentToDelete.callId || null,
        },
        cancelReason: 'deleted',
        cancelledAt: new Date().toISOString(),
      });
      console.log(`📅 [Appointment Webhook] Triggered appointment.cancelled for deleted appointment ${id}`);
    } catch (webhookError: any) {
      console.error(`📅 [Appointment Webhook] Failed to trigger cancelled webhook:`, webhookError.message);
    }

    await db
      .delete(appointments)
      .where(and(eq(appointments.id, id), eq(appointments.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting appointment:", error);
    res.status(500).json({ error: "Failed to delete appointment" });
  }
});

// TODO: appointment.reminder_sent webhook trigger
// This event should be triggered when an appointment reminder is sent to the contact.
// Currently, there is no appointment reminder system implemented.
// When a reminder system is added (e.g., a cron job that sends SMS/email reminders),
// uncomment and adapt the following code:
//
// async function sendAppointmentReminder(appointment: any, userId: string) {
//   // ... reminder sending logic ...
//   
//   // Trigger appointment.reminder_sent webhook
//   try {
//     await webhookDeliveryService.triggerEvent(userId, 'appointment.reminder_sent', {
//       appointment: {
//         appointmentId: appointment.id,
//         contactName: appointment.contactName || null,
//         contactPhone: appointment.contactPhone || null,
//         contactEmail: appointment.contactEmail || null,
//         date: appointment.appointmentDate,
//         time: appointment.appointmentTime,
//         duration: appointment.duration || 30,
//         serviceName: appointment.serviceName || null,
//         notes: appointment.notes || null,
//         status: appointment.status,
//         flowId: appointment.flowId || null,
//         callId: appointment.callId || null,
//       },
//       reminderType: 'email', // or 'sms'
//       reminderSentAt: new Date().toISOString(),
//       hoursBeforeAppointment: 24, // configurable
//     });
//     console.log(`📅 [Appointment Webhook] Triggered appointment.reminder_sent for ${appointment.id}`);
//   } catch (webhookError: any) {
//     console.error(`📅 [Appointment Webhook] Failed to trigger reminder_sent webhook:`, webhookError.message);
//   }
// }

router.get("/appointment-settings", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    const [settings] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, userId));

    // Convert database format to frontend format
    const convertToFrontendFormat = (workingHours: any) => {
      if (!workingHours) {
        return {
          workingHoursStart: "09:00",
          workingHoursEnd: "17:00",
          workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        };
      }

      // Extract enabled days
      const enabledDays: string[] = [];
      let startTime = "09:00";
      let endTime = "17:00";

      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (const day of days) {
        const daySettings = workingHours[day];
        if (daySettings?.enabled) {
          enabledDays.push(day);
          // Use the first enabled day's times as the global times
          if (startTime === "09:00" && daySettings.start) startTime = daySettings.start;
          if (endTime === "17:00" && daySettings.end) endTime = daySettings.end;
        }
      }

      return {
        workingHoursStart: startTime,
        workingHoursEnd: endTime,
        workingDays: enabledDays,
      };
    };

    if (!settings) {
      return res.json({
        id: null,
        allowOverlap: false,
        bufferTime: 15,
        maxPerDay: null,
        syncToGoogleCalendar: false,
        workingHoursStart: "09:00",
        workingHoursEnd: "17:00",
        workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      });
    }

    // Convert to frontend format
    const frontendFormat = convertToFrontendFormat(settings.workingHours);

    res.json({
      id: settings.id,
      allowOverlap: settings.allowOverlapping,
      bufferTime: settings.bufferMinutes,
      maxPerDay: null,
      syncToGoogleCalendar: settings.syncToGoogleCalendar,
      ...frontendFormat,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    });
  } catch (error: any) {
    console.error("Error fetching appointment settings:", error);
    res.status(500).json({ error: "Failed to fetch appointment settings" });
  }
});

router.put("/appointment-settings", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    // Accept frontend format and convert to database format
    const {
      allowOverlap,
      bufferTime,
      workingHoursStart,
      workingHoursEnd,
      workingDays,
      syncToGoogleCalendar,
      // Also accept direct database format fields
      allowOverlapping,
      bufferMinutes,
      workingHours
    } = req.body;

    // Convert frontend format to database format
    const convertToDbFormat = () => {
      const start = workingHoursStart || "09:00";
      const end = workingHoursEnd || "17:00";
      const days = workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"];

      const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const result: Record<string, { start: string; end: string; enabled: boolean }> = {};

      for (const day of allDays) {
        result[day] = {
          start,
          end,
          enabled: days.includes(day),
        };
      }

      return result;
    };

    // Use provided workingHours object if given (direct database format), 
    // otherwise convert from frontend format
    const dbWorkingHours = workingHours || convertToDbFormat();
    const dbAllowOverlapping = allowOverlapping ?? allowOverlap ?? false;
    const dbBufferMinutes = bufferMinutes ?? bufferTime ?? 0;
    const dbSyncToGoogleCalendar = syncToGoogleCalendar ?? false;

    console.log('📅 [Settings] Saving appointment settings:', {
      allowOverlapping: dbAllowOverlapping,
      bufferMinutes: dbBufferMinutes,
      workingDays: workingDays,
      workingHours: dbWorkingHours,
    });

    const [existing] = await db
      .select()
      .from(appointmentSettings)
      .where(eq(appointmentSettings.userId, userId));

    if (existing) {
      const [updated] = await db
        .update(appointmentSettings)
        .set({
          allowOverlapping: dbAllowOverlapping,
          bufferMinutes: dbBufferMinutes,
          syncToGoogleCalendar: dbSyncToGoogleCalendar,
          workingHours: dbWorkingHours,
          updatedAt: new Date(),
        })
        .where(eq(appointmentSettings.userId, userId))
        .returning();

      // Convert back to frontend format for response
      const frontendFormat = {
        id: updated.id,
        allowOverlap: updated.allowOverlapping,
        bufferTime: updated.bufferMinutes,
        syncToGoogleCalendar: updated.syncToGoogleCalendar,
        maxPerDay: null,
        workingHoursStart: workingHoursStart || "09:00",
        workingHoursEnd: workingHoursEnd || "17:00",
        workingDays: workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };

      return res.json(frontendFormat);
    } else {
      const settingsId = nanoid();
      const [created] = await db
        .insert(appointmentSettings)
        .values({
          id: settingsId,
          userId,
          allowOverlapping: dbAllowOverlapping,
          bufferMinutes: dbBufferMinutes,
          syncToGoogleCalendar: dbSyncToGoogleCalendar,
          workingHours: dbWorkingHours,
        })
        .returning();

      // Convert back to frontend format for response
      const frontendFormat = {
        id: created.id,
        allowOverlap: created.allowOverlapping,
        bufferTime: created.bufferMinutes,
        syncToGoogleCalendar: created.syncToGoogleCalendar,
        maxPerDay: null,
        workingHoursStart: workingHoursStart || "09:00",
        workingHoursEnd: workingHoursEnd || "17:00",
        workingDays: workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };

      return res.json(frontendFormat);
    }
  } catch (error: any) {
    console.error("Error updating appointment settings:", error);
    res.status(500).json({ error: "Failed to update appointment" });
  }
});

router.post("/appointments/sync", async (req: AuthRequest, res: Response) => {
  try {
    const {
      agentId,
      callId,
      contactName,
      contactPhone,
      contactEmail,
      appointmentDate,
      appointmentTime,
      duration,
      serviceName,
      notes,
      metadata
    } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }
    if (!contactName || !contactPhone) {
      return res.status(400).json({ error: "contactName and contactPhone are required" });
    }
    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: "appointmentDate and appointmentTime are required" });
    }

    const agent = await db
      .select({ userId: agents.userId, flowId: agents.flowId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agent.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const userId = agent[0].userId;
    const flowId = agent[0].flowId;

    // Validate working hours
    const workingHoursResult = await validateWorkingHours(
      userId,
      appointmentDate,
      appointmentTime,
      duration || 30
    );

    if (!workingHoursResult.valid) {
      console.log(`📅 [Appointment Sync] Rejected due to working hours: ${workingHoursResult.message}`);
      return res.status(400).json({
        success: false,
        error: workingHoursResult.message
      });
    }

    const appointmentId = nanoid();
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        id: appointmentId,
        userId,
        callId: callId || null,
        flowId: flowId || null,
        contactName,
        contactPhone,
        contactEmail: contactEmail || null,
        appointmentDate,
        appointmentTime,
        duration: duration || 30,
        serviceName: serviceName || null,
        notes: notes || null,
        status: "scheduled",
        metadata: metadata || null,
      })
      .returning();

    console.log(`📅 [Appointment Sync] Created appointment ${appointmentId} for agent ${agentId}`);
    console.log(`   Contact: ${contactName} (${contactPhone})`);
    console.log(`   Date/Time: ${appointmentDate} at ${appointmentTime}`);

    res.json({
      success: true,
      appointment: newAppointment,
    });
  } catch (error: any) {
    console.error("Error syncing appointment:", error);
    res.status(500).json({ error: "Failed to sync appointment" });
  }
});

router.get("/forms", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;

    const userForms = await db
      .select()
      .from(forms)
      .where(eq(forms.userId, userId))
      .orderBy(desc(forms.createdAt));

    // Include fields and submission count for each form
    const formsWithFieldsAndCount = await Promise.all(
      userForms.map(async (form) => {
        const fields = await db
          .select()
          .from(formFields)
          .where(eq(formFields.formId, form.id))
          .orderBy(formFields.order);

        // Get submission count
        const [submissionResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(formSubmissions)
          .where(eq(formSubmissions.formId, form.id));

        return {
          ...form,
          fields,
          submissionCount: Number(submissionResult?.count || 0)
        };
      })
    );

    res.json(formsWithFieldsAndCount);
  } catch (error: any) {
    console.error("Error fetching forms:", error);
    res.status(500).json({ error: "Failed to fetch forms" });
  }
});

router.get("/forms/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const [form] = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.userId, userId)));

    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }

    const fields = await db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.order);

    res.json({ ...form, fields });
  } catch (error: any) {
    console.error("Error fetching form:", error);
    res.status(500).json({ error: "Failed to fetch form" });
  }
});

router.post("/forms", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { name, description, fields } = req.body;

    const formId = nanoid();
    const [newForm] = await db
      .insert(forms)
      .values({
        id: formId,
        userId,
        name,
        description,
      })
      .returning();

    if (fields && fields.length > 0) {
      const fieldValues = fields.map((field: any, index: number) => ({
        id: nanoid(),
        formId,
        question: field.question,
        fieldType: field.fieldType,
        options: field.options,
        isRequired: field.isRequired ?? true,
        order: index,
      }));

      await db.insert(formFields).values(fieldValues);
    }

    const createdFields = await db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .orderBy(formFields.order);

    res.json({ ...newForm, fields: createdFields });
  } catch (error: any) {
    console.error("Error creating form:", error);
    res.status(500).json({ error: "Failed to create form" });
  }
});

router.patch("/forms/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;
    const { name, description, fields } = req.body;

    const [updatedForm] = await db
      .update(forms)
      .set({
        name,
        description,
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, id), eq(forms.userId, userId)))
      .returning();

    if (!updatedForm) {
      return res.status(404).json({ error: "Form not found" });
    }

    if (fields) {
      await db.delete(formFields).where(eq(formFields.formId, id));

      if (fields.length > 0) {
        const fieldValues = fields.map((field: any, index: number) => ({
          id: nanoid(),
          formId: id,
          question: field.question,
          fieldType: field.fieldType,
          options: field.options,
          isRequired: field.isRequired ?? true,
          order: index,
        }));

        await db.insert(formFields).values(fieldValues);
      }
    }

    const updatedFields = await db
      .select()
      .from(formFields)
      .where(eq(formFields.formId, id))
      .orderBy(formFields.order);

    res.json({ ...updatedForm, fields: updatedFields });
  } catch (error: any) {
    console.error("Error updating form:", error);
    res.status(500).json({ error: "Failed to update form" });
  }
});

router.delete("/forms/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    await db
      .delete(forms)
      .where(and(eq(forms.id, id), eq(forms.userId, userId)));

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting form:", error);
    res.status(500).json({ error: "Failed to delete form" });
  }
});

router.get("/forms/:id/submissions", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { id } = req.params;

    const [form] = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, id), eq(forms.userId, userId)));

    if (!form) {
      return res.status(404).json({ error: "Form not found" });
    }

    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formId, id))
      .orderBy(desc(formSubmissions.submittedAt));

    res.json(submissions);
  } catch (error: any) {
    console.error("Error fetching form submissions:", error);
    res.status(500).json({ error: "Failed to fetch form submissions" });
  }
});

router.get("/executions", async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.userId!;
    const { flowId, callId, status } = req.query;

    const userFlows = await db
      .select({ id: flows.id, nodes: flows.nodes })
      .from(flows)
      .where(eq(flows.userId, userId));

    const userFlowIds = userFlows.map(f => f.id);

    if (userFlowIds.length === 0) {
      return res.json([]);
    }

    const flowNodesMap: Record<string, import('@shared/schema').FlowNode[]> = {};
    for (const flow of userFlows) {
      flowNodesMap[flow.id] = (flow.nodes || []) as import('@shared/schema').FlowNode[];
    }

    const conditions: any[] = [inArray(flowExecutions.flowId, userFlowIds)];

    if (flowId) conditions.push(eq(flowExecutions.flowId, flowId as string));
    if (callId) conditions.push(eq(flowExecutions.callId, callId as string));
    if (status) conditions.push(eq(flowExecutions.status, status as string));

    const executionsWithDetails = await db
      .select({
        id: flowExecutions.id,
        callId: flowExecutions.callId,
        flowId: flowExecutions.flowId,
        flowName: flows.name,
        flowNodes: flows.nodes,
        currentNodeId: flowExecutions.currentNodeId,
        status: flowExecutions.status,
        variables: flowExecutions.variables,
        pathTaken: flowExecutions.pathTaken,
        metadata: flowExecutions.metadata,
        error: flowExecutions.error,
        startedAt: flowExecutions.startedAt,
        completedAt: flowExecutions.completedAt,
        phoneNumber: calls.phoneNumber,
        callStatus: calls.status,
        contactId: calls.contactId,
        callDuration: calls.duration,
        callEndedAt: calls.endedAt,
        callTranscript: calls.transcript,
        callAiSummary: calls.aiSummary,
      })
      .from(flowExecutions)
      .leftJoin(flows, eq(flowExecutions.flowId, flows.id))
      .leftJoin(calls, eq(flowExecutions.callId, calls.id))
      .where(and(...conditions))
      .orderBy(desc(flowExecutions.startedAt))
      .limit(100);

    // Auto-sync: Fix any executions that show "running" but whose call is completed
    // First sync from main calls table
    const executionsToSync = executionsWithDetails.filter(
      e => e.status === 'running' && e.callStatus === 'completed' && e.callEndedAt
    );

    if (executionsToSync.length > 0) {
      console.log(`[Executions API] Syncing ${executionsToSync.length} stale executions from calls table`);
      for (const exec of executionsToSync) {
        await db
          .update(flowExecutions)
          .set({
            status: 'completed',
            completedAt: exec.callEndedAt,
          })
          .where(eq(flowExecutions.id, exec.id));

        // Update in-memory for this response - using Object.assign for type-safe mutation
        Object.assign(exec, { status: 'completed', completedAt: exec.callEndedAt });
      }
    }

    // Second pass: Sync from Plivo calls table for executions still showing "running"
    const stillRunningExecs = executionsWithDetails.filter(
      e => e.status === 'running' && !e.callStatus
    );

    if (stillRunningExecs.length > 0) {
      const stillRunningCallIds = stillRunningExecs.map(e => e.callId);

      // Check plivoCalls table
      const plivoCallStatuses = await db
        .select({ id: plivoCalls.id, status: plivoCalls.status, endedAt: plivoCalls.endedAt })
        .from(plivoCalls)
        .where(inArray(plivoCalls.id, stillRunningCallIds));

      const plivoCallMap = new Map(plivoCallStatuses.map(c => [c.id, c]));

      // Check twilioOpenaiCalls table
      const twilioOpenaiStatuses = await db
        .select({ id: twilioOpenaiCalls.id, status: twilioOpenaiCalls.status, endedAt: twilioOpenaiCalls.endedAt })
        .from(twilioOpenaiCalls)
        .where(inArray(twilioOpenaiCalls.id, stillRunningCallIds));

      const twilioOpenaiMap = new Map(twilioOpenaiStatuses.map(c => [c.id, c]));

      // Check sipCalls table
      const sipCallStatuses = await db
        .select({ id: sipCalls.id, status: sipCalls.status, endedAt: sipCalls.endedAt })
        .from(sipCalls)
        .where(inArray(sipCalls.id, stillRunningCallIds));

      const sipCallMap = new Map(sipCallStatuses.map(c => [c.id, c]));

      for (const exec of stillRunningExecs) {
        const plivoCall = plivoCallMap.get(exec.callId);
        const twilioCall = twilioOpenaiMap.get(exec.callId);
        const sipCall = sipCallMap.get(exec.callId);

        const callInfo = plivoCall || twilioCall || sipCall;

        if (callInfo && callInfo.status && ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(callInfo.status)) {
          const execStatus = callInfo.status === 'completed' ? 'completed' : 'failed';
          await db
            .update(flowExecutions)
            .set({
              status: execStatus,
              completedAt: callInfo.endedAt || new Date(),
              error: callInfo.status !== 'completed' ? `Call ended with status: ${callInfo.status}` : null,
            })
            .where(eq(flowExecutions.id, exec.id));

          Object.assign(exec, { status: execStatus, completedAt: callInfo.endedAt || new Date() });
          console.log(`[Executions API] Synced execution ${exec.id} from alternate call table to ${execStatus}`);
        }
      }
    }

    // Third pass: Timeout-based cleanup for stale executions
    // If execution started >5 minutes ago and is still "running", mark as failed
    // This handles cases where status webhooks never arrived
    const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const now = new Date();

    const staleExecs = executionsWithDetails.filter(e => {
      if (e.status !== 'running') return false;
      if (!e.startedAt) return false;
      const startedAt = new Date(e.startedAt);
      const ageMs = now.getTime() - startedAt.getTime();
      return ageMs > STALE_TIMEOUT_MS;
    });

    if (staleExecs.length > 0) {
      console.log(`[Executions API] Found ${staleExecs.length} stale executions (>5 min old), marking as failed`);
      for (const exec of staleExecs) {
        await db
          .update(flowExecutions)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: 'Call status unknown - marked as failed after timeout (status webhook may not have been received)',
          })
          .where(eq(flowExecutions.id, exec.id));

        Object.assign(exec, {
          status: 'failed',
          completedAt: new Date(),
          error: 'Call status unknown - marked as failed after timeout'
        });
        console.log(`[Executions API] Marked stale execution ${exec.id} as failed (started ${exec.startedAt})`);
      }
    }

    // Look up contact names for executions with contactId
    const contactIds = executionsWithDetails
      .map(e => e.contactId)
      .filter((id): id is string => id !== null);

    const contactsMap: Record<string, { name: string; phone: string }> = {};
    if (contactIds.length > 0) {
      const contactRecords = await db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, phone: contacts.phone })
        .from(contacts)
        .where(inArray(contacts.id, contactIds));

      for (const c of contactRecords) {
        const fullName = c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
        contactsMap[c.id] = { name: fullName, phone: c.phone };
      }
    }

    const enrichedExecutions = executionsWithDetails.map(execution => {
      const nodes = (execution.flowNodes || []) as import('@shared/schema').FlowNode[];
      const pathTaken = (execution.pathTaken || []) as string[];

      // Get contact info - prioritize contacts table, fallback to call phoneNumber
      const contactInfo = execution.contactId ? contactsMap[execution.contactId] : null;

      const detailedPath = pathTaken.map((nodeId, index) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) {
          return {
            nodeId,
            stepNumber: index + 1,
            type: 'unknown',
            label: nodeId,
            content: null
          };
        }

        const config = (node.data?.config || {}) as any;
        let content: string | null = null;
        let label = node.data?.label || node.type || 'Unknown';

        switch (node.type) {
          case 'message':
            content = config.message || null;
            label = 'Message';
            break;
          case 'question':
            content = config.question || null;
            label = `Question: ${config.variableName || 'response'}`;
            break;
          case 'condition':
            content = `Checking: ${config.conditions?.map((c: any) => c.value).join(', ') || 'conditions'}`;
            label = 'Decision';
            break;
          case 'transfer':
            content = `Transfer to: ${config.transferNumber || 'unknown'}`;
            label = 'Transfer';
            break;
          case 'webhook':
            content = `Webhook: ${config.url || 'unknown'}`;
            label = 'Webhook';
            break;
          case 'appointment':
            content = config.serviceName || 'Schedule appointment';
            label = 'Appointment';
            break;
          case 'form':
            content = 'Collecting form data';
            label = 'Form';
            break;
          case 'delay':
            content = `Wait ${config.seconds || 0} seconds`;
            label = 'Delay';
            break;
          case 'end':
            content = config.message || 'End call';
            label = 'End';
            break;
        }

        return {
          nodeId,
          stepNumber: index + 1,
          type: node.type,
          label,
          content
        };
      });

      const { flowNodes, contactId, phoneNumber, callDuration, callEndedAt, callTranscript, callAiSummary, ...rest } = execution;
      const metadataObj = (execution.metadata || {}) as { contactPhone?: string; telephonyProvider?: string; testCall?: boolean };

      return {
        ...rest,
        contactPhone: contactInfo?.phone || phoneNumber || metadataObj.contactPhone || null,
        contactName: contactInfo?.name || null,
        duration: callDuration || null,
        transcriptPreview: callTranscript ? (callTranscript.length > 200 ? callTranscript.substring(0, 200) + '...' : callTranscript) : null,
        aiSummary: callAiSummary || null,
        detailedPath,
        isTestCall: metadataObj.testCall || false,
        telephonyProvider: metadataObj.telephonyProvider || null,
      };
    });

    res.json(enrichedExecutions);
  } catch (error: any) {
    console.error("Error fetching flow executions:", error);
    res.status(500).json({ error: "Failed to fetch flow executions" });
  }
});

export default router;
