/**
 * ============================================================
 * Plugin Loader System
 * 
 * Automatically discovers and registers installed plugins.
 * Plugins are located in the /plugins directory and must have
 * a plugin.json manifest file.
 * 
 * Usage:
 *   import { loadPlugins, getLoadedPlugins } from './plugins/loader';
 *   await loadPlugins(app, { sessionAuthMiddleware, adminAuthMiddleware });
 * ============================================================
 */

import type { Express, RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { db } from '../db';
import { globalSettings } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { canImportTypeScript, resetCanImportTypeScript } from '../utils/plugin-import';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use process.cwd() for plugins directory to work in both dev and production
// In production, code is bundled to dist/index.js and __dirname would be wrong
const pluginsDir = path.resolve(process.cwd(), 'plugins');

const SAFE_TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

export interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
  compatibility?: {
    agentlabs?: string;
    node?: string;
  };
  entryPoint: string;
  registerFunction: string;
  database?: {
    migrations?: string[];
    tables?: string[];
  };
  routes?: {
    api?: Array<{ path: string; description: string }>;
  };
  ui?: {
    adminSettings?: { tab: string; label: string; component: string; menu?: string; icon?: string };
    userSettings?: { tab: string; label: string; component: string };
    frontendBundle?: string;
  };
  permissions?: {
    required?: string[];
  };
  features?: string[];
  scopes?: Record<string, string>;
  settings?: Record<string, {
    type: string;
    default: any;
    label: string;
    description: string;
  }>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  registered: boolean;
  error?: string;
}

export interface PluginLoaderOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
}

const loadedPlugins: Map<string, LoadedPlugin> = new Map();
export const externallyRegisteredPlugins: Set<string> = new Set();

/**
 * Mark a plugin as externally registered (for backward compatibility)
 * This prevents the loader from trying to register it again
 */
export function markPluginAsRegistered(pluginName: string): void {
  externallyRegisteredPlugins.add(pluginName);
}

/**
 * Check if a plugin is enabled in database settings
 */
async function isPluginEnabled(pluginName: string): Promise<boolean> {
  try {
    const settingKey = `plugin_${pluginName}_enabled`;
    const [setting] = await db.select()
      .from(globalSettings)
      .where(eq(globalSettings.key, settingKey))
      .limit(1);
    
    if (setting && setting.value) {
      // Value is jsonb type, could be { enabled: boolean } or string 'true'/'false'
      const val = setting.value as any;
      if (typeof val === 'object' && 'enabled' in val) {
        return val.enabled === true;
      }
      if (typeof val === 'string') {
        return val === 'true';
      }
      return Boolean(val);
    }
    
    // Default: enabled
    return true;
  } catch (error) {
    console.warn(`[Plugin Loader] Could not check plugin status for ${pluginName}, defaulting to enabled`);
    return true;
  }
}

/**
 * Discover all plugins in the plugins directory
 */
export function discoverPlugins(): PluginManifest[] {
  const plugins: PluginManifest[] = [];
  const seenNames = new Set<string>();
  
  if (!fs.existsSync(pluginsDir)) {
    console.log('[Plugin Loader] No plugins directory found');
    return plugins;
  }
  
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
    
    if (!fs.existsSync(manifestPath)) {
      console.log(`[Plugin Loader] Skipping ${entry.name}: no plugin.json found`);
      continue;
    }
    
    try {
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as PluginManifest;
      if (seenNames.has(manifest.name)) {
        console.warn(`[Plugin Loader] Skipping duplicate plugin '${manifest.name}' in directory '${entry.name}'`);
        continue;
      }
      seenNames.add(manifest.name);
      plugins.push(manifest);
    } catch (error) {
      console.error(`[Plugin Loader] Error parsing ${manifestPath}:`, error);
    }
  }
  
  return plugins;
}

/**
 * Load and register all enabled plugins
 */
