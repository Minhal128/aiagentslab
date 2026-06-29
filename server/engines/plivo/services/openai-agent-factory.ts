'use strict';
/**
 * ============================================================
 * OpenAI Agent Factory
 * 
 * Creates OpenAI Realtime agents with integrated tools:
 * - Configure voice, model, system prompt
 * - Add tools (KB lookup, appointments, forms, webhooks)
 * - Handle Flow Builder compiled configurations
 * ============================================================
 */

import type { 
  OpenAIVoice, 
  OpenAIRealtimeModel, 
  AgentTool, 
  AgentConfig, 
  CompiledFlowConfig,
  FlowNode,
  FlowEdge
} from '../types';
import { OPENAI_VOICES, MODEL_TIER_CONFIG } from '../types';
import { RAGKnowledgeService } from '../../../services/rag-knowledge';
import { db } from '../../../db';
import { appointments, appointmentSettings, formSubmissions, agents, flows, forms, formFields } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { validateWebhookUrl } from '../../../utils/url-validator';

/**
 * Context passed to tool handlers during calls
 */
export interface ToolContext {
  userId: string;
  agentId: string;
  callId?: string;
}

/**
 * Extended AgentConfig with context for tool handlers
 */
export interface AgentConfigWithContext extends AgentConfig {
  toolContext?: ToolContext;
}

export class OpenAIAgentFactory {
  /**
   * Get available voices
   */
  static getAvailableVoices(): typeof OPENAI_VOICES {
    return OPENAI_VOICES;
  }

  /**
   * Get available models for a tier
   */
  static getAvailableModels(tier: 'free' | 'pro'): OpenAIRealtimeModel[] {
    return MODEL_TIER_CONFIG[tier].models;
  }

  /**
   * Validate and normalize voice selection
   */
  static validateVoice(voice: string): OpenAIVoice {
    // Map display-only voices to actual OpenAI API voices
    const voiceAliasMap: Record<string, OpenAIVoice> = { arjun: 'echo', priya: 'shimmer' };
    const resolved = voiceAliasMap[voice] ?? voice;
    const validVoice = OPENAI_VOICES.find(v => v.id === resolved);
    if (!validVoice) {
      console.warn(`[Agent Factory] Invalid voice "${voice}", falling back to "alloy"`);
      return 'alloy';
    }
    return resolved as OpenAIVoice;
  }

  /**
   * Validate and normalize model selection based on tier
   */
  static validateModel(model: string, tier: 'free' | 'pro' = 'free'): OpenAIRealtimeModel {
    const allowedModels = this.getAvailableModels(tier);
    if (!allowedModels.includes(model as OpenAIRealtimeModel)) {
      console.warn(`[Agent Factory] Model "${model}" not allowed for tier "${tier}", falling back to ${allowedModels[0]}`);
      return allowedModels[0];
    }
    return model as OpenAIRealtimeModel;
  }

  /**
   * Create an agent configuration for OpenAI Realtime
   */
  static createAgentConfig(params: {
    voice: OpenAIVoice;
    model: OpenAIRealtimeModel;
    systemPrompt: string;
    firstMessage?: string;
    temperature?: number;
    userTier?: 'free' | 'pro';
    toolContext?: ToolContext;
    language?: string;
  }): AgentConfigWithContext {
    const tier = params.userTier || 'free';
    const voice = this.validateVoice(params.voice);
    const model = this.validateModel(params.model, tier);
    const language = params.language || 'en';

    console.log(`[Agent Factory] Creating config: voice=${voice}, model=${model}, tier=${tier}, language=${language}`);

    // Add language instructions to system prompt if not English
    // Guard against duplication (e.g., when called after compileFlow which already added the header)
    let systemPrompt = params.systemPrompt;
    if (language && language !== 'en' && !params.systemPrompt.includes('CRITICAL LANGUAGE REQUIREMENT')) {
      const languageName = this.getLanguageName(language);
      systemPrompt = `CRITICAL LANGUAGE REQUIREMENT: You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English. This is mandatory.\n\n${params.systemPrompt}`;
    }

    return {
      voice,
      model,
      systemPrompt,
      firstMessage: params.firstMessage,
      temperature: params.temperature ?? 0.7,
      tools: [],
      toolContext: params.toolContext,
    };
  }

  /**
   * Add knowledge base lookup tool to agent
   * Uses RAGKnowledgeService for vector similarity search
   */
  static addKnowledgeBaseTool(
    config: AgentConfigWithContext, 
    knowledgeBaseIds: string[],
    userId: string
  ): AgentConfigWithContext {
    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
      console.log(`[Agent Factory] No knowledge bases to add`);
      return config;
    }

    console.log(`[Agent Factory] Adding KB tool for ${knowledgeBaseIds.length} knowledge bases`);

