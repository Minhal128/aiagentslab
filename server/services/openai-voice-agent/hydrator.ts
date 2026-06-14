'use strict';
/**
 * ============================================================
 * Flow Hydrator Utility
 * 
 * Takes pre-compiled flow data from the flows table and creates
 * executable agent configurations with proper tool handlers.
 * 
 * This utility converts stored CompiledFunctionTool definitions
 * into runtime AgentTool objects with actual handler functions.
 * ============================================================
 */

import type { CompiledFunctionTool, CompiledConversationState } from '@shared/schema';
import { RAGKnowledgeService } from '../rag-knowledge';
import { db } from '../../db';
import { appointments, appointmentSettings, agents, formSubmissions, forms, formFields as formFieldsTable } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { appendRowToSheet, listSheetTabs } from '../google-sheets/google-sheets.service';

/**
 * Appends a structured warning entry to a call record's metadata JSONB column.
 * This makes Google Sheets push failures visible in the call record (not just server logs).
 * Works across all call table types by trying each in sequence.
 */
async function markCallGoogleSheetsWarning(
  callId: string,
  sheetId: string,
  sheetTab: string,
  errorMessage: string
): Promise<void> {
  if (!callId) return;
  const warning = {
    googleSheetsWarning: true,
    googleSheetsSheetId: sheetId,
    googleSheetsTab: sheetTab,
    googleSheetsErrorMessage: errorMessage,
    googleSheetsErrorAt: new Date().toISOString(),
  };
  const callTables = ['calls', 'twilio_openai_calls', 'plivo_calls', 'sip_calls'] as const;
  for (const table of callTables) {
    try {
      const rows = await db.execute(
        sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${callId} LIMIT 1`
      );
      const exists = (Array.isArray(rows) ? rows : (rows as any).rows || []).length > 0;
      if (exists) {
        // Merge warning fields into existing metadata using jsonb concatenation
        await db.execute(
          sql`UPDATE ${sql.identifier(table)} SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(warning)}::jsonb WHERE id = ${callId}`
        );
        console.log(`[Sheets Warning] Wrote googleSheetsWarning to ${table} call ${callId}`);
        return;
      }
    } catch (e: any) {
      // Not in this table or update failed — try next
    }
  }
  // If not found in any table, just log (best effort)
  console.warn(`[Sheets Warning] Could not find callId "${callId}" in any call table to record warning`);
}

/**
 * Runtime AgentTool with handler function
 */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Agent configuration with tool context
 */
export interface AgentConfigWithContext {
  voice: string;
  model: string;
  systemPrompt: string;
  firstMessage?: string;
  temperature?: number;
  tools: AgentTool[];
  toolContext?: ToolContext;
  knowledgeBaseIds?: string[];
}

/**
 * Context for tool execution
 */
export interface ToolContext {
  userId: string;
  agentId: string;
  callId?: string;
}

/**
 * Parameters for hydrating a compiled flow
 */
export interface HydrateFlowParams {
  compiledSystemPrompt: string;
  compiledFirstMessage: string | null;
  compiledTools: CompiledFunctionTool[];
  compiledStates: CompiledConversationState[];
  voice: string;
  model: string;
  temperature: number;
  toolContext: ToolContext;
  language?: string;
  knowledgeBaseIds?: string[];
  transferPhoneNumber?: string;
  transferEnabled?: boolean;
}

/**
 * Language code to name mapping
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  cs: 'Czech',
  el: 'Greek',
  he: 'Hebrew',
  hu: 'Hungarian',
  ro: 'Romanian',
  uk: 'Ukrainian',
};

/**
 * Get language name from code
 */
function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || code;
}

/**
 * Substitute {{variable}} placeholders in a value recursively
 */
function substituteVariables(
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
    return template.map(item => substituteVariables(item, params));
  }
  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = substituteVariables(value, params);
    }
    return result;
  }
  return template;
}

/**
 * Create end_call tool handler
 */
function createEndCallHandler(): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    console.log(`[End Call Tool] Ending call, reason: ${params.reason || 'conversation complete'}`);
    return { 
      action: 'end_call',
      reason: params.reason as string || 'conversation complete'
    };
  };
}

/**
 * Create transfer_call tool handler
 */
function createTransferHandler(transferPhoneNumber?: string): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    const phoneNumber = (params.destination as string) || transferPhoneNumber || 'unknown';
    console.log(`[Transfer Tool] Initiating transfer to ${phoneNumber}, reason: ${params.reason || 'none'}`);
    return { 
      action: 'transfer',
      phoneNumber,
      reason: params.reason as string
    };
  };
}

/**
 * Create knowledge base lookup tool handler
 */
function createKnowledgeBaseHandler(
  knowledgeBaseIds: string[],
  userId: string
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      const query = params.query as string;
      console.log(`[KB Tool] Searching: "${query?.substring(0, 50)}..."`);
      
      if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
        return { found: false, message: 'No knowledge base configured.' };
      }
      
      const results = await RAGKnowledgeService.searchKnowledge(
        query,
        knowledgeBaseIds,
        userId,
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
}

/**
 * Create appointment booking tool handler
 */
function createAppointmentHandler(
  userId: string,
  agentId: string,
  callId?: string,
  googleSheetId?: string,
  googleSheetName?: string
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      console.log(`[Appointment Tool] Booking:`, JSON.stringify(params));
      
      if (!params.contactName || !params.contactPhone || !params.appointmentDate || !params.appointmentTime) {
        return {
          success: false,
          message: 'Please provide name, phone, date and time for the appointment.'
        };
      }
      
      // Get agent's flowId if available
      const [agent] = await db
        .select({ flowId: agents.flowId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      
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
      
      // Check for duplicate booking from same call
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
      
      const appointmentId = nanoid();
      await db
        .insert(appointments)
        .values({
          id: appointmentId,
          userId,
          callId: callId || null,
          flowId: agent?.flowId || null,
          contactName: params.contactName as string,
          contactPhone: params.contactPhone as string,
          contactEmail: (params.contactEmail as string) || null,
          appointmentDate: params.appointmentDate as string,
          appointmentTime: params.appointmentTime as string,
          duration: (params.duration as number) || 30,
          serviceName: (params.serviceName as string) || null,
          notes: (params.notes as string) || null,
          status: 'scheduled',
          metadata: { source: 'hydrated-flow', agentId },
        });
      
      console.log(`[Appointment Tool] Created appointment ${appointmentId}`);

      if (googleSheetId) {
        // Declare sheetTab outside the try so catch can reference it for the structured warning
        let sheetTab = googleSheetName || '';
        try {
          // Resolve sheet tab: prefer the configured name; auto-detect first tab when not set
          // to avoid silent failures when the user's spreadsheet has no "Sheet1" tab.
          if (!sheetTab) {
            try {
              const tabs = await listSheetTabs(userId, googleSheetId);
              sheetTab = tabs[0]?.title || 'Sheet1';
              if (tabs[0]?.title) {
                console.log(`[Appointment Tool] Auto-detected sheet tab: "${sheetTab}"`);
              }
            } catch {
              sheetTab = 'Sheet1';
            }
          }
          const row = [
            String(params.contactName || ""),
            String(params.contactPhone || ""),
            String(params.appointmentDate || ""),
            String(params.appointmentTime || ""),
            String((params.duration as number) || 30),
            String(params.serviceName || ""),
            String(callId || ""),
            new Date().toISOString(),
          ];
          const apptAppended = await appendRowToSheet(userId, googleSheetId, sheetTab, row);
          if (apptAppended) {
            console.log(`[Appointment Tool] Row pushed to Google Sheet ${googleSheetId}`);
          } else {
            const errMsg = `appendRowToSheet returned false for sheet ${googleSheetId} tab "${sheetTab}"`;
            console.error(`[Appointment Tool] Google Sheet append FAILED — appointment saved locally but NOT in Google Sheets. ${errMsg}`);
            if (callId) await markCallGoogleSheetsWarning(callId, googleSheetId, sheetTab, errMsg);
          }
        } catch (sheetErr: any) {
          console.error(`[Appointment Tool] Google Sheets push failed (non-fatal):`, sheetErr.message);
          if (callId) await markCallGoogleSheetsWarning(callId, googleSheetId, sheetTab, sheetErr.message);
        }
      }
      
      return { 
        success: true, 
        appointmentId,
        message: `Appointment booked for ${params.contactName} on ${params.appointmentDate} at ${params.appointmentTime}` 
      };
    } catch (error: any) {
      console.error(`[Appointment Tool] Error:`, error.message, error.stack);
      return { 
        success: false, 
        message: 'Unable to book appointment at this time. Please try again.' 
      };
    }
  };
}

/**
 * Create form submission tool handler
 * Fetches form fields from database and saves submission
 */
function createFormSubmissionHandler(
  formId: string,
  compiledFields: Array<{ name?: string; id?: string; type?: string; required?: boolean; label?: string; description?: string }>,
  userId: string,
  callId?: string,
  googleSheetId?: string,
  googleSheetName?: string
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      console.log(`[Form Tool] Submitting to form ${formId}:`, JSON.stringify(params));
      
      // Fetch form from database to get current field definitions
      const [form] = await db
        .select()
        .from(forms)
        .where(eq(forms.id, formId))
        .limit(1);
      
      if (!form) {
        console.error(`[Form Tool] Form ${formId} not found in database`);
        return { 
          success: false, 
          message: 'Form configuration not found.' 
        };
      }
      
      // Fetch form fields from database (fields stored in separate formFields table)
      const formFieldRows = await db
        .select()
        .from(formFieldsTable)
        .where(eq(formFieldsTable.formId, formId))
        .orderBy(formFieldsTable.order);
      
      // Use form fields from database if available, otherwise fall back to compiled fields
      const formFields = formFieldRows.length > 0
        ? formFieldRows.map(f => ({
            id: f.id,
            question: f.question,
            fieldType: f.fieldType,
            isRequired: f.isRequired,
          }))
        : compiledFields.map(f => ({
            id: f.id || f.name || 'unknown',
            question: f.description || f.label || f.name || 'Field',
            fieldType: f.type || 'text',
            isRequired: f.required || false,
          }));
      
      // Build responses array from the params, tracking consumed param keys
      const responses: Array<{ fieldId: string; question: string; answer: string }> = [];
      const consumedParamKeys = new Set<string>();
      const metaFields = ['contactName', 'contactPhone', 'contactEmail', 'fullName', 'phone'];
      
      for (const field of formFields) {
        // Try different field key patterns
        const fieldKey = `field_${(field.id || '').replace(/-/g, '_')}`;
        const altKey = field.id;
        const nameKey = (field as any).name;
        
        // Find which key matched
        let matchedKey: string | null = null;
        let value: unknown = undefined;
        
        if (params[fieldKey] !== undefined) {
          matchedKey = fieldKey;
          value = params[fieldKey];
        } else if (params[altKey] !== undefined) {
          matchedKey = altKey;
          value = params[altKey];
        } else if (nameKey && params[nameKey] !== undefined) {
          matchedKey = nameKey;
          value = params[nameKey];
        }
        
        if (value !== undefined && value !== null && matchedKey) {
          responses.push({
            fieldId: field.id,
            question: (field as any).question || (field as any).label || field.id,
            answer: String(value),
          });
          // Mark all possible keys for this field as consumed
          consumedParamKeys.add(fieldKey);
          consumedParamKeys.add(altKey);
          if (nameKey) consumedParamKeys.add(nameKey);
        }
      }
      
      // No fallback loop needed - we only store responses for known form fields
      
      const submissionId = nanoid();
      await db
        .insert(formSubmissions)
        .values({
          id: submissionId,
          formId,
          callId: callId || null,
          contactName: (params.contactName as string) || (params.fullName as string) || null,
          contactPhone: (params.contactPhone as string) || (params.phone as string) || null,
          responses,
        });
      
      console.log(`[Form Tool] Created submission ${submissionId} with ${responses.length} responses`);

      if (googleSheetId) {
        // Declare sheetTab outside the try so catch can reference it for the structured warning
        let sheetTab = googleSheetName || '';
        try {
          // Resolve sheet tab: prefer the configured name; auto-detect first tab when not set
          // to avoid silent failures when the user's spreadsheet has no "Sheet1" tab.
          if (!sheetTab) {
            try {
              const tabs = await listSheetTabs(userId, googleSheetId);
              sheetTab = tabs[0]?.title || 'Sheet1';
              if (tabs[0]?.title) {
                console.log(`[Form Tool] Auto-detected sheet tab: "${sheetTab}"`);
              }
            } catch {
              sheetTab = 'Sheet1';
            }
          }
          const contactName = String((params.contactName as string) || (params.fullName as string) || "");
          const contactPhone = String((params.contactPhone as string) || (params.phone as string) || "");
          const answerValues = responses.map((r) => String(r.answer ?? ""));
          const row = [contactName, contactPhone, ...answerValues, String(callId || ""), new Date().toISOString()];
          const formAppended = await appendRowToSheet(userId, googleSheetId, sheetTab, row);
          if (formAppended) {
            console.log(`[Form Tool] Row pushed to Google Sheet ${googleSheetId}`);
          } else {
            const errMsg = `appendRowToSheet returned false for sheet ${googleSheetId} tab "${sheetTab}"`;
            console.error(`[Form Tool] Google Sheet append FAILED — form data saved locally but NOT in Google Sheets. ${errMsg}`);
            if (callId) await markCallGoogleSheetsWarning(callId, googleSheetId, sheetTab, errMsg);
          }
        } catch (sheetErr: any) {
          console.error(`[Form Tool] Google Sheets push failed (non-fatal):`, sheetErr.message);
          if (callId) await markCallGoogleSheetsWarning(callId, googleSheetId, sheetTab, sheetErr.message);
        }
      }
      
      return { 
        success: true, 
        submissionId,
        message: 'Your information has been saved successfully.' 
      };
    } catch (error: any) {
      console.error(`[Form Tool] Error:`, error.message, error.stack);
      return { 
        success: false, 
        message: 'Unable to save information at this time. Please try again.' 
      };
    }
  };
}

function createMessagingEmailHandler(
  userId: string,
  agentId: string,
  callId?: string,
  templateName?: string,
  defaultRecipientEmail?: string
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      const recipientEmail = (params.recipient_email as string) || defaultRecipientEmail;
      const template = (params.template_name as string) || templateName || 'default';

      console.log(`[Send Email Tool] Sending email: template="${template}" to="${recipientEmail}"`);

      if (!recipientEmail) {
        return {
          success: false,
          message: 'Please provide the recipient email address before sending the email.'
        };
      }

      const { EmailTemplateService } = await import('../../../plugins/messaging/services/email-template.service');
      const emailService = new EmailTemplateService();
      const dynamicVars = (params.dynamic_variables as Record<string, string>) || {};

      const result = await emailService.sendEmailByName(
        userId,
        template,
        recipientEmail,
        dynamicVars,
        { callId: callId || '', agentId }
      );

      console.log(`[Send Email Tool] Result:`, result.success ? 'sent' : result.error);
      return {
        success: result.success,
        message: result.success
          ? `Email sent successfully to ${recipientEmail} using template "${template}".`
          : `Failed to send email: ${result.error || 'Unknown error'}`
      };
    } catch (error: any) {
      console.error(`[Send Email Tool] Error:`, error.message);
      return {
        success: false,
        message: 'Unable to send email at this time. Please try again later.'
      };
    }
  };
}

function createMessagingWhatsAppHandler(
  userId: string,
  agentId: string,
  callId?: string,
  templateName?: string,
  language?: string,
  metadataVariables?: any[]
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      let phoneNumber = params.phone_number as string;
      const template = (params.template_name as string) || templateName || 'hello_world';
      const lang = language || 'en_US';

      if (!phoneNumber && callId) {
        try {
          const { sql } = await import('drizzle-orm');
          const sanitizedCallId = callId.replace(/[^a-zA-Z0-9_-]/g, '');
          const callTables = ['calls', 'twilio_openai_calls', 'plivo_calls', 'sip_calls'] as const;
          for (const table of callTables) {
            const rows = await db.execute(
              sql`SELECT caller_number, from_number FROM ${sql.identifier(table)} WHERE id = ${sanitizedCallId} LIMIT 1`
            );
            const row = (Array.isArray(rows) ? rows : (rows as any).rows || [])[0];
            if (row?.caller_number || row?.from_number) {
              phoneNumber = row.caller_number || row.from_number;
              console.log(`[Send WhatsApp Tool] Resolved caller phone from ${table}: ${phoneNumber}`);
              break;
            }
          }
        } catch (e: any) {
          console.warn(`[Send WhatsApp Tool] Could not resolve caller phone:`, e.message);
        }
      }

      console.log(`[Send WhatsApp Tool] Sending WhatsApp: template="${template}" to="${phoneNumber}"`);

      if (!phoneNumber) {
        return {
          success: false,
          message: 'Please provide the phone number to send the WhatsApp message to.'
        };
      }

      let templateVariables = (params.template_variables as any[]) || [];
      if (templateVariables.length === 0) {
        const variableEntries: { position: number; value: string }[] = [];
        for (const [key, value] of Object.entries(params)) {
          const match = key.match(/^variable_(\d+)$/);
          if (match && value) {
            variableEntries.push({ position: parseInt(match[1], 10), value: String(value) });
          }
        }
        if (variableEntries.length > 0) {
          variableEntries.sort((a, b) => a.position - b.position);
          templateVariables = variableEntries.map(v => ({ position: v.position, value: v.value }));
        }
      }

      if (templateVariables.length === 0 && metadataVariables && metadataVariables.length > 0) {
        templateVariables = metadataVariables.map((tv: any) => {
          let value = tv.value || '';
          if (tv.source && tv.source !== 'custom') {
            const sourceKey = tv.source;
            if (params[sourceKey]) {
              value = String(params[sourceKey]);
            } else if (sourceKey === 'system__caller_id' && phoneNumber) {
              value = phoneNumber;
            }
          }
          return { position: tv.position, value };
        });
      }

      const { getDomain } = await import('../../utils/domain');
      const { getAppointmentWebhookSecret } = await import('../../services/appointment-elevenlabs-tool');
      const domain = getDomain();
      const secret = getAppointmentWebhookSecret();

      const [agent] = await db
        .select({ elevenLabsAgentId: agents.elevenLabsAgentId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      const elAgentId = agent?.elevenLabsAgentId || agentId;
      const queryParams = callId ? `?callId=${encodeURIComponent(callId)}` : '';
      const webhookUrl = `${domain}/api/webhooks/messaging/send-whatsapp/${secret}/${elAgentId}${queryParams}`;

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: phoneNumber,
          template_name: template,
          language: lang,
          template_variables: templateVariables,
        }),
      });

      const data = await response.json();
      console.log(`[Send WhatsApp Tool] Result:`, data.success ? 'sent' : data.error);

      return {
        success: data.success,
        message: data.success
          ? `WhatsApp message sent successfully to ${phoneNumber} using template "${template}".`
          : `Failed to send WhatsApp message: ${data.message || data.error || 'Unknown error'}`
      };
    } catch (error: any) {
      console.error(`[Send WhatsApp Tool] Error:`, error.message);
      return {
        success: false,
        message: 'Unable to send WhatsApp message at this time. Please try again later.'
      };
    }
  };
}

/**
 * Create webhook tool handler
 */
function createWebhookHandler(
  webhookUrl: string,
  webhookMethod: string = 'POST',
  payloadTemplate?: Record<string, any>
): (params: Record<string, unknown>) => Promise<unknown> {
  return async (params: Record<string, unknown>) => {
    try {
      let payload: unknown;
      
      if (payloadTemplate && Object.keys(payloadTemplate).length > 0) {
        payload = substituteVariables(payloadTemplate, params);
        console.log(`[Webhook Tool] Substituted payload:`, JSON.stringify(payload));
      } else {
        payload = params;
        console.log(`[Webhook Tool] Using params as payload:`, JSON.stringify(params));
      }
      
      console.log(`[Webhook Tool] ${webhookMethod} ${webhookUrl}`);
      
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
      
      console.log(`[Webhook Tool] Response received`);
      return { success: true, data };
    } catch (error: any) {
      console.error(`[Webhook Tool] Error:`, error.message);
      return { success: false, error: error.message };
    }
  };
}

/**
 * Hydrate compiled tools into executable AgentTools with handlers
 */
export function hydrateCompiledTools(
  compiledTools: CompiledFunctionTool[],
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
    
    switch (toolName) {
      case 'end_call':
        handler = createEndCallHandler();
        break;
        
      case 'transfer_call':
        handler = createTransferHandler(context.transferPhoneNumber);
        break;
        
      case 'query_knowledge_base':
      case 'lookup_knowledge_base':
        handler = createKnowledgeBaseHandler(
          context.knowledgeBaseIds || [],
          context.userId
        );
        break;
        
      case 'book_appointment': {
        const apptMeta = (compiledTool as any)._metadata;
        handler = createAppointmentHandler(
          context.userId,
          context.agentId,
          context.callId,
          apptMeta?.googleSheetId,
          apptMeta?.googleSheetName
        );
        break;
      }
        
      default:
        // Check for transfer_* pattern (flow node transfer tools)
        if (toolName.startsWith('transfer_')) {
          handler = createTransferHandler(context.transferPhoneNumber);
        }
        // Check for webhook_* pattern
        else if (toolName.startsWith('webhook_')) {
          const metadata = (compiledTool as any)._metadata;
          
          if (metadata?.webhookUrl) {
            handler = createWebhookHandler(
              metadata.webhookUrl,
              metadata.webhookMethod || 'POST',
              metadata.payloadTemplate
            );
          } else {
            console.warn(`[Hydrator] Webhook tool ${toolName} missing URL in metadata`);
            handler = async (params: Record<string, unknown>) => {
              console.log(`[Generic Tool] ${toolName} called with:`, params);
              return { success: true, toolName, params };
            };
          }
        }
        // Check for api_call_* pattern
        else if (toolName.startsWith('api_call_')) {
          const metadata = (compiledTool as any)._metadata;
          
          if (metadata?.webhookUrl) {
            handler = createWebhookHandler(
              metadata.webhookUrl,
              metadata.webhookMethod || 'GET',
              metadata.payloadTemplate
            );
          } else {
            handler = async (params: Record<string, unknown>) => {
              console.log(`[API Call Tool] ${toolName} called with:`, params);
              return { success: true, toolName, params };
            };
          }
        }
        // Check for submit_form_* pattern
        else if (toolName.startsWith('submit_form')) {
          const metadata = (compiledTool as any)._metadata;
          const formId = metadata?.formId;
          
          if (formId) {
            // Validate that nodeId in metadata matches the expected tool (stale metadata guard)
            const metaNodeId = metadata?.nodeId;
            if (metaNodeId && !toolName.includes(metaNodeId.replace(/[^a-zA-Z0-9]/g, '_'))) {
              console.error(
                `[Hydrator] STALE METADATA DETECTED: tool "${toolName}" has _metadata.nodeId="${metaNodeId}" ` +
                `which does not match the tool name. The compiled flow may be outdated — ` +
                `recompile the flow to fix this inconsistency. Using the formId from metadata anyway.`
              );
            }
            handler = createFormSubmissionHandler(
              formId,
              metadata?.fields || [],
              context.userId,
              context.callId,
              metadata?.googleSheetId,
              metadata?.googleSheetName
            );
          } else {
            console.error(
              `[Hydrator] CRITICAL: Form tool "${toolName}" is missing formId in _metadata. ` +
              `nodeId in metadata: "${metadata?.nodeId || 'unknown'}". ` +
              `Submissions via this tool will return an error. Recompile the flow to fix this.`
            );
            handler = async (params: Record<string, unknown>) => {
              console.error(`[Form Tool] ${toolName} called but no formId in metadata — cannot submit. params:`, JSON.stringify(params));
              return { success: false, message: 'Form configuration error: missing form reference. Please contact support.' };
            };
          }
        }
        // Check for send_email_* pattern
        else if (toolName.startsWith('send_email')) {
          const metadata = (compiledTool as any)._metadata;
          handler = createMessagingEmailHandler(
            context.userId,
            context.agentId,
            context.callId,
            metadata?.templateName,
            metadata?.recipientEmail
          );
        }
        // Check for send_whatsapp_* pattern
        else if (toolName.startsWith('send_whatsapp')) {
          const metadata = (compiledTool as any)._metadata;
          handler = createMessagingWhatsAppHandler(
            context.userId,
            context.agentId,
            context.callId,
            metadata?.templateName,
            metadata?.language,
            metadata?.templateVariables
          );
        }
        // Check for play_audio_* pattern
        else if (toolName.startsWith('play_audio')) {
          const metadata = (compiledTool as any)._metadata;
          const audioUrl = metadata?.audioUrl;
          
          // Handler just returns acknowledgment - actual playback is handled by audio bridge
          handler = async (params: Record<string, unknown>) => {
            console.log(`[Play Audio Tool] ${toolName} called, audioUrl: ${audioUrl}`);
            return { 
              action: 'play_audio',
              audioUrl: audioUrl || '',
              audioFileName: metadata?.audioFileName || 'audio file',
              interruptible: metadata?.interruptible ?? false,
              waitForComplete: metadata?.waitForComplete ?? true,
              message: audioUrl ? 'Audio playback requested.' : 'No audio URL configured.'
            };
          };
        }
        // Generic handler for unknown tools
        else {
          handler = async (params: Record<string, unknown>) => {
            console.log(`[Generic Tool] ${toolName} called with:`, params);
            return { success: true, toolName, params };
          };
        }
        break;
    }
    
    // Build the tool object with handler
    const tool: AgentTool & Record<string, unknown> = {
      name: toolName,
      description,
      parameters,
      handler,
    };
    
    // Attach metadata properties for serialization (needed by Plivo call service)
    // These allow the tool to be recreated after being stored in call metadata
    const toolMetadata = (compiledTool as any)._metadata;
    if (toolMetadata) {
      if (toolMetadata.webhookUrl) tool._webhookUrl = toolMetadata.webhookUrl;
      if (toolMetadata.webhookMethod) tool._webhookMethod = toolMetadata.webhookMethod;
      if (toolMetadata.payloadTemplate) tool._payloadTemplate = toolMetadata.payloadTemplate;
      if (toolMetadata.bodyTemplate) tool._bodyTemplate = toolMetadata.bodyTemplate;
      if (toolMetadata.headers) tool._webhookHeaders = toolMetadata.headers;
      if (toolMetadata.responseMapping) tool._responseMapping = toolMetadata.responseMapping;
      if (toolMetadata.formId) tool._formId = toolMetadata.formId;
      if (toolMetadata.formName) tool._formName = toolMetadata.formName;
      if (toolMetadata.formFields) tool._formFields = toolMetadata.formFields;
      if (toolMetadata.action) tool._action = toolMetadata.action;
      if (toolMetadata.googleSheetId) tool._googleSheetId = toolMetadata.googleSheetId;
      if (toolMetadata.googleSheetName) tool._googleSheetName = toolMetadata.googleSheetName;
    }
    
    // Also check for transfer number - from context OR from compiled tool metadata
    if (toolName === 'transfer_call' || toolName.startsWith('transfer_')) {
      // Priority: context.transferPhoneNumber > _metadata.phoneNumber
      const transferNum = context.transferPhoneNumber || toolMetadata?.phoneNumber;
      if (transferNum) {
        tool._transferNumber = transferNum;
        // Merge with existing metadata to preserve nodeId and other fields
        tool._metadata = { ...(toolMetadata ?? {}), phoneNumber: transferNum };
      }
    }
    
    // Preserve _metadata for play_audio tools (audio bridge needs audioUrl)
    if (toolName.startsWith('play_audio') && toolMetadata) {
      tool._metadata = { 
        audioUrl: toolMetadata.audioUrl,
        audioFileName: toolMetadata.audioFileName,
        interruptible: toolMetadata.interruptible,
        waitForComplete: toolMetadata.waitForComplete,
        nodeId: toolMetadata.nodeId,
      };
    }
    
    tools.push(tool);
  }
  
  console.log(`[Hydrator] Hydrated ${tools.length} tools from compiled data`);
  return tools;
}

/**
 * Hydrate a complete compiled flow into an executable agent configuration
 * 
 * This is the main entry point for using pre-compiled flow data at runtime.
 * It converts stored flow data into a ready-to-use agent configuration with
 * all tool handlers properly wired up.
 */
export function hydrateCompiledFlow(params: HydrateFlowParams): AgentConfigWithContext {
  const {
    compiledSystemPrompt,
    compiledFirstMessage,
    compiledTools,
    voice,
    model,
    temperature,
    toolContext,
    language,
    knowledgeBaseIds,
    transferPhoneNumber,
  } = params;
  
  // Build system prompt with language instructions if needed
  let systemPrompt = compiledSystemPrompt;
  if (language && language !== 'en' && !systemPrompt.includes('CRITICAL LANGUAGE REQUIREMENT')) {
    const languageName = getLanguageName(language);
    systemPrompt = `CRITICAL LANGUAGE REQUIREMENT: You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English. This is mandatory.\n\n${systemPrompt}`;
  }
  
  // Hydrate the compiled tools with proper handlers
  const tools = hydrateCompiledTools(compiledTools, {
    userId: toolContext.userId,
    agentId: toolContext.agentId,
    callId: toolContext.callId,
    knowledgeBaseIds,
    transferPhoneNumber,
  });
  
  console.log(`[Hydrator] Created agent config: voice=${voice}, model=${model}, language=${language || 'en'}, tools=${tools.length}`);
  
  return {
    voice,
    model,
    systemPrompt,
    firstMessage: compiledFirstMessage || undefined,
    temperature,
    tools,
    toolContext,
    knowledgeBaseIds,
  };
}

/**
 * Substitute contact variables in a compiled flow's prompts
 * 
 * This handles {{contact_name}}, {{contact_phone}}, etc. placeholders
 * that need to be filled in at call time.
 */
export function substituteContactVariables(
  text: string,
  variables: Record<string, unknown>
): string {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = String(value || '');
    result = result.split(placeholder).join(replacement);
  }
  return result;
}
