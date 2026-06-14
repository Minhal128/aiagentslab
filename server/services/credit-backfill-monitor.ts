/**
 * Credit Backfill Monitor
 *
 * Daily background job that scans every telephony engine for completed
 * calls with positive duration that have no matching `credit_transactions`
 * row. The detection is read-only by default; if anything is found the
 * job notifies admins so they can investigate (or trigger a one-click
 * backfill from the admin panel).
 *
 * This is the safety net introduced after the Twilio+OpenAI billing bug
 * (task #164) went unnoticed for weeks. Engines covered:
 *
 *   - elevenlabs-twilio  (table: calls,             ref: 'elevenlabs-twilio:<id>')
 *   - twilio-openai      (table: twilio_openai_calls, ref: 'twilio-openai:<id>')
 *   - plivo-openai       (table: plivo_calls,         ref: 'plivo-openai:<id>')
 *   - elevenlabs-sip     (table: sip_calls,           ref: 'elevenlabs-sip:<id>')
 *   - openai-sip         (table: sip_calls,           ref: 'openai-sip:<id>')
 */
import { db } from "../db";
import {
  twilioOpenaiCalls,
  plivoCalls,
  sipCalls,
  calls,
  creditTransactions,
} from "@shared/schema";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { deductCallCredits, type CreditEngine } from "./credit-service";
import { NotificationService } from "./notification-service";
import { logger } from "../utils/logger";

export type BackfillEngine =
  | "elevenlabs-twilio"
  | "twilio-openai"
  | "plivo-openai"
  | "elevenlabs-sip"
  | "openai-sip";

export const ALL_ENGINES: readonly BackfillEngine[] = [
  "elevenlabs-twilio",
  "twilio-openai",
  "plivo-openai",
  "elevenlabs-sip",
  "openai-sip",
] as const;

export interface UnbilledCall {
  id: string;
  userId: string;
  duration: number;
  fromNumber: string | null;
  toNumber: string | null;
  /**
   * For elevenlabs-twilio rows: set when the row originated from a website
   * widget. Widget calls are billed via the widget session path and must
   * never be charged through this backfill (defense-in-depth alongside the
   * SQL filter in fetchUnbilled).
   */
  widgetId?: string | null;
}

export interface EngineScanResult {
  engine: BackfillEngine;
  unbilled: number;
  estimatedCredits: number;
  uniqueUsers: number;
  sampleIds: string[];
  /**
   * True when this engine's scan hit the per-engine row cap (`limit`),
   * meaning the real backlog may be larger than `unbilled`/`estimatedCredits`
   * report. Re-run with a larger `limit` to get exhaustive numbers.
   */
  truncated: boolean;
  limit: number;
}

export interface ScanResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: {
    unbilled: number;
    estimatedCredits: number;
    uniqueUsers: number;
  };
  engines: EngineScanResult[];
  error?: string;
}

export interface EngineBackfillResult {
  engine: BackfillEngine;
  scanned: number;
  charged: number;
  alreadyDeducted: number;
  insufficientCredits: number;
  errors: number;
  totalCreditsDeducted: number;
}

export interface BackfillResult {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  engines: EngineBackfillResult[];
  totals: {
    scanned: number;
    charged: number;
    totalCreditsDeducted: number;
    errors: number;
  };
}

interface FetchOptions {
  /** Only scan calls created within the last N days. 0 / undefined = no limit. */
  sinceDays?: number;
  /** Optional cap on rows returned per engine to keep scans bounded. */
  limit?: number;
}

const DEFAULT_LIMIT = 5000;

