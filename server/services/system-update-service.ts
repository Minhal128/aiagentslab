import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import archiver from 'archiver';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { scheduleGracefulRestart } from '../utils/graceful-restart';

const execAsync = promisify(exec);

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const TEMP_UPDATE_DIR = path.resolve(process.cwd(), '.update-temp');
const MAINTENANCE_FLAG = path.resolve(process.cwd(), '.maintenance');
const UPDATE_STATE_FILE = path.resolve(process.cwd(), '.update-state.json');

// Only paths that must NEVER be touched by an update package. The application
// code itself (server/, shared/, plugins/, scripts/, package*.json, ...) IS
// allowed to be replaced — that's the whole point of the updater.
const PROTECTED_PATHS = [
  '.env',
  '.env.local',
  '.env.production',
  'node_modules/',
  'uploads/',
  'backups/',
  '.update-temp/',
  '.git/',
  '.config/',
  'data/',
  '.maintenance',
  '.update-state.json',
];

const PROTECTED_EXTENSIONS = ['.log'];

// Paths inside the project root that we never copy into a backup snapshot
// (huge, regenerable, themselves backup data, or full of platform-managed
// symlinks that would crash a recursive file copy).
const BACKUP_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'backups',
  '.update-temp',
  '.cache',
  '.local',
  '.upm',
  '.npm',
  '.pnpm-store',
  'dist',
  'logs',
  'attached_assets',
];

// How many successful update backups to keep on disk. Failed-update backups
// are kept indefinitely so the admin can investigate or roll back. The value
// is read from the SYSTEM_UPDATE_KEEP_BACKUPS env var (default 5) so admins
// can tune retention without redeploying.
function getRetentionKeepSuccessful(): number {
  const raw = process.env.SYSTEM_UPDATE_KEEP_BACKUPS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return 5;
  return Math.min(parsed, 100);
}

// If a `.maintenance` flag is older than this we assume a previous update
// crashed mid-flight and clear it on startup so user traffic isn't blocked.
const STALE_MAINTENANCE_MS = 30 * 60 * 1000;

/**
 * Parse the structured `__MIGRATION_RESULT__:{json}` lines emitted by
 * scripts/run-safe-migration.mjs (task #196) so the system-update flow
 * can surface per-file results in the admin UI. Lines without the marker
 * are ignored. Malformed JSON entries are skipped silently rather than
 * failing the whole update.
 */
function parseAppliedMigrations(output: string): AppliedMigration[] {
  const out: AppliedMigration[] = [];
  for (const raw of output.split('\n')) {
    const i = raw.indexOf('__MIGRATION_RESULT__:');
    if (i === -1) continue;
    try {
      const obj = JSON.parse(raw.slice(i + '__MIGRATION_RESULT__:'.length).trim());
      if (obj && typeof obj.file === 'string' && typeof obj.statements === 'number') {
        out.push({
          file: obj.file,
          statements: obj.statements,
          durationMs: typeof obj.durationMs === 'number' ? obj.durationMs : 0,
          status: obj.status === 'failed' ? 'failed' : 'applied',
          error: typeof obj.error === 'string' ? obj.error : undefined,
        });
      }
    } catch { /* ignore malformed line */ }
  }
  return out;
}

interface AppliedMigration {
  file: string;
  statements: number;
  durationMs: number;
  status: 'applied' | 'failed';
  error?: string;
}

interface DbPushResult {
  exitCode: number;
  success: boolean;
  /** Tail of combined stdout+stderr (last ~4 KB) so admins can see what
   *  the migration runner reported without having to dig through server
   *  logs. */
  outputTail: string;
  /** Per-file structured results parsed from the migration runner's
   *  `__MIGRATION_RESULT__:` lines (task #196). Surfaced in the admin UI
   *  so operators can see which migration files ran and how many
   *  statements each contained. */
  appliedMigrations?: AppliedMigration[];
}

interface UpdateStatus {
  inProgress: boolean;
  phase: 'idle' | 'validating' | 'backing_up' | 'backing_up_db' | 'extracting' | 'installing_deps' | 'db_push' | 'restarting' | 'health_check' | 'complete' | 'rolling_back' | 'failed';
  progress: number;
  message: string;
  currentVersion: string;
  targetVersion?: string;
  error?: string;
  startedAt?: Date;
  /** Last DB schema migration run during this update, surfaced to the
   *  admin UI. The field name is `dbPush` for backward compatibility with
   *  earlier admin clients, but the underlying operation now runs the
   *  additive migrations in `migrations/` (task #196), not drizzle-kit
   *  push. */
  dbPush?: DbPushResult;
}

interface UpdateManifest {
  version: string;
  name: string;
  minCompatibleVersion?: string;
  releaseNotes?: string;
  migrations?: { description: string; sql?: string }[];
  requiredNodeVersion?: string;
  /** Optional list of files (relative paths) the new version wants removed. */
  deletes?: string[];
}

interface ValidationResult {
  valid: boolean;
  manifest?: UpdateManifest;
  fileCount: number;
  estimatedSize: number;
  error?: string;
}

function isProtectedPath(filePath: string): boolean {
  let normalized = filePath.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = path.posix.normalize(normalized);

  if (normalized.startsWith('../') || normalized.startsWith('/')) {
    return true;
  }

  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath.endsWith('/')) {
      if (normalized.startsWith(protectedPath) || normalized === protectedPath.slice(0, -1)) {
        return true;
      }
    } else {
      if (normalized === protectedPath) {
        return true;
      }
    }
  }

  for (const ext of PROTECTED_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return true;
    }
  }

  return false;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