export async function loadPlugins(app: Express, options: PluginLoaderOptions): Promise<LoadedPlugin[]> {
  const manifests = discoverPlugins();
  const results: LoadedPlugin[] = [];
  
  console.log(`[Plugin Loader] Found ${manifests.length} plugin(s)`);
  
  for (const manifest of manifests) {
    const pluginPath = path.join(pluginsDir, manifest.name);
    const enabled = await isPluginEnabled(manifest.name);
    
    const loadedPlugin: LoadedPlugin = {
      manifest,
      path: pluginPath,
      enabled,
      registered: false,
    };
    
    if (!enabled) {
      console.log(`[Plugin Loader] Plugin '${manifest.displayName}' is disabled`);
      loadedPlugins.set(manifest.name, loadedPlugin);
      results.push(loadedPlugin);
      continue;
    }
    
    // Skip if plugin was already registered externally (backward compatibility)
    if (externallyRegisteredPlugins.has(manifest.name)) {
      loadedPlugin.registered = true;
      console.log(`[Plugin Loader] Plugin '${manifest.displayName}' already registered externally`);
      loadedPlugins.set(manifest.name, loadedPlugin);
      results.push(loadedPlugin);
      continue;
    }
    
    try {
      let entryPointPath = path.join(pluginPath, manifest.entryPoint);
      
      const canTs = canImportTypeScript();
      const runtimeLabel = canTs ? 'TS-capable runtime' : 'JS-only runtime';
      
      if (manifest.entryPoint.endsWith('.ts')) {
        if (canTs) {
          if (fs.existsSync(entryPointPath)) {
            console.log(`[Plugin Loader] ${runtimeLabel}: using TypeScript source for '${manifest.name}'`);
          } else {
            const baseName = manifest.entryPoint.replace(/\.ts$/, '');
            const jsEntryPointPath = path.join(pluginPath, baseName + '.js');
            const cjsEntryPointPath = path.join(pluginPath, baseName + '.cjs');
            const mjsEntryPointPath = path.join(pluginPath, baseName + '.mjs');
            if (fs.existsSync(jsEntryPointPath)) {
              entryPointPath = jsEntryPointPath;
              console.log(`[Plugin Loader] ${runtimeLabel}: using compiled JS for '${manifest.name}' (.ts not found)`);
            } else if (fs.existsSync(cjsEntryPointPath)) {
              entryPointPath = cjsEntryPointPath;
              console.log(`[Plugin Loader] ${runtimeLabel}: using compiled CJS for '${manifest.name}' (.ts not found)`);
            } else if (fs.existsSync(mjsEntryPointPath)) {
              entryPointPath = mjsEntryPointPath;
              console.log(`[Plugin Loader] ${runtimeLabel}: using compiled MJS for '${manifest.name}' (.ts not found)`);
            }
          }
        } else {
          const baseName = manifest.entryPoint.replace(/\.ts$/, '');
          const jsEntryPointPath = path.join(pluginPath, baseName + '.js');
          const cjsEntryPointPath = path.join(pluginPath, baseName + '.cjs');
          const mjsEntryPointPath = path.join(pluginPath, baseName + '.mjs');
          if (fs.existsSync(jsEntryPointPath)) {
            entryPointPath = jsEntryPointPath;
            console.log(`[Plugin Loader] ${runtimeLabel}: using compiled JS for '${manifest.name}'`);
          } else if (fs.existsSync(cjsEntryPointPath)) {
            entryPointPath = cjsEntryPointPath;
            console.log(`[Plugin Loader] ${runtimeLabel}: using compiled CJS for '${manifest.name}'`);
          } else if (fs.existsSync(mjsEntryPointPath)) {
            entryPointPath = mjsEntryPointPath;
            console.log(`[Plugin Loader] ${runtimeLabel}: using compiled MJS for '${manifest.name}'`);
          } else if (fs.existsSync(entryPointPath)) {
            console.log(`[Plugin Loader] ${runtimeLabel}: WARNING - only .ts available for '${manifest.name}', import may fail`);
          }
        }
      }
      
      const entryPointUrl = pathToFileURL(entryPointPath).href;
      let pluginModule: any;
      try {
        pluginModule = await import(entryPointUrl);
      } catch (importErr: any) {
        if (entryPointPath.endsWith('.ts') && importErr?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
          console.warn(`[Plugin Loader] TS import failed for '${manifest.name}' (ERR_UNKNOWN_FILE_EXTENSION), falling back to compiled JS`);
          resetCanImportTypeScript();
          const basePath = entryPointPath.replace(/\.ts$/, '');
          let fallbackLoaded = false;
          for (const ext of ['.js', '.cjs', '.mjs']) {
            const fallbackPath = basePath + ext;
            if (fs.existsSync(fallbackPath)) {
              console.log(`[Plugin Loader] Using fallback: ${path.basename(fallbackPath)} for '${manifest.name}'`);
              pluginModule = await import(pathToFileURL(fallbackPath).href);
              fallbackLoaded = true;
              break;
            }
          }
          if (!fallbackLoaded) {
            throw new Error(`TS import failed and no compiled JS fallback found for '${manifest.name}'`);
          }
        } else {
          throw importErr;
        }
      }
      
      // Get the register function
      const registerFn = pluginModule[manifest.registerFunction];
      
      if (typeof registerFn !== 'function') {
        throw new Error(`Register function '${manifest.registerFunction}' not found in ${manifest.entryPoint}`);
      }
      
      // For rest-api plugin, inject call services from core server modules
      let enrichedOptions = options;
      if (manifest.name === 'rest-api') {
        try {
          const { OutboundCallService } = await import('../services/outbound-call-service');
          const { ElevenLabsPoolService } = await import('../services/elevenlabs-pool');
          let PlivoCallServiceRef: any = null;
          let TwilioOpenAICallServiceRef: any = null;
          try {
            const plivoMod = await import('../engines/plivo/services/plivo-call.service');
            PlivoCallServiceRef = plivoMod.PlivoCallService;
          } catch {}
          try {
            const twilioMod = await import('../engines/twilio-openai/services/twilio-openai-call.service');
            TwilioOpenAICallServiceRef = twilioMod.TwilioOpenAICallService;
          } catch {}
          enrichedOptions = {
            ...options,
            callServices: {
              OutboundCallService,
              getCredentialForAgent: ElevenLabsPoolService.getCredentialForAgent.bind(ElevenLabsPoolService),
              PlivoCallService: PlivoCallServiceRef,
              TwilioOpenAICallService: TwilioOpenAICallServiceRef,
            },
          };
          console.log(`[Plugin Loader] Injected call services for '${manifest.name}'`);
        } catch (err: any) {
          console.warn(`[Plugin Loader] Could not inject call services for '${manifest.name}': ${err.message}`);
        }
      }

      // Register the plugin — await in case the function is async
      await Promise.resolve(registerFn(app, enrichedOptions));
      
      loadedPlugin.registered = true;
      console.log(`[Plugin Loader] Registered plugin '${manifest.displayName}' v${manifest.version}`);
      
      // Check for required database tables and auto-migrate if missing
      const requiredTables = manifest.database?.tables || [];
      const safeTables = requiredTables.filter((t: string) => SAFE_TABLE_NAME_RE.test(t));
      if (safeTables.length > 0) {
        try {
          const tableCheckResult = await db.execute(sql.raw(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (${safeTables.map((t: string) => `'${t}'`).join(',')})
          `));
          const existingTables = new Set(
            (tableCheckResult.rows as Array<{ table_name: string }>).map(r => r.table_name)
          );
          const missingTables = safeTables.filter((t: string) => !existingTables.has(t));
          
          if (missingTables.length > 0) {
            console.log(`[Plugin Loader] Plugin '${manifest.name}' has missing tables: ${missingTables.join(', ')}`);
            
            const migrations = manifest.database?.migrations || [];
            if (migrations.length > 0) {
              console.log(`[Plugin Loader] Running auto-migration for '${manifest.name}'...`);
              let migrationSuccess = true;
              
              for (const migrationFile of migrations) {
                if (migrationFile.includes('..') || path.isAbsolute(migrationFile) || !migrationFile.endsWith('.sql')) {
                  console.warn(`[Plugin Loader] Skipping unsafe migration path: ${migrationFile}`);
                  continue;
                }
                const migrationPath = path.join(pluginPath, migrationFile);
                const resolvedMigPath = path.resolve(migrationPath);
                if (!resolvedMigPath.startsWith(pluginPath + path.sep)) {
                  console.warn(`[Plugin Loader] Migration path escapes plugin directory: ${migrationFile}`);
                  continue;
                }
                if (fs.existsSync(migrationPath)) {
                  try {
                    const stat = fs.lstatSync(migrationPath);
                    if (stat.isSymbolicLink()) {
                      console.warn(`[Plugin Loader] Skipping symlinked migration: ${migrationFile}`);
                      continue;
                    }
                    const realMigPath = fs.realpathSync(migrationPath);
                    const realPluginPath = fs.realpathSync(pluginPath);
                    if (!realMigPath.startsWith(realPluginPath + path.sep)) {
                      console.warn(`[Plugin Loader] Migration real path escapes plugin directory: ${migrationFile}`);
                      continue;
                    }
                  } catch {
                    console.warn(`[Plugin Loader] Could not verify migration path safety: ${migrationFile}`);
                    continue;
                  }
                  try {
                    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
                    await db.execute(sql.raw(migrationSql));
                    console.log(`[Plugin Loader] ✅ Migration applied: ${migrationFile}`);
                  } catch (migErr: any) {
                    console.error(`[Plugin Loader] ❌ Migration failed for ${migrationFile}:`, migErr.message);
                    migrationSuccess = false;
                  }
                } else {
                  console.warn(`[Plugin Loader] ⚠️  Migration file not found: ${migrationPath}`);
                }
              }
              
              if (migrationSuccess) {
                console.log(`[Plugin Loader] ✅ Auto-migration complete for '${manifest.name}'`);
              } else {
                console.warn(`[Plugin Loader] ⚠️  Some migrations failed for '${manifest.name}'. Check logs above.`);
                console.warn(`   Manual fix: psql $DATABASE_URL -f plugins/${manifest.name}/migrations/*.sql`);
              }
            } else {
              console.warn(`[Plugin Loader] ⚠️  No migration files defined for '${manifest.name}'`);
              console.warn(`   Missing tables: ${missingTables.join(', ')}`);
            }
          }
        } catch (err) {
          // Ignore table check errors - plugin may still work
        }
      }
      
    } catch (error: any) {
      loadedPlugin.error = error.message;
      console.error(`[Plugin Loader] Failed to load plugin '${manifest.name}':`, error);
    }
    
    loadedPlugins.set(manifest.name, loadedPlugin);
    results.push(loadedPlugin);
  }
  
  return results;
}

/**
 * Get all loaded plugins
 */
export function getLoadedPlugins(): LoadedPlugin[] {
  return Array.from(loadedPlugins.values());
}

/**
 * Get a specific loaded plugin by name
 */
export function getPlugin(name: string): LoadedPlugin | undefined {
  return loadedPlugins.get(name);
}

/**
 * Check if a plugin is loaded and registered
 */
export function isPluginRegistered(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  return plugin?.registered ?? false;
}

/**
 * Get plugin manifest by name
 */
export function getPluginManifest(name: string): PluginManifest | undefined {
  const plugin = loadedPlugins.get(name);
  return plugin?.manifest;
}

/**
 * Get plugin manifest from disk (fallback for newly installed plugins not yet in memory)
 */
export function getPluginManifestFromDisk(name: string): PluginManifest | undefined {
  const manifestPath = path.join(pluginsDir, name, 'plugin.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content) as PluginManifest;
  } catch {
    return undefined;
  }
}

/**
 * Set plugin enabled status in database
 */
export async function setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
  const settingKey = `plugin_${pluginName}_enabled`;
  
  try {
    // Upsert the setting (value is jsonb type)
    await db.insert(globalSettings)
      .values({
        key: settingKey,
        value: { enabled },
        description: `Whether the ${pluginName} plugin is enabled`,
      })
      .onConflictDoUpdate({
        target: globalSettings.key,
        set: { value: { enabled } },
      });
      
    // Update in-memory state
    const plugin = loadedPlugins.get(pluginName);
    if (plugin) {
      plugin.enabled = enabled;
    }
    
    console.log(`[Plugin Loader] Plugin '${pluginName}' ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error(`[Plugin Loader] Failed to set plugin status:`, error);
    throw error;
  }
}

/**
 * Get all available plugins with their status
 */
export async function getPluginStatus(): Promise<Array<{
  name: string;
  displayName: string;
  version: string;
  description: string;
  enabled: boolean;
  registered: boolean;
  features: string[];
  hasFrontendBundle: boolean;
  error?: string;
}>> {
  return Array.from(loadedPlugins.values()).map(plugin => {
    let hasFrontendBundle = false;
    if (plugin.manifest.ui?.frontendBundle) {
      const bundlePath = path.join(plugin.path, plugin.manifest.ui.frontendBundle);
      hasFrontendBundle = fs.existsSync(bundlePath);
    }
    return {
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      enabled: plugin.enabled,
      registered: plugin.registered,
      features: plugin.manifest.features || [],
      hasFrontendBundle,
      error: plugin.error,
    };
  });
}