async function fetchUnbilled(
  engine: BackfillEngine,
  opts: FetchOptions = {},
): Promise<UnbilledCall[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sinceDate = opts.sinceDays && opts.sinceDays > 0
    ? new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
    : null;

  if (engine === "twilio-openai") {
    const conditions = [
      eq(twilioOpenaiCalls.status, "completed"),
      isNotNull(twilioOpenaiCalls.userId),
      isNotNull(twilioOpenaiCalls.duration),
      gte(twilioOpenaiCalls.duration, 1),
    ];
    if (sinceDate) conditions.push(gte(twilioOpenaiCalls.createdAt, sinceDate));

    const rows = await db
      .select({
        id: twilioOpenaiCalls.id,
        userId: twilioOpenaiCalls.userId,
        duration: twilioOpenaiCalls.duration,
        fromNumber: twilioOpenaiCalls.fromNumber,
        toNumber: twilioOpenaiCalls.toNumber,
      })
      .from(twilioOpenaiCalls)
      .leftJoin(
        creditTransactions,
        and(
          eq(
            creditTransactions.reference,
            sql`'twilio-openai:' || ${twilioOpenaiCalls.id}`,
          ),
          eq(creditTransactions.userId, twilioOpenaiCalls.userId),
        ),
      )
      .where(and(...conditions, isNull(creditTransactions.id)))
      .limit(limit);

    return rows
      .filter((r) => r.userId && r.duration && r.duration >= 1)
      .map((r) => ({
        id: r.id,
        userId: r.userId as string,
        duration: r.duration as number,
        fromNumber: r.fromNumber,
        toNumber: r.toNumber,
      }));
  }

  if (engine === "plivo-openai") {
    const conditions = [
      eq(plivoCalls.status, "completed"),
      isNotNull(plivoCalls.userId),
      isNotNull(plivoCalls.duration),
      gte(plivoCalls.duration, 1),
    ];
    if (sinceDate) conditions.push(gte(plivoCalls.createdAt, sinceDate));

    const rows = await db
      .select({
        id: plivoCalls.id,
        userId: plivoCalls.userId,
        duration: plivoCalls.duration,
        fromNumber: plivoCalls.fromNumber,
        toNumber: plivoCalls.toNumber,
      })
      .from(plivoCalls)
      .leftJoin(
        creditTransactions,
        and(
          eq(
            creditTransactions.reference,
            sql`'plivo-openai:' || ${plivoCalls.id}`,
          ),
          eq(creditTransactions.userId, plivoCalls.userId),
        ),
      )
      .where(and(...conditions, isNull(creditTransactions.id)))
      .limit(limit);

    return rows
      .filter((r) => r.userId && r.duration && r.duration >= 1)
      .map((r) => ({
        id: r.id,
        userId: r.userId as string,
        duration: r.duration as number,
        fromNumber: r.fromNumber,
        toNumber: r.toNumber,
      }));
  }

  if (engine === "elevenlabs-twilio") {
    // IMPORTANT: widget-originated calls are billed via the widget session
    // path (see deductCreditsForCall in server/routes/webhooks/helpers.ts:
    // "Skipping for widget call ... already billed via widget session").
    // They never produce a `credit_transactions.reference='elevenlabs-twilio:<id>'`
    // row, so they MUST be excluded here or the monitor will permanently
    // flag them as un-billed (and a backfill click would double-charge).
    const conditions = [
      eq(calls.status, "completed"),
      isNotNull(calls.userId),
      isNotNull(calls.duration),
      gte(calls.duration, 1),
      isNull(calls.widgetId),
    ];
    if (sinceDate) conditions.push(gte(calls.createdAt, sinceDate));

    const rows = await db
      .select({
        id: calls.id,
        userId: calls.userId,
        duration: calls.duration,
        fromNumber: calls.fromNumber,
        toNumber: calls.toNumber,
        widgetId: calls.widgetId,
      })
      .from(calls)
      .leftJoin(
        creditTransactions,
        and(
          eq(
            creditTransactions.reference,
            sql`'elevenlabs-twilio:' || ${calls.id}`,
          ),
          eq(creditTransactions.userId, calls.userId),
        ),
      )
      .where(and(...conditions, isNull(creditTransactions.id)))
      .limit(limit);

    return rows
      .filter((r) => r.userId && r.duration && r.duration >= 1 && !r.widgetId)
      .map((r) => ({
        id: r.id,
        userId: r.userId as string,
        duration: r.duration as number,
        fromNumber: r.fromNumber,
        toNumber: r.toNumber,
        widgetId: r.widgetId ?? null,
      }));
  }

  // SIP engines (elevenlabs-sip, openai-sip) share the sip_calls table but
  // are differentiated by the `engine` column.
  const sipEngineValue = engine; // 'elevenlabs-sip' | 'openai-sip'
  const refPrefix = `${sipEngineValue}:`;
  const conditions = [
    eq(sipCalls.engine, sipEngineValue),
    eq(sipCalls.status, "completed"),
    isNotNull(sipCalls.userId),
    isNotNull(sipCalls.durationSeconds),
    gte(sipCalls.durationSeconds, 1),
  ];
  if (sinceDate) conditions.push(gte(sipCalls.createdAt, sinceDate));

  const rows = await db
    .select({
      id: sipCalls.id,
      userId: sipCalls.userId,
      duration: sipCalls.durationSeconds,
      fromNumber: sipCalls.fromNumber,
      toNumber: sipCalls.toNumber,
    })
    .from(sipCalls)
    .leftJoin(
      creditTransactions,
      and(
        eq(
          creditTransactions.reference,
          sql`${refPrefix} || ${sipCalls.id}`,
        ),
        eq(creditTransactions.userId, sipCalls.userId),
      ),
    )
    .where(and(...conditions, isNull(creditTransactions.id)))
    .limit(limit);

  return rows
    .filter((r) => r.userId && r.duration && r.duration >= 1)
    .map((r) => ({
      id: r.id,
      userId: r.userId as string,
      duration: r.duration as number,
      fromNumber: r.fromNumber,
      toNumber: r.toNumber,
    }));
}

