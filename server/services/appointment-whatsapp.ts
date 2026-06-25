/**
 * Appointment WhatsApp Confirmation Service
 *
 * Sends a WhatsApp confirmation to the caller immediately after the call ends,
 * when an appointment was booked during that call.
 *
 * Triggered from the post_call_activity handler in webhook-routes.ts (fire-and-forget)
 * only when callRecord.metadata.appointmentBooked === true.
 *
 * Uses the agent's configured WhatsApp template (messagingWhatsappTemplate)
 * with the following variable order:
 *   {{1}} = appointment date (human-readable)
 *   {{2}} = appointment time (human-readable, 12-hour)
 *   {{3}} = doctor name (appointmentDoctorName or agent name)
 *
 * Falls back gracefully when:
 *   - WhatsApp is not enabled on the agent
 *   - The messaging plugin is not installed
 *   - No active WhatsApp provider is configured
 */

import { db } from '../db';
import { agents } from '@shared/schema';
import { sql } from 'drizzle-orm';

function formatReadableDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatReadableTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  } catch {
    return timeStr;
  }
}

export interface AppointmentConfirmationParams {
  userId: string;
  elevenLabsAgentId: string;
  callerPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentId?: string;
  callId?: string;
}

export async function sendAppointmentWhatsAppConfirmation(params: AppointmentConfirmationParams): Promise<void> {
  const { userId, elevenLabsAgentId, callerPhone, appointmentDate, appointmentTime, appointmentId, callId } = params;

  try {
    const phoneDigits = callerPhone.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 6) {
      console.warn(`[Appointment WhatsApp] Skipping: invalid phone "${callerPhone}"`);
      return;
    }

    // Look up agent settings
    const agentRows = await db
      .select()
      .from(agents)
      .where(sql`eleven_labs_agent_id = ${elevenLabsAgentId} OR id = ${elevenLabsAgentId}`)
      .limit(1);

    if (agentRows.length === 0) {
      console.log(`[Appointment WhatsApp] Agent not found: ${elevenLabsAgentId}`);
      return;
    }

    const agent = agentRows[0];

    if (!agent.messagingWhatsappEnabled) {
      console.log(`[Appointment WhatsApp] WhatsApp messaging not enabled for agent ${agent.id}`);
      return;
    }

    if (!agent.messagingWhatsappTemplate) {
      console.log(`[Appointment WhatsApp] No WhatsApp template configured for agent ${agent.id}`);
      return;
    }

    const doctorName = agent.appointmentDoctorName?.trim() || agent.name || 'Your Doctor';
    const readableDate = formatReadableDate(appointmentDate);
    const readableTime = formatReadableTime(appointmentTime);

    console.log(`📱 [Appointment WhatsApp] Sending confirmation to ${callerPhone}`);
    console.log(`   Date: ${readableDate}, Time: ${readableTime}, Doctor: ${doctorName}`);
    console.log(`   Template: ${agent.messagingWhatsappTemplate}`);

    // Build template components: {{1}}=date, {{2}}=time, {{3}}=doctor
    const bodyParameters = [
      { type: 'text', text: readableDate },
      { type: 'text', text: readableTime },
      { type: 'text', text: doctorName },
    ];
    const components = [{ type: 'body', parameters: bodyParameters }];

    // Load WhatsApp provider services dynamically (messaging plugin)
    let metaWhatsAppService: any;
    let MetaWhatsAppService: any;
    let whatswayService: any;

    try {
      const metaMod = await import('../../plugins/messaging/services/meta-whatsapp.service');
      metaWhatsAppService = metaMod.metaWhatsAppService;
      MetaWhatsAppService = metaMod.MetaWhatsAppService;
    } catch {
      // Plugin not installed — try WhatsWay only
    }

    try {
      const wwMod = await import('../../plugins/messaging/services/whatsway.service');
      whatswayService = wwMod.whatswayService;
    } catch {
      // Plugin not installed
    }

    if (!metaWhatsAppService && !whatswayService) {
      console.warn(`[Appointment WhatsApp] No WhatsApp provider available (messaging plugin not installed)`);
      return;
    }

    let templateLanguage = 'en_US';

    const metaSettings = metaWhatsAppService ? await metaWhatsAppService.getSettings(userId) : null;
    const whatswaySettings = whatswayService ? await whatswayService.getSettings(userId) : null;

    if (!metaSettings?.isActive && !whatswaySettings?.isActive) {
      console.warn(`[Appointment WhatsApp] No active WhatsApp provider for user ${userId}`);
      return;
    }

    if (metaSettings?.isActive && metaWhatsAppService) {
      // Enrich components using the template definition (headers, buttons, etc.)
      try {
        const templateDef = await metaWhatsAppService.getTemplateByName(userId, agent.messagingWhatsappTemplate);
        templateLanguage = templateDef?.language || 'en_US';

        if (templateDef?.components) {
          const buttonComponents = MetaWhatsAppService.buildButtonComponents(templateDef.components);
          if (buttonComponents.length > 0) {
            components.push(...buttonComponents);
          }
        }
      } catch (tmplErr: any) {
        console.warn(`[Appointment WhatsApp] Could not fetch Meta template: ${tmplErr.message}`);
      }

      const result = await metaWhatsAppService.sendTemplate(
        userId,
        callerPhone,
        agent.messagingWhatsappTemplate,
        templateLanguage,
        components,
        { callId, agentId: agent.id, appointmentId }
      );
      console.log(`✅ [Appointment WhatsApp] Sent via Meta. Result: ${JSON.stringify(result)}`);
    } else if (whatswaySettings?.isActive && whatswayService) {
      const result = await whatswayService.sendTemplate(
        userId,
        callerPhone,
        agent.messagingWhatsappTemplate,
        templateLanguage,
        components,
        { callId, agentId: agent.id, appointmentId }
      );
      console.log(`✅ [Appointment WhatsApp] Sent via WhatsWay. Result: ${JSON.stringify(result)}`);
    }
  } catch (err: any) {
    console.error(`❌ [Appointment WhatsApp] Error sending confirmation: ${err.message}`);
    console.error(err.stack);
  }
}
