/**
 * ============================================================
 * Plugin Management Routes
 * 
 * Admin routes for viewing and managing installed plugins.
 * User routes for checking plugin availability/capabilities.
 * ============================================================
 */

import { Router, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';

import { scheduleGracefulRestart as scheduleServerRestart } from '../utils/graceful-restart';
import { fileURLToPath } from 'url';
import { 
  discoverPlugins, 
  getPluginStatus, 
  setPluginEnabled, 
  getPluginManifest,
  getPluginManifestFromDisk,
  getPlugin
} from '../plugins/loader';
import { getUserPlanCapabilities } from '../services/membership-service';
import { db } from '../db';
import { sql, eq } from 'drizzle-orm';
import { requireAdminPermission, AdminRequest } from '../middleware/admin-auth';
import { globalSettings } from '../../shared/schema';

/** Read the configured app name from the database. Falls back to 'Platform' if unset. */
async function getAppName(): Promise<string> {
  try {
    const [row] = await db
      .select({ value: globalSettings.value })
      .from(globalSettings)
      .where(eq(globalSettings.key, 'app_name'))
      .limit(1);
    return (row?.value as string) || 'Platform';
  } catch {
    return 'Platform';
  }
}

/** HTML-escape a string for safe injection into server-rendered HTML. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Use process.cwd() for plugins directory to work in both dev and production
// In production, code is bundled to dist/index.js and __dirname would be wrong
const pluginsDir = path.resolve(process.cwd(), 'plugins');

const SAFE_TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_PLUGIN_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/;

const router = Router();

/**
 * User-accessible endpoint for plugin capabilities
 * This router can be mounted without admin auth
 */
export const userPluginRouter = Router();

/**
 * GET /api/plugins/capabilities
 * Returns which plugins are enabled (user-safe, no sensitive data)
 * This is used by the frontend to conditionally show plugin-dependent UI
 * 
 * Now also checks user's plan to determine if they have SIP access
 */
userPluginRouter.get('/capabilities', async (req, res) => {
  // Cache for 60 seconds - capabilities rarely change
  res.setHeader('Cache-Control', 'private, max-age=60');
  
  try {
    const plugins = await getPluginStatus();
    
    const capabilities: Record<string, boolean> = {};
    const pluginBundles: Record<string, string> = {};
    
    for (const plugin of plugins) {
      if (plugin.enabled && plugin.registered) {
        capabilities[plugin.name] = true;
        // If plugin has a frontend bundle, include its URL
        // Use /bundle (without .js) to avoid Vite middleware transformation
        if (plugin.hasFrontendBundle) {
          pluginBundles[plugin.name] = `/api/plugins/${plugin.name}/bundle`;
        }
      }
    }
    
    // Check if SIP Engine plugin is globally enabled
    const sipPluginEnabled = capabilities['sip-engine'] ?? false;
    
    // Check if user has SIP access via their plan
    let userHasSipAccess = false;
    let sipEnginesAllowed: string[] = [];
    let maxConcurrentSipCalls = 0;
    
    // Get user's plan capabilities if authenticated
    const userId = (req as any).userId;
    if (userId && sipPluginEnabled) {
      try {
        const planCapabilities = await getUserPlanCapabilities(userId);
        userHasSipAccess = planCapabilities.sipEnabled;
        sipEnginesAllowed = planCapabilities.sipEnginesAllowed;
        maxConcurrentSipCalls = planCapabilities.maxConcurrentSipCalls;
      } catch (err) {
        console.warn('[Plugin Capabilities] Could not get user plan capabilities:', err);
      }
    }
    
    // SIP Engine is accessible only if plugin is enabled AND user's plan allows it
    const sipEngineAccess = sipPluginEnabled && userHasSipAccess;
    
    res.json({
      success: true,
      data: {
        capabilities,
        pluginBundles,
        sipEngine: sipEngineAccess,
        sipPluginInstalled: sipPluginEnabled,
        sipEnginesAllowed: sipEngineAccess ? sipEnginesAllowed : [],
        maxConcurrentSipCalls: sipEngineAccess ? maxConcurrentSipCalls : 0,
        restApi: capabilities['rest-api'] ?? false,
        teamManagement: capabilities['team-management'] ?? false,
      }
    });
  } catch (error: any) {
    console.error('[Plugin Capabilities] Error getting capabilities:', error);
    res.json({
      success: true,
      data: {
        capabilities: {},
        pluginBundles: {},
        sipEngine: false,
        sipPluginInstalled: false,
        sipEnginesAllowed: [],
        maxConcurrentSipCalls: 0,
        restApi: false,
        teamManagement: false,
      }
    });
  }
});

/**
 * Public router for serving plugin bundles
 * No authentication required - bundles are just JavaScript code
 * Plugin enabled status is still checked
 */
export const publicPluginRouter = Router();

/**
 * GET /api/plugins/health
 * Public health check endpoint for plugin installation status
 * Shows which plugins are installed, their status, and any missing requirements
 * Mounted on publicPluginRouter so it doesn't require authentication
 */
publicPluginRouter.get('/health', async (_req, res) => {
  try {
    const plugins = await getPluginStatus();
    const healthChecks: Array<{
      name: string;
      displayName: string;
      version: string;
      status: 'ok' | 'error' | 'disabled';
      enabled: boolean;
      registered: boolean;
      tablesStatus: 'ok' | 'missing' | 'unchecked';
      missingTables: string[];
      error?: string;
    }> = [];

    for (const plugin of plugins) {
      const manifest = getPluginManifest(plugin.name);
      const requiredTables = manifest?.database?.tables || [];
      const safeTables = requiredTables.filter(t => SAFE_TABLE_NAME_RE.test(t));
      let tablesStatus: 'ok' | 'missing' | 'unchecked' = 'unchecked';
      const missingTables: string[] = [];

      if (safeTables.length > 0) {
        try {
          const tableCheckResult = await db.execute(
            sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${safeTables})`
          );
          const existingTables = new Set(
            (tableCheckResult.rows as Array<{ table_name: string }>).map(r => r.table_name)
          );
          
          for (const table of safeTables) {
            if (!existingTables.has(table)) {
              missingTables.push(table);
            }
          }
          tablesStatus = missingTables.length === 0 ? 'ok' : 'missing';
        } catch (err: any) {
          console.error(`[Plugin Health] Error checking tables for ${plugin.name}:`, err);
          tablesStatus = 'unchecked';
        }
      }

      let status: 'ok' | 'error' | 'disabled' = 'ok';
      if (!plugin.enabled) {
        status = 'disabled';
      } else if (plugin.error || missingTables.length > 0) {
        status = 'error';
      }

      healthChecks.push({
        name: plugin.name,
        displayName: manifest?.displayName || plugin.name,
        version: manifest?.version || 'unknown',
        status,
        enabled: plugin.enabled,
        registered: plugin.registered,
        tablesStatus,
        missingTables,
        error: plugin.error || (missingTables.length > 0 
          ? `Missing database tables: ${missingTables.join(', ')}. Run the migration SQL file.`
          : undefined),
      });
    }

    const allHealthy = healthChecks.every(h => h.status === 'ok' || h.status === 'disabled');

    res.json({
      success: true,
      healthy: allHealthy,
      timestamp: new Date().toISOString(),
      plugins: healthChecks,
      troubleshooting: allHealthy ? null : {
        message: 'Some plugins have issues. See individual plugin errors above.',
        commonFixes: [
          'Run plugin migrations: psql $DATABASE_URL -f plugins/<plugin-name>/migrations/*.sql',
          'Restart the application after running migrations',
          'Check that all plugin files are present in the plugins folder',
          'Ensure compiled .js files exist (run build if needed)',
        ],
      },
    });
  } catch (error: any) {
    console.error('[Plugin Health] Error checking plugin health:', error);
    res.status(500).json({
      success: false,
      healthy: false,
      error: 'Failed to check plugin health',
    });
  }
});

/**
 * GET /api/plugins/:name/docs
 * Serve a plugin's documentation.html with dynamic app-name substitution.
 * Reads global_settings app_name and replaces all "AgentLabs" occurrences so
 * white-label installations see their configured brand name.
 */
publicPluginRouter.get('/:name/docs', async (req, res) => {
  try {
    const { name } = req.params;
    if (!SAFE_PLUGIN_NAME_RE.test(name)) {
      res.status(400).json({ error: 'Invalid plugin name' });
      return;
    }
    const docPath = path.resolve(pluginsDir, name, 'docs', 'documentation.html');
    if (!fs.existsSync(docPath)) {
      res.status(404).json({ error: 'Documentation not found for plugin: ' + name });
      return;
    }
    const appName = escapeHtml(await getAppName());
    let html = fs.readFileSync(docPath, 'utf8');
    // Replace template placeholder first; also catch any legacy "AgentLabs" literals
    html = html.replace(/\{\{app_name\}\}/g, appName).replace(/AgentLabs/g, appName);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error: any) {
    console.error('[Plugin Docs] Error serving documentation:', error);
    res.status(500).json({ error: 'Failed to serve plugin documentation' });
  }
});

/**
 * GET /api/plugins/:name/bundle.js or /api/plugins/:name/bundle
 * Serve the frontend bundle for a plugin (public access)
 * This allows plugins to self-register their UI components at runtime
 * Uses .bundle extension to prevent Vite middleware transformation
 */
publicPluginRouter.get('/:name/bundle', async (req, res) => {
  try {
    const { name } = req.params;
    const plugin = getPlugin(name);
    
    if (!plugin) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found',
      });
    }
    
    if (!plugin.enabled || !plugin.registered) {
      return res.status(403).json({
        success: false,
        error: 'Plugin is not enabled',
      });
    }
    
    const manifest = plugin.manifest;
    if (!manifest.ui?.frontendBundle) {
      return res.status(404).json({
        success: false,
        error: 'Plugin has no frontend bundle',
      });
    }
    
    const bundlePath = path.join(pluginsDir, name, manifest.ui.frontendBundle);
    const pluginDir = path.join(pluginsDir, name);
    const resolvedBundlePath = path.resolve(bundlePath);
    if (!resolvedBundlePath.startsWith(pluginDir + path.sep) && resolvedBundlePath !== pluginDir) {
      return res.status(403).json({
        success: false,
        error: 'Invalid bundle path',
      });
    }
    
    if (!fs.existsSync(bundlePath)) {
      return res.status(404).json({
        success: false,
        error: 'Bundle file not found',
      });
    }

    try {
      const realBundlePath = fs.realpathSync(bundlePath);
      const realPluginDir = fs.realpathSync(pluginDir);
      if (!realBundlePath.startsWith(realPluginDir + path.sep)) {
        return res.status(403).json({
          success: false,
          error: 'Invalid bundle path',
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: 'Invalid bundle path',
      });
    }

    // Disallow symlinks for bundle files
    try {
      const stat = fs.lstatSync(bundlePath);
      if (stat.isSymbolicLink()) {
        return res.status(403).json({
          success: false,
          error: 'Symlinked bundle files are not allowed',
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: 'Invalid bundle path',
      });
    }

    // Get file stats for ETag (cache-busting when file changes)
    const stats = fs.statSync(bundlePath);
    const etag = `"${stats.size}-${stats.mtime.getTime()}"`;
    const lastModified = stats.mtime.toUTCString();
    
    // Check If-None-Match for 304 response
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    
    // Read file content directly to prevent any middleware transformation
    const bundleContent = fs.readFileSync(bundlePath, 'utf-8');
    
    // Set headers to explicitly prevent Vite/middleware transformation
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    // Cache with revalidation - client caches but must check ETag on expiry
    res.setHeader('Cache-Control', process.env.NODE_ENV === 'production' ? 'public, max-age=300, must-revalidate' : 'no-cache');
    res.setHeader('X-Vite-Skip', 'true');
    
    // Send raw content as string
    res.send(bundleContent);
    
  } catch (error: any) {
    console.error('[Plugin Routes] Error serving bundle:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to serve plugin bundle',
    });
  }
});

/**
 * GET /api/admin/plugins
 * List all installed plugins with their status
 */
router.get('/', async (req, res) => {
  try {
    const plugins = await getPluginStatus();
    
    res.json({
      success: true,
      data: {
        plugins,
        total: plugins.length,
        enabled: plugins.filter(p => p.enabled).length,
        registered: plugins.filter(p => p.registered).length,
      }
    });
  } catch (error: any) {
    console.error('[Plugin Routes] Error listing plugins:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list plugins',
    });
  }
});

/**
 * GET /api/admin/plugins/:name
 * Get details of a specific plugin
 */
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (!SAFE_PLUGIN_NAME_RE.test(name)) {
      return res.status(400).json({ success: false, error: 'Invalid plugin name' });
    }
    const manifest = getPluginManifest(name) || getPluginManifestFromDisk(name);
    
    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found',
        message: `Plugin '${name}' is not installed`,
      });
    }
    
    const status = (await getPluginStatus()).find(p => p.name === name);
    
    res.json({
      success: true,
      data: {
        ...manifest,
        enabled: status?.enabled ?? false,
        registered: status?.registered ?? false,
        error: status?.error,
      }
    });
  } catch (error: any) {
    console.error('[Plugin Routes] Error getting plugin:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get plugin details',
    });
  }
});

/**
 * PUT /api/admin/plugins/:name/enable
 * Enable a plugin (requires update permission)
 */
router.put('/:name/enable', requireAdminPermission('settings', 'plugins', 'update'), async (req: AdminRequest, res: Response) => {
  try {
    const { name } = req.params;
    if (!SAFE_PLUGIN_NAME_RE.test(name)) {
      return res.status(400).json({ success: false, error: 'Invalid plugin name' });
    }
    const manifest = getPluginManifest(name) || getPluginManifestFromDisk(name);
    
    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found',
        message: `Plugin '${name}' is not installed`,
      });
    }
    
    await setPluginEnabled(name, true);
    
    res.json({
      success: true,
      message: `Plugin '${manifest.displayName}' enabled. Server will restart automatically to apply changes.`,
      data: {
        name,
        enabled: true,
        requiresRestart: true,
      }
    });

    scheduleServerRestart(`Plugin '${manifest.displayName}' enabled`);
  } catch (error: any) {
    console.error('[Plugin Routes] Error enabling plugin:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to enable plugin',
    });
  }
});

/**
 * PUT /api/admin/plugins/:name/disable
 * Disable a plugin (requires update permission)
 */
router.put('/:name/disable', requireAdminPermission('settings', 'plugins', 'update'), async (req: AdminRequest, res: Response) => {
  try {
    const { name } = req.params;
    if (!SAFE_PLUGIN_NAME_RE.test(name)) {
      return res.status(400).json({ success: false, error: 'Invalid plugin name' });
    }
    const manifest = getPluginManifest(name) || getPluginManifestFromDisk(name);
    
    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found',
        message: `Plugin '${name}' is not installed`,
      });
    }
    
    await setPluginEnabled(name, false);
    
    res.json({
      success: true,
      message: `Plugin '${manifest.displayName}' disabled. Server will restart automatically to apply changes.`,
      data: {
        name,
        enabled: false,
        requiresRestart: true,
      }
    });

    scheduleServerRestart(`Plugin '${manifest.displayName}' disabled`);
  } catch (error: any) {
    console.error('[Plugin Routes] Error disabling plugin:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disable plugin',
    });
  }
});

/**
 * GET /api/admin/plugins/discover/available
 * Discover all available plugins (including disabled)
 */
router.get('/discover/available', async (req, res) => {
  try {
    const manifests = discoverPlugins();
    
    res.json({
      success: true,
      data: {
        plugins: manifests.map(m => ({
          name: m.name,
          displayName: m.displayName,
          version: m.version,
          description: m.description,
          author: m.author,
          features: m.features || [],
        })),
        total: manifests.length,
      }
    });
  } catch (error: any) {
    console.error('[Plugin Routes] Error discovering plugins:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to discover plugins',
    });
  }
});

export default router;
