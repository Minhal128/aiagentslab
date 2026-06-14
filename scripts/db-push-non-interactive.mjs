#!/usr/bin/env node
/**
 * Wraps `drizzle-kit push --force` so it can run under a closed-stdin
 * post-merge / system-update environment.
 *
 * Drizzle's column/table rename-detection picker prints lines like:
 *   "Is <name> column in <table> table created or renamed from another column?"
 *   "Is <name> table created or renamed from another table?"
 * The highlighted default ("❯") is always the safe "+ create …" option,
 * which is what we want — picking a rename would silently drop data.
 *
 * For each unique question we see, we send a single CR to accept the
 * highlighted default. We key by the question line itself, not by the
 * presence of "❯", so re-renders of the same prompt don't double-send,
 * and a brand-new prompt right after a previous one isn't dropped by a
 * time-based throttle.
 */
import { spawn } from "node:child_process";

// Production guard (task #196): drizzle-kit push --force has been observed
// dropping plugin-owned tables (admin_teams, whatsapp_*, …) and leaving the
// app missing columns even with the tablesFilter defense in drizzle.config.ts.
// On production we MUST go through the additive hand-written migrations in
// migrations/0001..NNNN_*.sql via scripts/run-safe-migration.mjs instead.
// This wrapper is the only non-interactive entry point used by the system
// update flow and post-merge.sh, so blocking it here is enough to prevent
// any automated push from running against a production database.
//
// Override (only ever for emergency manual recovery):
//     ALLOW_DB_PUSH_ON_PRODUCTION=1 node scripts/db-push-non-interactive.mjs
if (process.env.NODE_ENV === "production"
    && process.env.ALLOW_DB_PUSH_ON_PRODUCTION !== "1") {
  console.error(
    "[db-push-non-interactive] REFUSING to run drizzle-kit push --force on production.\n" +
    "  Production app updates must apply additive SQL migrations via:\n" +
    "      node scripts/run-safe-migration.mjs   (or: npm run db:migrate)\n" +
    "  See replit.md > 'Production database migration rule (task #196)'.\n" +
    "  If you absolutely must override, set ALLOW_DB_PUSH_ON_PRODUCTION=1.",
  );
  process.exit(2);
}

const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, FORCE_COLOR: "0" },
});

// Each known interactive drizzle-kit prompt is matched here. We answer
// every unique question exactly once by sending CR, which selects the
// highlighted default — "+ create" for rename detection, and the safe
// "No, …" option for the truncate confirmation. Add new patterns here
// as drizzle-kit introduces new question types.
const PROMPT_PATTERNS = [
  /Is\s+\S+\s+(?:column|table).*?created or renamed from another (?:column|table)\?/g,
  /Do you want to truncate\s+\S+\s+table\?/g,
];

let buf = "";
const seenPrompts = new Set();

child.stdout.on("data", (chunk) => {
  const s = chunk.toString("utf8");
  process.stdout.write(s);
  buf += s;

  for (const re of PROMPT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(buf)) !== null) {
      const key = m[0];
      if (!seenPrompts.has(key)) {
        seenPrompts.add(key);
        child.stdin.write("\r");
      }
    }
  }

  if (buf.length > 8192) buf = buf.slice(-2048);
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("drizzle-kit spawn failed:", err);
  process.exit(1);
});
