import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import multer from 'multer';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAdminPermission, AdminRequest } from '../middleware/admin-auth';
import { discoverPlugins, getPluginStatus, setPluginEnabled } from '../plugins/loader';
import { scheduleGracefulRestart as scheduleServerRestart } from '../utils/graceful-restart';

const pluginsDir = path.resolve(process.cwd(), 'plugins');

const pluginUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

const router = Router();

const SAFE_TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_PLUGIN_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/;

function sanitizeTableNames(tables: string[]): string[] {
  return tables.filter(t => SAFE_TABLE_NAME_RE.test(t));
}

function validateManifestSafety(manifest: PluginManifest): string | null {
  if (!SAFE_PLUGIN_NAME_RE.test(manifest.name)) {
    return `Invalid plugin name: '${manifest.name}'. Must be lowercase alphanumeric with hyphens/underscores.`;
  }
  const tables = manifest.database?.tables || [];
  for (const t of tables) {
    if (!SAFE_TABLE_NAME_RE.test(t)) {
      return `Invalid table name: '${t}'. Must be lowercase alphanumeric with underscores.`;
    }
  }
  const migrations = manifest.database?.migrations || [];
  for (const m of migrations) {
    if (m.includes('..') || path.isAbsolute(m) || !m.endsWith('.sql')) {
      return `Invalid migration path: '${m}'. Must be a relative .sql file path without parent traversal.`;
    }
  }
  return null;
}

function isSafeZipEntry(entryPath: string, targetDir: string): boolean {
  if (entryPath.includes('..') || path.isAbsolute(entryPath)) return false;
  const resolved = path.resolve(targetDir, entryPath);
  return resolved.startsWith(targetDir + path.sep) || resolved === targetDir;
}

interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  entryPoint: string;
  registerFunction: string;
  database?: {
    migrations?: string[];
    tables?: string[];
  };
  features?: string[];
  ui?: {
    frontendBundle?: string;
    adminSettings?: any;
    userSettings?: any;
  };
  [key: string]: any;
}

function findManifestInZip(zip: AdmZip): { manifest: PluginManifest; rootDir: string } | null {
  const entries = zip.getEntries();
  
  for (const entry of entries) {
    if (entry.entryName.endsWith('plugin.json') && !entry.isDirectory) {
      const parts = entry.entryName.split('/');
      if (parts.length <= 2) {
        try {
          const content = entry.getData().toString('utf-8');
          const manifest = JSON.parse(content) as PluginManifest;
          if (manifest.name && manifest.version && manifest.entryPoint && manifest.registerFunction) {
            const rootDir = parts.length === 2 ? parts[0] : '';
            return { manifest, rootDir };
          }
        } catch {}
      }
    }
  }
  return null;
}

