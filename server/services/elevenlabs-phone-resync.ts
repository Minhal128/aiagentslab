'use strict';
import { db } from '../db';
import { isNotNull, eq } from 'drizzle-orm';
import { phoneNumbers, sipPhoneNumbers, sipTrunks } from '@shared/schema';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { ElevenLabsService } from './elevenlabs';
import { storage } from '../storage';
import { getCorrelationHeaders } from '../middleware/correlation-id';

/**
 * Re-syncs all ElevenLabs-registered phone numbers with the current Twilio credentials.
 *
 * This is needed when the Twilio Account SID or Auth Token is rotated.
 * ElevenLabs stores those credentials internally for SIP authentication on outbound calls.
 * If they go stale, every outbound call fails with "max auth retry attempts reached".
 *
 * Strategy for each number:
 *   1. Resolve the ElevenLabs credential — prefer the phone row's elevenLabsCredentialId
 *      for deterministic behaviour in multi-key setups, falling back to user/pool lookup.
 *   2. Delete the old ElevenLabs registration using that credential's API key.
 *   3. Re-register with the current Twilio credentials.
 *   4. Update elevenLabsPhoneNumberId, elevenLabsCredentialId, and credentialsSyncedAt in the DB row.
 *
 * Runs all numbers concurrently (Promise.allSettled) — partial failures do not block others.
 */
export async function resyncElevenLabsPhoneCredentials(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const dbSid = await storage.getGlobalSetting('twilio_account_sid');
  const dbToken = await storage.getGlobalSetting('twilio_auth_token');
  const twilioAccountSid = (dbSid?.value as string) || process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = (dbToken?.value as string) || process.env.TWILIO_AUTH_TOKEN;

  if (!twilioAccountSid || !twilioAuthToken) {
    throw new Error('Twilio credentials not configured');
  }

  const registered = await db
    .select()
    .from(phoneNumbers)
    .where(isNotNull(phoneNumbers.elevenLabsPhoneNumberId));

  if (registered.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  console.log(`[ElevenLabs Resync] Re-syncing Twilio credentials for ${registered.length} phone number(s)`);

  const results = await Promise.allSettled(
    registered.map(async (phone) => {
      await _resyncOnePhone(phone, twilioAccountSid, twilioAuthToken);
    })
  );

  let synced = 0;
  const errors: string[] = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      synced++;
    } else {
      const msg = `${registered[i].phoneNumber}: ${r.reason?.message ?? r.reason}`;
      errors.push(msg);
      console.error(`[ElevenLabs Resync] ❌ ${msg}`);
    }
  });

  console.log(`[ElevenLabs Resync] Done — synced ${synced}, failed ${errors.length}`);
  return { synced, failed: errors.length, errors };
}

/**
 * Re-syncs a single phone number's Twilio credentials in ElevenLabs.
 *
 * Designed to be called automatically when a call_initiation_failure webhook arrives
 * with failure_reason matching "max auth retry attempts reached" (stale credentials).
 * Also called as a pre-flight step before each campaign launch.
 *
 * @param phoneDbId - The internal DB id of the phone_numbers row
 * @returns true on success, false if the phone could not be resynced
 */
// Coalesces concurrent resync calls for the same phoneDbId so simultaneous
// callers (webhook + pre-flight) share one underlying network operation.
const inflightPhoneResyncs = new Map<string, Promise<{ success: boolean; error?: string }>>();

export async function resyncSinglePhoneCredentials(phoneDbId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const existing = inflightPhoneResyncs.get(phoneDbId);
  if (existing) {
    return existing;
  }
  const promise = _resyncSinglePhoneCredentialsImpl(phoneDbId).finally(() => {
    inflightPhoneResyncs.delete(phoneDbId);
  });
  inflightPhoneResyncs.set(phoneDbId, promise);
  return promise;
}