function summarize(
  engine: BackfillEngine,
  rows: UnbilledCall[],
  limit: number,
): EngineScanResult {
  const users = new Set<string>();
  let credits = 0;
  for (const r of rows) {
    users.add(r.userId);
    credits += Math.ceil(r.duration / 60);
  }
  return {
    engine,
    unbilled: rows.length,
    estimatedCredits: credits,
    uniqueUsers: users.size,
    sampleIds: rows.slice(0, 5).map((r) => r.id),
    truncated: rows.length >= limit,
    limit,
  };
}

export async function scanForUnbilledCalls(
  opts: { engines?: BackfillEngine[]; sinceDays?: number; limit?: number } = {},
): Promise<ScanResult> {
  const startedAt = new Date();
  const engines = opts.engines && opts.engines.length > 0 ? opts.engines : [...ALL_ENGINES];
  const engineResults: EngineScanResult[] = [];
  let totalUnbilled = 0;
  let totalCredits = 0;
  const allUsers = new Set<string>();

  try {
    for (const engine of engines) {
      try {
        const effectiveLimit = opts.limit ?? DEFAULT_LIMIT;
        const rows = await fetchUnbilled(engine, {
          sinceDays: opts.sinceDays,
          limit: effectiveLimit,
        });
        const summary = summarize(engine, rows, effectiveLimit);
        if (summary.truncated) {
          logger.warn(
            `[CreditBackfillMonitor] Engine ${engine} hit row cap of ${effectiveLimit}; backlog may be larger than reported`,
            undefined,
            "CreditBackfillMonitor",
          );
        }
        engineResults.push(summary);
        totalUnbilled += summary.unbilled;
        totalCredits += summary.estimatedCredits;
        for (const r of rows) allUsers.add(r.userId);
      } catch (err: any) {
        logger.error(
          `[CreditBackfillMonitor] Scan failed for engine ${engine}: ${err?.message || err}`,
          err,
          "CreditBackfillMonitor",
        );
        engineResults.push({
          engine,
          unbilled: 0,
          estimatedCredits: 0,
          uniqueUsers: 0,
          sampleIds: [],
          truncated: false,
          limit: opts.limit ?? DEFAULT_LIMIT,
        });
      }
    }

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      totals: {
        unbilled: totalUnbilled,
        estimatedCredits: totalCredits,
        uniqueUsers: allUsers.size,
      },
      engines: engineResults,
    };
  } catch (err: any) {
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      totals: { unbilled: 0, estimatedCredits: 0, uniqueUsers: 0 },
      engines: engineResults,
      error: err?.message || String(err),
    };
  }
}

