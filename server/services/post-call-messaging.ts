import { db } from '../db';
import { sql, eq, and, desc, isNull } from 'drizzle-orm';
import { agents, contacts, campaigns, appointments, emailTemplates } from '@shared/schema';

function extractRows(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray((result as any).rows)) return (result as any).rows;
  return [];
}

function stripUnresolvedVar(value: string | undefined | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\{\{\s*\w+\s*\}\}$/.test(trimmed)) return '';
  return trimmed;
}

const CALL_TABLES = ['twilio_openai_calls', 'plivo_calls', 'calls', 'sip_calls'] as const;

const _triggeredCallIds = new Set<string>();

async function readCallerEmailFromMetadata(callId: string): Promise<string> {
  if (!callId) return '';
  try {
    for (const table of CALL_TABLES) {
      try {
        const result = await db.execute(
          sql`SELECT metadata->>'callerEmail' as caller_email FROM ${sql.identifier(table)} WHERE id = ${callId} LIMIT 1`
        );
        const rows = extractRows(result);
        if (rows.length > 0 && rows[0].caller_email) {
          return rows[0].caller_email as string;
        }
      } catch (_) { /* table may not have the record */ }
    }
  } catch (err: any) {
    console.warn(`[Post-Call Messaging] Could not read callerEmail from metadata: ${err.message}`);
  }
  return '';
}

async function lookupContactByPhone(phone: string, userId: string): Promise<Record<string, string>> {
  if (!phone || !userId) return {};
  try {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length < 6) return {};

    const results = await db
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
      })
      .from(contacts)
      .innerJoin(campaigns, eq(contacts.campaignId, campaigns.id))
      .where(and(
        eq(campaigns.userId, userId),
        sql`${contacts.phone} LIKE ${'%' + digits.slice(-10)}`
      ))
      .orderBy(desc(contacts.createdAt))
      .limit(1);

    if (results.length > 0) {
      const c = results[0];
      const name = c.lastName ? `${c.firstName || ''} ${c.lastName}`.trim() : (c.firstName || '');
      return {
        ...(name ? { contact_name: name } : {}),
        ...(c.phone ? { contact_phone: c.phone } : {}),
        ...(c.email ? { contact_email: c.email } : {}),
      };
    }
  } catch (err: any) {
    console.warn(`[Post-Call Messaging] Contact lookup error: ${err.message}`);
  }
  return {};
}

async function lookupSipCallData(callId: string, userId: string): Promise<{ conversationId: string; contactData: Record<string, string> }> {
  if (!callId || !userId) return { conversationId: '', contactData: {} };
  try {
    const result = await db.execute(sql`
      SELECT sc.elevenlabs_conversation_id, sc.from_number, sc.to_number, sc.direction,
             a.name as agent_name,
             COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name,
             ct.email as contact_email
      FROM sip_calls sc
      LEFT JOIN agents a ON sc.agent_id = a.id
      LEFT JOIN contacts ct ON sc.contact_id = ct.id
      WHERE sc.id = ${callId} AND sc.user_id = ${userId}
      LIMIT 1
    `);
    const rows = extractRows(result);
    if (rows.length > 0) {
      const row = rows[0];
      const phone = row.direction === 'inbound'
        ? (row.from_number || row.to_number || '')
        : (row.to_number || row.from_number || '');
      return {
        conversationId: row.elevenlabs_conversation_id || '',
        contactData: {
          ...(row.contact_name ? { contact_name: row.contact_name } : {}),
          ...(phone ? { contact_phone: phone } : {}),
          ...(row.contact_email ? { contact_email: row.contact_email } : {}),
          ...(row.agent_name ? { agent_name: row.agent_name } : {}),
        },
      };
    }
  } catch (err: any) {
    console.warn(`[Post-Call Messaging] SIP call lookup error: ${err.message}`);
  }
  return { conversationId: '', contactData: {} };
}

