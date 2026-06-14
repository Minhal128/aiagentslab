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
 * Form Submission ElevenLabs Tool Configuration
 * 
 * Configures the submit_form webhook tool for ElevenLabs agents.
 * When a Flow Agent needs to submit form data during a call, ElevenLabs calls
 * our webhook with the collected responses, which saves it to the database.
 * 
 * Tool Type: "webhook" (server-side) - ElevenLabs calls our endpoint directly
 * Security: Uses a shared secret token in header for webhook authentication
 */

import { getDomain } from "../utils/domain";
import crypto from "crypto";
import fs from "fs";
import path from "path";

let formWebhookSecret: string | null = null;

export function getFormWebhookSecret(): string {
  if (!formWebhookSecret) {
    if (process.env.FORM_WEBHOOK_SECRET) {
      formWebhookSecret = process.env.FORM_WEBHOOK_SECRET;
    } else {
      // Derive a stable secret from JWT_SECRET so it never changes across restarts.
      // Falls back to a static file-persisted value if JWT_SECRET is not set.
      const baseKey = process.env.JWT_SECRET || process.env.ELEVENLABS_AGENT_SECRET;
      if (baseKey) {
        formWebhookSecret = crypto
          .createHmac('sha256', baseKey)
          .update('agentlabs:form-webhook-secret:v1')
          .digest('hex');
        console.log(`📋 [Form Tool] Derived stable webhook secret from server key`);
      } else {
        // Final fallback: persist to a file so it survives restarts within the same deployment
        const secretPath = path.join(process.cwd(), '.form-webhook-secret');
        try {
          if (fs.existsSync(secretPath)) {
            formWebhookSecret = fs.readFileSync(secretPath, 'utf-8').trim();
            console.log(`📋 [Form Tool] Loaded persisted webhook secret from file`);
          }
        } catch (_) {}

        if (!formWebhookSecret) {
          formWebhookSecret = crypto.randomBytes(32).toString('hex');
          try {
            fs.writeFileSync(secretPath, formWebhookSecret, { mode: 0o600 });
          } catch (_) {}
          console.log(`📋 [Form Tool] Generated and persisted new webhook secret`);
        }
      }
    }
  }
  return formWebhookSecret!;
}

