import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Plugin-only tables: those that live ONLY in plugins/<name>/migrations/*.sql
// (created via `CREATE TABLE IF NOT EXISTS` when the plugin loader boots) and
// are NOT defined in shared/schema.ts. Without this exclusion list, every
// `drizzle-kit push --force` (run during system updates and via npm run
// db:push) sees them as "extra tables not in schema" and DROPS them, wiping
// every row of plugin data (admin_teams, team_members, whatsapp_*, etc.).
//
// IMPORTANT — what does NOT belong here:
// Tables that are in BOTH shared/schema.ts AND a plugin migration (notably
// `api_keys`, `api_audit_logs`, `api_rate_limits`, `sip_calls`,
// `sip_phone_numbers`, `sip_trunks`) are app-managed: drizzle-kit owns the
// schema, the plugin migrations are no-op safety nets. Excluding them would
// silently block legitimate schema-reconciliation pushes for those tables.
// Drizzle was never going to drop them anyway because they ARE in the schema.
//
// New plugin-only tables MUST be added here. New main-app tables added to
// shared/schema.ts need no change because the include glob `*` matches all,
// and only the explicit plugin-only names below are excluded.
//
// See replit.md > "System update plugin-table protection".
const PLUGIN_TABLE_PATTERNS = [
  "!teams",
  "!team_*",
  "!admin_teams",
  "!admin_team_*",
  "!whatsapp_*",
  "!whatsway_settings",
  "!meta_whatsapp_*",
  "!user_email_templates",
  "!messaging_logs",
  "!messaging_plugin_meta",
];

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter: ["*", ...PLUGIN_TABLE_PATTERNS],
});
