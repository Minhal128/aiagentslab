/**
 * One-time backfill: charge users for completed Plivo+ElevenLabs calls that
 * never had credits deducted. Mirrors backfill-twilio-openai-credits.ts.
 *
 * NOTE: Until this fix shipped, the Plivo+ElevenLabs engine never inserted
 * rows into `plivo_calls` at all (no per-call record was created), so this
 * backfill will most likely find zero historical candidates. It is still
 * provided so future regressions of this class can be recovered with the
 * same idempotent process. Safe to re-run — `deductCallCredits` is
 * idempotent via a Postgres advisory lock + uniqueness check on
 * `credit_transactions.reference = 'plivo-elevenlabs:<callId>'`.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-plivo-elevenlabs-credits.ts
 *   npx tsx server/scripts/backfill-plivo-elevenlabs-credits.ts --dry-run
 *   npx tsx server/scripts/backfill-plivo-elevenlabs-credits.ts --user <userId>
 */
import { db } from "../db";
import { plivoCalls, creditTransactions } from "@shared/schema";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { deductCallCredits } from "../services/credit-service";

interface BackfillStats {
  scanned: number;
  charged: number;
  alreadyDeducted: number;
  insufficientCredits: number;
  errors: number;
  totalCreditsDeducted: number;
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const userIdx = args.indexOf("--user");
  const filterUserId = userIdx !== -1 ? args[userIdx + 1] : undefined;

  console.log(
    `[Backfill] Starting Plivo+ElevenLabs credit backfill (dryRun=${dryRun}${
      filterUserId ? `, user=${filterUserId}` : ""
    })`,
  );

  // Find completed plivo-elevenlabs calls with positive duration, owned by a
  // user, that have no matching credit_transactions row referencing them.
  // Discriminator: metadata->>'engine' = 'plivo-elevenlabs' (set at insert
  // time in outbound-call.service.ts and the inbound webhook).
  const conditions = [
    eq(plivoCalls.status, "completed"),
    isNotNull(plivoCalls.userId),
    isNotNull(plivoCalls.duration),
    gte(plivoCalls.duration, 1),
    sql`${plivoCalls.metadata}->>'engine' = 'plivo-elevenlabs'`,
  ];
  if (filterUserId) {
    conditions.push(eq(plivoCalls.userId, filterUserId));
  }

  const candidates = await db
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
          sql`'plivo-elevenlabs:' || ${plivoCalls.id}`,
        ),
        eq(creditTransactions.userId, plivoCalls.userId),
      ),
    )
    .where(and(...conditions, isNull(creditTransactions.id)));

  const stats: BackfillStats = {
    scanned: candidates.length,
    charged: 0,
    alreadyDeducted: 0,
    insufficientCredits: 0,
    errors: 0,
    totalCreditsDeducted: 0,
  };

  console.log(`[Backfill] Unbilled candidates: ${candidates.length}`);

  for (const call of candidates) {
    if (!call.userId || !call.duration || call.duration < 1) continue;
    const credits = Math.ceil(call.duration / 60);
    if (credits <= 0) continue;

    if (dryRun) {
      console.log(
        `[Backfill] DRY: would deduct ${credits} credits from user ${call.userId} for call ${call.id} (${call.duration}s)`,
      );
      continue;
    }

    try {
      const result = await deductCallCredits({
        userId: call.userId,
        creditsToDeduct: credits,
        callId: call.id,
        fromNumber: call.fromNumber || "Unknown",
        toNumber: call.toNumber || "Unknown",
        durationSeconds: call.duration,
        engine: "plivo-elevenlabs",
      });

      if (result.success && result.creditsDeducted > 0) {
        stats.charged += 1;
        stats.totalCreditsDeducted += result.creditsDeducted;
        console.log(
          `[Backfill] Charged ${result.creditsDeducted} credits to user ${call.userId} for call ${call.id} (new balance: ${result.newBalance})`,
        );
      } else if (result.alreadyDeducted) {
        stats.alreadyDeducted += 1;
      } else if (!result.success && result.error === "Insufficient credits") {
        stats.insufficientCredits += 1;
        console.warn(
          `[Backfill] Skipped call ${call.id}: user ${call.userId} has insufficient credits for ${credits}`,
        );
      } else {
        stats.errors += 1;
        console.error(
          `[Backfill] Failed call ${call.id}: ${result.error || "unknown error"}`,
        );
      }
    } catch (err: any) {
      stats.errors += 1;
      console.error(
        `[Backfill] Exception for call ${call.id}: ${err?.message || err}`,
      );
    }
  }

  console.log("[Backfill] Summary:");
  console.log(`  Unbilled candidates:   ${stats.scanned}`);
  console.log(`  Charged:               ${stats.charged}`);
  console.log(`  Already deducted:      ${stats.alreadyDeducted}`);
  console.log(`  Insufficient credits:  ${stats.insufficientCredits}`);
  console.log(`  Errors:                ${stats.errors}`);
  console.log(`  Total credits taken:   ${stats.totalCreditsDeducted}`);

  process.exit(stats.errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
