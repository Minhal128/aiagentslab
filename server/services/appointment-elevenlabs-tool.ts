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
 * Appointment ElevenLabs Tool Configuration
 * 
 * Configures the book_appointment webhook tool for ElevenLabs agents.
 * When a Flow Agent needs to book an appointment during a call, ElevenLabs calls
 * our webhook with the appointment details, which saves it to the database.
 * 
 * Tool Type: "webhook" (server-side) - ElevenLabs calls our endpoint directly
 * Security: Uses a shared secret token in header for webhook authentication
 */

import { getDomain } from "../utils/domain";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const PERSISTED_SECRET_PATH = path.join(process.cwd(), '.appointment-webhook-secret');

let appointmentWebhookSecret: string | null = null;

export function getAppointmentWebhookSecret(): string {
  if (!appointmentWebhookSecret) {
    if (process.env.APPOINTMENT_WEBHOOK_SECRET) {
      appointmentWebhookSecret = process.env.APPOINTMENT_WEBHOOK_SECRET;
    } else {
      try {
        if (fs.existsSync(PERSISTED_SECRET_PATH)) {
          appointmentWebhookSecret = fs.readFileSync(PERSISTED_SECRET_PATH, 'utf-8').trim();
          console.log(`📅 [Appointment Tool] Loaded persisted webhook secret from file`);
        }
      } catch (err) {
        // ignore read errors
      }

      if (!appointmentWebhookSecret) {
        appointmentWebhookSecret = crypto.randomBytes(32).toString('hex');
        console.log(`📅 [Appointment Tool] Generated new webhook secret`);
      }

      try {
        fs.writeFileSync(PERSISTED_SECRET_PATH, appointmentWebhookSecret, { mode: 0o600 });
        console.log(`📅 [Appointment Tool] Persisted webhook secret to file (set APPOINTMENT_WEBHOOK_SECRET env var for explicit control)`);
      } catch (err) {
        console.warn(`📅 [Appointment Tool] Could not persist webhook secret to file - secret will change on restart`);
      }
    }
  }
  return appointmentWebhookSecret;
}