export function validateFormWebhookToken(providedToken: string | undefined): boolean {
  if (!providedToken) {
    return false;
  }
  const secret = getFormWebhookSecret();
  
  const providedBuffer = Buffer.from(providedToken);
  const secretBuffer = Buffer.from(secret);
  
  if (providedBuffer.length !== secretBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(providedBuffer, secretBuffer);
}

export interface FormWebhookToolConfig {
  type: "webhook";
  name: string;
  description: string;
  api_schema: {
    url: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    request_body_schema?: Record<string, any>;
  };
}

export interface FormFieldDefinition {
  id: string;
  question: string;
  fieldType: string;
  options?: string[] | null;
  isRequired: boolean;
  order: number;
}

/**
 * Sanitize field ID for ElevenLabs API compatibility
 * ElevenLabs only allows: alphanumeric, underscores, non-consecutive dots, and @ symbols
 * Replace hyphens and other invalid characters with underscores
 */
export function sanitizeFieldId(fieldId: string): string {
  return fieldId
    .replace(/-/g, '_')  // Replace hyphens with underscores
    .replace(/[^a-zA-Z0-9_.@]/g, '_')  // Replace other invalid chars
    .replace(/\.{2,}/g, '.')  // Collapse consecutive dots
    .replace(/_{2,}/g, '_');  // Collapse consecutive underscores
}

/**
 * Generate request body schema properties from form fields
 * Each field becomes a property in the request body
 */
function generateFieldProperties(fields: FormFieldDefinition[]): Record<string, any> {
  const properties: Record<string, any> = {
    contactName: {
      type: "string",
      description: "The name of the person filling the form"
    },
    contactPhone: {
      type: "string",
      description: "Auto-populated server-side from the call record. Do NOT ask the caller for this value — the system already has their phone number on file."
    }
  };
  
  for (const field of fields) {
    const fieldKey = `field_${sanitizeFieldId(field.id)}`;
    
    switch (field.fieldType) {
      case 'text':
        properties[fieldKey] = {
          type: "string",
          description: `Answer to: "${field.question}"`
        };
        break;
        
      case 'number':
        properties[fieldKey] = {
          type: "number",
          description: `Numeric answer to: "${field.question}"`
        };
        break;
        
      case 'yes_no':
        properties[fieldKey] = {
          type: "boolean",
          description: `Yes/No answer to: "${field.question}" (true = yes, false = no)`
        };
        break;
        
      case 'multiple_choice':
        properties[fieldKey] = {
          type: "string",
          description: `Choice for: "${field.question}"${field.options?.length ? `. Options: ${field.options.join(', ')}` : ''}`
        };
        break;
        
      case 'email':
        properties[fieldKey] = {
          type: "string",
          description: `Email address for: "${field.question}"`
        };
        break;
        
      case 'phone':
      case 'tel':
        properties[fieldKey] = {
          type: "string",
          description: `Phone number for: "${field.question}". IMPORTANT: If this question is asking for the CALLER'S OWN phone number, the system already has it on file — use the known number and do NOT ask the caller to provide it again. Only ask if this question is clearly about a DIFFERENT person's number (e.g. emergency contact, spouse, office line).`
        };
        break;
        
      case 'date':
        properties[fieldKey] = {
          type: "string",
          description: `Date for: "${field.question}". Can be natural language like 'tomorrow' or formatted date.`
        };
        break;
        
      case 'rating':
        properties[fieldKey] = {
          type: "number",
          description: `Rating (1-5 or 1-10) for: "${field.question}"`
        };
        break;
        
      default:
        properties[fieldKey] = {
          type: "string",
          description: `Answer to: "${field.question}"`
        };
    }
  }
  
  return properties;
}

/**
 * Get required fields array from form fields
 */
function getRequiredFields(fields: FormFieldDefinition[]): string[] {
  // contactPhone is NEVER required — the server auto-populates it from the call record.
  // Asking the caller for it is redundant for both incoming calls (we have the caller's
  // number from the Twilio webhook) and outgoing calls (we dialled this number).
  const required = ['contactName'];
  
  for (const field of fields) {
    if (field.isRequired) {
      required.push(`field_${sanitizeFieldId(field.id)}`);
    }
  }
  
  return required;
}

/**
 * Get the submit_form webhook tool configuration for ElevenLabs
 * @param formId - The database form ID
 * @param formName - The form name for the tool description
 * @param fields - The form fields to collect
 * @param agentId - The ElevenLabs agent ID
 * @param nodeId - (optional) The flow node ID — appended to the webhook URL for precise routing
 */
export function getSubmitFormWebhookTool(
  formId: string,
  formName: string,
  fields: FormFieldDefinition[],
  agentId: string,
  nodeId?: string
): FormWebhookToolConfig {
  const domain = getDomain();
  const secret = getFormWebhookSecret();
  
  // Include nodeId as query param so the webhook handler can resolve the exact flow node
  // (e.g. to pick the correct Google Sheet when the same form appears in multiple nodes)
  const baseUrl = `${domain}/api/webhooks/elevenlabs/form/${secret}/${formId}/${agentId}`;
  const webhookUrl = nodeId ? `${baseUrl}?nodeId=${encodeURIComponent(nodeId)}` : baseUrl;
  
  // Tool name is node-specific when nodeId is provided: this ensures that when the same formId
  // is used in two separate flow nodes (e.g. the same form in different branches), each node
  // gets its own uniquely-named ElevenLabs tool with its own webhook URL.
  // Falls back to formId-based name (backward-compat) only when nodeId is not available.
  const toolName = nodeId
    ? `submit_form_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
    : `submit_form_${formId.replace(/-/g, '_')}`;
  
  console.log(`📋 [Form Tool] Creating webhook tool config for form ${formId}`);
  console.log(`   Tool name: ${toolName}`);
  console.log(`   Form: ${formName} (${fields.length} fields)`);
  console.log(`   Node ID: ${nodeId || 'not provided'}`);
  console.log(`   Webhook URL: ${webhookUrl.replace(secret, '[TOKEN]')}`);
  
  const fieldDescriptions = fields
    .sort((a, b) => a.order - b.order)
    .map((f, i) => `${i + 1}. "${f.question}" (${f.fieldType}${f.isRequired ? ', required' : ''})`)
    .join('\n');
  
  return {
    type: "webhook",
    name: toolName,
    description: `Submit the "${formName}" form. Collect the following information from the caller before using this tool:\n${fieldDescriptions}\n\nOnce all required fields are collected, call this tool to save the form submission.`,
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      request_body_schema: {
        type: "object",
        properties: generateFieldProperties(fields),
        required: getRequiredFields(fields)
      }
    }
  };
}

/**
 * Generate the prompt for collecting form data
 * This creates detailed instructions for the AI to collect each field
 */
export function generateFormCollectionPrompt(
  introMessage: string,
  formName: string,
  fields: FormFieldDefinition[]
): string {
  const sortedFields = [...fields].sort((a, b) => a.order - b.order);
  
  const fieldInstructions = sortedFields.map((field, index) => {
    let instruction = `${index + 1}. Ask: "${field.question}"`;
    
    switch (field.fieldType) {
      case 'yes_no':
        instruction += ` (Accept yes/no, yeah/nah, affirmative/negative responses)`;
        break;
      case 'multiple_choice':
        if (field.options?.length) {
          instruction += ` (Options: ${field.options.join(', ')})`;
        }
        break;
      case 'number':
        instruction += ` (Collect a number)`;
        break;
      case 'email':
        instruction += ` (Collect email address, confirm spelling)`;
        break;
      case 'phone':
      case 'tel':
        instruction += ` (CALLER'S OWN NUMBER: do NOT ask — state "I already have your number on file" and auto-fill. Only ask if clearly requesting a DIFFERENT contact's phone)`;
        break;
      case 'rating':
        instruction += ` (Collect a rating, typically 1-5 or 1-10)`;
        break;
      case 'date':
        instruction += ` (Accept natural language dates like "tomorrow", "next week")`;
        break;
    }
    
    if (field.isRequired) {
      instruction += ` [REQUIRED]`;
    }
    
    return instruction;
  }).join('\n');
  
  const formIdSuffix = sortedFields[0]?.id ? sortedFields[0].id.split('_')[0] : 'form';
  
  return `Say exactly: '${introMessage}'

FORM COLLECTION INSTRUCTIONS for "${formName}":
You need to collect the following information. Before asking any question, check what the caller has ALREADY provided during this conversation (including any answer given right after the intro message). Only ask for information that has NOT yet been given.

PHONE NUMBER POLICY: The caller's phone number is already captured by the call system. For any question that asks for the CALLER'S OWN phone number, do NOT ask — instead say "I already have your number on file" and auto-fill it. Only ask for a phone number if the question is clearly about someone else's number (e.g. an emergency contact, spouse, or office line).

Required questions (ask only for missing answers, one at a time):

${fieldInstructions}

IMPORTANT RULES:
1. If the caller already answered a question (even during the intro), accept that answer immediately — do NOT re-ask it.
2. Ask each missing question ONE AT A TIME. Wait for the answer before asking the next question.
3. If the caller's response is unclear, ask for clarification once. Then accept whatever they provide.
4. Once ALL required information has been collected, call the submit_form tool immediately to save the responses.
5. CRITICAL: After successful submission, say exactly: "Your information has been saved successfully." This phrase signals completion.
6. If the submit_form tool fails, apologize and try ONE more time. If it fails a second time, say "Your information has been noted and we will follow up with you shortly." then proceed to the next step without retrying further.
7. Only after saying the completion phrase (or the follow-up fallback) should you proceed to the next step.

PHONE NUMBER PRONUNCIATION: When reading back or confirming any phone number, ALWAYS speak each digit separately with brief pauses. For example:
- "9990155993" should be spoken as "nine, nine, nine, zero, one, five, five, nine, nine, three"
- Never read phone numbers as large numbers (do NOT say "nine hundred ninety-nine million...")
- Group digits in sets of 3 or 4 for natural reading rhythm

Then stop speaking and wait for response.`;
}