router.post('/validate',
  requireAdminPermission('settings', 'plugins', 'create'),
  pluginUpload.single('plugin'),
  async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      const zip = new AdmZip(req.file.buffer);
      const result = findManifestInZip(zip);

      if (!result) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plugin package',
          message: 'No valid plugin.json found. The zip must contain a plugin.json with name, version, entryPoint, and registerFunction fields.',
        });
      }

      const { manifest } = result;

      const safetyError = validateManifestSafety(manifest);
      if (safetyError) {
        return res.status(400).json({ success: false, error: 'Plugin validation failed', message: safetyError });
      }

      const existingDir = path.join(pluginsDir, manifest.name);
      const isUpgrade = fs.existsSync(existingDir) && fs.existsSync(path.join(existingDir, 'plugin.json'));
      let existingVersion: string | null = null;

      if (isUpgrade) {
        try {
          const existing = JSON.parse(fs.readFileSync(path.join(existingDir, 'plugin.json'), 'utf-8'));
          existingVersion = existing.version;
        } catch {}
      }

      let tablesExist: string[] = [];
      let tablesMissing: string[] = [];
      const requiredTables = sanitizeTableNames(manifest.database?.tables || []);

      if (requiredTables.length > 0) {
        try {
          const tableCheck = await db.execute(
            sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${requiredTables})`
          );
          const existing = new Set((tableCheck.rows as any[]).map(r => r.table_name));
          tablesExist = requiredTables.filter(t => existing.has(t));
          tablesMissing = requiredTables.filter(t => !existing.has(t));
        } catch {}
      }

      const hasMigrations = (manifest.database?.migrations || []).length > 0;

      res.json({
        success: true,
        data: {
          manifest: {
            name: manifest.name,
            displayName: manifest.displayName,
            version: manifest.version,
            description: manifest.description,
            author: manifest.author,
            features: manifest.features || [],
          },
          isUpgrade,
          existingVersion,
          database: {
            requiredTables,
            tablesExist,
            tablesMissing,
            hasMigrations,
            migrationFiles: manifest.database?.migrations || [],
          },
          hasUI: !!(manifest.ui?.frontendBundle || manifest.ui?.adminSettings),
        },
      });
    } catch (error: any) {
      console.error('[Plugin Installer] Validation error:', error);
      res.status(500).json({ success: false, error: 'Failed to validate plugin' });
    }
  }
);

router.post('/install',
  requireAdminPermission('settings', 'plugins', 'create'),
  pluginUpload.single('plugin'),
  async (req: AdminRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      const skipMigration = req.body?.skipMigration === 'true';
      const zip = new AdmZip(req.file.buffer);
      const result = findManifestInZip(zip);

      if (!result) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plugin package',
          message: 'No valid plugin.json found.',
        });
      }

      const { manifest, rootDir } = result;

      const safetyError = validateManifestSafety(manifest);
      if (safetyError) {
        return res.status(400).json({ success: false, error: 'Plugin validation failed', message: safetyError });
      }

      const pluginName = manifest.name;
      const targetDir = path.join(pluginsDir, pluginName);
      const backupDir = path.join(pluginsDir, `${pluginName}.backup.${Date.now()}`);
      const isUpgrade = fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, 'plugin.json'));

      const steps: Array<{ step: string; status: 'success' | 'failed' | 'skipped'; message: string }> = [];

      if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
        steps.push({ step: 'create_plugins_dir', status: 'success', message: 'Created plugins directory' });
      }

      if (isUpgrade) {
        try {
          fs.cpSync(targetDir, backupDir, { recursive: true });
          steps.push({ step: 'backup', status: 'success', message: `Backup created at ${path.basename(backupDir)}` });
        } catch (backupErr: any) {
          steps.push({ step: 'backup', status: 'failed', message: `Backup failed: ${backupErr.message}` });
          return res.status(500).json({ success: false, error: 'Failed to create backup of existing plugin', steps });
        }
      }

      try {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.mkdirSync(targetDir, { recursive: true });

        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;

          let entryPath = entry.entryName;
          if (rootDir && entryPath.startsWith(rootDir + '/')) {
            entryPath = entryPath.substring(rootDir.length + 1);
          }
          if (!entryPath) continue;

          if (!isSafeZipEntry(entryPath, targetDir)) {
            steps.push({ step: 'extract', status: 'failed', message: `Unsafe path rejected: ${entryPath}` });
            continue;
          }

          const fullPath = path.join(targetDir, entryPath);
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, entry.getData());
        }

        steps.push({ step: 'extract', status: 'success', message: `Plugin files extracted to plugins/${pluginName}` });

      } catch (extractErr: any) {
        if (isUpgrade && fs.existsSync(backupDir)) {
          try {
            if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
            fs.cpSync(backupDir, targetDir, { recursive: true });
            steps.push({ step: 'rollback_files', status: 'success', message: 'Restored from backup after extraction failure' });
          } catch {}
        }
        steps.push({ step: 'extract', status: 'failed', message: `Extraction failed: ${extractErr.message}` });
        return res.status(500).json({ success: false, error: 'Failed to extract plugin files', steps });
      }

      if (!skipMigration) {
        const migrations = manifest.database?.migrations || [];
        const requiredTables = sanitizeTableNames(manifest.database?.tables || []);

        if (migrations.length > 0 && requiredTables.length > 0) {
          let needsMigration = false;
          try {
            const tableCheck = await db.execute(
              sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${requiredTables})`
            );
            const existing = new Set((tableCheck.rows as any[]).map(r => r.table_name));
            needsMigration = requiredTables.some(t => !existing.has(t));
          } catch {
            needsMigration = true;
          }

          if (needsMigration) {
            let migrationSuccess = true;
            for (const migFile of migrations) {
              if (migFile.includes('..') || path.isAbsolute(migFile) || !migFile.endsWith('.sql')) {
                steps.push({ step: `migration_${migFile}`, status: 'failed', message: 'Unsafe migration path rejected' });
                continue;
              }
              const migPath = path.join(targetDir, migFile);
              const resolvedMigPath = path.resolve(migPath);
              if (!resolvedMigPath.startsWith(targetDir + path.sep)) {
                steps.push({ step: `migration_${migFile}`, status: 'failed', message: 'Migration path escapes plugin directory' });
                continue;
              }
              if (fs.existsSync(migPath)) {
                try {
                  const stat = fs.lstatSync(migPath);
                  if (stat.isSymbolicLink()) {
                    steps.push({ step: `migration_${migFile}`, status: 'failed', message: 'Symlinked migration files are not allowed' });
                    continue;
                  }
                  const realMigPath = fs.realpathSync(migPath);
                  const realTargetDir = fs.realpathSync(targetDir);
                  if (!realMigPath.startsWith(realTargetDir + path.sep)) {
                    steps.push({ step: `migration_${migFile}`, status: 'failed', message: 'Migration real path escapes plugin directory' });
                    continue;
                  }
                } catch {
                  steps.push({ step: `migration_${migFile}`, status: 'failed', message: 'Could not verify migration path safety' });
                  continue;
                }
                try {
                  const migSql = fs.readFileSync(migPath, 'utf-8');
                  await db.execute(sql.raw(migSql));
                  steps.push({ step: `migration_${migFile}`, status: 'success', message: `Migration applied: ${migFile}` });
                } catch (migErr: any) {
                  migrationSuccess = false;
                  steps.push({ step: `migration_${migFile}`, status: 'failed', message: `Migration failed: ${migErr.message}` });
                }
              } else {
                steps.push({ step: `migration_${migFile}`, status: 'failed', message: `Migration file not found: ${migFile}` });
              }
            }

            if (migrationSuccess) {
              steps.push({ step: 'migrations', status: 'success', message: 'All database migrations applied successfully' });
            } else {
              steps.push({ step: 'migrations', status: 'failed', message: 'Some migrations failed - check individual migration steps above' });
            }
          } else {
            steps.push({ step: 'migrations', status: 'skipped', message: 'All required tables already exist' });
          }
        } else if (migrations.length === 0 && requiredTables.length > 0) {
          steps.push({ step: 'migrations', status: 'skipped', message: 'No migration files defined in plugin.json' });
        } else {
          steps.push({ step: 'migrations', status: 'skipped', message: 'No database tables required' });
        }
      } else {
        steps.push({ step: 'migrations', status: 'skipped', message: 'Migrations skipped by user request' });
      }

      try {
        await setPluginEnabled(pluginName, true);
        steps.push({ step: 'register', status: 'success', message: 'Plugin registered and enabled' });
      } catch (regErr: any) {
        steps.push({ step: 'register', status: 'failed', message: `Registration failed: ${regErr.message}` });
      }

      if (isUpgrade && fs.existsSync(backupDir)) {
        try {
          fs.rmSync(backupDir, { recursive: true, force: true });
        } catch {}
      }

      const allSuccess = steps.every(s => s.status !== 'failed');

      res.json({
        success: allSuccess,
        message: allSuccess
          ? `Plugin '${manifest.displayName}' v${manifest.version} installed successfully. Server will restart automatically to activate.`
          : `Plugin '${manifest.displayName}' installed with some issues. Check the steps below.`,
        data: {
          name: pluginName,
          displayName: manifest.displayName,
          version: manifest.version,
          isUpgrade,
          requiresRestart: true,
          steps,
        },
      });

      if (allSuccess) {
        scheduleServerRestart(`Plugin '${manifest.displayName}' v${manifest.version} installed`);
      }
    } catch (error: any) {
      console.error('[Plugin Installer] Install error:', error);
      res.status(500).json({ success: false, error: 'Failed to install plugin' });
    }
  }
);