function copyDirRecursive(src: string, dest: string, excludeDirs: string[] = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Symlinks are platform/cache artifacts on Replit/Nix hosts and tend to
    // point at directories outside the project root. Re-create them as
    // symlinks rather than dereferencing — copyFileSync would crash with
    // EISDIR on a symlinked directory.
    if (entry.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(srcPath);
        fs.symlinkSync(target, destPath);
      } catch (err: any) {
        console.warn(`[SystemUpdate] Skipped symlink during backup (${srcPath}): ${err.message}`);
      }
      continue;
    }

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludeDirs);
    } else if (entry.isFile()) {
      // Hard fail on copy errors — an incomplete backup is worse than no
      // backup, because the caller treats backup-success as a green light to
      // mutate the live system.
      fs.copyFileSync(srcPath, destPath);
    }
    // Sockets, FIFOs, devices, etc. are intentionally skipped.
  }
}

function getFreeDiskBytes(targetPath: string): number | null {
  try {
    // statfs is available on linux node 18+. Fall back to null on platforms
    // where it isn't available — pre-flight will then be skipped.
    const anyFs = fs as any;
    if (typeof anyFs.statfsSync === 'function') {
      const stat = anyFs.statfsSync(targetPath);
      return Number(stat.bavail) * Number(stat.bsize);
    }
  } catch {}
  return null;
}

class SystemUpdateService {
  private status: UpdateStatus;

  constructor() {
    this.status = {
      inProgress: false,
      phase: 'idle',
      progress: 0,
      message: 'System is idle',
      currentVersion: this.getCurrentVersion(),
    };
    this.recoverPersistedState();
  }

  /**
   * Called by server bootstrap. If a `.maintenance` flag is left over from a
   * crashed update and is older than the stale threshold, remove it so user
   * traffic isn't blocked indefinitely. Logs a warning either way.
   */
  static cleanupStaleMaintenanceFlag(): void {
    try {
      if (!fs.existsSync(MAINTENANCE_FLAG)) return;
      const stat = fs.statSync(MAINTENANCE_FLAG);
      const age = Date.now() - stat.mtimeMs;
      if (age > STALE_MAINTENANCE_MS) {
        console.warn(`[SystemUpdate] Removing stale .maintenance flag (age ${Math.round(age / 1000)}s) — previous update likely crashed.`);
        try { fs.unlinkSync(MAINTENANCE_FLAG); } catch {}
      } else {
        console.warn(`[SystemUpdate] .maintenance flag present (age ${Math.round(age / 1000)}s) — leaving in place.`);
      }
    } catch (err: any) {
      console.warn('[SystemUpdate] cleanupStaleMaintenanceFlag failed:', err.message);
    }
  }

  /**
   * On boot, restore the persisted update state so the admin UI can show the
   * outcome of the last update even though the polling connection was dropped
   * by the restart. If we find an `inProgress=true` snapshot it means the
   * previous process died mid-update — convert it to `failed` so the UI
   * shows a clear error. Otherwise (`complete` / `failed` / `rolling_back`)
   * we keep the snapshot as-is until the admin dismisses it or starts a new
   * update.
   */
  private recoverPersistedState() {
    try {
      if (!fs.existsSync(UPDATE_STATE_FILE)) return;
      const raw = fs.readFileSync(UPDATE_STATE_FILE, 'utf-8');
      const persisted = JSON.parse(raw) as UpdateStatus;
      if (!persisted) return;

      if (persisted.inProgress) {
        console.warn('[SystemUpdate] Found in-progress state from previous run — marking as failed.');
        // Task #191: don't let the generic "server restart" message overwrite
        // a more specific failure that the failing phase already persisted
        // (e.g. "npm install failed during update: ... timed out after Xms").
        // If we have a real error string, surface it as the headline message
        // too so the admin UI's red box shows the cause, not just a generic
        // restart notice.
        const hadSpecificError = !!(persisted.error && persisted.error.trim());
        this.status = {
          ...persisted,
          inProgress: false,
          phase: 'failed',
          error: hadSpecificError
            ? persisted.error
            : 'Update process was interrupted (server restarted before completion).',
          message: hadSpecificError
            ? (persisted.message && persisted.message.trim()
                ? persisted.message
                : persisted.error!.split('\n')[0].slice(0, 200))
            : 'Update interrupted by server restart',
        };
        // Persist the converted (failed) state so subsequent polls keep
        // returning it until dismissed.
        this.persistState();
        // In dev, an interrupted update means the dev process (tsx) was killed
        // mid `npm install`. Don't make the workspace wait 30 minutes behind a
        // 503 — clear the maintenance flag immediately on boot so the preview
        // comes back. Production keeps the staleness threshold so a real
        // crashed update during a tight restart loop isn't masked.
        if (process.env.NODE_ENV !== 'production') {
          try {
            if (fs.existsSync(MAINTENANCE_FLAG)) {
              fs.unlinkSync(MAINTENANCE_FLAG);
              console.warn('[SystemUpdate] Dev mode: cleared leftover .maintenance flag from interrupted update.');
            }
          } catch (e: any) {
            console.warn('[SystemUpdate] Failed to clear .maintenance in dev recovery:', e.message);
          }
        }
      } else {
        // Successful or previously-failed completion — restore as the
        // last-known result. Always refresh currentVersion from package.json
        // because after a successful update the binary reports the new
        // version while the persisted snapshot still has the old one.
        this.status = {
          ...persisted,
          currentVersion: this.getCurrentVersion(),
        };
        console.log(`[SystemUpdate] Restored last update state: phase=${persisted.phase}`);
      }
    } catch (err: any) {
      console.warn('[SystemUpdate] Failed to recover update state:', err.message);
    }
  }

