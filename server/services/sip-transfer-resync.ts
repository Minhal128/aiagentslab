import { db } from '../db';
import { sql } from 'drizzle-orm';
import { ElevenLabsService, isAgentOnSipPhoneNumber } from './elevenlabs';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { IncomingAgentService } from './incoming-agent';
import { storage } from '../storage';
import { getAppointmentWebhookSecret } from './appointment-elevenlabs-tool';


let ElevenLabsSipServiceClass: any = null;
async function getElevenLabsSipService() {
  if (!ElevenLabsSipServiceClass) {
    try {
      const { importPlugin } = await import('../utils/plugin-import');
      const mod = await importPlugin('plugins/sip-engine/services/elevenlabs-sip.service.ts');
      ElevenLabsSipServiceClass = mod.ElevenLabsSipService;
    } catch {
      return null;
    }
  }
  return ElevenLabsSipServiceClass;
}

export async function resyncSipTrunkConfigs(): Promise<void> {
  try {
    const ElevenLabsSipService = await getElevenLabsSipService();
    if (!ElevenLabsSipService) {
      console.log(`[SIP Config Resync] SIP engine plugin not available, skipping`);
      return;
    }

    const result = await db.execute(sql`
      SELECT sp.id, sp.phone_number, sp.external_elevenlabs_phone_id, sp.user_id,
             st.id as trunk_id, st.sip_host, st.sip_port, st.transport, st.provider,
             st.username, st.password, st.media_encryption
      FROM sip_phone_numbers sp
      JOIN sip_trunks st ON sp.sip_trunk_id = st.id
      WHERE sp.engine = 'elevenlabs-sip'
        AND sp.external_elevenlabs_phone_id IS NOT NULL
        AND sp.is_active = true
    `);

    if (!result.rows || result.rows.length === 0) {
      console.log(`[SIP Config Resync] No ElevenLabs SIP phone numbers found`);
      return;
    }

    console.log(`[SIP Config Resync] Found ${result.rows.length} SIP phone number(s) to resync config`);

    let updated = 0;
    let failed = 0;

    for (const row of result.rows) {
      const phone = row as any;
      try {
        const trunk = {
          id: phone.trunk_id,
          sipHost: phone.sip_host,
          sipPort: phone.sip_port,
          transport: phone.transport,
          provider: phone.provider,
          username: phone.username,
          password: phone.password,
          mediaEncryption: phone.media_encryption,
          engine: 'elevenlabs-sip' as const,
        };

        await ElevenLabsSipService.updatePhoneNumberSipConfig(
          phone.user_id,
          phone.external_elevenlabs_phone_id,
          trunk,
          phone.phone_number
        );
        updated++;
        console.log(`   [SIP Config Resync] Updated ${phone.phone_number} (media_encryption: ${phone.media_encryption})`);
      } catch (error: any) {
        failed++;
        console.warn(`   [SIP Config Resync] Failed ${phone.phone_number}: ${error.message}`);
      }
    }

    console.log(`[SIP Config Resync] Complete: ${updated} updated, ${failed} failed`);
  } catch (error: any) {
    console.warn(`[SIP Config Resync] Failed: ${error.message}`);
  }
}