router.delete('/uninstall/:name',
  requireAdminPermission('settings', 'plugins', 'delete'),
  async (req: AdminRequest, res: Response) => {
    try {
      const { name } = req.params;
      if (!SAFE_PLUGIN_NAME_RE.test(name)) {
        return res.status(400).json({ success: false, error: 'Invalid plugin name' });
      }
      const targetDir = path.join(pluginsDir, name);

      if (!fs.existsSync(targetDir) || !fs.existsSync(path.join(targetDir, 'plugin.json'))) {
        return res.status(404).json({ success: false, error: `Plugin '${name}' not found` });
      }

      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf-8'));
      } catch {
        return res.status(400).json({ success: false, error: 'Cannot read plugin manifest' });
      }

      const protectedPlugins = ['rest-api'];
      if (protectedPlugins.includes(name)) {
        return res.status(403).json({ success: false, error: `Plugin '${name}' is a core plugin and cannot be uninstalled` });
      }

      try {
        await setPluginEnabled(name, false);
      } catch {}

      const backupDir = path.join(pluginsDir, `${name}.uninstalled.${Date.now()}`);
      try {
        fs.renameSync(targetDir, backupDir);
      } catch (renameErr: any) {
        return res.status(500).json({
          success: false,
          error: 'Failed to remove plugin files',
        });
      }

      res.json({
        success: true,
        message: `Plugin '${manifest.displayName}' uninstalled. Server will restart automatically to apply changes. Database tables have been preserved.`,
        data: {
          name,
          displayName: manifest.displayName,
          version: manifest.version,
          backupLocation: path.basename(backupDir),
          requiresRestart: true,
          tablesPreserved: manifest.database?.tables || [],
        },
      });

      scheduleServerRestart(`Plugin '${manifest.displayName}' uninstalled`);
    } catch (error: any) {
      console.error('[Plugin Installer] Uninstall error:', error);
      res.status(500).json({ success: false, error: 'Failed to uninstall plugin' });
    }
  }
);

