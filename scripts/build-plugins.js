#!/usr/bin/env node
/**
 * ============================================================
 * Plugin Build Script
 * 
 * Builds frontend bundles for all installed plugins.
 * Each plugin's bundle self-registers its UI components at runtime.
 * 
 * Usage:
 *   node scripts/build-plugins.js [plugin-name]
 * 
 * Options:
 *   [plugin-name]  Build only the specified plugin
 *   --all          Build all plugins (default)
 *   --watch        Watch mode for development
 * ============================================================
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginsDir = path.resolve(__dirname, '../plugins');
const clientSrcDir = path.resolve(__dirname, '../client/src');

async function getPluginsWithFrontend() {
  const plugins = [];
  
  if (!fs.existsSync(pluginsDir)) {
    console.log('No plugins directory found');
    return plugins;
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const pluginPath = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(pluginPath, 'plugin.json');
    
    if (!fs.existsSync(manifestPath)) continue;
    
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      
      if (manifest.ui?.frontendBundle) {
        const frontendEntryPath = path.join(pluginPath, 'frontend', 'index.tsx');
        const frontendEntryPathJs = path.join(pluginPath, 'frontend', 'index.ts');
        
        let entryFile = null;
        if (fs.existsSync(frontendEntryPath)) {
          entryFile = frontendEntryPath;
        } else if (fs.existsSync(frontendEntryPathJs)) {
          entryFile = frontendEntryPathJs;
        }
        
        if (entryFile) {
          plugins.push({
            name: manifest.name,
            displayName: manifest.displayName,
            path: pluginPath,
            manifest,
            entryFile,
            outputPath: path.join(pluginPath, manifest.ui.frontendBundle),
          });
        } else {
          console.warn(`[${manifest.name}] No frontend entry found at frontend/index.tsx or frontend/index.ts`);
        }
      }
    } catch (err) {
      console.error(`Error reading manifest for ${entry.name}:`, err.message);
    }
  }
  
  return plugins;
}

async function buildPlugin(plugin, watch = false) {
  console.log(`Building ${plugin.displayName} (${plugin.name})...`);
  
  const outputDir = path.dirname(plugin.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build plugins as IIFE format that uses global React/ReactDOM
  // This allows plugins to be loaded via script tags without module import issues
  const buildOptions = {
    entryPoints: [plugin.entryFile],
    bundle: true,
    outfile: plugin.outputPath,
    format: 'iife',
    globalName: `__plugin_${plugin.name.replace(/-/g, '_')}__`,
    platform: 'browser',
    target: ['es2020'],
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    // Use classic JSX transform to avoid bundling jsx-runtime
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
    },
    // Externalize React, ReactDOM, and TanStack Query - they're provided by host app
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@tanstack/react-query'],
    alias: {
      '@/components': path.join(clientSrcDir, 'components'),
      '@/hooks': path.join(clientSrcDir, 'hooks'),
      '@/lib': path.join(clientSrcDir, 'lib'),
      '@/contexts': path.join(clientSrcDir, 'contexts'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
    define: {
      'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    },
    // Banner injects React/ReactDOM/TanStackQuery from window globals
    banner: {
      js: `/* Plugin: ${plugin.name} v${plugin.manifest.version} */