    const kbTool: AgentTool = {
      name: 'lookup_knowledge_base',
      description: 'Search the knowledge base for relevant information to answer user questions. Use this when you need facts, policies, product details, or any information that might be stored.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant information. Be specific and include key terms.',
          },
        },
        required: ['query'],
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const query = params.query as string;
          console.log(`[KB Tool] Searching: "${query.substring(0, 50)}..."`);
          
          const results = await RAGKnowledgeService.searchKnowledge(
            query,
            knowledgeBaseIds,
            userId,
            5 // max results
          );
          
          if (results.length === 0) {
            console.log(`[KB Tool] No results found`);
            return { 
              found: false, 
              message: 'No relevant information found in the knowledge base.' 
            };
          }
          
          const formattedResponse = RAGKnowledgeService.formatResultsForAgent(results, 400);
          console.log(`[KB Tool] Found ${results.length} results`);
          
          return { 
            found: true, 
            information: formattedResponse 
          };
        } catch (error: any) {
          console.error(`[KB Tool] Error:`, error.message);
          return { 
            found: false, 
            message: 'Unable to search knowledge base at this time.' 
          };
        }
      },
    };

    return {
      ...config,
      knowledgeBaseIds,
      tools: [...(config.tools || []), kbTool],
    };
  }

  /**
   * Add appointment booking tool to agent
   * Creates appointments in database directly
   */
  static addAppointmentTool(
    config: AgentConfigWithContext,
    userId: string,
    agentId: string,
    callId?: string,
    callerPhone?: string
  ): AgentConfigWithContext {
    // Skip only if appointment tool already exists WITH a live handler
    const existingApptTool = config.tools?.find(t => t.name === 'book_appointment');
    if (existingApptTool?.handler) {
      console.log(`[Agent Factory] Appointment tool already exists with handler, skipping`);
      return config;
    }
    // If tool exists but has no handler (e.g. deserialized from JSON), remove it so we re-add properly
    if (existingApptTool) {
      console.log(`[Agent Factory] Appointment tool exists without handler — replacing with live handler`);
      config = { ...config, tools: config.tools?.filter(t => t.name !== 'book_appointment') };
    }
    
    console.log(`[Agent Factory] Adding appointment tool for agent ${agentId}`);
    if (callerPhone) {
      console.log(`[Agent Factory] Caller phone available: ${callerPhone}`);
    }

    const toolDescription = callerPhone
      ? `Book an appointment for the caller. The caller's phone number is ${callerPhone} - do NOT ask for their phone number unless they want to use a different one. For contactPhone, use "${callerPhone}" unless they explicitly provide a different number. Collect their name, preferred date and time before calling this tool.`
      : 'Book an appointment for the caller. Collect their name, phone number, preferred date and time before calling this tool.';

    const appointmentTool: AgentTool = {
      name: 'book_appointment',
      description: toolDescription,
      parameters: {
        type: 'object',
        properties: {
          contactName: { 
            type: 'string', 
            description: 'The name of the person booking the appointment' 
          },
          contactPhone: { 
            type: 'string', 
            description: callerPhone 
              ? `The caller's phone number. Default to "${callerPhone}" (the number they are calling from). Only use a different number if the caller explicitly provides one.`
              : 'Phone number exactly as spoken. Accept any format.'
          },
          contactEmail: { 
            type: 'string', 
            description: 'Optional email address' 
          },
          appointmentDate: { 
            type: 'string', 
            description: 'Appointment date in YYYY-MM-DD format' 
          },
          appointmentTime: { 
            type: 'string', 
            description: 'Appointment time in HH:MM format (24-hour)' 
          },
          duration: { 
            type: 'number', 
            description: 'Duration in minutes (default 30)' 
          },
          serviceName: { 
            type: 'string', 
            description: 'Name of the service being booked' 
          },
          notes: { 
            type: 'string', 
            description: 'Additional notes or requirements' 
          },
        },
        required: callerPhone
          ? ['appointmentDate', 'appointmentTime']
          : ['contactName', 'contactPhone', 'appointmentDate', 'appointmentTime'],
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          // Auto-fill caller phone — always use caller's number if not explicitly provided
          if (callerPhone && (!params.contactPhone || params.contactPhone === 'USE_CALLER_NUMBER' || params.contactPhone === 'same')) {
            params.contactPhone = callerPhone;
            console.log(`[Appointment Tool] Auto-filled caller phone: ${callerPhone}`);
          }
          // Default name to "Customer" if not collected — don't block booking over a name
          if (!params.contactName) {
            params.contactName = 'Customer';
          }

          // Normalize date to YYYY-MM-DD (AI may send "June 30", "30 June 2026", etc.)
          if (params.appointmentDate) {
            const raw = String(params.appointmentDate).trim();
            const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!isoMatch) {
              const parsed = new Date(raw);
              if (!isNaN(parsed.getTime())) {
                const y = parsed.getFullYear();
                const m = String(parsed.getMonth() + 1).padStart(2, '0');
                const d = String(parsed.getDate()).padStart(2, '0');
                params.appointmentDate = `${y}-${m}-${d}`;
              }
            }
          }

          // Normalize time to HH:MM 24h (AI may send "10:30 AM", "2:30 PM", "2pm", etc.)
          if (params.appointmentTime) {
            const raw = String(params.appointmentTime).trim();
            const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?$/i);
            if (hhmm) {
              let h = parseInt(hhmm[1], 10);
              const min = hhmm[2];
              const meridiem = (hhmm[4] || '').toLowerCase();
              if (meridiem === 'pm' && h < 12) h += 12;
              if (meridiem === 'am' && h === 12) h = 0;
              params.appointmentTime = `${String(h).padStart(2, '0')}:${min}`;
            } else {
              // Try "2pm", "10am" shorthand
              const short = raw.match(/^(\d{1,2})\s*(am|pm)$/i);
              if (short) {
                let h = parseInt(short[1], 10);
                const meridiem = short[2].toLowerCase();
                if (meridiem === 'pm' && h < 12) h += 12;
                if (meridiem === 'am' && h === 12) h = 0;
                params.appointmentTime = `${String(h).padStart(2, '0')}:00`;
              }
            }
          }

          console.log(`[Appointment Tool] Booking: ${JSON.stringify(params)}`);

          // Validate required parameters
          if (!params.contactName || !params.contactPhone || !params.appointmentDate || !params.appointmentTime) {
            return {
              success: false,
              message: 'Please provide name, phone, date and time for the appointment.'
            };
          }
          
          // Get agent's flowId — only use it if the flow still exists (prevents FK violation)
          const [agent] = await db
            .select({ flowId: agents.flowId })
            .from(agents)
            .where(eq(agents.id, agentId))
            .limit(1);
          let safeFlowId: string | null = null;
          if (agent?.flowId) {
            const [flowExists] = await db
              .select({ id: flows.id })
              .from(flows)
              .where(eq(flows.id, agent.flowId))
              .limit(1);
            safeFlowId = flowExists ? agent.flowId : null;
          }
          
          // Check user's appointment settings for overlap validation and working hours
          const [settings] = await db
            .select()
            .from(appointmentSettings)
            .where(eq(appointmentSettings.userId, userId));
          
          // Default working hours
          const defaultWorkingHours: Record<string, { start: string; end: string; enabled: boolean }> = {
            monday: { start: "09:00", end: "17:00", enabled: true },
            tuesday: { start: "09:00", end: "17:00", enabled: true },
            wednesday: { start: "09:00", end: "17:00", enabled: true },
            thursday: { start: "09:00", end: "17:00", enabled: true },
            friday: { start: "09:00", end: "17:00", enabled: true },
            saturday: { start: "09:00", end: "17:00", enabled: false },
            sunday: { start: "09:00", end: "17:00", enabled: false },
          };
          
          // Validate working hours
          const appointmentDate = params.appointmentDate as string;
          const appointmentTime = params.appointmentTime as string;
          const parsedDate = new Date(appointmentDate + 'T12:00:00');
          
          if (!isNaN(parsedDate.getTime())) {
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
            const dayOfWeek = parsedDate.getDay();
            const dayName = dayNames[dayOfWeek];
            
            const userWorkingHours = settings?.workingHours as Record<string, { start: string; end: string; enabled: boolean }> | undefined;
            const daySettings = userWorkingHours?.[dayName] 
              ? { ...defaultWorkingHours[dayName], ...userWorkingHours[dayName] }
              : defaultWorkingHours[dayName];
            
            console.log(`[Appointment Tool] Working hours for ${dayName}:`, daySettings);
            
            if (!daySettings?.enabled) {
              const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
              console.log(`[Appointment Tool] Rejected: ${dayName} is not available for appointments`);
              return {
                success: false,
                message: `We're not available on ${capitalizedDay}s. Please choose a different day.`
              };
            }
            
            // Check time is within working hours
            try {
              const parseTimeToMinutes = (timeStr: string): number => {
                const parts = timeStr.split(':');
                return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
              };
              
              const requestedMinutes = parseTimeToMinutes(appointmentTime);
              const startMinutes = parseTimeToMinutes(daySettings.start || "09:00");
              const endMinutes = parseTimeToMinutes(daySettings.end || "17:00");
              const duration = (params.duration as number) || 30;
              const appointmentEndMinutes = requestedMinutes + duration;
              
              if (requestedMinutes < startMinutes || appointmentEndMinutes > endMinutes) {
                const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
                console.log(`[Appointment Tool] Rejected: ${appointmentTime} is outside working hours`);
                return {
                  success: false,
                  message: `${appointmentTime} is outside our available hours on ${capitalizedDay}. We're available from ${daySettings.start} to ${daySettings.end}.`
                };
              }
            } catch (e) {
              console.log(`[Appointment Tool] Time validation error, allowing booking`);
            }
          }
          
          // Check for duplicate booking from same call (prevents double-booking during same conversation)
          if (callId) {
            const duplicateFromCall = await db
              .select()
              .from(appointments)
              .where(
                and(
                  eq(appointments.callId, callId),
                  eq(appointments.appointmentDate, params.appointmentDate as string),
                  eq(appointments.status, 'scheduled')
                )
              );
            
            if (duplicateFromCall.length > 0) {
              console.log(`[Appointment Tool] Duplicate booking attempt from same call ${callId}`);
              return {
                success: true,
                appointmentId: duplicateFromCall[0].id,
                message: `Your appointment is already confirmed for ${params.appointmentDate} at ${duplicateFromCall[0].appointmentTime}.`,
                alreadyBooked: true
              };
            }
          }

          // Check for duplicate booking by same contact phone on same date/time
          const duplicateByContact = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.userId, userId),
                eq(appointments.contactPhone, params.contactPhone as string),
                eq(appointments.appointmentDate, params.appointmentDate as string),
                eq(appointments.appointmentTime, params.appointmentTime as string),
                eq(appointments.status, 'scheduled')
              )
            );
          
          if (duplicateByContact.length > 0) {
            console.log(`[Appointment Tool] Duplicate booking attempt by same contact`);
            return {
              success: true,
              appointmentId: duplicateByContact[0].id,
              message: `You already have an appointment at this time. Your appointment is confirmed for ${params.appointmentDate} at ${params.appointmentTime}.`,
              alreadyBooked: true
            };
          }

          // Check for overlapping appointments if not allowed
          if (settings && !settings.allowOverlapping) {
            const existing = await db
              .select()
              .from(appointments)
              .where(
                and(
                  eq(appointments.userId, userId),
                  eq(appointments.appointmentDate, params.appointmentDate as string),
                  eq(appointments.appointmentTime, params.appointmentTime as string),
                  eq(appointments.status, 'scheduled')
                )
              );
            
            if (existing.length > 0) {
              console.log(`[Appointment Tool] Slot conflict at ${params.appointmentDate} ${params.appointmentTime}`);
              return {
                success: false,
                message: `That time slot is already booked. Please choose a different time.`
              };
            }
          }
          
          console.log(`[Appointment Tool] ✅ All checks passed. Inserting into DB: userId=${userId} callId=${callId || 'none'} agentId=${agentId}`);
          console.log(`[Appointment Tool]    → name="${params.contactName}" phone="${params.contactPhone}" date="${params.appointmentDate}" time="${params.appointmentTime}"`);

          const appointmentId = nanoid();
          const [newAppointment] = await db
            .insert(appointments)
            .values({
              id: appointmentId,
              userId,
              callId: callId || null,
              flowId: safeFlowId,
              contactName: params.contactName as string,
              contactPhone: params.contactPhone as string,
              contactEmail: (params.contactEmail as string) || null,
              appointmentDate: params.appointmentDate as string,
              appointmentTime: params.appointmentTime as string,
              duration: (params.duration as number) || 30,
              serviceName: (params.serviceName as string) || null,
              notes: (params.notes as string) || null,
              status: 'scheduled',
              metadata: { source: 'openai-agent', agentId },
            })
            .returning();

          if (newAppointment) {
            console.log(`[Appointment Tool] 🎉 SUCCESS: appointment ${appointmentId} saved to DB`);
          } else {
            console.error(`[Appointment Tool] ❌ DB insert returned no rows — possible constraint violation`);
          }

          return {
            success: true,
            appointmentId,
            message: `Appointment booked for ${params.contactName} on ${params.appointmentDate} at ${params.appointmentTime}`
          };
        } catch (error: any) {
          console.error(`[Appointment Tool] ❌ DB ERROR: ${error.message}`);
          console.error(`[Appointment Tool]    Stack: ${error.stack}`);
          return {
            success: false,
            message: 'Unable to book appointment at this time. Do NOT retry. Tell the caller there was a technical issue and continue the conversation.'
          };
        }
      },
    };

    const apptPromptAddition = `\n\nCRITICAL APPOINTMENT BOOKING RULE: You are an internal booking system. You MUST call book_appointment tool immediately after getting name, date and time. NEVER say you cannot save or book. NEVER ask for clinic name, hospital name, or doctor details - NOT required. You only need: name, date, time. Call the tool IMMEDIATELY. Works in all languages including Hindi and Urdu.`;

    return {
      ...config,
      systemPrompt: (config.systemPrompt || '') + apptPromptAddition,
      tools: [...(config.tools || []), appointmentTool],
    };
  }

  /**
   * Add form submission tool to agent
   * Submits collected data to form submission table
   */
  static addFormTool(
    config: AgentConfigWithContext, 
    formId: string,
    formName: string,
    formFields: Array<{ id: string; question: string; fieldType: string; isRequired: boolean }>,
    userId: string,
    callId?: string
  ): AgentConfigWithContext {
    // Skip if form tool already exists to prevent duplicates
    // Form tool names can be "submit_form" or "submit_form_node_2" (with node ID suffix)
    if (config.tools?.some(t => t.name.startsWith('submit_form'))) {
      console.log(`[Agent Factory] Form tool already exists, skipping`);
      return config;
    }
    
    console.log(`[Agent Factory] Adding form tool for form ${formId} (${formName})`);

    // Build field descriptions for the tool
    const fieldProperties: Record<string, any> = {
      contactName: {
        type: 'string',
        description: 'Name of the person providing the information'
      },
      contactPhone: {
        type: 'string',
        description: 'Phone number exactly as spoken'
      }
    };
    
    const requiredFields = ['contactName', 'contactPhone'];
    
    for (const field of formFields) {
      const fieldKey = `field_${field.id.replace(/-/g, '_')}`;
      
      switch (field.fieldType) {
        case 'number':
          fieldProperties[fieldKey] = {
            type: 'number',
            description: `Numeric answer to: "${field.question}"`
          };
          break;
        case 'yes_no':
          fieldProperties[fieldKey] = {
            type: 'boolean',
            description: `Yes/No answer to: "${field.question}" (true = yes, false = no)`
          };
          break;
        default:
          fieldProperties[fieldKey] = {
            type: 'string',
            description: `Answer to: "${field.question}"`
          };
      }
      
      if (field.isRequired) {
        requiredFields.push(fieldKey);
      }
    }

    const formTool: AgentTool & { _formId: string; _formName: string; _formFields: typeof formFields } = {
      name: 'submit_form',
      description: `Submit the collected information for "${formName}". Collect all required fields before calling this tool.`,
      parameters: {
        type: 'object',
        properties: fieldProperties,
        required: requiredFields,
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          console.log(`[Form Tool] Submitting to form ${formId}: ${JSON.stringify(params)}`);
          
          // Build responses array in the required format
          const responses: Array<{ fieldId: string; question: string; answer: string }> = [];
          
          for (const field of formFields) {
            const fieldKey = `field_${field.id.replace(/-/g, '_')}`;
            const value = params[fieldKey];
            if (value !== undefined && value !== null) {
              responses.push({
                fieldId: field.id,
                question: field.question,
                answer: String(value),
              });
            }
          }
          
          const submissionId = nanoid();
          const [submission] = await db
            .insert(formSubmissions)
            .values({
              id: submissionId,
              formId,
              callId: callId || null,
              contactName: (params.contactName as string) || null,
              contactPhone: (params.contactPhone as string) || null,
              responses,
            })
            .returning();
          
          console.log(`[Form Tool] Created submission ${submissionId}`);
          
          return { 
            success: true, 
            submissionId,
            message: 'Your information has been saved successfully.' 
          };
        } catch (error: any) {
          console.error(`[Form Tool] Error:`, error.message);
          return { 
            success: false, 
            message: 'Unable to save information at this time. Please try again.' 
          };
        }
      },
      // Store for serialization
      _formId: formId,
      _formName: formName,
      _formFields: formFields,
    };

    return {
      ...config,
      tools: [...(config.tools || []), formTool],
    };
  }

  /**
   * Add call transfer tool to agent
   */
  static addTransferTool(
    config: AgentConfigWithContext,
    transferNumber: string,
    transferMessage?: string
  ): AgentConfigWithContext {
    // Skip if transfer tool already exists to prevent duplicates
    if (config.tools?.some(t => t.name === 'transfer_call')) {
      console.log(`[Agent Factory] Transfer tool already exists, skipping`);
      return config;
    }
    
    console.log(`[Agent Factory] Adding transfer tool to ${transferNumber}`);

    const transferTool: AgentTool & { _transferNumber: string } = {
      name: 'transfer_call',
      description: 'Transfer the call to a human agent. IMPORTANT: Before calling this function, you MUST first say a brief transfer announcement like "Sure, let me transfer you to an agent now" or "One moment, I will connect you with a representative". After speaking this announcement, immediately call this function. You MUST call this function when: (1) the user explicitly asks to speak to a human, agent, or real person, (2) the user says "transfer", "connect me", or similar phrases, (3) you cannot help them with their request.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief reason for the transfer'
          }
        },
        required: ['reason'],
      },
      handler: async (params: Record<string, unknown>) => {
        console.log(`[Transfer Tool] Initiating transfer to ${transferNumber}, reason: ${params.reason || 'none'}`);
        // The actual transfer is handled by the audio bridge
        return { 
          action: 'transfer',
          phoneNumber: transferNumber,
          reason: params.reason as string
        };
      },
      _transferNumber: transferNumber, // Store for serialization
    };

    return {
      ...config,
      tools: [...(config.tools || []), transferTool],
    };
  }

  /**
   * Add end call tool to agent
   */
  static addEndCallTool(config: AgentConfigWithContext): AgentConfigWithContext {
    // Skip if end_call tool already exists to prevent duplicates
    if (config.tools?.some(t => t.name === 'end_call')) {
      console.log(`[Agent Factory] End call tool already exists, skipping`);
      return config;
    }
    
    console.log(`[Agent Factory] Adding end call tool`);

    const endCallTool: AgentTool = {
      name: 'end_call',
      description: 'IMMEDIATELY end the call. You MUST call this function when: (1) the user says "bye", "goodbye", "thank you bye", "have a good day", "that\'s all", "I\'m done", "hang up", or any farewell phrase, (2) the conversation has naturally concluded and all tasks are complete, (3) the user explicitly asks to end the call. DO NOT just say goodbye - you MUST actually call this function to disconnect the call.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Brief reason for ending the call'
          }
        },
        required: [],
      },
      handler: async (params: Record<string, unknown>) => {
        console.log(`[End Call Tool] Ending call, reason: ${params.reason || 'conversation complete'}`);
        return { 
          action: 'end_call',
          reason: params.reason as string || 'conversation complete'
        };
      },
    };

    return {
      ...config,
      tools: [...(config.tools || []), endCallTool],
    };
  }

  static addMessagingEmailTool(
    config: AgentConfigWithContext,
    userId: string,
    agentId: string,
    callId: string | undefined,
    templateName?: string | null,
    templateNames: string[] = []
  ): AgentConfigWithContext {
    if (config.tools?.some(t => t.name === 'send_email')) {
      console.log(`[Agent Factory] send_email tool already exists, skipping`);
      return config;
    }

    let templateInstruction: string;
    if (templateName) {
      templateInstruction = `You MUST use the template named "${templateName}".`;
    } else if (templateNames.length > 0) {
      templateInstruction = `Available email templates: ${templateNames.join(', ')}.`;
    } else {
      templateInstruction = 'Use the template name configured by the user.';
    }

    console.log(`[Agent Factory] Adding send_email tool`);

    const emailTool: AgentTool = {
      name: 'send_email',
      description: `Send an email to the caller. You MUST ask for their email address first before using this tool. ${templateInstruction} The system will automatically fill in agent_name and appointment details (appointment_date, appointment_time, service_name, duration, appointment_notes) from the current call. You should provide contact_name from the conversation. Any additional variables can be passed via dynamic_variables.`,
      parameters: {
        type: 'object',
        properties: {
          recipient_email: {
            type: 'string',
            description: 'The email address to send the email to. You must ask the caller for this.'
          },
          template_name: {
            type: 'string',
            description: templateName
              ? `The email template to use. ALWAYS use "${templateName}".`
              : `The name of the email template to use. ${templateInstruction}`
          },
          contact_name: {
            type: 'string',
            description: 'The name of the caller/contact collected during the conversation.'
          },
          dynamic_variables: {
            type: 'object',
            description: 'Additional key-value pairs for template variable substitution beyond the auto-injected ones.'
          }
        },
        required: ['recipient_email', 'template_name'],
      },
      _messagingContext: { userId, agentId, callId, defaultTemplate: templateName || undefined },
    } as any;

    return {
      ...config,
      tools: [...(config.tools || []), emailTool],
    };
  }

  static addCollectCallerEmailTool(
    config: AgentConfigWithContext,
    userId: string,
    agentId: string,
    callId: string | undefined
  ): AgentConfigWithContext {
    if (config.tools?.some(t => t.name === 'collect_caller_email')) {
      return config;
    }
    console.log(`[Agent Factory] Adding collect_caller_email tool`);
    const collectTool: AgentTool & { _messagingContext: { userId: string; agentId: string; callId: string | undefined } } = {
      name: 'collect_caller_email',
      description: 'Ask the caller for their email address and store it for post-call follow-up email. Call this tool as soon as you have collected the caller\'s email address. Do not send an email immediately — the email will be sent automatically after the call ends.',
      parameters: {
        type: 'object',
        properties: {
          email_address: {
            type: 'string',
            description: 'The email address provided by the caller.'
          }
        },
        required: ['email_address'],
      },
      _messagingContext: { userId, agentId, callId },
      handler: async () => ({ success: true }),
    };
    return {
      ...config,
      tools: [...(config.tools || []), collectTool],
    };
  }

  static addMessagingWhatsAppTool(
    config: AgentConfigWithContext,
    userId: string,
    agentId: string,
    callId: string | undefined,
    templateName?: string | null,
    templateNames: string[] = [],
    variableDescriptions?: string | null
  ): AgentConfigWithContext {
    if (config.tools?.some(t => t.name === 'send_whatsapp')) {
      console.log(`[Agent Factory] send_whatsapp tool already exists, skipping`);
      return config;
    }

    let templateInstruction: string;
    if (templateName) {
      templateInstruction = `You MUST use the template named "${templateName}".`;
    } else if (templateNames.length > 0) {
      templateInstruction = `Available WhatsApp templates: ${templateNames.join(', ')}.`;
    } else {
      templateInstruction = 'Use the template name configured by the user.';
    }

    let parsedVars: Record<string, any> = {};
    try {
      if (variableDescriptions) parsedVars = JSON.parse(variableDescriptions);
    } catch { /* ignore */ }

    const fixedVars: Record<string, string> = {};
    const collectVars: Record<string, string> = {};
    const fixedButtonVars: Record<number, string> = {};
    for (const [idx, val] of Object.entries(parsedVars)) {
      if (typeof val === 'string') {
        collectVars[idx] = val;
      } else if (val && typeof val === 'object' && (val as any).componentType === 'button') {
        const btnIdx = idx.startsWith('btn_') ? parseInt(idx.replace('btn_', '')) : parseInt(idx);
        if (!isNaN(btnIdx)) {
          fixedButtonVars[btnIdx] = (val as any).value || '';
        }
      } else if (val && typeof val === 'object' && (val as any).mode === 'fixed') {
        fixedVars[idx] = (val as any).value || '';
      } else if (val && typeof val === 'object' && (val as any).mode === 'collect') {
        collectVars[idx] = (val as any).value || '';
      }
    }

    const hasCollectVars = Object.keys(collectVars).length > 0;
    const hasFixedVars = Object.keys(fixedVars).length > 0;
    const hasAnyVars = hasCollectVars || hasFixedVars;

    let variableInstruction = '';
    if (hasCollectVars) {
      const varList = Object.entries(collectVars).map(([idx, desc]) => `{{${idx}}} = ${desc}`).join(', ');
      variableInstruction += ` This template has variables you MUST collect from the caller: ${varList}. Collect these values from the conversation before sending.`;
    }
    if (hasFixedVars) {
      const fixedList = Object.entries(fixedVars).map(([idx, val]) => `{{${idx}}}`).join(', ');
      variableInstruction += ` The following variables are pre-filled automatically: ${fixedList}. Do NOT ask the caller for these values.`;
    }

    console.log(`[Agent Factory] Adding send_whatsapp tool (${hasCollectVars ? Object.keys(collectVars).length + ' collect' : '0 collect'}, ${hasFixedVars ? Object.keys(fixedVars).length + ' fixed' : '0 fixed'})`);

    const properties: Record<string, any> = {
      template_name: {
        type: 'string',
        description: templateName
          ? `The WhatsApp template to send. ALWAYS use "${templateName}".`
          : `The name of the WhatsApp template to send. ${templateInstruction}`
      },
      language: {
        type: 'string',
        description: 'The language code for the template (default: en_US)'
      },
      phone_number: {
        type: 'string',
        description: 'The phone number to send the WhatsApp message to. Use the caller phone number from the call if available.'
      }
    };

    if (hasCollectVars) {
      const varProperties: Record<string, any> = {};
      const varRequired: string[] = [];
      for (const [idx, desc] of Object.entries(collectVars)) {
        const key = `var_${idx}`;
        varProperties[key] = {
          type: 'string',
          description: `Value for template variable {{${idx}}}: ${desc}`
        };
        varRequired.push(key);
      }
      properties.variables = {
        type: 'object',
        description: 'Template variable values to collect from the caller. Each key corresponds to a placeholder in the template.',
        properties: varProperties,
        required: varRequired,
      };
    }

    const whatsappTool: AgentTool = {
      name: 'send_whatsapp',
      description: `Send a WhatsApp message to the caller using an approved template. The caller's phone number is automatically available from the call. ${templateInstruction}${variableInstruction}`,
      parameters: {
        type: 'object',
        properties,
        required: hasCollectVars ? ['template_name', 'variables'] : ['template_name'],
      },
      _messagingContext: { userId, agentId, callId, defaultTemplate: templateName || undefined, fixedVariables: hasFixedVars ? fixedVars : undefined, fixedButtonVariables: Object.keys(fixedButtonVars).length > 0 ? fixedButtonVars : undefined },
    } as any;

    return {
      ...config,
      tools: [...(config.tools || []), whatsappTool],
    };
  }

  /**
   * Enable language detection by enhancing the system prompt
   * OpenAI models can naturally detect and respond in multiple languages
   */
  static enableLanguageDetection(config: AgentConfigWithContext): AgentConfigWithContext {
    console.log(`[Agent Factory] Enabling language detection`);

    const languageInstruction = `

LANGUAGE DETECTION: You have automatic language detection enabled. Listen carefully to the language the caller is speaking and ALWAYS respond in the SAME language they use. If they switch languages, you should switch too. Support all major world languages naturally.`;

    return {
      ...config,
      systemPrompt: config.systemPrompt + languageInstruction,
    };
  }

  /**
   * Recursively substitute {{variable}} placeholders in an object with values from params
   */
  private static substituteVariables(
    template: unknown,
    params: Record<string, unknown>
  ): unknown {
    if (typeof template === 'string') {
      let result = template;
      const variablePattern = /\{\{(\w+)\}\}/g;
      let match;
      while ((match = variablePattern.exec(template)) !== null) {
        const varName = match[1];
        const value = params[varName];
        if (value !== undefined) {
          result = result.replace(match[0], String(value));
        }
      }
      return result;
    }
    if (Array.isArray(template)) {
      return template.map(item => this.substituteVariables(item, params));
    }
    if (template !== null && typeof template === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.substituteVariables(value, params);
      }
      return result;
    }
    return template;
  }

  /**
   * Add webhook tool to agent for custom integrations
   */
  static addWebhookTool(
    config: AgentConfigWithContext,
    webhookUrl: string,
    toolName: string,
    description: string,
    parameters: Record<string, any>,
    webhookMethod: string = 'POST',
    payloadTemplate?: Record<string, any>
  ): AgentConfigWithContext {
    console.log(`[Agent Factory] Adding webhook tool: ${toolName} (${webhookMethod})`);
    if (payloadTemplate) {
      console.log(`[Agent Factory] Webhook payload template:`, JSON.stringify(payloadTemplate));
    }

    // Ensure contact_name and contact_phone are always in the parameters so OpenAI collects them
    const enhancedParameters = {
      type: 'object',
      properties: {
        contact_name: {
          type: 'string',
          description: 'Name of the contact (person on the call)'
        },
        contact_phone: {
          type: 'string',
          description: 'Phone number of the contact'
        },
        ...(parameters.properties || {})
      },
      required: Array.from(new Set(['contact_name', 'contact_phone', ...(parameters.required || [])]))
    };

    const webhookTool: AgentTool & { _webhookUrl: string; _webhookMethod: string; _payloadTemplate?: Record<string, any> } = {
      name: toolName,
      description,
      parameters: enhancedParameters,
      handler: async (params: Record<string, unknown>) => {
        try {
          let payload: unknown;
          // Only use payloadTemplate if it has actual content, otherwise use params directly
          if (payloadTemplate && Object.keys(payloadTemplate).length > 0) {
            payload = OpenAIAgentFactory.substituteVariables(payloadTemplate, params);
            console.log(`[Webhook Tool] Substituted payload:`, JSON.stringify(payload));
          } else {
            // Use params directly - this contains the collected conversation data from OpenAI
            payload = params;
            console.log(`[Webhook Tool] Using params as payload:`, JSON.stringify(params));
          }
          
          console.log(`[Webhook Tool] ${webhookMethod} ${webhookUrl} with:`, JSON.stringify(payload));
          
          const urlCheck = await validateWebhookUrl(webhookUrl);
          if (!urlCheck.valid) {
            throw new Error(`Webhook URL blocked: ${urlCheck.error}`);
          }
          
          const fetchOptions: RequestInit = {
            method: webhookMethod,
            headers: { 'Content-Type': 'application/json' },
          };
          
          if (['POST', 'PUT', 'PATCH'].includes(webhookMethod.toUpperCase())) {
            fetchOptions.body = JSON.stringify(payload);
          }
          
          const response = await fetch(webhookUrl, fetchOptions);
          
          if (!response.ok) {
            throw new Error(`Webhook returned ${response.status}`);
          }
          
          const data = await response.json();
          console.log(`[Webhook Tool] Response:`, data);
          return data;
        } catch (error: any) {
          console.error(`[Webhook Tool] Error:`, error.message);
          return { success: false, error: error.message };
        }
      },
      _webhookUrl: webhookUrl,
      _webhookMethod: webhookMethod,
      _payloadTemplate: payloadTemplate,
    };

    return {
      ...config,
      tools: [...(config.tools || []), webhookTool],
    };
  }

  /**
   * Hydrate compiled tools from database storage into AgentTool format with handlers
   * This converts the stored OpenAIFunctionTool format back to runtime AgentTool format
   * 
   * @param compiledTools - Tools from flow.compiledTools (stored at save time)
   * @param context - Context for handlers (userId, agentId, callId, knowledgeBaseIds, transferNumber)
   * @returns Array of AgentTools with proper handlers attached
   */
  static hydrateCompiledTools(
    compiledTools: Array<{ type: string; function: { name: string; description: string; parameters: any } }>,
    context: {
      userId: string;
      agentId: string;
      callId?: string;
      knowledgeBaseIds?: string[];
      transferPhoneNumber?: string;
    }
  ): AgentTool[] {
    const tools: AgentTool[] = [];
    
    for (const compiledTool of compiledTools) {
      const toolName = compiledTool.function.name;
      const description = compiledTool.function.description;
      const parameters = compiledTool.function.parameters;
      
      let handler: (params: Record<string, unknown>) => Promise<unknown>;
      
      // Create appropriate handler based on tool name
      switch (toolName) {
        case 'end_call':
          handler = async (params: Record<string, unknown>) => {
            console.log(`[End Call Tool] Ending call, reason: ${params.reason || 'conversation complete'}`);
            return { 
              action: 'end_call',
              reason: params.reason as string || 'conversation complete'
            };
          };
          break;
          
        case 'transfer_call':
          handler = async (params: Record<string, unknown>) => {
            const phoneNumber = context.transferPhoneNumber || 'unknown';
            console.log(`[Transfer Tool] Initiating transfer to ${phoneNumber}, reason: ${params.reason || 'none'}`);
            return { 
              action: 'transfer',
              phoneNumber,
              reason: params.reason as string
            };
          };
          break;
          
        case 'query_knowledge_base':
        case 'lookup_knowledge_base':
          handler = async (params: Record<string, unknown>) => {
            try {
              const query = params.query as string;
              console.log(`[KB Tool] Searching: "${query?.substring(0, 50)}..."`);
              
              if (!context.knowledgeBaseIds || context.knowledgeBaseIds.length === 0) {
                return { found: false, message: 'No knowledge base configured.' };
              }
              
              const results = await RAGKnowledgeService.searchKnowledge(
                query,
                context.knowledgeBaseIds,
                context.userId,
                5
              );
              
              if (results.length === 0) {
                return { found: false, message: 'No relevant information found.' };
              }
              
              const formattedResponse = RAGKnowledgeService.formatResultsForAgent(results, 400);
              console.log(`[KB Tool] Found ${results.length} results`);
              
              return { found: true, information: formattedResponse };
            } catch (error: any) {
              console.error(`[KB Tool] Error:`, error.message);
              return { found: false, message: 'Unable to search knowledge base.' };
            }
          };
          break;
          
        case 'book_appointment':
          // Use the full appointment handler - delegate to addAppointmentTool's handler logic
          handler = async (params: Record<string, unknown>) => {
            try {
              console.log(`[Appointment Tool] Booking via hydrated tool:`, JSON.stringify(params));
              
              if (!params.contactName || !params.contactPhone || !params.appointmentDate || !params.appointmentTime) {
                return {
                  success: false,
                  message: 'Please provide name, phone, date and time for the appointment.'
                };
              }
              
              const appointmentId = nanoid();
              const [appointment] = await db
                .insert(appointments)
                .values({
                  id: appointmentId,
                  userId: context.userId,
                  callId: context.callId,
                  contactName: params.contactName as string,
                  contactPhone: params.contactPhone as string,
                  contactEmail: (params.contactEmail as string) || null,
                  appointmentDate: params.appointmentDate as string,
                  appointmentTime: params.appointmentTime as string,
                  duration: (params.duration as number) || 30,
                  serviceName: (params.serviceName as string) || null,
                  notes: (params.notes as string) || null,
                  status: 'scheduled',
                })
                .returning();
              
              console.log(`[Appointment Tool] Created appointment ${appointmentId}`);
              return { success: true, appointmentId, message: 'Appointment booked successfully.' };
            } catch (error: any) {
              console.error(`[Appointment Tool] Error:`, error.message);
              return { success: false, message: 'Unable to book appointment at this time.' };
            }
          };
          break;
          
        default:
          // Check if this is a form submission tool (name starts with 'submit_form_')
          if (toolName.startsWith('submit_form_')) {
            // Extract form metadata from compiled tool if available
            const formName = (compiledTool as any)._formName || null;
            
            handler = async (params: Record<string, unknown>) => {
              try {
                console.log(`[Form Tool Hydrated] ${toolName} called with:`, JSON.stringify(params));
                
                // Extract form ID from tool name (e.g., submit_form_node_2 -> node_2)
                const formIdMatch = toolName.match(/submit_form_(.+)/);
                const formId = formIdMatch ? formIdMatch[1] : toolName;
                
                // Build responses array from params (excluding contact fields)
                const responses: Array<{ fieldId: string; question: string; answer: string }> = [];
                const excludeKeys = ['contactName', 'contactPhone', 'contactEmail', 'contact_name', 'contact_phone', 'contact_email', 'fullName', 'email', 'phone', 'name', 'phoneNumber'];
                
                for (const [key, value] of Object.entries(params)) {
                  if (!excludeKeys.includes(key) && value !== undefined && value !== null) {
                    // Handle field_* keys
                    const fieldId = key.startsWith('field_') ? key.replace('field_', '').replace(/_/g, '-') : key;
                    responses.push({
                      fieldId,
                      question: key,
                      answer: String(value),
                    });
                  }
                }
                
                // Normalize contact fields (handle both camelCase and snake_case)
                const contactName = (params.contactName || params.contact_name || params.fullName || params.name) as string | undefined;
                const contactPhone = (params.contactPhone || params.contact_phone || params.phone || params.phoneNumber) as string | undefined;
                const contactEmail = (params.contactEmail || params.contact_email || params.email) as string | undefined;
                
                const submissionId = nanoid();
                const [submission] = await db
                  .insert(formSubmissions)
                  .values({
                    id: submissionId,
                    formId,
                    callId: context.callId || null,
                    contactName: contactName || null,
                    contactPhone: contactPhone || null,
                    responses,
                  })
                  .returning();
                
                console.log(`[Form Tool Hydrated] Created submission ${submissionId} with contactName=${contactName}, contactPhone=${contactPhone}`);
                
                // Trigger form.submitted webhook event
                try {
                  await webhookDeliveryService.triggerEvent(context.userId, 'form.submitted', {
                    submission: {
                      id: submissionId,
                      formId: formId,
                      formName: formName,
                      contactName: contactName || null,
                      contactPhone: contactPhone || null,
                      responses: responses,
                      submittedAt: new Date().toISOString(),
                    },
                    call: {
                      id: context.callId || null,
                    },
                  });
                  console.log(`[Form Tool Hydrated] Triggered form.submitted webhook event`);
                } catch (webhookError: any) {
                  console.error(`[Form Tool Hydrated] Failed to trigger webhook:`, webhookError.message);
                }
                
                return { 
                  success: true, 
                  submissionId,
                  message: 'Your information has been saved successfully.' 
                };
              } catch (error: any) {
                console.error(`[Form Tool Hydrated] Error:`, error.message);
                return { 
                  success: false, 
                  message: 'Unable to save information at this time.' 
                };
              }
            };
            break;
          }
          
          // Check if this is a webhook tool (name starts with 'webhook_')
          if (toolName.startsWith('webhook_')) {
            // Extract metadata from compiled tool if available
            const metadata = (compiledTool as any)._metadata;
            
            if (metadata?.webhookUrl) {
              const webhookUrl = metadata.webhookUrl;
              const webhookMethod = metadata.webhookMethod || 'POST';
              const payloadTemplate = metadata.payloadTemplate;
              
              handler = async (params: Record<string, unknown>) => {
                try {
                  let payload: unknown;
                  
                  // Only use payloadTemplate if it has actual content
                  if (payloadTemplate && Object.keys(payloadTemplate).length > 0) {
                    payload = OpenAIAgentFactory.substituteVariables(payloadTemplate, params);
                    console.log(`[Webhook Tool Hydrated] Substituted payload:`, JSON.stringify(payload));
                  } else {
                    // Use params directly - contains collected conversation data
                    payload = params;
                    console.log(`[Webhook Tool Hydrated] Using params as payload:`, JSON.stringify(params));
                  }
                  
                  console.log(`[Webhook Tool Hydrated] ${webhookMethod} ${webhookUrl} with:`, JSON.stringify(payload));
                  
                  const urlCheck2 = await validateWebhookUrl(webhookUrl);
                  if (!urlCheck2.valid) {
                    throw new Error(`Webhook URL blocked: ${urlCheck2.error}`);
                  }
                  
                  const fetchOptions: RequestInit = {
                    method: webhookMethod,
                    headers: { 'Content-Type': 'application/json' },
                  };
                  
                  if (['POST', 'PUT', 'PATCH'].includes(webhookMethod.toUpperCase())) {
                    fetchOptions.body = JSON.stringify(payload);
                  }
                  
                  const response = await fetch(webhookUrl, fetchOptions);
                  
                  if (!response.ok) {
                    throw new Error(`Webhook returned ${response.status}`);
                  }
                  
                  let data;
                  const contentType = response.headers.get('content-type');
                  if (contentType?.includes('application/json')) {
                    data = await response.json();
                  } else {
                    data = await response.text();
                  }
                  
                  console.log(`[Webhook Tool Hydrated] Response:`, data);
                  return { success: true, data };
                } catch (error: any) {
                  console.error(`[Webhook Tool Hydrated] Error:`, error.message);
                  return { success: false, error: error.message };
                }
              };
            } else {
              // No webhook URL in metadata, fallback to generic handler
              console.warn(`[Hydrate] Webhook tool ${toolName} missing URL in metadata, using generic handler`);
              handler = async (params: Record<string, unknown>) => {
                console.log(`[Generic Tool] ${toolName} called with:`, params);
                return { success: true, toolName, params };
              };
            }
          } else {
            // Generic handler for other custom/unknown tools
            handler = async (params: Record<string, unknown>) => {
              console.log(`[Generic Tool] ${toolName} called with:`, params);
              return { success: true, toolName, params };
            };
          }
          break;
      }
      
      tools.push({
        name: toolName,
        description,
        parameters,
        handler,
      });
    }
    
    console.log(`[Agent Factory] Hydrated ${tools.length} tools from compiled data`);
    return tools;
  }

  /**
   * Add API call tool to agent for external HTTP requests
   */
  static addApiCallTool(
    config: AgentConfigWithContext,
    nodeId: string,
    apiConfig: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      bodyTemplate?: string;
      responseMapping?: Record<string, string>;
      description?: string;
    }
  ): AgentConfigWithContext {
    const toolName = `api_call_${nodeId.replace(/-/g, '_').substring(0, 8)}`;
    console.log(`[Agent Factory] Adding API call tool: ${toolName} -> ${apiConfig.url}`);

    const apiTool: AgentTool & { 
      _webhookUrl: string; 
      _webhookMethod: string; 
      _webhookHeaders?: Record<string, string>;
      _bodyTemplate?: string;
      _responseMapping?: Record<string, string>;
    } = {
      name: toolName,
      description: apiConfig.description || `Make an API request to ${apiConfig.url}`,
      parameters: {
        type: 'object',
        properties: {
          queryParams: {
            type: 'object',
            description: 'Optional query parameters to include in the request',
          },
          bodyData: {
            type: 'object',
            description: 'Optional body data for POST/PUT requests',
          },
        },
        required: [],
      },
      handler: async (params: Record<string, unknown>) => {
        try {
          const method = apiConfig.method || 'GET';
          let url = apiConfig.url;
          
          // Add query params if provided
          if (params.queryParams && typeof params.queryParams === 'object') {
            const queryString = new URLSearchParams(
              params.queryParams as Record<string, string>
            ).toString();
            url = `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
          }

          console.log(`[API Call Tool] ${method} ${url}`);

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(apiConfig.headers || {}),
          };

          const fetchOptions: RequestInit = {
            method,
            headers,
          };

          // Add body for POST/PUT/PATCH
          if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
            let body: any;
            if (apiConfig.bodyTemplate) {
              // Use template, substituting variables
              body = apiConfig.bodyTemplate;
              if (params.bodyData && typeof params.bodyData === 'object') {
                for (const [key, value] of Object.entries(params.bodyData)) {
                  body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
                }
              }
              body = JSON.parse(body);
            } else {
              body = params.bodyData || {};
            }
            fetchOptions.body = JSON.stringify(body);
          }

          const apiUrlCheck = await validateWebhookUrl(url);
          if (!apiUrlCheck.valid) {
            throw new Error(`API URL blocked: ${apiUrlCheck.error}`);
          }
          
          const response = await fetch(url, fetchOptions);
          
          if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type');
          let data: any;
          
          if (contentType?.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          console.log(`[API Call Tool] Response received`);

          // Apply response mapping if configured
          if (apiConfig.responseMapping && typeof data === 'object') {
            const mapped: Record<string, unknown> = {};
            for (const [outputKey, jsonPath] of Object.entries(apiConfig.responseMapping)) {
              mapped[outputKey] = this.getNestedValue(data, jsonPath);
            }
            return { success: true, data: mapped };
          }

          return { success: true, data };
        } catch (error: any) {
          console.error(`[API Call Tool] Error:`, error.message);
          return { success: false, error: error.message };
        }
      },
      // Store config for serialization
      _webhookUrl: apiConfig.url,
      _webhookMethod: apiConfig.method || 'GET',
      _webhookHeaders: apiConfig.headers,
      _bodyTemplate: apiConfig.bodyTemplate,
      _responseMapping: apiConfig.responseMapping,
    };

    return {
      ...config,
      tools: [...(config.tools || []), apiTool],
    };
  }

  /**
   * Helper to get nested value from object using dot notation
   */
  private static getNestedValue(obj: any, path: string): unknown {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Add custom tool from flow node
   */
  static addCustomTool(
    config: AgentConfigWithContext,
    toolConfig: {
      name: string;
      description: string;
      parameters: Record<string, any>;
      action: 'log' | 'store' | 'webhook';
      webhookUrl?: string;
    }
  ): AgentConfigWithContext {
    console.log(`[Agent Factory] Adding custom tool: ${toolConfig.name}`);

    const customTool: AgentTool = {
      name: toolConfig.name,
      description: toolConfig.description,
      parameters: toolConfig.parameters,
      handler: async (params: Record<string, unknown>) => {
        console.log(`[Custom Tool ${toolConfig.name}] Params:`, params);

        switch (toolConfig.action) {
          case 'log':
            console.log(`[Custom Tool ${toolConfig.name}] Logged:`, params);
            return { success: true, message: 'Data logged successfully' };

          case 'store':
            // Store in metadata/context for later use
            return { success: true, stored: params };

          case 'webhook':
            if (toolConfig.webhookUrl) {
              try {
                const whUrlCheck = await validateWebhookUrl(toolConfig.webhookUrl);
                if (!whUrlCheck.valid) {
                  return { success: false, error: `Webhook URL blocked: ${whUrlCheck.error}` };
                }
                const response = await fetch(toolConfig.webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(params),
                });
                if (!response.ok) {
                  throw new Error(`Webhook returned ${response.status}`);
                }
                return await response.json();
              } catch (error: any) {
                return { success: false, error: error.message };
              }
            }
            return { success: false, error: 'No webhook URL configured' };

          default:
            return { success: true, data: params };
        }
      },
    };

    return {
      ...config,
      tools: [...(config.tools || []), customTool],
    };
  }

  /**
   * Get the actual node type from node.data.type or node.data.config.type
   * Flow builder uses type: "custom" at top level, real type is in data
   */
  private static getNodeType(node: FlowNode): string {
    const data = node.data || {};
    // Check data.type first, then data.config.type, then fall back to node.type
    return (data.type as string) || (data.config as any)?.type || node.type || 'unknown';
  }

  /**
   * Get node content (message, question, etc.) from the correct location
   * Content can be in node.data.config.xxx, node.data.xxx, etc.
   */
  private static getNodeContent(node: FlowNode, field: string): string {
    const data = node.data || {};
    const config = (data.config as any) || {};
    // Check config first (more specific), then data directly
    return config[field] || (data as any)[field] || '';
  }

  /**
   * Get node data (any type) from the correct location
   * Handles objects, arrays, numbers, etc.
   */
  private static getNodeData<T>(node: FlowNode, field: string, defaultValue?: T): T | undefined {
    const data = node.data || {};
    const config = (data.config as any) || {};
    // Check config first (more specific), then data directly
    const value = config[field] ?? (data as any)[field];
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Compile a Flow Builder flow into agent configuration
   * Converts visual flow nodes into system prompt instructions and tools
   */
  static async compileFlow(
    flowConfig: CompiledFlowConfig,
    params: {
      voice: OpenAIVoice;
      model: OpenAIRealtimeModel;
      userId: string;
      agentId: string;
      callId?: string;
      temperature?: number;
      language?: string;
      vadSettings?: {
        threshold?: number;
        prefixPaddingMs?: number;
        silenceDurationMs?: number;
      };
    }
  ): Promise<AgentConfigWithContext> {
    console.log(`[Agent Factory] Compiling flow with ${flowConfig.nodes.length} nodes, language: ${params.language || 'en'}`);
    
    const { nodes, edges, variables } = flowConfig;
    
    // Build system prompt from flow structure with language
    let systemPrompt = this.buildFlowSystemPrompt(nodes, edges, variables, params.language || 'en');
    
    // Find first message from start node using helper to check correct location
    let firstMessage: string | undefined;
    const startNode = nodes.find(n => {
      const nodeType = this.getNodeType(n);
      return nodeType === 'start' || nodeType === 'message';
    });
    if (startNode) {
      const message = this.getNodeContent(startNode, 'message');
      if (message) {
        firstMessage = message;
        console.log(`[Agent Factory] Found firstMessage from start node: "${message.substring(0, 50)}..."`);
      }
    }

    let config: AgentConfigWithContext = {
      voice: params.voice,
      model: params.model,
      systemPrompt,
      firstMessage,
      temperature: params.temperature ?? 0.7,
      vadSettings: params.vadSettings,
      tools: [],
      flowConfig,
      toolContext: {
        userId: params.userId,
        agentId: params.agentId,
        callId: params.callId,
      },
    };

    // Add tools based on flow nodes (using helpers for node type and data)
    for (const node of nodes) {
      const nodeType = this.getNodeType(node);
      switch (nodeType) {
        case 'transfer': {
          const transferPhone = this.getNodeContent(node, 'phoneNumber');
          if (transferPhone) {
            config = this.addTransferTool(
              config,
              transferPhone,
              this.getNodeContent(node, 'message')
            );
          }
          break;
        }
        
        case 'end_call':
          config = this.addEndCallTool(config);
          break;
        
        case 'webhook': {
          const webhookUrl = this.getNodeContent(node, 'url') || this.getNodeContent(node, 'webhookUrl');
          const webhookToolName = this.getNodeContent(node, 'toolName') || `webhook_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
          if (webhookUrl) {
            const webhookPayload = this.getNodeData<Record<string, any>>(node, 'payload');
            const webhookParams = this.getNodeData<Record<string, any>>(node, 'parameters') || { type: 'object', properties: {} };
            config = this.addWebhookTool(
              config,
              webhookUrl,
              webhookToolName,
              this.getNodeContent(node, 'description') || 'Submit collected information via webhook',
              webhookParams,
              this.getNodeContent(node, 'method') || 'POST',
              webhookPayload
            );
          }
          break;
        }

        case 'api_call': {
          const apiUrl = this.getNodeContent(node, 'url');
          if (apiUrl) {
            config = this.addApiCallTool(config, node.id, {
              url: apiUrl,
              method: this.getNodeContent(node, 'method') || 'GET',
              headers: this.getNodeData<Record<string, string>>(node, 'headers') || {},
              bodyTemplate: this.getNodeContent(node, 'bodyTemplate') || undefined,
              responseMapping: this.getNodeData<Record<string, string>>(node, 'responseMapping'),
              description: this.getNodeContent(node, 'description') || undefined,
            });
          }
          break;
        }

        case 'tool': {
          const customToolName = this.getNodeContent(node, 'toolName');
          if (customToolName) {
            config = this.addCustomTool(config, {
              name: customToolName,
              description: this.getNodeContent(node, 'description') || 'Custom action',
              parameters: this.getNodeData<Record<string, any>>(node, 'parameters') || { type: 'object', properties: {} },
              action: (this.getNodeContent(node, 'action') as 'log' | 'store' | 'webhook') || 'log',
              webhookUrl: this.getNodeContent(node, 'webhookUrl') || undefined,
            });
          }
          break;
        }
        
        case 'appointment':
          // Add appointment booking tool when flow has appointment nodes
          if (!config.tools?.some(t => t.name === 'book_appointment')) {
            config = this.addAppointmentTool(
              config,
              params.userId,
              params.agentId,
              params.callId
            );
          }
          break;
        
        case 'form': {
          const formId = this.getNodeContent(node, 'formId');
          if (formId) {
            // Fetch form and its fields from database (fields stored in separate formFields table)
            const [form] = await db.select().from(forms).where(eq(forms.id, formId)).limit(1);
            if (form) {
              // Fetch form fields from the formFields table
              const formFieldRows = await db
                .select()
                .from(formFields)
                .where(eq(formFields.formId, formId))
                .orderBy(formFields.order);
              
              if (formFieldRows.length > 0) {
                const formFieldsData = formFieldRows.map(f => ({
                  id: f.id,
                  question: f.question,
                  fieldType: f.fieldType,
                  isRequired: f.isRequired,
                }));
                config = this.addFormTool(
                  config,
                  formId,
                  form.name || 'Form',
                  formFieldsData,
                  params.userId,
                  params.callId
                );
                console.log(`[Agent Factory] Added form tool for form ${formId} with ${formFieldsData.length} fields`);
              } else {
                console.warn(`[Agent Factory] Form ${formId} has no fields, skipping form tool`);
              }
            }
          }
          break;
        }
      }
    }

    // Always ensure end_call tool is available for flow agents
    const hasEndCallTool = config.tools?.some(t => t.name === 'end_call');
    if (!hasEndCallTool) {
      config = this.addEndCallTool(config);
    }

    return config;
  }

  /**
   * Get human-readable language name from code
   */
  private static getLanguageName(code: string): string {
    const languageNames: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'nl': 'Dutch',
      'pl': 'Polish',
      'ru': 'Russian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'tr': 'Turkish',
      'vi': 'Vietnamese',
      'th': 'Thai',
      'id': 'Indonesian',
      'ms': 'Malay',
      'fil': 'Filipino',
      'bn': 'Bengali',
      'ta': 'Tamil',
      'te': 'Telugu',
      'mr': 'Marathi',
      'gu': 'Gujarati',
      'kn': 'Kannada',
      'ml': 'Malayalam',
      'pa': 'Punjabi',
      'ur': 'Urdu',
      'fa': 'Persian',
      'he': 'Hebrew',
      'uk': 'Ukrainian',
      'cs': 'Czech',
      'ro': 'Romanian',
      'hu': 'Hungarian',
      'el': 'Greek',
      'sv': 'Swedish',
      'da': 'Danish',
      'fi': 'Finnish',
      'no': 'Norwegian',
    };
    return languageNames[code] || code.toUpperCase();
  }

  /**
   * Build system prompt from flow nodes
   */
  private static buildFlowSystemPrompt(
    nodes: FlowNode[],
    edges: FlowEdge[],
    variables: Record<string, unknown>,
    language: string = 'en'
  ): string {
    const languageName = this.getLanguageName(language);
    
    const parts: string[] = [
      `CRITICAL LANGUAGE REQUIREMENT: You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English unless ${languageName} is English. This is mandatory.`,
      '',
      'You are an AI assistant following a structured conversation flow.',
      'Guide the conversation through the following steps:',
      ''
    ];

    // Build adjacency map with edge conditions
    const adjacencyMap = new Map<string, Array<{ targetId: string; condition?: string }>>();
    for (const edge of edges) {
      const targets = adjacencyMap.get(edge.source) || [];
      targets.push({ targetId: edge.target, condition: edge.condition });
      adjacencyMap.set(edge.source, targets);
    }

    // Build node lookup
    const nodeMap = new Map<string, FlowNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Find start node using helper to get actual node type
    const startNode = nodes.find(n => this.getNodeType(n) === 'start' || !edges.some(e => e.target === n.id));
    if (!startNode) {
      parts.push('Follow the conversation naturally based on user responses.');
      return parts.join('\n');
    }

    // Traverse flow to build instructions with branching
    const visited = new Set<string>();
    const queue: Array<{ node: FlowNode; depth: number }> = [{ node: startNode, depth: 0 }];
    let stepNumber = 1;

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);

      const instruction = this.nodeToInstruction(node, stepNumber, edges, nodeMap);
      if (instruction) {
        const indent = '  '.repeat(depth);
        parts.push(`${indent}${stepNumber}. ${instruction}`);
        stepNumber++;
      }

      // Handle branching for condition nodes (using helper for node type)
      const nextEdges = adjacencyMap.get(node.id) || [];
      const currentNodeType = this.getNodeType(node);
      
      if (currentNodeType === 'condition' && nextEdges.length > 1) {
        // Add branching instructions
        parts.push('');
        parts.push(`   BRANCHING based on: ${this.getNodeContent(node, 'condition') || 'user response'}`);
        
        for (const nextEdge of nextEdges) {
          const targetNode = nodeMap.get(nextEdge.targetId);
          if (targetNode && !visited.has(targetNode.id)) {
            const conditionLabel = nextEdge.condition || 'default';
            const targetContent = this.getNodeContent(targetNode, 'message') || this.getNodeContent(targetNode, 'question') || this.getNodeType(targetNode);
            parts.push(`   - If ${conditionLabel}: proceed to step for "${targetContent}"`);
            queue.push({ node: targetNode, depth: depth + 1 });
          }
        }
        parts.push('');
      } else {
        // Linear flow
        for (const nextEdge of nextEdges) {
          const targetNode = nodeMap.get(nextEdge.targetId);
          if (targetNode && !visited.has(targetNode.id)) {
            queue.push({ node: targetNode, depth });
          }
        }
      }
    }

    // Add variable context if any
    if (Object.keys(variables).length > 0) {
      parts.push('');
      parts.push('Available context variables (use these in your responses):');
      for (const [key, value] of Object.entries(variables)) {
        parts.push(`- {{${key}}}: ${value}`);
      }
    }

    // Add flow behavior instructions
    parts.push('');
    parts.push('IMPORTANT INSTRUCTIONS:');
    parts.push('- Guide the conversation naturally through the flow steps.');
    parts.push('- Wait for user responses before proceeding to the next step.');
    parts.push('- If the user asks something off-topic, answer briefly then guide them back.');
    parts.push('- Use the available tools when the flow requires an action.');
    parts.push('- Be helpful, patient, and maintain a professional tone.');

    return parts.join('\n');
  }

  /**
   * Convert a flow node to an instruction string (using helpers for node type/content)
   */
  private static nodeToInstruction(
    node: FlowNode, 
    step: number,
    edges: FlowEdge[],
    nodeMap: Map<string, FlowNode>
  ): string | null {
    const nodeType = this.getNodeType(node);
    
    switch (nodeType) {
      case 'message': {
        const message = this.getNodeContent(node, 'message');
        if (!message) {
          return null;
        }
        return `Say: "${message}"`;
      }
      
      case 'question': {
        const question = this.getNodeContent(node, 'question') || 'What would you like to do?';
        const options = this.getNodeData<string[]>(node, 'options');
        if (options && options.length > 0) {
          return `Ask: "${question}" (Expected answers: ${options.join(', ')})`;
        }
        return `Ask the user: "${question}" and wait for their response.`;
      }
      
      case 'condition': {
        const condition = this.getNodeContent(node, 'condition') || 'based on user response';
        const conditionType = this.getNodeContent(node, 'conditionType') || 'llm';
        if (conditionType === 'exact') {
          return `Check if the user's response matches: "${condition}"`;
        }
        return `Evaluate: ${condition}. Then proceed based on the result.`;
      }
      
      case 'transfer': {
        const transferMsg = this.getNodeContent(node, 'message') || 'Let me connect you with a human agent.';
        return `If transfer is needed, say "${transferMsg}" then use the transfer_call tool.`;
      }
      
      case 'appointment': {
        const serviceName = this.getNodeContent(node, 'serviceName') || 'an appointment';
        return `Collect appointment details for ${serviceName}: ask for name, phone, date, and time. Then use the book_appointment tool.`;
      }
      
      case 'form': {
        const formName = this.getNodeContent(node, 'formName') || 'the form';
        const fields = this.getNodeData<Array<{ question: string }>>(node, 'fields');
        if (fields && fields.length > 0) {
          const questions = fields.map(f => f.question).join('; ');
          return `Collect information for ${formName} by asking: ${questions}. Then use submit_form tool.`;
        }
        return `Collect the required form information for ${formName}, then use submit_form tool.`;
      }
      
      case 'api_call': {
        const desc = this.getNodeContent(node, 'description') || 'external data';
        const apiToolName = `api_call_${node.id.replace(/-/g, '_').substring(0, 8)}`;
        return `Use the ${apiToolName} tool to fetch ${desc}. Use the response in your conversation.`;
      }
      
      case 'tool': {
        const customToolName = this.getNodeContent(node, 'toolName') || 'custom_tool';
        const toolDesc = this.getNodeContent(node, 'description') || 'perform an action';
        return `When appropriate, use the ${customToolName} tool to ${toolDesc}.`;
      }
      
      case 'delay': {
        const delaySeconds = this.getNodeData<number>(node, 'seconds') || this.getNodeData<number>(node, 'duration') || 2;
        const delayMessage = this.getNodeContent(node, 'message');
        if (delayMessage) {
          return `WAIT ${delaySeconds} seconds. During this pause, say: "${delayMessage}"`;
        }
        return `WAIT ${delaySeconds} seconds before continuing to the next step. You may say "One moment please..." during the pause.`;
      }
      
      case 'webhook': {
        const webhookToolName = this.getNodeContent(node, 'toolName') || 'webhook';
        return `When appropriate, use the ${webhookToolName} tool to send data externally.`;
      }
      
      case 'end_call': {
        const endMessage = this.getNodeContent(node, 'message') || 'Thank you for calling. Goodbye!';
        return `End the conversation by saying: "${endMessage}" Then use the end_call tool.`;
      }
      
      case 'start': {
        const startMessage = this.getNodeContent(node, 'message');
        if (startMessage) {
          return `Greet the user with: "${startMessage}"`;
        }
        return null;
      }
      
      default:
        return null;
    }
  }

  /**
   * Create a complete agent from database agent record
   */
  static async createFromAgentRecord(
    agent: {
      id: string;
      userId: string;
      type: string;
      systemPrompt: string;
      firstMessage?: string | null;
      openaiVoice?: string | null;
      openaiModel?: string | null;
      temperature?: number | null;
      knowledgeBaseIds?: string[] | null;
      transferEnabled?: boolean | null;
      transferPhoneNumber?: string | null;
      transferMessage?: string | null;
      endConversationEnabled?: boolean | null;
      detectLanguageEnabled?: boolean | null;
      flowId?: string | null;
      language?: string | null;
      messagingEmailEnabled?: boolean | null;
      messagingWhatsappEnabled?: boolean | null;
      messagingEmailTemplate?: string | null;
      messagingWhatsappTemplate?: string | null;
    },
    userTier: 'free' | 'pro',
    callId?: string,
    flowConfig?: CompiledFlowConfig
  ): Promise<AgentConfigWithContext> {
    console.log(`[Agent Factory] Creating agent from record: ${agent.id}, type: ${agent.type}, language: ${agent.language || 'en'}`);

    const voice = this.validateVoice(agent.openaiVoice || 'alloy');
    const model = this.validateModel(agent.openaiModel || 'gpt-realtime-1.5', userTier);

    let config: AgentConfigWithContext;

    // Handle flow-based agents
    if (agent.type === 'flow' && flowConfig) {
      config = await this.compileFlow(flowConfig, {
        voice,
        model,
        userId: agent.userId,
        agentId: agent.id,
        callId,
        temperature: agent.temperature ?? 0.7,
        language: agent.language || 'en',
      });
    } else {
      // Natural or incoming agents
      config = this.createAgentConfig({
        voice,
        model,
        systemPrompt: agent.systemPrompt || 'You are a helpful AI assistant.',
        firstMessage: agent.firstMessage || undefined,
        temperature: agent.temperature || 0.7,
        userTier,
        toolContext: {
          userId: agent.userId,
          agentId: agent.id,
          callId,
        },
      });
    }

    // Add knowledge base tool if configured
    if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
      config = this.addKnowledgeBaseTool(config, agent.knowledgeBaseIds, agent.userId);
    }

    // Add transfer tool if enabled
    if (agent.transferEnabled && agent.transferPhoneNumber) {
      config = this.addTransferTool(config, agent.transferPhoneNumber, agent.transferMessage || undefined);
    }

    // Add end call tool if enabled
    if (agent.endConversationEnabled) {
      config = this.addEndCallTool(config);
    }

    // Enable language detection if enabled
    if (agent.detectLanguageEnabled) {
      config = this.enableLanguageDetection(config);
    }

    // Add collect caller email tool if email messaging is enabled (for post-call follow-up)
    if (agent.messagingEmailEnabled) {
      config = this.addCollectCallerEmailTool(config, agent.userId, agent.id, callId);
    }

    // Add messaging email tool if enabled
    if (agent.messagingEmailEnabled) {
      config = this.addMessagingEmailTool(config, agent.userId, agent.id, callId, agent.messagingEmailTemplate);
    }

    // Add messaging WhatsApp tool if enabled
    if (agent.messagingWhatsappEnabled) {
      config = this.addMessagingWhatsAppTool(config, agent.userId, agent.id, callId, agent.messagingWhatsappTemplate, [], agent.messagingWhatsappVariables);
    }

    console.log(`[Agent Factory] Created config with ${config.tools?.length || 0} tools`);
    
    return config;
  }
}