export async function executeBackfill(
  opts: {
    engines?: BackfillEngine[];
    sinceDays?: number;
    limit?: number;
    dryRun?: boolean;
    userId?: string;
  } = {},
): Promise<BackfillResult> {
  const startedAt = new Date();
  const dryRun = opts.dryRun ?? false;
  const engines = opts.engines && opts.engines.length > 0 ? opts.engines : [...ALL_ENGINES];
  const results: EngineBackfillResult[] = [];

  for (const engine of engines) {
    const stat: EngineBackfillResult = {
      engine,
      scanned: 0,
      charged: 0,
      alreadyDeducted: 0,
      insufficientCredits: 0,
      errors: 0,
      totalCreditsDeducted: 0,
    };

    let rows: UnbilledCall[] = [];
    try {
      rows = await fetchUnbilled(engine, {
        sinceDays: opts.sinceDays,
        limit: opts.limit,
      });
    } catch (err: any) {
      logger.error(
        `[CreditBackfillMonitor] Backfill scan failed for ${engine}: ${err?.message || err}`,
        err,
        "CreditBackfillMonitor",
      );
      stat.errors += 1;
      results.push(stat);
      continue;
    }

    if (opts.userId) rows = rows.filter((r) => r.userId === opts.userId);
    stat.scanned = rows.length;

    for (const call of rows) {
      // Defense-in-depth: even if a widget call somehow slipped through the
      // SQL filter in fetchUnbilled, never charge it here — widget calls
      // are billed via the widget session path, not via this reference.
      if (engine === "elevenlabs-twilio" && call.widgetId) {
        stat.alreadyDeducted += 1;
        continue;
      }

      const credits = Math.ceil(call.duration / 60);
      if (credits <= 0) continue;

      if (dryRun) continue;

      try {
        const result = await deductCallCredits({
          userId: call.userId,
          creditsToDeduct: credits,
          callId: call.id,
          fromNumber: call.fromNumber || "Unknown",
          toNumber: call.toNumber || "Unknown",
          durationSeconds: call.duration,
          engine: engine as CreditEngine,
        });

        if (result.success && result.creditsDeducted > 0) {
          stat.charged += 1;
          stat.totalCreditsDeducted += result.creditsDeducted;
        } else if (result.alreadyDeducted) {
          stat.alreadyDeducted += 1;
        } else if (!result.success && result.error === "Insufficient credits") {
          stat.insufficientCredits += 1;
        } else if (!result.success) {
          stat.errors += 1;
        }
      } catch (err: any) {
        stat.errors += 1;
        logger.error(
          `[CreditBackfillMonitor] Backfill exception for ${engine} call ${call.id}: ${err?.message || err}`,
          err,
          "CreditBackfillMonitor",
        );
      }
    }

    results.push(stat);
  }

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    dryRun,
    engines: results,
    totals: {
      scanned: results.reduce((a, r) => a + r.scanned, 0),
      charged: results.reduce((a, r) => a + r.charged, 0),
      totalCreditsDeducted: results.reduce((a, r) => a + r.totalCreditsDeducted, 0),
      errors: results.reduce((a, r) => a + r.errors, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Cron / scheduling
// ---------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Wait this long after server startup before the first scan so we don't
// pile work onto an already busy boot sequence.
const STARTUP_DELAY_MS = 10 * 60 * 1000; // 10 minutes
// The cron path scans the entire history (no time window) so very old
// missed bills are still surfaced. The per-engine `limit` in fetchUnbilled
// keeps the query bounded; if a deployment ever needs to throttle the
// historical sweep, set CRON_SCAN_WINDOW_DAYS > 0.
const CRON_SCAN_WINDOW_DAYS = 0;

let scanInterval: NodeJS.Timeout | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let lastScanResult: ScanResult | null = null;
let lastBackfillResult: BackfillResult | null = null;
let isScanning = false;

export function getLastScanResult(): ScanResult | null {
  return lastScanResult;
}

export function getLastBackfillResult(): BackfillResult | null {
  return lastBackfillResult;
}

export function setLastBackfillResult(result: BackfillResult): void {
  lastBackfillResult = result;
}

async function runScheduledScan(): Promise<void> {
  if (isScanning) {
    logger.info(
      "[CreditBackfillMonitor] Skipping scheduled scan — previous scan still running",
      undefined,
      "CreditBackfillMonitor",
    );
    return;
  }
  isScanning = true;
  try {
    logger.info(
      "[CreditBackfillMonitor] Starting daily un-billed call scan",
      undefined,
      "CreditBackfillMonitor",
    );
    const result = await scanForUnbilledCalls(
      CRON_SCAN_WINDOW_DAYS > 0 ? { sinceDays: CRON_SCAN_WINDOW_DAYS } : {},
    );
    lastScanResult = result;

    const { unbilled, estimatedCredits, uniqueUsers } = result.totals;
    logger.info(
      `[CreditBackfillMonitor] Scan complete in ${result.durationMs}ms — unbilled=${unbilled}, credits=${estimatedCredits}, users=${uniqueUsers}`,
      undefined,
      "CreditBackfillMonitor",
    );

    if (unbilled > 0) {
      const perEngine = result.engines
        .filter((e) => e.unbilled > 0)
        .map((e) =>
          `${e.engine}: ${e.unbilled}${e.truncated ? "+" : ""} call(s) / ${e.estimatedCredits} credits`,
        )
        .join("; ");
      const truncatedEngines = result.engines.filter((e) => e.truncated).map((e) => e.engine);
      const truncatedNote = truncatedEngines.length > 0
        ? ` Note: results for ${truncatedEngines.join(", ")} were capped at ${truncatedEngines.map((eng) => result.engines.find((e) => e.engine === eng)?.limit).join("/")} rows — actual backlog may be larger.`
        : "";
      const windowText =
        CRON_SCAN_WINDOW_DAYS > 0
          ? `in the last ${CRON_SCAN_WINDOW_DAYS} days`
          : "across all history";
      try {
        await NotificationService.notifyAdmins(
          "Un-billed calls detected",
          `Daily credit backfill scan found ${unbilled} completed call(s) (${estimatedCredits} credits, ${uniqueUsers} user(s)) without matching credit transactions ${windowText}. Per engine — ${perEngine}.${truncatedNote} Review the Billing → Credit Backfill admin panel to investigate or trigger a backfill.`,
          "warning",
        );
      } catch (err: any) {
        logger.error(
          `[CreditBackfillMonitor] Failed to send admin notification: ${err?.message || err}`,
          err,
          "CreditBackfillMonitor",
        );
      }
    }
  } catch (err: any) {
    logger.error(
      `[CreditBackfillMonitor] Scheduled scan failed: ${err?.message || err}`,
      err,
      "CreditBackfillMonitor",
    );
  } finally {
    isScanning = false;
  }
}

export function startCreditBackfillMonitor(): void {
  if (scanInterval || startupTimeout) {
    logger.info(
      "[CreditBackfillMonitor] Already running",
      undefined,
      "CreditBackfillMonitor",
    );
    return;
  }
  logger.info(
    `[CreditBackfillMonitor] Scheduling daily scan (first run in ${Math.round(STARTUP_DELAY_MS / 60000)} minutes)`,
    undefined,
    "CreditBackfillMonitor",
  );
  // First scan on a delay to let the server fully boot.
  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    runScheduledScan().catch(() => {});
    scanInterval = setInterval(() => {
      runScheduledScan().catch(() => {});
    }, SCAN_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function stopCreditBackfillMonitor(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  logger.info(
    "[CreditBackfillMonitor] Stopped",
    undefined,
    "CreditBackfillMonitor",
  );
}

/** For tests / manual admin triggers — runs a scan immediately. */
export async function triggerScanNow(opts: {
  sinceDays?: number;
} = {}): Promise<ScanResult> {
  const sinceDays = opts.sinceDays ?? CRON_SCAN_WINDOW_DAYS;
  const result = await scanForUnbilledCalls(
    sinceDays > 0 ? { sinceDays } : {},
  );
  lastScanResult = result;
  return result;
}