async function lookupRegularCallData(callId: string, userId: string): Promise<Record<string, string>> {
  if (!callId || !userId) return {};
  try {
    const result = await db.execute(sql`
      SELECT c.phone_number, c.from_number, c.to_number, c.call_direction,
             a.name as agent_name,
             COALESCE(ct.first_name || ' ' || ct.last_name, ct.first_name, '') as contact_name,
             ct.email as contact_email
      FROM calls c
      LEFT JOIN agents a ON c.agent_id = a.id
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      WHERE c.id = ${callId} AND c.user_id = ${userId}
      LIMIT 1
    `);
    const rows = extractRows(result);
    if (rows.length > 0) {
      const row = rows[0];
      const isOutbound = (row.call_direction || '').includes('out');
      const customerPhone = isOutbound
        ? (row.to_number || row.phone_number || '')
        : (row.phone_number || row.from_number || '');
      return {
        ...(row.contact_name ? { contact_name: row.contact_name } : {}),
        ...(customerPhone ? { contact_phone: customerPhone } : {}),
        ...(row.contact_email ? { contact_email: row.contact_email } : {}),
        ...(row.agent_name ? { agent_name: row.agent_name } : {}),
      };
    }
  } catch (err: any) {
    console.warn(`[Post-Call Messaging] Regular call lookup error: ${err.message}`);
  }
  return {};
}

async function lookupAppointmentData(callId: string, conversationId: string, userId: string): Promise<Record<string, string>> {
  try {
    if (!userId) return {};
    const ids = [callId, conversationId].filter(Boolean);

    // First try matching by call_id
    let result: any = null;
    if (ids.length > 0) {
      const conditions = ids.map(id => sql`call_id = ${id}`);
      const orClause = conditions.length === 1 ? conditions[0] : sql`(${sql.join(conditions, sql` OR `)})`;
      result = await db.execute(sql`
        SELECT contact_name, contact_phone, contact_email, appointment_date, appointment_time,
               duration, service_name, notes, status
        FROM appointments
        WHERE user_id = ${userId} AND ${orClause}
        ORDER BY created_at DESC LIMIT 1
      `);
    }

    // Fallback: most recent appointment for this user in the last 15 minutes (handles empty call_id)
    if (!result || extractRows(result).length === 0) {
      result = await db.execute(sql`
        SELECT contact_name, contact_phone, contact_email, appointment_date, appointment_time,
               duration, service_name, notes, status
        FROM appointments
        WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '15 minutes'
        ORDER BY created_at DESC LIMIT 1
      `);
    }
    const rows = extractRows(result);
    if (rows.length > 0) {
      const a = rows[0];
      console.log(`[Post-Call Messaging] Found appointment data: date=${a.appointment_date}, time=${a.appointment_time}, service=${a.service_name || 'N/A'}`);
      return {
        ...(a.contact_name ? { contact_name: a.contact_name } : {}),
        ...(a.contact_phone ? { contact_phone: a.contact_phone } : {}),
        ...(a.contact_email ? { contact_email: a.contact_email } : {}),
        ...(a.appointment_date ? { appointment_date: a.appointment_date } : {}),
        ...(a.appointment_time ? { appointment_time: a.appointment_time } : {}),
        ...(a.duration ? { duration: String(a.duration) } : {}),
        ...(a.service_name ? { service_name: a.service_name } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(a.status ? { appointment_status: a.status } : {}),
      };
    }
  } catch (err: any) {
    console.warn(`[Post-Call Messaging] Appointment lookup error: ${err.message}`);
  }
  return {};
}

function resolveVarValue(value: string, contactData: Record<string, string>): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (contactData[trimmed] !== undefined && contactData[trimmed] !== '') {
    return contactData[trimmed];
  }
  const varMatch = trimmed.match(/^\{\{\s*(\w+)\s*\}\}$/);
  if (varMatch) {
    if (contactData[varMatch[1]] !== undefined && contactData[varMatch[1]] !== '') {
      return contactData[varMatch[1]];
    }
    return '';
  }
  let resolved = trimmed.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (contactData[key] !== undefined && contactData[key] !== '') {
      return contactData[key];
    }
    return '';
  });
  return resolved;
}