router.post('/run-migration/:name',
  requireAdminPermission('settings', 'plugins', 'update'),
  async (req: AdminRequest, res: Response) => {
    try {
      const { name } = req.params;
      if (!SAFE_PLUGIN_NAME_RE.test(name)) {
        return res.status(400).json({ success: false, error: 'Invalid plugin name' });
      }
      const targetDir = path.join(pluginsDir, name);

      if (!fs.existsSync(path.join(targetDir, 'plugin.json'))) {
        return res.status(404).json({ success: false, error: `Plugin '${name}' not found` });
      }

      const manifest: PluginManifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf-8'));
      const migrations = manifest.database?.migrations || [];

      if (migrations.length === 0) {
        return res.json({ success: true, message: 'No migrations defined for this plugin', steps: [] });
      }

      const steps: Array<{ file: string; status: 'success' | 'failed'; message: string }> = [];

      for (const migFile of migrations) {
        if (migFile.includes('..') || path.isAbsolute(migFile) || !migFile.endsWith('.sql')) {
          steps.push({ file: migFile, status: 'failed', message: 'Unsafe migration path rejected' });
          continue;
        }
        const migPath = path.join(targetDir, migFile);
        const resolvedMigPath = path.resolve(migPath);
        if (!resolvedMigPath.startsWith(targetDir + path.sep)) {
          steps.push({ file: migFile, status: 'failed', message: 'Migration path escapes plugin directory' });
          continue;
        }
        if (fs.existsSync(migPath)) {
          try {
            const stat = fs.lstatSync(migPath);
            if (stat.isSymbolicLink()) {
              steps.push({ file: migFile, status: 'failed', message: 'Symlinked migration files are not allowed' });
              continue;
            }
            const realMigPath = fs.realpathSync(migPath);
            const realTargetDir = fs.realpathSync(targetDir);
            if (!realMigPath.startsWith(realTargetDir + path.sep)) {
              steps.push({ file: migFile, status: 'failed', message: 'Migration real path escapes plugin directory' });
              continue;
            }
          } catch {
            steps.push({ file: migFile, status: 'failed', message: 'Could not verify migration path safety' });
            continue;
          }
          try {
            const migSql = fs.readFileSync(migPath, 'utf-8');
            await db.execute(sql.raw(migSql));
            steps.push({ file: migFile, status: 'success', message: 'Migration applied successfully' });
          } catch (err: any) {
            steps.push({ file: migFile, status: 'failed', message: err.message });
          }
        } else {
          steps.push({ file: migFile, status: 'failed', message: 'File not found' });
        }
      }

      const allSuccess = steps.every(s => s.status === 'success');
      res.json({
        success: allSuccess,
        message: allSuccess ? 'All migrations applied successfully' : 'Some migrations failed',
        steps,
      });
    } catch (error: any) {
      console.error('[Plugin Installer] Migration error:', error);
      res.status(500).json({ success: false, error: 'Failed to run migrations' });
    }
  }
);

