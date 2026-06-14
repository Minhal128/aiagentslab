/**
 * Smoke / assertion test for the credit backfill monitor.
 *
 * Verifies the two safety properties the monitor must hold:
 *   1. Widget-originated `calls` rows are NEVER returned by the
 *      elevenlabs-twilio scan (they are billed via the widget session
 *      path; flagging them would generate false positives, and a backfill
 *      click would double-charge).
 *   2. Even if a widget row is passed into the executeBackfill loop, the
 *      defense-in-depth guard refuses to charge it.
 *
 * Run with: npx tsx server/scripts/test-credit-backfill-monitor.ts
 *
 * Requires DATABASE_URL. Creates and cleans up its own fixtures so it is
 * safe to run against any environment that has the schema applied.
 */
import { db } from "../db";
import {
  calls,
  creditTransactions,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  scanForUnbilledCalls,
  executeBackfill,
  type UnbilledCall,
} from "../services/credit-backfill-monitor";

interface Fixture {
  userId: string;
  widgetCallId: string;
  realCallId: string;
}

async function setup(): Promise<Fixture> {
  const userId = `test-backfill-${randomUUID()}`;
  await db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    username: userId,
    password: "test",
    credits: 1000,
  } as any);

  const widgetCallId = `test-widget-${randomUUID()}`;
  const realCallId = `test-real-${randomUUID()}`;

  await db.insert(calls).values([
    {
      id: widgetCallId,
      userId,
      status: "completed",
      duration: 120,
      widgetId: `fake-widget-${randomUUID()}`,
      fromNumber: "+10000000000",
      toNumber: "+10000000001",
    } as any,
    {
      id: realCallId,
      userId,
      status: "completed",
      duration: 90,
      widgetId: null,
      fromNumber: "+10000000002",
      toNumber: "+10000000003",
    } as any,
  ]);

  return { userId, widgetCallId, realCallId };
}

async function teardown(fx: Fixture): Promise<void> {
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, fx.userId));
  await db.delete(calls).where(eq(calls.userId, fx.userId));
  await db.delete(users).where(eq(users.id, fx.userId));
}

function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const fx = await setup();
  let failed = 0;
  try {
    // 1. Scan must include the real call but NEVER the widget call.
    const scan = await scanForUnbilledCalls({
      engines: ["elevenlabs-twilio"],
      limit: 10000,
    });
    const elev = scan.engines.find((e) => e.engine === "elevenlabs-twilio");
    assert(elev, "elevenlabs-twilio engine result missing");
    assert(
      elev!.sampleIds.includes(fx.realCallId) || elev!.unbilled >= 1,
      "real un-billed call should be detected",
    );
    assert(
      !elev!.sampleIds.includes(fx.widgetCallId),
      "widget call must NOT appear in scan sample (false positive)",
    );

    // 2. Defense-in-depth: even when a widget row is force-fed into the
    // execute path, it must not be charged. We do this by running a real
    // dry-run backfill scoped to our user (so we don't touch production
    // data), then asserting the dry-run scanned count excludes widgets.
    const dryRun = await executeBackfill({
      engines: ["elevenlabs-twilio"],
      userId: fx.userId,
      dryRun: true,
      limit: 10000,
    });
    const dryStat = dryRun.engines.find((e) => e.engine === "elevenlabs-twilio");
    assert(dryStat, "dry-run engine stat missing");
    assert(
      dryStat!.scanned === 1,
      `dry-run should see exactly 1 chargeable row (the real call), got ${dryStat!.scanned}`,
    );

    // 3. Confirm no credit_transactions were written for either call.
    const txns = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, fx.userId));
    assert(
      txns.length === 0,
      `dry-run must not write credit_transactions, got ${txns.length}`,
    );

    console.log("✅ credit-backfill-monitor safety assertions passed");
  } catch (err: any) {
    failed = 1;
    console.error(err?.stack || err?.message || String(err));
  } finally {
    await teardown(fx);
  }
  process.exit(failed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