async function _resyncSinglePhoneCredentialsImpl(phoneDbId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const dbSid = await storage.getGlobalSetting('twilio_account_sid');
  const dbToken = await storage.getGlobalSetting('twilio_auth_token');
  const twilioAccountSid = (dbSid?.value as string) || process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = (dbToken?.value as string) || process.env.TWILIO_AUTH_TOKEN;

  if (!twilioAccountSid || !twilioAuthToken) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  const [phone] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.id, phoneDbId))
    .limit(1);

  if (!phone) {
    return { success: false, error: `Phone number not found in DB: ${phoneDbId}` };
  }

  if (!phone.elevenLabsPhoneNumberId) {
    return { success: false, error: `Phone ${phone.phoneNumber} has no ElevenLabs registration to resync` };
  }

  try {
    console.log(`[ElevenLabs Resync] Targeted resync for ${phone.phoneNumber} (db: ${phoneDbId})`);
    await _resyncOnePhone(phone, twilioAccountSid, twilioAuthToken);
    console.log(`[ElevenLabs Resync] ✅ Targeted resync complete for ${phone.phoneNumber}`);
    return { success: true };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[ElevenLabs Resync] ❌ Targeted resync failed for ${phone.phoneNumber}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Internal helper: delete + re-register one phone number and stamp credentialsSyncedAt.
 */
async function _resyncOnePhone(
  phone: typeof phoneNumbers.$inferSelect,
  twilioAccountSid: string,
  twilioAuthToken: string
): Promise<void> {
  const oldId = phone.elevenLabsPhoneNumberId!;

  let credential =
    phone.elevenLabsCredentialId
      ? await ElevenLabsPoolService.getCredentialById(phone.elevenLabsCredentialId)
      : null;

  if (!credential) {
    if (phone.userId) {
      credential = await ElevenLabsPoolService.getUserCredential(phone.userId);
    } else {
      credential = await ElevenLabsPoolService.getAvailableCredential();
    }
  }

  if (!credential) {
    throw new Error(`No ElevenLabs credential for ${phone.phoneNumber}`);
  }

  const elevenLabsService = new ElevenLabsService(credential.apiKey);

  console.log(`[ElevenLabs Resync] Deleting old registration ${oldId} for ${phone.phoneNumber} (cred: ${credential.id})`);
  try {
    await elevenLabsService.deletePhoneNumber(oldId);
  } catch (deleteErr: any) {
    console.warn(`[ElevenLabs Resync] Delete failed (continuing): ${deleteErr.message}`);
  }

  console.log(`[ElevenLabs Resync] Re-registering ${phone.phoneNumber} with fresh Twilio credentials`);
  const result = await elevenLabsService.syncPhoneNumberToElevenLabs({
    phoneNumber: phone.phoneNumber,
    twilioAccountSid,
    twilioAuthToken,
    label: phone.friendlyName || phone.phoneNumber,
    enableOutbound: true,
  });

  await db
    .update(phoneNumbers)
    .set({
      elevenLabsPhoneNumberId: result.phone_number_id,
      elevenLabsCredentialId: credential.id,
      credentialsSyncedAt: new Date(),
    })
    .where(eq(phoneNumbers.id, phone.id));

  console.log(`[ElevenLabs Resync] ✅ ${phone.phoneNumber} -> new id ${result.phone_number_id} (cred: ${credential.id})`);
}

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

const PROVIDER_SIP_DOMAINS: Record<string, { host: string; port: number; requiresUserHost: boolean }> = {
  twilio: { host: '', port: 5060, requiresUserHost: true },
  plivo: { host: '', port: 5060, requiresUserHost: true },
  vonage: { host: '', port: 5060, requiresUserHost: true },
  bandwidth: { host: '', port: 5060, requiresUserHost: true },
  ringcentral: { host: '', port: 5060, requiresUserHost: true },
  sinch: { host: '', port: 5060, requiresUserHost: true },
  telnyx: { host: 'sip.telnyx.com', port: 5060, requiresUserHost: false },
  exotel: { host: 'sip.exotel.com', port: 5060, requiresUserHost: false },
  didww: { host: 'sip.didww.com', port: 5060, requiresUserHost: false },
  zadarma: { host: 'pbx.zadarma.com', port: 5060, requiresUserHost: false },
  cloudonix: { host: 'sip.cloudonix.io', port: 5060, requiresUserHost: false },
  infobip: { host: 'sip.infobip.com', port: 5060, requiresUserHost: false },
  generic: { host: '', port: 5060, requiresUserHost: true },
};

function parseHostAndPort(hostStr: string, defaultPort: number): { host: string; port: number } {
  if (!hostStr) return { host: '', port: defaultPort };
  const parts = hostStr.split(':');
  if (parts.length === 2) {
    const parsed = parseInt(parts[1], 10);
    return { host: parts[0], port: isNaN(parsed) ? defaultPort : parsed };
  }
  return { host: hostStr, port: defaultPort };
}

/**
 * Re-syncs a single SIP phone number's registration in ElevenLabs.
 *
 * For SIP phones, the "credentials" are the SIP trunk config (host, port, username/password).
 * This function:
 *   1. Looks up the SIP phone number + associated trunk from the DB.
 *   2. Resolves the target ElevenLabs credential (preferring the specified credentialId).
 *   3. Deletes the old ElevenLabs phone registration.
 *   4. Re-registers as a SIP trunk phone with the current trunk config + new credential API key.
 *   5. Updates externalElevenLabsPhoneId, elevenLabsCredentialId, and credentialsSyncedAt.
 *
 * @param sipPhoneDbId - The internal DB id of the sip_phone_numbers row
 * @param targetCredentialId - Optional: the credential to register under (e.g. the agent's credential)
 * @returns success/error result
 */
export async function resyncSipPhoneCredentials(
  sipPhoneDbId: string,
  targetCredentialId?: string
): Promise<{ success: boolean; newElevenLabsPhoneId?: string; error?: string }> {
  const [sipPhone] = await db
    .select()
    .from(sipPhoneNumbers)
    .where(eq(sipPhoneNumbers.id, sipPhoneDbId))
    .limit(1);

  if (!sipPhone) {
    return { success: false, error: `SIP phone number not found in DB: ${sipPhoneDbId}` };
  }

  if (!sipPhone.externalElevenLabsPhoneId) {
    return { success: false, error: `SIP phone ${sipPhone.phoneNumber} has no ElevenLabs registration to resync` };
  }

  const [trunk] = await db
    .select()
    .from(sipTrunks)
    .where(eq(sipTrunks.id, sipPhone.sipTrunkId))
    .limit(1);

  if (!trunk) {
    return { success: false, error: `SIP trunk not found for phone ${sipPhone.phoneNumber}` };
  }

  let credential = targetCredentialId
    ? await ElevenLabsPoolService.getCredentialById(targetCredentialId)
    : null;

  if (!credential && sipPhone.elevenLabsCredentialId) {
    credential = await ElevenLabsPoolService.getCredentialById(sipPhone.elevenLabsCredentialId);
  }

  if (!credential) {
    credential = await ElevenLabsPoolService.getUserCredential(sipPhone.userId);
  }

  if (!credential) {
    credential = await ElevenLabsPoolService.getAvailableCredential();
  }

  if (!credential) {
    return { success: false, error: `No ElevenLabs credential available for SIP phone ${sipPhone.phoneNumber}` };
  }

  try {
    const oldId = sipPhone.externalElevenLabsPhoneId;
    console.log(`[ElevenLabs SIP Resync] Resyncing ${sipPhone.phoneNumber} (old: ${oldId}, cred: ${credential.id})`);

    console.log(`[ElevenLabs SIP Resync] Deleting old registration ${oldId}`);
    try {
      const delResponse = await fetch(`${ELEVENLABS_API_BASE}/convai/phone-numbers/${oldId}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': credential.apiKey, ...getCorrelationHeaders() },
      });
      if (!delResponse.ok && delResponse.status !== 404) {
        console.warn(`[ElevenLabs SIP Resync] Delete returned ${delResponse.status} (continuing)`);
      }
    } catch (delErr: any) {
      console.warn(`[ElevenLabs SIP Resync] Delete failed (continuing): ${delErr.message}`);
    }

    const outboundTransport = trunk.transport === 'tls' ? 'tls' : 'tcp';
    const mediaEncryption = trunk.mediaEncryption === 'require' ? 'required' :
                           trunk.mediaEncryption === 'disable' ? 'disabled' :
                           trunk.mediaEncryption === 'allow' ? 'allowed' : 'allowed';
    const providerDomain = PROVIDER_SIP_DOMAINS[trunk.provider] || PROVIDER_SIP_DOMAINS.generic;
    const defaultOutboundPort = outboundTransport === 'tls' ? 5061 : 5060;
    const { host: sipHost, port: parsedPort } = parseHostAndPort(
      trunk.sipHost || providerDomain.host || '',
      defaultOutboundPort
    );
    const sipPort = trunk.sipPort || parsedPort;

    if (!sipHost) {
      return { success: false, error: `SIP host not configured for trunk ${trunk.name}` };
    }

    const normalizedNumber = sipPhone.phoneNumber.replace(/[\s\-\(\)]/g, '');
    const phoneWithPlus = normalizedNumber.startsWith('+')
      ? normalizedNumber
      : `+${normalizedNumber}`;

    const outboundConfig: Record<string, any> = {
      address: `${sipHost}:${sipPort}`,
      transport: outboundTransport,
      media_encryption: mediaEncryption,
    };
    if (trunk.username && trunk.password) {
      outboundConfig.credentials = { username: trunk.username, password: trunk.password };
    }

    const importBody = {
      label: sipPhone.label || `SIP - ${sipPhone.phoneNumber}`,
      phone_number: phoneWithPlus,
      provider_type: 'sip_trunk',
      inbound_trunk_config: {
        media_encryption: 'allowed',
        remote_domains: [sipHost],
      },
      outbound_trunk_config: outboundConfig,
    };

    console.log(`[ElevenLabs SIP Resync] Re-importing ${sipPhone.phoneNumber} with fresh trunk config`);
    const importResponse = await fetch(`${ELEVENLABS_API_BASE}/convai/phone-numbers`, {
      method: 'POST',
      headers: {
        'xi-api-key': credential.apiKey,
        'Content-Type': 'application/json',
        ...getCorrelationHeaders(),
      },
      body: JSON.stringify(importBody),
    });

    if (!importResponse.ok) {
      const errText = await importResponse.text();
      return { success: false, error: `ElevenLabs SIP import failed (${importResponse.status}): ${errText}` };
    }

    const importResult = await importResponse.json();
    const newPhoneId = importResult.phone_number_id;

    const patchBody = {
      label: sipPhone.label || `SIP - ${sipPhone.phoneNumber}`,
      inbound_trunk_config: {
        media_encryption: 'allowed',
        remote_domains: [sipHost],
      },
      outbound_trunk_config: outboundConfig,
    };

    const patchResponse = await fetch(`${ELEVENLABS_API_BASE}/convai/phone-numbers/${newPhoneId}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': credential.apiKey,
        'Content-Type': 'application/json',
        ...getCorrelationHeaders(),
      },
      body: JSON.stringify(patchBody),
    });

    if (!patchResponse.ok) {
      console.warn(`[ElevenLabs SIP Resync] PATCH config failed (non-fatal): ${patchResponse.status}`);
    }

    await db
      .update(sipPhoneNumbers)
      .set({
        externalElevenLabsPhoneId: newPhoneId,
        elevenLabsCredentialId: credential.id,
        credentialsSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sipPhoneNumbers.id, sipPhone.id));

    console.log(`[ElevenLabs SIP Resync] ✅ ${sipPhone.phoneNumber} -> new id ${newPhoneId} (cred: ${credential.id})`);
    return { success: true, newElevenLabsPhoneId: newPhoneId };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[ElevenLabs SIP Resync] ❌ Failed for ${sipPhone.phoneNumber}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Verifies a SIP phone number still exists on ElevenLabs by calling GET on the phone number.
 *
 * Returns a three-state result:
 *  - exists: true — phone is live on ElevenLabs
 *  - exists: false, notFound: true — 404, phone should be re-imported
 *  - exists: false, notFound: false — transient error, caller should NOT auto-reimport
 */
export async function verifySipPhoneExists(
  elevenLabsPhoneId: string,
  apiKey: string
): Promise<{ exists: boolean; notFound?: boolean; details?: any; error?: string }> {
  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/convai/phone-numbers/${elevenLabsPhoneId}`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey, ...getCorrelationHeaders() },
    });
    if (response.status === 404) {
      return { exists: false, notFound: true };
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[ElevenLabs SIP Verify] Unexpected status ${response.status} for ${elevenLabsPhoneId}: ${errText}`);
      return { exists: false, notFound: false, error: `ElevenLabs returned ${response.status}` };
    }
    const details = await response.json();
    return { exists: true, details };
  } catch (err: any) {
    console.warn(`[ElevenLabs SIP Verify] Network error checking ${elevenLabsPhoneId}: ${err.message}`);
    return { exists: false, notFound: false, error: err.message };
  }
}