router.get('/installed', async (_req, res) => {
  try {
    if (!fs.existsSync(pluginsDir)) {
      return res.json({ success: true, data: { plugins: [], total: 0 } });
    }

    const plugins: any[] = [];
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const statusInfo = await getPluginStatus();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.includes('.backup.') || entry.name.includes('.uninstalled.')) continue;

      const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const requiredTables = sanitizeTableNames(manifest.database?.tables || []);
        let tablesStatus: 'ok' | 'missing' | 'unchecked' = 'unchecked';
        let missingTables: string[] = [];

        if (requiredTables.length > 0) {
          try {
            const tableCheck = await db.execute(
              sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${requiredTables})`
            );
            const existing = new Set((tableCheck.rows as any[]).map(r => r.table_name));
            missingTables = requiredTables.filter((t: string) => !existing.has(t));
            tablesStatus = missingTables.length === 0 ? 'ok' : 'missing';
          } catch {
            tablesStatus = 'unchecked';
          }
        } else {
          tablesStatus = 'ok';
        }

        const pluginStatus = statusInfo.find(p => p.name === manifest.name);

        plugins.push({
          name: manifest.name,
          displayName: manifest.displayName || manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          features: manifest.features || [],
          enabled: pluginStatus?.enabled ?? false,
          registered: pluginStatus?.registered ?? false,
          tablesStatus,
          missingTables,
          hasMigrations: (manifest.database?.migrations || []).length > 0,
          hasUI: !!(manifest.ui?.frontendBundle || manifest.ui?.adminSettings),
          error: pluginStatus?.error,
        });
      } catch {}
    }

    res.json({ success: true, data: { plugins, total: plugins.length } });
  } catch (error: any) {
    console.error('[Plugin Installer] List error:', error);
    res.status(500).json({ success: false, error: 'Failed to list plugins' });
  }
});

const ALLOWED_DOWNLOADS = new Set(['sip-engine-plugin-v1.0.0.zip']);

router.get('/download/:filename',
  requireAdminPermission('settings', 'plugins', 'read'),
  (req: AdminRequest, res: Response) => {
    const { filename } = req.params;
    if (!ALLOWED_DOWNLOADS.has(filename)) {
      return res.status(404).json({ success: false, error: 'File not available for download' });
    }
    const filePath = path.resolve(process.cwd(), filename);
    if (!filePath.startsWith(process.cwd() + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    res.download(filePath, filename);
  }
);

export default router;