  /**
   * Force-clear all on-disk update artifacts and reset in-memory status to
   * idle. Used by the admin "Reset Update State" action when an update was
   * interrupted and left `.maintenance` / `.update-state.json` behind.
   *
   * Unlike dismissLastResult(), this works even when in-memory status reports
   * inProgress=true, because the whole point is to recover from a stuck
   * snapshot. It does NOT undo any partial file or DB changes — those have
   * to be addressed via rollback or a fresh successful update.
   */
  forceReset(): UpdateStatus {
    try { fs.unlinkSync(MAINTENANCE_FLAG); } catch {}
    try { fs.unlinkSync(UPDATE_STATE_FILE); } catch {}
    this.status = {
      inProgress: false,
      phase: 'idle',
      progress: 0,
      message: 'System is idle',
      currentVersion: this.getCurrentVersion(),
    };
    console.warn('[SystemUpdate] forceReset(): cleared .maintenance, .update-state.json, and reset in-memory status to idle.');
    return this.getStatus();
  }

  /**
   * Returns true when the running process is the dev workspace (tsx loading
   * source files live), where running an update would extract files over and
   * `npm install` under the running process — which kills tsx mid-flight.
   * Production deploys run the bundled `dist/index.js` and are safe.
   */
  isDevMode(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  dismissLastResult(): void {
    if (this.status.inProgress) {
      throw new Error('Cannot dismiss while an update is in progress');
    }
    this.status = {
      inProgress: false,
      phase: 'idle',
      progress: 0,
      message: 'System is idle',
      currentVersion: this.getCurrentVersion(),
    };
    this.clearPersistedState();
  }

  private persistState() {
    try {
      fs.writeFileSync(UPDATE_STATE_FILE, JSON.stringify(this.status, null, 2));
    } catch {}
  }

  private clearPersistedState() {
    try { fs.unlinkSync(UPDATE_STATE_FILE); } catch {}
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  getCurrentVersion(): string {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  async getUpdateHistory(): Promise<any[]> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM system_updates ORDER BY created_at DESC LIMIT 50
      `);
      return result.rows as any[];
    } catch {
      return [];
    }
  }

  validateZip(buffer: Buffer): ValidationResult {
    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      for (const entry of entries) {
        const entryPath = entry.entryName;
        if (entryPath.includes('..') || path.isAbsolute(entryPath)) {
          return { valid: false, fileCount: 0, estimatedSize: 0, error: `Path traversal detected in entry: ${entryPath}` };
        }
      }

      let manifest: UpdateManifest | undefined;
      let rootDir = '';

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName.split('/');
        const fileName = parts[parts.length - 1];

        if (fileName === 'update-manifest.json' && parts.length <= 2) {
          try {
            const content = entry.getData().toString('utf-8');
            manifest = JSON.parse(content) as UpdateManifest;
            if (parts.length === 2) rootDir = parts[0];
            break;
          } catch {}
        }
      }

      if (!manifest) {
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const parts = entry.entryName.split('/');
          const fileName = parts[parts.length - 1];

          if (fileName === 'package.json' && parts.length <= 2) {
            try {
              const content = entry.getData().toString('utf-8');
              const pkg = JSON.parse(content);
              if (pkg.version) {
                manifest = {
                  version: pkg.version,
                  name: pkg.name || 'Unknown',
                  releaseNotes: pkg.description,
                };
                if (parts.length === 2) rootDir = parts[0];
                break;
              }
            } catch {}
          }
        }
      }

      if (!manifest) {
        return { valid: false, fileCount: 0, estimatedSize: 0, error: 'No update-manifest.json or package.json found in the ZIP file' };
      }

      const currentVersion = this.getCurrentVersion();
      if (compareVersions(manifest.version, currentVersion) <= 0) {
        return {
          valid: false,
          fileCount: 0,
          estimatedSize: 0,
          error: `Update version (${manifest.version}) must be higher than current version (${currentVersion})`,
        };
      }

      if (manifest.minCompatibleVersion) {
        if (compareVersions(currentVersion, manifest.minCompatibleVersion) < 0) {
          return {
            valid: false,
            fileCount: 0,
            estimatedSize: 0,
            error: `Current version (${currentVersion}) is below minimum compatible version (${manifest.minCompatibleVersion})`,
          };
        }
      }

      let fileCount = 0;
      let estimatedSize = 0;
      for (const entry of entries) {
        if (!entry.isDirectory) {
          fileCount++;
          estimatedSize += entry.header.size;
        }
      }

      return { valid: true, manifest, fileCount, estimatedSize };
    } catch (error: any) {
      return { valid: false, fileCount: 0, estimatedSize: 0, error: `Failed to parse ZIP: ${error.message}` };
    }
  }

  /**
   * Reject early if there isn't roughly 3× the ZIP size free on disk
   * (backup + extraction temp + headroom). Returns null when ok, or a
   * human-readable error string when blocked. Skips silently on platforms
   * where statfs isn't available.
   */
  preflightDiskSpace(zipSize: number): string | null {
    const required = zipSize * 3;
    const cwd = process.cwd();
    const free = getFreeDiskBytes(cwd);
    if (free === null) return null;
    if (free < required) {
      const fmt = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
      return `Not enough free disk space for a safe update. Need ~${fmt(required)} (3× ZIP size for backup + extraction); only ${fmt(free)} available.`;
    }
    return null;
  }

  async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(BACKUPS_DIR, `backup-${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const cwd = process.cwd();
    copyDirRecursive(cwd, backupDir, BACKUP_EXCLUDE_DIRS);

    // Sanity check — must contain at least package.json. If it doesn't, the
    // backup is unusable and we must abort the update.
    if (!fs.existsSync(path.join(backupDir, 'package.json'))) {
      throw new Error('File backup did not include package.json — aborting update.');
    }

    return backupDir;
  }

  /**
   * Best-effort database dump. Returns true if a dump file was written.
   * If `pg_dump` is not installed we throw — callers decide whether the
   * absence of a DB backup is fatal (it is, for `performUpdate`).
   */
  async createDatabaseBackup(backupDir: string): Promise<boolean> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set — cannot back up the database.');
    }

    const dumpPath = path.join(backupDir, 'database.sql');
    // --clean / --if-exists prepend `DROP ... IF EXISTS` for every object so
    // the dump can be safely restored into an existing (and likely
    // populated) database. Without these flags the very first CREATE on
    // restore aborts with "already exists" under `psql -v ON_ERROR_STOP=1`,
    // which is what rollback uses, leaving customers with a half-restored
    // schema. --no-owner / --no-privileges keep the dump portable across
    // databases that don't have the same role grants.
    await execAsync(
      `pg_dump --clean --if-exists --no-owner --no-privileges "${databaseUrl}" > "${dumpPath}"`,
      { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
    );

    const stat = fs.statSync(dumpPath);
    if (stat.size === 0) {
      throw new Error('Database backup file is empty — pg_dump produced no output.');
    }
    console.log(`[SystemUpdate] Database backup created (${stat.size} bytes)`);
    return true;
  }

  extractFiles(zip: AdmZip, rootDir: string, deletes: string[] = []): { extracted: number; deleted: number } {
    const entries = zip.getEntries();
    const cwd = process.cwd();
    let extractedCount = 0;
    let deletedCount = 0;

    // Apply explicit deletes from the manifest first.
    for (const rel of deletes) {
      const safe = rel.replace(/\\/g, '/').replace(/^\.\/+/, '');
      if (safe.includes('..') || path.isAbsolute(safe)) continue;
      if (isProtectedPath(safe)) {
        console.log(`[SystemUpdate] Refusing to delete protected path: ${safe}`);
        continue;
      }
      const fullPath = path.join(cwd, safe);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(cwd + path.sep)) continue;
      if (fs.existsSync(fullPath)) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          deletedCount++;
        } catch (err: any) {
          console.warn(`[SystemUpdate] Failed to delete ${safe}: ${err.message}`);
        }
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      let entryPath = entry.entryName;
      if (rootDir && entryPath.startsWith(rootDir + '/')) {
        entryPath = entryPath.substring(rootDir.length + 1);
      }
      if (!entryPath) continue;

      // The manifest file itself is metadata, not part of the deployed app.
      if (entryPath === 'update-manifest.json') continue;

      if (isProtectedPath(entryPath)) {
        console.log(`[SystemUpdate] Skipping protected path: ${entryPath}`);
        continue;
      }

      if (entryPath.includes('..') || path.isAbsolute(entryPath)) continue;

      const fullPath = path.join(cwd, entryPath);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) continue;

      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, entry.getData());
      extractedCount++;
    }

    return { extracted: extractedCount, deleted: deletedCount };
  }

  /**
   * Apply pending database schema changes for the just-extracted code by
   * running the additive SQL migrations in `migrations/0001..NNNN_*.sql`
   * via `scripts/run-safe-migration.mjs`. Returns combined stdout/stderr +
   * exit code so the caller can surface failures to the admin.
   *
   * Why migrations and not drizzle-kit push (task #196):
   *   `drizzle-kit push --force` looks at the live DB, diffs it against
   *   `shared/schema.ts`, and applies whatever it thinks is needed. On
   *   production that has caused two real outages already:
   *     1) plugin-owned tables (admin_teams, whatsapp_*, etc.) that aren't
   *        in `shared/schema.ts` get DROPPED, even with the
   *        `tablesFilter` defense in `drizzle.config.ts` — when a customer
   *        deploys a zip without that defense, every update wipes their
   *        plugin data;
   *     2) the rename-detection picker can collapse a freshly-added column
   *        into a rename of an existing column, so users see "missing
   *        column messaging_email_enabled" after an update.
   *   The hand-written migrations under `migrations/` are purely additive
   *   (CREATE TABLE / ADD COLUMN with IF NOT EXISTS) and idempotent, so
   *   replaying them on any live DB cannot drop or rename anything.
   *
   * Method name retained for backward compat with callers and the drill
   * (`scripts/system-update-http-drill.ts` calls `runSchemaPush()`).
   */
  async runSchemaPush(): Promise<{ ok: boolean; exitCode: number; output: string; appliedMigrations: AppliedMigration[] }> {
    const script = path.join(process.cwd(), 'scripts', 'run-safe-migration.mjs');
    if (!fs.existsSync(script)) {
      // Hard fail rather than silently falling back to drizzle-kit push:
      // the migrations runner is shipped in the production zip allowlist
      // (scripts/production-zip*.sh). If it's missing the zip is broken
      // and we'd rather the operator see the failure than have us silently
      // run a destructive push.
      return {
        ok: false,
        exitCode: 1,
        output:
          `[SystemUpdate] Migration runner not found at scripts/run-safe-migration.mjs.\n` +
          `Production zips must include this script. See replit.md > ` +
          `"Production database migration rule (task #196)".`,
        appliedMigrations: [],
      };
    }
    try {
      const { stdout, stderr } = await execAsync(`node "${script}"`, {
        timeout: 180_000,
        cwd: process.cwd(),
        maxBuffer: 5 * 1024 * 1024,
      });
      const output = `${stdout}\n${stderr}`;
      return { ok: true, exitCode: 0, output, appliedMigrations: parseAppliedMigrations(output) };
    } catch (err: any) {
      const output = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message}`;
      return {
        ok: false,
        exitCode: typeof err.code === 'number' ? err.code : 1,
        output,
        appliedMigrations: parseAppliedMigrations(output),
      };
    }
  }

  /**
   * Run `npm install --include=dev` for the just-extracted code.
   *
   * Why this is its own method instead of an inline execAsync (task #191):
   *   - The previous inline call used a 3-minute exec timeout, which is
   *     too short for real production installs (570+ files, several
   *     native modules) on small VPSes — it routinely timed out and the
   *     only stderr captured at SIGTERM was npm's harmless deprecation
   *     warning, leaving operators with a meaningless "Command failed:
   *     npm warn config production..." error.
   *   - exec buffered all output into memory and emitted nothing until
   *     the install finished (or failed), so PM2 logs were silent for
   *     minutes at a time.
   *   - `--production=false` is deprecated in npm v9+; `--include=dev`
   *     is the modern equivalent and produces no warnings.
   *
   * The implementation streams stdout+stderr to the server log in real
   * time (so an operator tailing PM2 sees progress), keeps a rolling
   * 200KB tail in memory for the failure payload (real npm output, not
   * just deprecation warnings), and uses a long, env-overridable timeout.
   * Returns a structured result instead of throwing so the caller can
   * persist the exit code into update history.
   */
  async runNpmInstall(opts: {
    /** Extra npm args appended after the base args. Used by the drill to add
     *  flags like `--dry-run` or `--registry=...` for failure-path tests. */
    extraArgs?: string[];
    /** Extra env vars merged on top of process.env. Used by the drill. */
    env?: Record<string, string>;
    /** Override the timeout. Mainly for the drill to fail fast. */
    timeoutMs?: number;
  } = {}): Promise<{ ok: boolean; exitCode: number; output: string; error: string }> {
    const TIMEOUT_MS = opts.timeoutMs ?? (() => {
      const raw = process.env.SYSTEM_UPDATE_NPM_INSTALL_TIMEOUT_MS;
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000; // 10 min default
    })();
    const MAX_TAIL = 200 * 1024; // 200KB rolling tail of npm output
    const args = ['install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=warn', ...(opts.extraArgs || [])];
    const cmdString = `npm ${args.join(' ')}`;

    return await new Promise((resolve) => {
      console.log(`[SystemUpdate] running ${cmdString} (timeout=${TIMEOUT_MS}ms)`);
      const child = spawn('npm', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: {
          ...process.env,
          // Force non-interactive so npm never tries to prompt and
          // FORCE_COLOR=0 keeps the captured tail clean of ANSI codes.
          FORCE_COLOR: '0',
          npm_config_progress: 'false',
          NPM_CONFIG_PROGRESS: 'false',
          CI: '1',
          ...(opts.env || {}),
        },
      });

      let combined = '';
      let settled = false;
      let timedOut = false;

      const append = (chunk: Buffer | string) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        combined = (combined + s).slice(-MAX_TAIL);
      };

      const stream = (kind: 'stdout' | 'stderr', src: NodeJS.ReadableStream) => {
        let buf = '';
        src.on('data', (chunk) => {
          append(chunk);
          buf += chunk.toString('utf8');
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.trim()) console.log(`[SystemUpdate][npm:${kind}] ${line}`);
          }
        });
      };

      stream('stdout', child.stdout);
      stream('stderr', child.stderr);

      const settle = (result: { ok: boolean; exitCode: number; output: string; error: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        console.error(`[SystemUpdate] ${cmdString} exceeded ${TIMEOUT_MS}ms — sending SIGKILL`);
        try { child.kill('SIGKILL'); } catch {}
      }, TIMEOUT_MS);

      child.on('error', (err) => {
        settle({
          ok: false,
          exitCode: 1,
          output: combined,
          error: `npm install failed during update: spawn error: ${err.message}`,
        });
      });

      child.on('exit', (code, signal) => {
        const exitCode = code ?? (signal ? 124 : 1);
        if (exitCode === 0) {
          settle({ ok: true, exitCode: 0, output: combined, error: '' });
          return;
        }
        const reason = timedOut
          ? `timed out after ${TIMEOUT_MS}ms (configurable via SYSTEM_UPDATE_NPM_INSTALL_TIMEOUT_MS)`
          : signal
            ? `killed by signal ${signal} (the parent server process may have been restarted mid-install)`
            : `exited with code ${exitCode}`;
        const tail = combined.trim().slice(-4000) || '<no output captured>';
        settle({
          ok: false,
          exitCode,
          output: combined,
          error: `npm install failed during update: \`${cmdString}\` ${reason}\n--- last npm output ---\n${tail}`,
        });
      });
    });
  }

  async performUpdate(zipBuffer: Buffer, performedBy?: string): Promise<void> {
    if (this.status.inProgress) {
      throw new Error('An update is already in progress');
    }

    let backupPath = '';
    let backupSucceeded = false;
    let dbBackupSucceeded = false;
    const fromVersion = this.getCurrentVersion();
    let toVersion = '';
    let fileCount = 0;
    let dbPushOutput = '';

    try {
      this.status = {
        inProgress: true,
        phase: 'validating',
        progress: 5,
        message: 'Validating update package...',
        currentVersion: fromVersion,
        startedAt: new Date(),
      };
      this.persistState();

      const validation = this.validateZip(zipBuffer);
      if (!validation.valid || !validation.manifest) {
        throw new Error(validation.error || 'Invalid update package');
      }

      // Pre-flight disk space — estimate uses zipBuffer length × 3.
      const diskErr = this.preflightDiskSpace(zipBuffer.length);
      if (diskErr) throw new Error(diskErr);

      toVersion = validation.manifest.version;
      this.status.targetVersion = toVersion;
      this.status.progress = 15;
      this.status.message = `Validated update to version ${toVersion}`;
      this.persistState();

      // Only NOW set the maintenance flag — after validation passes.
      fs.writeFileSync(MAINTENANCE_FLAG, 'updating');

      // ---- HARD PRE-CONDITION: backups must succeed before any mutation ----
      this.status.phase = 'backing_up';
      this.status.progress = 20;
      this.status.message = 'Creating file backup...';
      this.persistState();

      backupPath = await this.createBackup();
      backupSucceeded = true;
      this.status.progress = 35;
      this.status.message = 'File backup created';

      this.status.phase = 'backing_up_db';
      this.status.progress = 40;
      this.status.message = 'Creating database backup...';
      this.persistState();

      await this.createDatabaseBackup(backupPath);
      dbBackupSucceeded = true;
      this.status.progress = 50;
      this.status.message = 'Database backup complete';
      // ---------------------------------------------------------------------

      this.status.phase = 'extracting';
      this.status.progress = 55;
      this.status.message = 'Extracting update files...';
      this.persistState();

      const zip = new AdmZip(zipBuffer);
      let rootDir = '';
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName.split('/');
        const fileName = parts[parts.length - 1];
        if ((fileName === 'update-manifest.json' || fileName === 'package.json') && parts.length === 2) {
          rootDir = parts[0];
          break;
        }
      }

      const extractResult = this.extractFiles(zip, rootDir, validation.manifest.deletes || []);
      fileCount = extractResult.extracted;
      this.status.progress = 70;
      this.status.message = `Extracted ${fileCount} files${extractResult.deleted ? `, removed ${extractResult.deleted}` : ''}`;
      this.persistState();

      this.status.phase = 'installing_deps';
      this.status.progress = 75;
      this.status.message = 'Installing dependencies...';
      this.persistState();

      const installResult = await this.runNpmInstall();
      if (!installResult.ok) {
        throw new Error(installResult.error);
      }

      this.status.phase = 'db_push';
      this.status.progress = 85;
      this.status.message = 'Applying database migrations...';
      this.persistState();

      const pushResult = await this.runSchemaPush();
      dbPushOutput = pushResult.output;
      this.status.dbPush = {
        exitCode: pushResult.exitCode,
        success: pushResult.ok,
        outputTail: pushResult.output.slice(-4000),
        appliedMigrations: pushResult.appliedMigrations,
      };
      this.persistState();
      if (!pushResult.ok) {
        throw new Error(`Database migration failed (exit ${pushResult.exitCode}): ${pushResult.output.slice(-500)}`);
      }
      console.log('[SystemUpdate] migrations output:\n' + pushResult.output);

      this.status.progress = 95;
      this.status.message = 'Schema applied';
      this.persistState();

      this.status.phase = 'complete';
      this.status.progress = 100;
      this.status.message = `Update to version ${toVersion} completed successfully. Server will restart shortly.`;
      this.status.inProgress = false;
      this.persistState();

      await this.recordUpdate({
        fromVersion,
        toVersion,
        status: 'success',
        backupPath,
        releaseNotes: validation.manifest.releaseNotes,
        performedBy,
        fileCount,
      });

      // Apply retention AFTER recording so we don't delete the just-created
      // backup.
      await this.applyRetentionPolicy().catch((err) =>
        console.warn('[SystemUpdate] Retention policy failed:', err.message)
      );

      try { fs.unlinkSync(MAINTENANCE_FLAG); } catch {}
      // Intentionally keep `.update-state.json` so the admin UI can show the
      // "completed" outcome after the imminent restart drops the polling
      // connection. The admin clears it via the dismiss endpoint.

      scheduleGracefulRestart(`System update to v${toVersion}`);
    } catch (error: any) {
      console.error('[SystemUpdate] Update failed:', error);

      this.status.phase = 'rolling_back';
      this.status.progress = 0;
      this.status.message = 'Rolling back due to error...';
      this.status.error = error.message;
      this.persistState();

      // Only roll back if both backups completed — otherwise we'd be
      // restoring an incomplete snapshot.
      if (backupSucceeded && dbBackupSucceeded && backupPath && fs.existsSync(backupPath)) {
        try {
          await this.rollback(backupPath);
          this.status.message = 'Rolled back successfully after failure';
        } catch (rollbackError: any) {
          console.error('[SystemUpdate] Rollback also failed:', rollbackError);
          this.status.message = `Update failed and rollback also failed: ${rollbackError.message}`;
        }
      } else {
        this.status.message = `Update failed before backups completed — no changes were made: ${error.message}`;
      }

      this.status.phase = 'failed';
      this.status.inProgress = false;
      this.persistState();

      await this.recordUpdate({
        fromVersion,
        toVersion: toVersion || 'unknown',
        status: 'failed',
        backupPath: backupSucceeded ? backupPath : undefined,
        errorMessage: dbPushOutput
          ? `${error.message}\n\n[migrations output]\n${dbPushOutput.slice(-1000)}`
          : error.message,
        performedBy,
        fileCount,
      });

      try { fs.unlinkSync(MAINTENANCE_FLAG); } catch {}
      // Keep `.update-state.json` so the admin UI shows the failure after
      // any subsequent restart. Cleared via the dismiss endpoint.
    }
  }

  async rollback(backupPath: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup path does not exist: ${backupPath}`);
    }

    // Broadcast rollback progress through the same status mechanism the
    // updater uses, so the admin UI can show live feedback while polling.
    // We deliberately don't gate on `this.status.inProgress` here because
    // performUpdate()'s failure path calls into this method while the
    // update itself is still marked in-progress — that is the expected,
    // safe automatic-rollback flow. Concurrency between independent
    // user-triggered operations is already gated at the route layer
    // (see /system-update/rollback/:id and /system-update/apply).
    const fromVersion = this.getCurrentVersion();
    const previousMessage = this.status.message;
    this.status = {
      inProgress: true,
      phase: 'rolling_back',
      progress: 5,
      message: previousMessage && this.status.phase === 'rolling_back'
        ? previousMessage
        : 'Starting rollback...',
      currentVersion: fromVersion,
      startedAt: this.status.startedAt || new Date(),
      error: this.status.error,
    };
    this.persistState();

    // Enter maintenance mode so live traffic doesn't hit the filesystem /
    // database while we are mutating them. We unconditionally clear the flag
    // in `finally`, including on the error path, so a failed rollback can't
    // leave the system locked out.
    const maintenanceWasSet = !fs.existsSync(MAINTENANCE_FLAG);
    if (maintenanceWasSet) {
      try { fs.writeFileSync(MAINTENANCE_FLAG, 'rolling-back'); } catch {}
    }

    try {
      const cwd = process.cwd();
      this.status.progress = 15;
      this.status.message = 'Restoring application files...';
      this.persistState();
      const entries = fs.readdirSync(backupPath, { withFileTypes: true });
      const backupNames = new Set(entries.map((e) => e.name));

      // Restore files first.
      for (const entry of entries) {
        if (BACKUP_EXCLUDE_DIRS.includes(entry.name)) continue;
        if (entry.name === 'database.sql') continue;

        const srcPath = path.join(backupPath, entry.name);
        const destPath = path.join(cwd, entry.name);

        if (entry.isDirectory()) {
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true });
          }
          copyDirRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }

      // Parity sweep: remove any top-level entries the failed update added
      // that are NOT in the backup. Without this the filesystem can still
      // contain update-era artifacts after rollback. Anything in the
      // protected list (.env, node_modules, uploads, backups, .git, .config,
      // data, .maintenance, .update-state.json, *.log) is preserved because
      // it represents runtime state, secrets, or user data that must survive
      // a rollback regardless of what the backup happened to capture.
      const currentEntries = fs.readdirSync(cwd, { withFileTypes: true });
      for (const entry of currentEntries) {
        if (backupNames.has(entry.name)) continue;
        if (isProtectedPath(entry.name + (entry.isDirectory() ? '/' : ''))) continue;
        if (BACKUP_EXCLUDE_DIRS.includes(entry.name)) continue;
        const orphan = path.join(cwd, entry.name);
        try {
          fs.rmSync(orphan, { recursive: true, force: true });
          console.log('[SystemUpdate] Rollback removed update-era entry:', entry.name);
        } catch (err: any) {
          console.warn(`[SystemUpdate] Failed to remove ${orphan} during rollback:`, err.message);
        }
      }

      this.status.progress = 50;
      this.status.message = 'Reinstalling dependencies...';
      this.persistState();

      // Reinstall deps so node_modules matches the rolled-back package.json.
      try {
        await execAsync('npm install --production=false', {
          timeout: 180000,
          cwd: process.cwd(),
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (npmError: any) {
        const tail = `${npmError.stdout || ''}\n${npmError.stderr || ''}`.slice(-1500);
        throw new Error(`npm install failed during rollback: ${npmError.message}\n${tail}`);
      }

      // Restore the database when a dump is present. Legacy backups (taken
      // before pg_dump was wired in, or on hosts without pg_dump) won't have
      // a database.sql — in that case we proceed with file-only rollback and
      // surface a clear warning so the admin knows the DB schema was not
      // reverted.
      this.status.progress = 75;
      this.status.message = 'Restoring database...';
      this.persistState();

      const dumpPath = path.join(backupPath, 'database.sql');
      let dbRestoreWarning: string | null = null;
      if (!fs.existsSync(dumpPath)) {
        dbRestoreWarning = 'Backup did not include a database dump — files were restored but the database schema was not. If the failed update changed the schema you may need to restore it manually.';
        console.warn('[SystemUpdate] ' + dbRestoreWarning);
      } else if (!process.env.DATABASE_URL) {
        dbRestoreWarning = 'DATABASE_URL is not set — files were restored but the database was not. Set DATABASE_URL and re-run rollback if a DB restore is required.';
        console.warn('[SystemUpdate] ' + dbRestoreWarning);
      } else {
        try {
          await execAsync(
            `psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${dumpPath}"`,
            { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
          );
          console.log('[SystemUpdate] Database restored from backup.');
        } catch (err: any) {
          console.error('[SystemUpdate] Database restore failed:', err.message);
          throw new Error(`Database restore failed: ${err.message}`);
        }
      }

      this.status.phase = 'complete';
      this.status.progress = 100;
      this.status.inProgress = false;
      this.status.message = dbRestoreWarning
        ? `Rollback complete with warning: ${dbRestoreWarning} Server will restart shortly.`
        : 'Rollback complete. Server will restart shortly.';
      this.persistState();

      // Schedule a restart so the rolled-back code is loaded.
      scheduleGracefulRestart('System rollback');
    } catch (error: any) {
      console.error('[SystemUpdate] Rollback failed:', error);
      this.status.phase = 'failed';
      this.status.inProgress = false;
      // Preserve any pre-existing error (e.g. the original update error
      // when rollback was triggered automatically by performUpdate's
      // failure handler) and append the rollback error so admins see both.
      const previousError = this.status.error;
      this.status.error = previousError
        ? `${previousError} | Rollback also failed: ${error.message}`
        : error.message;
      this.status.message = `Rollback failed: ${error.message}`;
      this.persistState();
      throw error;
    } finally {
      if (maintenanceWasSet) {
        try { fs.unlinkSync(MAINTENANCE_FLAG); } catch {}
      }
    }
  }

  /**
   * Stream a backup directory as a ZIP into the given response. Uses
   * `archiver` so we never have to hold the whole archive in memory — that
   * matters because backups can be hundreds of MB. Returns false if the
   * backup folder is missing.
   */
  streamBackupZip(backupPath: string, res: Response, filename: string): boolean {
    if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isDirectory()) {
      return false;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => {
      console.warn('[SystemUpdate] backup zip warning:', err.message);
    });
    archive.on('error', (err) => {
      console.error('[SystemUpdate] backup zip error:', err);
      try { res.destroy(err); } catch {}
    });
    archive.pipe(res);
    archive.directory(backupPath, false);
    archive.finalize();
    return true;
  }

  /**
   * Keep the N most-recent successful update backups (N from
   * SYSTEM_UPDATE_KEEP_BACKUPS env var, default 5).
   * on disk. Failed-update backups are kept indefinitely so the admin can
   * inspect them. Backup folders for deleted records are not touched.
   */
  async applyRetentionPolicy(): Promise<{ deleted: number }> {
    let deleted = 0;
    try {
      const result = await db.execute(sql`
        SELECT id, backup_path, status
        FROM system_updates
        WHERE status = 'success' AND backup_path IS NOT NULL
        ORDER BY created_at DESC
      `);
      const rows = result.rows as Array<{ id: string; backup_path: string; status: string }>;
      const toDelete = rows.slice(getRetentionKeepSuccessful());
      for (const row of toDelete) {
        try {
          if (row.backup_path && fs.existsSync(row.backup_path)) {
            fs.rmSync(row.backup_path, { recursive: true, force: true });
            deleted++;
          }
          await db.execute(sql`
            UPDATE system_updates SET backup_path = NULL WHERE id = ${row.id}
          `);
        } catch (err: any) {
          console.warn(`[SystemUpdate] Retention: failed to delete ${row.backup_path}:`, err.message);
        }
      }
    } catch (err: any) {
      console.warn('[SystemUpdate] applyRetentionPolicy query failed:', err.message);
    }
    return { deleted };
  }

  async recordUpdate(data: {
    fromVersion: string;
    toVersion: string;
    status: 'success' | 'failed' | 'rolled_back';
    backupPath?: string;
    releaseNotes?: string;
    errorMessage?: string;
    performedBy?: string;
    fileCount?: number;
  }): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS system_updates (
          id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          from_version VARCHAR(50) NOT NULL,
          to_version VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'success',
          backup_path TEXT,
          release_notes TEXT,
          error_message TEXT,
          performed_by VARCHAR(255),
          file_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        INSERT INTO system_updates (from_version, to_version, status, backup_path, release_notes, error_message, performed_by, file_count)
        VALUES (
          ${data.fromVersion},
          ${data.toVersion},
          ${data.status},
          ${data.backupPath || null},
          ${data.releaseNotes || null},
          ${data.errorMessage || null},
          ${data.performedBy || null},
          ${data.fileCount || 0}
        )
      `);
    } catch (error: any) {
      console.error('[SystemUpdate] Failed to record update:', error.message);
    }
  }
}

export function isMaintenanceMode(): boolean {
  return fs.existsSync(MAINTENANCE_FLAG);
}

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/admin') || req.path.startsWith('/api/auth') || req.path.includes('.')) {
    return next();
  }
  if (fs.existsSync(MAINTENANCE_FLAG)) {
    return res.status(503).json({
      error: 'System is updating',
      message: 'The system is currently being updated. Please try again in a few minutes.',
    });
  }
  next();
}

export const systemUpdateService = new SystemUpdateService();
export const cleanupStaleMaintenanceFlag = SystemUpdateService.cleanupStaleMaintenanceFlag;