export async function resyncSipAgentTransferTools(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT a.id, a.name, a.type, a.eleven_labs_agent_id, a.transfer_phone_number,
             st.sip_host, st.sip_port, st.transport
      FROM agents a
      JOIN sip_phone_numbers sp ON sp.agent_id = a.id AND sp.is_active = true
      JOIN sip_trunks st ON sp.sip_trunk_id = st.id
      WHERE a.transfer_enabled = true
        AND a.transfer_phone_number IS NOT NULL
        AND a.eleven_labs_agent_id IS NOT NULL
    `);

    if (!result.rows || result.rows.length === 0) {
      console.log(`📞 [SIP Resync] No SIP agents with transfer enabled found`);
      return;
    }

    console.log(`📞 [SIP Resync] Found ${result.rows.length} SIP agent(s) with transfer enabled`);

    for (const row of result.rows) {
      const agent = row as any;
      try {
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        if (!credential) {
          console.warn(`   ⚠️  No credential for agent ${agent.name} (${agent.id}), skipping`);
          continue;
        }

        const elevenLabsService = new ElevenLabsService(credential.apiKey);

        const phoneNumber = agent.transfer_phone_number.startsWith('+')
          ? agent.transfer_phone_number
          : `+${agent.transfer_phone_number}`;

        console.log(`   📞 Resyncing ${agent.name} (${agent.type}): ${phoneNumber} (conference transfer)`);

        if (agent.type === 'incoming') {
          const currentAgent = await storage.getAgent(agent.id);
          if (currentAgent) {
            await IncomingAgentService.updateInElevenLabs(
              agent.id,
              agent.eleven_labs_agent_id,
              currentAgent,
              { databaseAgentId: agent.id, systemPrompt: currentAgent.systemPrompt || undefined }
            );
            console.log(`   ✅ Resynced incoming agent: ${agent.name}`);
          }
        } else {
          await elevenLabsService.updateAgentTools(agent.eleven_labs_agent_id, {
            transferEnabled: true,
            transferPhoneNumber: agent.transfer_phone_number,
            detectLanguageEnabled: true,
            endConversationEnabled: true,
            databaseAgentId: agent.id,
          });
          console.log(`   ✅ Resynced agent tools: ${agent.name}`);
        }
      } catch (error: any) {
        console.warn(`   ⚠️  Failed to resync agent ${agent.name}: ${error.message}`);
      }
    }

    console.log(`📞 [SIP Resync] Complete`);
  } catch (error: any) {
    console.warn(`⚠️  [SIP Resync] Failed: ${error.message}`);
  }
}

/**
 * Resync appointment webhook tool URLs for all agents with appointment booking enabled.
 * This ensures that after a server restart, the appointment webhook URL baked into
 * ElevenLabs agent configs uses the current persisted secret (not a stale one).
 * Runs once at startup, non-blocking.
 */
export async function resyncAppointmentWebhookUrls(): Promise<void> {
  try {
    getAppointmentWebhookSecret();
    
    const result = await db.execute(sql`
      SELECT id, name, eleven_labs_agent_id
      FROM agents
      WHERE appointment_booking_enabled = true
        AND eleven_labs_agent_id IS NOT NULL
    `);

    if (!result.rows || result.rows.length === 0) {
      console.log(`📅 [Appointment Resync] No agents with appointment booking found`);
      return;
    }

    console.log(`📅 [Appointment Resync] Found ${result.rows.length} agent(s) with appointment booking enabled`);
    
    let updated = 0;
    let failed = 0;

    for (const row of result.rows) {
      const agent = row as any;
      try {
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        if (!credential) {
          console.warn(`   ⚠️ No credential for agent ${agent.name} (${agent.id}), skipping`);
          continue;
        }

        const elevenLabsService = new ElevenLabsService(credential.apiKey);
        await elevenLabsService.refreshAppointmentToolWithCurrentDate(agent.eleven_labs_agent_id);
        updated++;
        console.log(`   ✅ Resynced appointment webhook URL: ${agent.name}`);
      } catch (error: any) {
        failed++;
        console.warn(`   ⚠️ Failed to resync appointment for ${agent.name}: ${error.message}`);
      }
    }

    console.log(`📅 [Appointment Resync] Complete: ${updated} updated, ${failed} failed`);
  } catch (error: any) {
    console.warn(`⚠️ [Appointment Resync] Failed: ${error.message}`);
  }
}

/**
 * Re-registers all ElevenLabs form submission webhook tools for agents whose
 * flow contains form nodes. This is run once on startup to repair stale webhook
 * URLs caused by the previous random-secret behaviour. With the new stable HMAC
 * secret, the re-registered URL will be identical on every subsequent restart so
 * this job becomes a one-time heal and then a no-op.
 */
export async function resyncFormWebhookUrls(): Promise<void> {
  try {
    // Warm up the stable secret so it is derived before any URL is built
    const { getFormWebhookSecret, getSubmitFormWebhookTool } = await import('./form-elevenlabs-tool');
    getFormWebhookSecret();

    // Find all agents that are linked to a flow
    const result = await db.execute(sql`
      SELECT id, name, eleven_labs_agent_id, flow_id, user_id
      FROM agents
      WHERE flow_id IS NOT NULL
        AND eleven_labs_agent_id IS NOT NULL
    `);

    if (!result.rows || result.rows.length === 0) {
      console.log(`📋 [Form Resync] No flow agents found, skipping`);
      return;
    }

    console.log(`📋 [Form Resync] Checking ${result.rows.length} flow agent(s) for form nodes`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const { db: dbInner } = await import('../db');
    const { flows, forms, formFields } = await import('../../shared/schema');
    const { eq, asc } = await import('drizzle-orm');

    for (const row of result.rows) {
      const agent = row as any;
      try {
        // Load the flow to inspect nodes
        const [flowRecord] = await dbInner
          .select({ nodes: flows.nodes })
          .from(flows)
          .where(eq(flows.id, agent.flow_id))
          .limit(1);

        if (!flowRecord) {
          skipped++;
          continue;
        }

        const nodes: any[] = (flowRecord.nodes as any[]) || [];
        const formNodes = nodes.filter((n: any) => {
          const t = n.data?.type || n.type;
          return t === 'form' || t === 'form_submission' || t === 'collect_info';
        });

        if (formNodes.length === 0) {
          skipped++;
          continue;
        }

        // Build form tools
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        if (!credential) {
          console.warn(`   ⚠️ No credential for agent ${agent.name} (${agent.id}), skipping form resync`);
          skipped++;
          continue;
        }

        const elevenLabsService = new ElevenLabsService(credential.apiKey);
        const newFormTools: any[] = [];

        for (const node of formNodes) {
          const cfg = node.data?.config || node.data || {};
          const formId: string = cfg.formId;
          if (!formId) continue;

          // Load form name and field definitions from DB — cfg.fields is always
          // empty in the raw flow JSON (fields are only enriched in memory at runtime).
          // Skip this node entirely if the form or its fields cannot be loaded.
          let formName: string;
          let fields: any[];
          try {
            const [formRecord] = await dbInner
              .select({ name: forms.name })
              .from(forms)
              .where(eq(forms.id, formId))
              .limit(1);
            if (!formRecord) {
              console.warn(`   ⚠️ [Form Resync] Form ${formId} not found in DB, skipping node`);
              continue;
            }
            formName = formRecord.name;
            const dbFields = await dbInner
              .select()
              .from(formFields)
              .where(eq(formFields.formId, formId))
              .orderBy(asc(formFields.order));
            fields = dbFields.map((f: any) => ({
              id: f.id,
              question: f.question,
              fieldType: f.fieldType,
              isRequired: f.isRequired,
              options: f.options,
              order: f.order ?? 0,
            }));
          } catch (fieldErr: any) {
            console.warn(`   ⚠️ [Form Resync] Failed to load fields for form ${formId}: ${(fieldErr as any).message}, skipping node`);
            continue;
          }

          console.log(`   📋 [Form Resync] Building tool for form "${formName}" (${fields.length} field(s))`);
          newFormTools.push(getSubmitFormWebhookTool(formId, formName, fields, agent.eleven_labs_agent_id, node.id));
        }

        if (newFormTools.length === 0) {
          skipped++;
          continue;
        }

        // Replace stale submit_form_* tools with the ones containing the new stable URL.
        // replaceToolsByPrefix preserves all other tools (RAG, appointment, messaging, etc.)
        await elevenLabsService.replaceToolsByPrefix(agent.eleven_labs_agent_id, 'submit_form_', newFormTools);

        updated++;
        console.log(`   ✅ Resynced form webhook URL(s) for: ${agent.name} (${newFormTools.length} form tool(s))`);
      } catch (error: any) {
        failed++;
        console.warn(`   ⚠️ Failed to resync form webhooks for ${agent.name}: ${error.message}`);
      }
    }

    console.log(`📋 [Form Resync] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  } catch (error: any) {
    console.warn(`⚠️ [Form Resync] Failed: ${error.message}`);
  }
}