export function validateAppointmentWebhookToken(providedToken: string | undefined): boolean {
  if (!providedToken) {
    return false;
  }
  const secret = getAppointmentWebhookSecret();
  
  const providedBuffer = Buffer.from(providedToken);
  const secretBuffer = Buffer.from(secret);
  
  if (providedBuffer.length !== secretBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(providedBuffer, secretBuffer);
}

export interface AppointmentWebhookToolConfig {
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

/**
 * Get the book_appointment webhook tool configuration for ElevenLabs
 * @param agentId - The database agent ID (not ElevenLabs agent ID) for appointment ownership
 * @param callId - Optional call ID to associate the appointment with
 */
export function getBookAppointmentWebhookTool(agentId: string, callId?: string): AppointmentWebhookToolConfig {
  const domain = getDomain();
  const secret = getAppointmentWebhookSecret();
  
  const queryParams = callId ? `?callId=${encodeURIComponent(callId)}` : '';
  const webhookUrl = `${domain}/api/webhooks/elevenlabs/appointment/${secret}/${agentId}${queryParams}`;
  
  const agentIdSuffix = agentId.slice(-8);
  const toolName = `book_appointment_${agentIdSuffix}`;
  
  console.log(`📅 [Appointment Tool] Creating webhook tool config for agent ${agentId}`);
  console.log(`   Tool name: ${toolName}`);
  console.log(`   Webhook URL: ${webhookUrl.replace(secret, '[TOKEN]')}`);

  return {
    type: "webhook",
    name: toolName,
    // ponytail: date intentionally NOT baked in — it goes stale when ElevenLabs caches the agent config.
    // Server resolves relative terms (tomorrow/next Monday/etc) via chrono-node at call time using server clock.
    description: `Book an appointment for the caller. Use this when the caller wants to schedule an appointment. For appointmentDate, ALWAYS pass relative terms exactly as spoken: "tomorrow", "next Monday", "in 3 days", "December 5th" — do NOT convert to a numeric date yourself; the server resolves them accurately. IMPORTANT: The caller's phone number is automatically available from the call. For contactPhone, ALWAYS set it to "{{system__caller_id}}" to use their actual calling number. Only set a different phone number if the caller explicitly provides a different one. Do NOT ask the caller for their phone number - you already have it.`,
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      request_body_schema: {
        type: "object",
        properties: {
          contactName: {
            type: "string",
            description: "The name of the person booking the appointment"
          },
          contactPhone: {
            type: "string",
            description: "ALWAYS set this to the string {{system__caller_id}} which will be automatically replaced with the caller's actual phone number. Only provide a different phone number if the caller explicitly gives you a different one."
          },
          contactEmail: {
            type: "string",
            description: "Optional email address of the person"
          },
          appointmentDate: {
            type: "string",
            description: "The appointment date. Can be relative like 'tomorrow', 'next Monday', 'in 3 days' OR in YYYY-MM-DD format. The server will parse relative dates automatically."
          },
          appointmentTime: {
            type: "string",
            description: "The appointment time in HH:MM format (24-hour). Convert spoken times: '2pm' becomes '14:00', '9:30am' becomes '09:30'"
          },
          duration: {
            type: "number",
            description: "Duration in minutes (default 30)"
          },
          serviceName: {
            type: "string",
            description: "Optional name of the service/reason for appointment"
          },
          notes: {
            type: "string",
            description: "Optional additional notes about the appointment"
          }
        },
        required: ["contactName", "contactPhone", "appointmentDate", "appointmentTime"]
      }
    }
  };
}

/**
 * Get the appointment webhook tool for a specific ElevenLabs agent
 * Used when creating/updating Flow agents
 * 
 * @param elevenLabsAgentId - The ElevenLabs agent ID (required after agent is created in ElevenLabs)
 */
export function getAppointmentToolForAgent(elevenLabsAgentId: string): AppointmentWebhookToolConfig {
  const domain = getDomain();
  const secret = getAppointmentWebhookSecret();
  
  const webhookUrl = `${domain}/api/webhooks/elevenlabs/appointment/${secret}/${elevenLabsAgentId}`;
  
  const agentIdSuffix = elevenLabsAgentId.slice(-8);
  const toolName = `book_appointment_${agentIdSuffix}`;
  
  console.log(`📅 [Appointment Tool] Creating webhook tool for ElevenLabs agent ${elevenLabsAgentId}`);
  console.log(`   Tool name: ${toolName}`);
  console.log(`   Webhook URL: ${webhookUrl.replace(secret, '[TOKEN]')}`);

  return {
    type: "webhook",
    name: toolName,
    // ponytail: same as getBookAppointmentWebhookTool — no baked-in date, server resolves at call time.
    description: `Book an appointment for the caller. Use this when the caller wants to schedule an appointment. For appointmentDate, ALWAYS pass relative terms exactly as spoken: "tomorrow", "next Monday", "in 3 days", "December 5th" — do NOT convert to a numeric date yourself; the server resolves them accurately. IMPORTANT: The caller's phone number is automatically available from the call. For contactPhone, ALWAYS set it to "{{system__caller_id}}" to use their actual calling number. Only set a different phone number if the caller explicitly provides a different one. Do NOT ask the caller for their phone number - you already have it.`,
    api_schema: {
      url: webhookUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      request_body_schema: {
        type: "object",
        properties: {
          contactName: {
            type: "string",
            description: "The name of the person booking the appointment"
          },
          contactPhone: {
            type: "string",
            description: "ALWAYS set this to the string {{system__caller_id}} which will be automatically replaced with the caller's actual phone number. Only provide a different phone number if the caller explicitly gives you a different one."
          },
          contactEmail: {
            type: "string",
            description: "Optional email address of the person"
          },
          appointmentDate: {
            type: "string",
            description: "The appointment date. Can be relative like 'tomorrow', 'next Monday', 'in 3 days' OR in YYYY-MM-DD format. The server will parse relative dates automatically."
          },
          appointmentTime: {
            type: "string",
            description: "The appointment time in HH:MM format (24-hour). Convert spoken times: '2pm' becomes '14:00', '9:30am' becomes '09:30'"
          },
          duration: {
            type: "number",
            description: "Duration in minutes (default 30)"
          },
          serviceName: {
            type: "string",
            description: "Optional name of the service/reason for appointment"
          },
          notes: {
            type: "string",
            description: "Optional additional notes about the appointment"
          }
        },
        required: ["contactName", "contactPhone", "appointmentDate", "appointmentTime"]
      }
    }
  };
}