var React = window.React;
var ReactDOM = window.ReactDOM;
var TanStackReactQuery = window.TanStackReactQuery;`,
    },
    // Plugin to resolve 'react' and 'react-dom' imports to global variables
    plugins: [{
      name: 'externalize-react',
      setup(build) {
        // Intercept react imports and replace with global
        build.onResolve({ filter: /^react$/ }, () => ({
          path: 'react',
          namespace: 'react-global',
        }));
        build.onResolve({ filter: /^react-dom$/ }, () => ({
          path: 'react-dom',
          namespace: 'react-global',
        }));
        build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
          path: 'react/jsx-runtime',
          namespace: 'react-global',
        }));
        build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
          path: 'react/jsx-dev-runtime',
          namespace: 'react-global',
        }));
        
        // Intercept @tanstack/react-query imports
        build.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
          path: '@tanstack/react-query',
          namespace: 'tanstack-global',
        }));
        
        // Intercept @/lib/queryClient imports - use window globals
        build.onResolve({ filter: /queryClient/ }, (args) => {
          // Check if this is the queryClient module import
          if (args.path.includes('queryClient') || args.path.includes('lib/queryClient')) {
            return {
              path: '@/lib/queryClient',
              namespace: 'queryClient-global',
            };
          }
        });
        
        // Provide global shims for React
        build.onLoad({ filter: /.*/, namespace: 'react-global' }, (args) => {
          if (args.path === 'react') {
            return {
              contents: `module.exports = window.React;`,
              loader: 'js',
            };
          }
          // jsx-runtime needs to export jsx, jsxs, Fragment functions
          // These map to React.createElement for classic JSX compatibility
          if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
            return {
              contents: `
var React = window.React;
module.exports = {
  jsx: function(type, props, key) {
    if (arguments.length > 2) {
      return React.createElement(type, { ...props, key: key });
    }
    return React.createElement(type, props);
  },
  jsxs: function(type, props, key) {
    if (arguments.length > 2) {
      return React.createElement(type, { ...props, key: key });
    }
    return React.createElement(type, props);
  },
  jsxDEV: function(type, props, key) {
    if (arguments.length > 2) {
      return React.createElement(type, { ...props, key: key });
    }
    return React.createElement(type, props);
  },
  Fragment: React.Fragment
};`,
              loader: 'js',
            };
          }
          if (args.path === 'react-dom') {
            return {
              contents: `module.exports = window.ReactDOM;`,
              loader: 'js',
            };
          }
        });
        
        // Provide global shim for TanStack Query
        build.onLoad({ filter: /.*/, namespace: 'tanstack-global' }, () => {
          return {
            contents: `module.exports = window.TanStackReactQuery;`,
            loader: 'js',
          };
        });
        
        // Provide global shim for queryClient - use window.queryClient from host app
        build.onLoad({ filter: /.*/, namespace: 'queryClient-global' }, () => {
          return {
            contents: `
// Use queryClient from window (shared with host app)
module.exports = {
  queryClient: window.queryClient,
  apiRequest: window.apiRequest
};`,
            loader: 'js',
          };
        });
      },
    }],
  };

  try {
    if (watch) {
      const ctx = await build({ ...buildOptions, metafile: true });
      console.log(`Watching ${plugin.name}...`);
      return ctx;
    } else {
      await build(buildOptions);
      const stats = fs.statSync(plugin.outputPath);
      console.log(`Built ${plugin.name}: ${(stats.size / 1024).toFixed(2)} KB`);
    }
  } catch (err) {
    console.error(`Failed to build ${plugin.name}:`, err.message);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch');
  const pluginFilter = args.find(arg => !arg.startsWith('--'));

  console.log('='.repeat(60));
  console.log('AgentLabs Plugin Builder');
  console.log('='.repeat(60));

  const plugins = await getPluginsWithFrontend();
  
  if (plugins.length === 0) {
    console.log('No plugins with frontend bundles found.');
    return;
  }

  const targetPlugins = pluginFilter 
    ? plugins.filter(p => p.name === pluginFilter)
    : plugins;

  if (targetPlugins.length === 0) {
    console.error(`Plugin "${pluginFilter}" not found or has no frontend bundle.`);
    process.exit(1);
  }

  console.log(`Found ${targetPlugins.length} plugin(s) to build:`);
  targetPlugins.forEach(p => console.log(`  - ${p.displayName} (${p.name})`));
  console.log('');

  const results = await Promise.allSettled(
    targetPlugins.map(plugin => buildPlugin(plugin, watchMode))
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log('');
  console.log('='.repeat(60));
  console.log(`Build complete: ${successful} succeeded, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