export async function triggerPostCallMessaging(params: {
  elevenLabsAgentId: string;
  userId: string;
  callerPhone: string;
  callId?: string;
  callerEmail?: string;
}): Promise<void> {
  const { elevenLabsAgentId, userId, callerPhone, callId } = params;

  const dedupeKey = callId || `${elevenLabsAgentId}:${userId}:${callerPhone}`;
  if (_triggeredCallIds.has(dedupeKey)) {
    console.log(`[Post-Call Messaging] Skipping duplicate trigger for ${dedupeKey}`);
    return;
  }
  _triggeredCallIds.add(dedupeKey);
  setTimeout(() => _triggeredCallIds.delete(dedupeKey), 10 * 60 * 1000);

  try {
    const agentRows = await db
      .select()
      .from(agents)
      .where(sql`eleven_labs_agent_id = ${elevenLabsAgentId} OR id = ${elevenLabsAgentId}`)
      .limit(1);

    if (agentRows.length === 0) {
      console.log(`[Post-Call Messaging] Agent not found: ${elevenLabsAgentId}`);
      return;
    }

    const agent = agentRows[0];
    const emailEnabled = !!agent.messagingEmailEnabled;
    const whatsappEnabled = !!agent.messagingWhatsappEnabled;
    const emailTemplate = agent.messagingEmailTemplate || null;
    const whatsappTemplate = agent.messagingWhatsappTemplate || null;
    const whatsappVariables = agent.messagingWhatsappVariables || null;
    const dbAgentId = agent.id;
    const agentName = agent.name || '';
    const userId = agent.userId;

    console.log(`📨 [Post-Call Messaging] Agent ${dbAgentId}: emailEnabled=${emailEnabled}, whatsappEnabled=${whatsappEnabled}, caller=${callerPhone}, userId=${userId}`);

    if (!emailEnabled && !whatsappEnabled) {
      return;
    }

    let callerEmail = params.callerEmail || '';
    if (!callerEmail && callId) {
      callerEmail = await readCallerEmailFromMetadata(callId);
      if (callerEmail) {
        console.log(`[Post-Call Messaging] Resolved callerEmail from call metadata: ${callerEmail}`);
      }
    }

    let contactData: Record<string, string> = {
      contact_phone: callerPhone,
      contact_email: callerEmail,
      agent_name: agentName,
      system__caller_id: callerPhone,
    };

    const contactInfo = await lookupContactByPhone(callerPhone, userId);
    if (Object.keys(contactInfo).length > 0) {
      contactData = { ...contactData, ...contactInfo };
      console.log(`[Post-Call Messaging] Enriched with contact data: ${Object.keys(contactInfo).join(', ')}`);
    }

    let conversationId = '';
    if (callId) {
      const sipData = await lookupSipCallData(callId, userId);
      if (sipData.conversationId) {
        conversationId = sipData.conversationId;
      }
      if (Object.keys(sipData.contactData).length > 0) {
        contactData = { ...contactData, ...sipData.contactData };
      }

      const regularCallData = await lookupRegularCallData(callId, userId);
      if (Object.keys(regularCallData).length > 0) {
        contactData = { ...contactData, ...regularCallData };
      }
    }

    if (callId || conversationId) {
      const apptData = await lookupAppointmentData(callId || '', conversationId, userId);
      if (Object.keys(apptData).length > 0) {
        contactData = { ...contactData, ...apptData };
        console.log(`[Post-Call Messaging] Enriched with appointment fields: ${Object.keys(apptData).join(', ')}`);
      }
    }

    console.log(`[Post-Call Messaging] Final Resolved Contact Data for variable resolution: ${JSON.stringify(contactData)}`);

    if (!callerEmail && contactData.contact_email) {
      callerEmail = contactData.contact_email;
      console.log(`[Post-Call Messaging] Resolved callerEmail from contact data: ${callerEmail}`);
    }

    if (whatsappEnabled && whatsappTemplate) {
      try {
        const phoneDigits = callerPhone.replace(/[^0-9]/g, '');
        if (phoneDigits.length < 6) {
          console.warn(`[Post-Call Messaging] Cannot send WhatsApp: invalid caller phone "${callerPhone}"`);
        } else {

          console.log(`[Post-Call Messaging] Initializing WhatsApp services for user ${userId}...`);
          const { metaWhatsAppService, MetaWhatsAppService } = await import('../../plugins/messaging/services/meta-whatsapp.service');
          const { whatswayService } = await import('../../plugins/messaging/services/whatsway.service');
          console.log(`[Post-Call Messaging] Services imported successfully.`);

          const metaSettings = await metaWhatsAppService.getSettings(userId);
          const whatswaySettings = await whatswayService.getSettings(userId);
          console.log(`[Post-Call Messaging] Settings fetched. Meta Active: ${!!metaSettings?.isActive}, WhatsWay Active: ${!!whatswaySettings?.isActive}`);

          let components: any[] = [];
          const buttonOverrides: Record<number, string> = {};

          if (whatsappVariables) {
            try {
              const parsedVars = JSON.parse(whatsappVariables);
              const bodyVarEntries: Array<[number, string]> = [];
              for (const [key, val] of Object.entries(parsedVars)) {
                if (!val || typeof val !== 'object') continue;
                const entry = val as any;

                if (entry.componentType === 'button') {
                  const btnIdx = key.startsWith('btn_') ? parseInt(key.replace('btn_', '')) : parseInt(key);
                  if (!isNaN(btnIdx) && entry.value) {
                    const resolved = stripUnresolvedVar(resolveVarValue(entry.value, contactData));
                    if (resolved) buttonOverrides[btnIdx] = resolved;
                  }
                } else if (entry.componentType === 'header') {
                  // header variables handled later via template definition
                } else if (!entry.componentType && (entry.mode === 'fixed' || entry.mode === 'collect') && entry.value) {
                  const idx = parseInt(key);
                  if (!isNaN(idx)) {
                    bodyVarEntries.push([idx, stripUnresolvedVar(resolveVarValue(entry.value, contactData))]);
                  }
                }
              }
              if (bodyVarEntries.length > 0) {
                bodyVarEntries.sort((a, b) => a[0] - b[0]);
                components = [{ type: 'body', parameters: bodyVarEntries.map(([, v]) => ({ type: 'text', text: v || ' ' })) }];
                console.log(`[Post-Call Messaging] Built ${bodyVarEntries.length} body variable(s) from agent config`);
              }
              if (Object.keys(buttonOverrides).length > 0) {
                console.log(`[Post-Call Messaging] Found ${Object.keys(buttonOverrides).length} button override(s) from agent config`);
              }
            } catch (parseErr: any) {
              console.warn(`[Post-Call Messaging] Failed to parse whatsapp variables: ${parseErr.message}`);
            }
          }

          let templateLanguage = 'en_US';

          if (metaSettings?.isActive) {
            try {
              const templateDef = await metaWhatsAppService.getTemplateByName(userId, whatsappTemplate);
              templateLanguage = templateDef?.language || 'en_US';
              if (templateDef?.components) {
                const bodyComp = templateDef.components.find((c: any) => c.type === 'BODY');
                if (bodyComp && bodyComp.text) {
                  const bodyVarMatches = bodyComp.text.match(/\{\{\d+\}\}/g) || [];
                  const requiredCount = [...new Set(bodyVarMatches)].length;
                  if (requiredCount > 0) {
                    const existingBody = components.find((c: any) => c.type === 'body');
                    const existingParams = existingBody?.parameters || [];
                    if (existingParams.length < requiredCount) {
                      const fallbackOrder = ['contact_name', 'contact_phone', 'contact_email', 'agent_name', 'appointment_date', 'appointment_time', 'service_name', 'duration', 'notes', 'appointment_status'];
                      const availableValues = fallbackOrder.filter(k => contactData[k] && contactData[k].trim() !== '').map(k => contactData[k]);
                      const parameters = [];
                      for (let i = 0; i < requiredCount; i++) {
                        if (i < existingParams.length && existingParams[i]?.text && existingParams[i].text.trim() !== '') {
                          parameters.push(existingParams[i]);
                        } else {
                          const fallbackIdx = i - existingParams.length;
                          parameters.push({ type: 'text', text: availableValues[fallbackIdx >= 0 ? fallbackIdx : i] || ' ' });
                        }
                      }
                      components = components.filter((c: any) => c.type !== 'body');
                      components.push({ type: 'body', parameters });
                      console.log(`[Post-Call Messaging] Padded body variables: ${existingParams.length} saved + ${requiredCount - existingParams.length} auto-populated = ${requiredCount} total`);
                    }
                  }
                }

                const headerComp = templateDef.components.find((c: any) => c.type === 'HEADER');
                if (headerComp) {
                  const headerFormat = (headerComp.format || '').toUpperCase();
                  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
                    let headerUrl = '';
                    if (whatsappVariables) {
                      try {
                        const parsedVars = JSON.parse(whatsappVariables);
                        for (const [, val] of Object.entries(parsedVars)) {
                          if (val && typeof val === 'object' && (val as any).componentType === 'header' && (val as any).value) {
                            headerUrl = stripUnresolvedVar(resolveVarValue((val as any).value, contactData));
                            break;
                          }
                        }
                      } catch (_) { }
                    }
                    if (headerUrl) {
                      const mediaTypeLowercase = headerFormat.toLowerCase() as 'image' | 'video' | 'document';

                      // For Meta API, the parameter type MUST match the media type (image/video/document)
                      const headerParam: any = {
                        type: mediaTypeLowercase
                      };

                      // Add the media object with the link
                      headerParam[mediaTypeLowercase] = {
                        link: headerUrl.trim()
                      };

                      const headerComponent = {
                        type: 'header',
                        parameters: [headerParam]
                      };

                      // Add as the first component
                      components = [headerComponent, ...components];
                      console.log(`[Post-Call Messaging] Added Meta HEADER (${mediaTypeLowercase}): ${headerUrl}`);
                    } else {
                      console.warn(`[Post-Call Messaging] Template has ${headerFormat} header but no URL was found in config.`);
                    }
                  } else if (headerFormat === 'TEXT' && headerComp.text) {
                    const headerVarMatches = headerComp.text.match(/\{\{\d+\}\}/g) || [];
                    if (headerVarMatches.length > 0) {
                      let headerVal = '';
                      if (whatsappVariables) {
                        try {
                          const parsedVars = JSON.parse(whatsappVariables);
                          for (const [, val] of Object.entries(parsedVars)) {
                            if (val && typeof val === 'object' && (val as any).componentType === 'header' && (val as any).value) {
                              headerVal = stripUnresolvedVar(resolveVarValue((val as any).value, contactData));
                              break;
                            }
                          }
                        } catch (_) { }
                      }
                      if (!headerVal) headerVal = contactData.contact_name || ' ';
                      components = [{ type: 'header', parameters: [{ type: 'text', text: headerVal }] }, ...components];
                      console.log(`[Post-Call Messaging] Added HEADER text: ${headerVal}`);
                    }
                  }
                }

                const buttonComponents = MetaWhatsAppService.buildButtonComponents(
                  templateDef.components,
                  Object.keys(buttonOverrides).length > 0 ? buttonOverrides : undefined
                );
                if (buttonComponents.length > 0) {
                  components = [...components, ...buttonComponents];
                  console.log(`[Post-Call Messaging] Added ${buttonComponents.length} button component(s)`);
                }
              }
            } catch (tmplErr: any) {
              console.warn(`[Post-Call Messaging] Could not fetch Meta template definition: ${tmplErr.message}`);
            }

            console.log(`[Post-Call Messaging] Attempting Meta send for ${callerPhone}...`);
            console.log(`[Post-Call Messaging] Final Resolved Components for Meta: ${JSON.stringify(components, null, 2)}`);
            const result = await metaWhatsAppService.sendTemplate(userId, callerPhone, whatsappTemplate, templateLanguage, components, { callId, agentId: dbAgentId });
            console.log(`✅ [Post-Call Messaging] WhatsApp sent via Meta. Result: ${JSON.stringify(result)}`);
          } else if (whatswaySettings?.isActive) {
            console.log(`[Post-Call Messaging] Final Resolved Components for WhatsWay: ${JSON.stringify(components, null, 2)}`);
            const result = await whatswayService.sendTemplate(userId, callerPhone, whatsappTemplate, templateLanguage, components, { callId, agentId: dbAgentId });
            console.log(`✅ [Post-Call Messaging] WhatsApp sent via WhatsWay. Result: ${JSON.stringify(result)}`);
          } else {
            console.warn(`[Post-Call Messaging] No active WhatsApp provider for user ${userId}`);
          }
        }
      } catch (waErr: any) {
        console.error(`❌ [Post-Call Messaging] WhatsApp send error: ${waErr.message}`);
        console.error(waErr.stack);
      }
    }

    if (emailEnabled && emailTemplate) {
      try {
        if (!callerEmail) {
          console.warn(`[Post-Call Messaging] Cannot send email: no email address collected for caller ${callerPhone}`);
        } else {
          const { emailTemplateService } = await import('../../plugins/messaging/services/email-template.service');
          const { storage } = await import('../storage');
          const companyName = await storage.getGlobalSetting('app_name') || 'Our Company';
          const variables: Record<string, string> = {
            company_name: companyName,
            contact_name: contactData.contact_name || '',
            contact_phone: callerPhone,
            contact_email: callerEmail,
            agent_name: contactData.agent_name || '',
            ...(contactData.appointment_date ? { appointment_date: contactData.appointment_date } : {}),
            ...(contactData.appointment_time ? { appointment_time: contactData.appointment_time } : {}),
            ...(contactData.service_name ? { service_name: contactData.service_name } : {}),
            ...(contactData.duration ? { duration: contactData.duration } : {}),
            ...(contactData.notes ? { notes: contactData.notes } : {}),
            ...(contactData.appointment_status ? { appointment_status: contactData.appointment_status } : {}),
          };
          await emailTemplateService.sendEmailByName(userId, emailTemplate, callerEmail, variables, { callId, agentId: dbAgentId });
          console.log(`✅ [Post-Call Messaging] Email sent to ${callerEmail}`);
        }
      } catch (emailErr: any) {
        console.error(`❌ [Post-Call Messaging] Email send error: ${emailErr.message}`);
      }
    }
  } catch (err: any) {
    console.error(`❌ [Post-Call Messaging] Unexpected error: ${err.message}`);
  }
}