/**
 * Resync messaging webhook tool URLs for all flow agents.
 * This repairs stale webhook URLs (e.g. from random-secret era or missing conversationId context).
 * Runs once at startup, non-blocking.
 */
export async function resyncMessagingWebhookUrls(): Promise<void> {
  try {
    const { flows } = await import('../../shared/schema');
    const { eq } = await import('drizzle-orm');
    const { db: dbInner } = await import('../db');

    // Find all agents that are linked to a flow
    const result = await db.execute(sql`
      SELECT id, name, eleven_labs_agent_id, flow_id
      FROM agents
      WHERE flow_id IS NOT NULL
        AND eleven_labs_agent_id IS NOT NULL
    `);

    if (!result.rows || result.rows.length === 0) {
      console.log(`💬 [Messaging Resync] No flow agents found, skipping`);
      return;
    }

    console.log(`💬 [Messaging Resync] Checking ${result.rows.length} flow agent(s) for messaging nodes`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of result.rows) {
      const agent = row as any;
      try {
        // Load the flow to inspect nodes
        const [flowRecord] = await dbInner
          .select({ nodes: flows.nodes })
          .from(flows)
          .where(eq(flows.id, agent.flow_id))
          .limit(1);

        if (!flowRecord) {
          skipped++;
          continue;
        }

        const nodes: any[] = (flowRecord.nodes as any[]) || [];
        const messagingNodes = nodes.filter((n: any) => {
          const t = n.data?.type || n.type;
          return t === 'send_email' || t === 'send_whatsapp';
        });

        if (messagingNodes.length === 0) {
          skipped++;
          continue;
        }

        // Build messaging tools
        const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
        if (!credential) {
          skipped++;
          continue;
        }

        const elevenLabsService = new ElevenLabsService(credential.apiKey);
        const { buildMessagingEmailTool, buildMessagingWhatsappTool } = await import('./elevenlabs');
        
        const newTools: any[] = [];
        for (const node of messagingNodes) {
          const type = node.data?.type || node.type;
          const config = node.data?.config || node.data || {};
          
          if (type === 'send_email') {
            const templateName = config.templateName || config.template_name || 'default';
            const emailTool = buildMessagingEmailTool(agent.eleven_labs_agent_id, [templateName], templateName);
            emailTool.name = `send_email_${node.id.slice(-8)}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
            newTools.push(emailTool);
          } else if (type === 'send_whatsapp') {
            const templateName = config.templateName || config.template_name || 'hello_world';
            const waTool = buildMessagingWhatsappTool(agent.eleven_labs_agent_id, [templateName], templateName);
            waTool.name = `send_whatsapp_${node.id.slice(-8)}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
            newTools.push(waTool);
          }
        }

        if (newTools.length === 0) {
          skipped++;
          continue;
        }

        // Replace stale tools
        await elevenLabsService.replaceToolsByPrefix(agent.eleven_labs_agent_id, 'send_email_', newTools.filter(t => t.name.startsWith('send_email_')));
        await elevenLabsService.replaceToolsByPrefix(agent.eleven_labs_agent_id, 'send_whatsapp_', newTools.filter(t => t.name.startsWith('send_whatsapp_')));

        updated++;
        console.log(`   ✅ Resynced messaging webhook URLs for: ${agent.name}`);
      } catch (error: any) {
        failed++;
        console.warn(`   ⚠️ Failed to resync messaging for ${agent.name}: ${error.message}`);
      }
    }

    console.log(`💬 [Messaging Resync] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  } catch (error: any) {
    console.warn(`⚠️ [Messaging Resync] Failed: ${error.message}`);
  }
}
