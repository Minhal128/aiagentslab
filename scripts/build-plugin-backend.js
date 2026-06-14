#!/usr/bin/env node

/**
 * Build Plugin Backend - Compiles plugin TypeScript to JavaScript for production
 * 
 * In production, Node.js cannot import .ts files directly.
 * This script compiles each plugin's TypeScript entry point and dependencies to JavaScript.
 * 
 * Usage: node scripts/build-plugin-backend.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const pluginsDir = path.join(projectRoot, 'plugins');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     Building Plugin Backend (TypeScript → JavaScript)      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

if (!fs.existsSync(pluginsDir)) {
  console.log('No plugins directory found. Skipping.');
  process.exit(0);
}

const plugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

if (plugins.length === 0) {
  console.log('No plugins found. Skipping.');
  process.exit(0);
}

console.log(`Found ${plugins.length} plugin(s): ${plugins.join(', ')}`);
console.log('');

let successCount = 0;
let errorCount = 0;

for (const pluginName of plugins) {
  const pluginPath = path.join(pluginsDir, pluginName);
  const manifestPath = path.join(pluginPath, 'plugin.json');
  
  if (!fs.existsSync(manifestPath)) {
    console.log(`⚠️  Skipping ${pluginName}: no plugin.json`);
    continue;
  }
  
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    if (!manifest.entryPoint || !manifest.entryPoint.endsWith('.ts')) {
      console.log(`⚠️  Skipping ${pluginName}: entryPoint is not TypeScript`);
      continue;
    }
    
    console.log(`📦 Building ${manifest.displayName || pluginName}...`);
    
    // Find all TypeScript files in the plugin directory (excluding node_modules)
    const tsFiles = [];
    
    function findTsFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'frontend' && entry.name !== 'ui') {
            findTsFiles(fullPath);
          }
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          tsFiles.push(fullPath);
        }
      }
    }
    
    findTsFiles(pluginPath);
    
    if (tsFiles.length === 0) {
      console.log(`   No TypeScript files found`);
      continue;
    }
    
    console.log(`   Found ${tsFiles.length} TypeScript file(s)`);
    
    // Use esbuild to compile each TypeScript file to JavaScript
    // Keep the same directory structure
    for (const tsFile of tsFiles) {
      const relativePath = path.relative(pluginPath, tsFile);
      const jsFile = tsFile.replace(/\.ts$/, '.js');
      
      try {
        // Use esbuild for fast compilation
        execSync(`npx esbuild "${tsFile}" --outfile="${jsFile}" --format=esm --platform=node --target=node18`, {
          cwd: projectRoot,
          stdio: 'pipe'
        });
        
        // Post-process: Add .js extension to relative imports (required by Node.js ESM)
        let content = fs.readFileSync(jsFile, 'utf-8');
        
        // Add .js extension to relative imports that don't have an extension
        // Match: from "./path" or from "../path" (not from "package")
        content = content.replace(
          /from\s+["'](\.\.?\/[^"']+)["']/g,
          (match, importPath) => {
            // Skip if already has .js or .json extension
            if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
              return match;
            }
            return `from "${importPath}.js"`;
          }
        );
        
        // Also handle dynamic imports
        content = content.replace(
          /import\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g,
          (match, importPath) => {
            if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
              return match;
            }
            return `import("${importPath}.js")`;
          }
        );
        
        fs.writeFileSync(jsFile, content, 'utf-8');
        console.log(`   ✓ ${relativePath}`);
      } catch (err) {
        console.error(`   ✗ ${relativePath}: ${err.message}`);
        errorCount++;
      }
    }
    
    successCount++;
    console.log(`   ✅ ${manifest.displayName || pluginName} compiled`);
    console.log('');
    
  } catch (error) {
    console.error(`❌ Error building ${pluginName}:`, error.message);
    errorCount++;
  }
}

console.log('════════════════════════════════════════════════════════════');
console.log(`✅ Built ${successCount} plugin(s)`);
if (errorCount > 0) {
  console.log(`❌ ${errorCount} error(s)`);
}
console.log('');
