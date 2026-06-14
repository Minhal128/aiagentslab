'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Distributed under the Envato / CodeCanyon License Agreement.
 * ============================================================
 */
import { db } from "../db";
import { phoneReleaseRetryQueue } from "@shared/schema";
import type { PhoneReleaseRetryQueueEntry } from "@shared/schema";
import { and, eq, lte, sql, inArray } from "drizzle-orm";
import { twilioService } from "./twilio";
import { PlivoPhoneService } from "../engines/plivo/services/plivo-phone.service";
import { withRetry } from "../utils/with-retry";

const RETRY_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const MAX_ATTEMPTS = 8; // ~ up to ~21h with exponential backoff

function backoffFor(attempts: number): number {
  // 5m, 10m, 20m, 40m, 80m, 160m, 320m, 640m
  const base = 5 * 60 * 1000;
  const ms = base * Math.pow(2, Math.max(0, attempts));
  return Math.min(ms, 12 * 60 * 60 * 1000); // cap at 12h
}

export async function processPhoneReleaseRetryQueue(): Promise<void> {
  try {
    // Claim up to N rows per tick with SKIP LOCKED so multiple workers don't collide.
    const claimedRows: PhoneReleaseRetryQueueEntry[] = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(phoneReleaseRetryQueue)
        .where(lte(phoneReleaseRetryQueue.nextRetryAt, new Date()))
        .orderBy(phoneReleaseRetryQueue.nextRetryAt)
        .limit(20)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      // Push nextRetryAt far out so other ticks don't re-claim while we process.
      const holdUntil = new Date(Date.now() + RETRY_INTERVAL_MS);
      await tx
        .update(phoneReleaseRetryQueue)
        .set({ nextRetryAt: holdUntil, updatedAt: new Date() })
        .where(inArray(phoneReleaseRetryQueue.id, ids));
      return rows;
    });

    if (claimedRows.length === 0) return;
    console.log(`📞 [Release Retry] Processing ${claimedRows.length} queued release(s)`);

    for (const row of claimedRows) {
      const attempts = (row.attempts ?? 0) + 1;
      try {
        if (row.provider === 'twilio') {
          await withRetry(
            () => twilioService.releasePhoneNumber(row.providerSid),
            { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000, label: 'twilio.releasePhoneNumber' }
          );
        } else if (row.provider === 'plivo') {
          // phoneNumberId on the queue row is the Plivo phone DB id
          await withRetry(
            () => PlivoPhoneService.unrentNumber(row.phoneNumberId),
            { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000, label: 'plivo.unrentNumber' }
          );
        } else {
          throw new Error(`Unsupported provider: ${row.provider}`);
        }
        await db.delete(phoneReleaseRetryQueue).where(eq(phoneReleaseRetryQueue.id, row.id));
        console.log(`✅ [Release Retry] Released ${row.providerSid} (phone ${row.phoneNumberId})`);
      } catch (err: unknown) {
        const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        if (attempts >= MAX_ATTEMPTS) {
          console.error(`❌ [Release Retry] Giving up on ${row.providerSid} after ${attempts} attempts: ${errMsg}`);
          await db.delete(phoneReleaseRetryQueue).where(eq(phoneReleaseRetryQueue.id, row.id));
        } else {
          const next = new Date(Date.now() + backoffFor(attempts));
          await db
            .update(phoneReleaseRetryQueue)
            .set({ attempts, lastError: errMsg, nextRetryAt: next, updatedAt: new Date() })
            .where(eq(phoneReleaseRetryQueue.id, row.id));
          console.warn(`⚠️ [Release Retry] Retry ${attempts}/${MAX_ATTEMPTS} failed for ${row.providerSid}: ${errMsg}`);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ [Release Retry] Worker tick failed:`, msg);
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startPhoneReleaseRetryWorker(): void {
  if (intervalId) return;
  console.log('📞 [Release Retry] Starting worker (every 10 minutes)');
  // Defer first run slightly so it doesn't collide with startup.
  setTimeout(() => {
    processPhoneReleaseRetryQueue();
  }, 30 * 1000);
  intervalId = setInterval(processPhoneReleaseRetryQueue, RETRY_INTERVAL_MS);
}

export function stopPhoneReleaseRetryWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('📞 [Release Retry] Worker stopped');
  }
}
