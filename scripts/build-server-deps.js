#!/usr/bin/env node

/**
 * Build Server Dependencies for Plugins
 * 
 * Compiles shared server dependencies (db.ts, services, etc.) to standalone JavaScript files
 * that plugins can import in production.
 * 
 * In development, plugins import from ../../../server/db.ts via tsx.
 * In production, plugins need ../../../server/db.js which this script creates.
 * 
 * Usage: node scripts/build-server-deps.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   Building Server Dependencies for Plugin Production Use   ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

const filesToCompile = [
  'shared/schema.ts',
  'server/db.ts',
  'server/storage.ts',
  'server/storage/types.ts',
  'server/storage/index.ts',
  'server/storage/analytics-helpers.ts',
  'server/services/contact-upload-service.ts',
  'server/utils/batch-utils.ts',
];

function fixImportPaths(filePath, content) {
  const dir = path.dirname(filePath);
  
  content = content.replace(
    /from\s+["']@shared\/([^"']+)["']/g,
    (match, modulePath) => {
      const sharedDir = path.join(projectRoot, 'shared');
      const relativePath = path.relative(path.join(projectRoot, dir), sharedDir);
      const normalizedPath = relativePath.replace(/\\/g, '/');
      const prefix = normalizedPath.startsWith('.') ? normalizedPath : './' + normalizedPath;
      return `from "${prefix}/${modulePath}.js"`;
    }
  );
  
  content = content.replace(
    /from\s+["']\.\/([^"'.]+)["']/g,
    'from "./$1.js"'
  );
  
  content = content.replace(
    /from\s+["']\.\.\/([^"'.]+)["']/g,
    'from "../$1.js"'
  );
  
  content = content.replace(
    /from\s+["']\.\.\/\.\.\/([^"'.]+)["']/g,
    'from "../../$1.js"'
  );
  
  return content;
}

async function compileFile(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  const outputPath = fullPath.replace(/\.ts$/, '.js');
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  Skipping ${relativePath}: file not found`);
    return false;
  }
  
  console.log(`📦 Building ${relativePath}...`);
  
  try {
    execSync(`npx esbuild "${fullPath}" --outfile="${outputPath}" --format=esm --platform=node --target=node18`, {
      cwd: projectRoot,
      stdio: 'pipe'
    });
    
    let content = fs.readFileSync(outputPath, 'utf-8');
    content = fixImportPaths(relativePath, content);
    fs.writeFileSync(outputPath, content, 'utf-8');
    
    console.log(`   ✅ ${path.basename(outputPath)}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function main() {
  let successCount = 0;
  let failCount = 0;
  
  for (const file of filesToCompile) {
    if (await compileFile(file)) successCount++;
    else failCount++;
  }
  
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`✅ Built ${successCount} dependencies`);
  if (failCount > 0) {
    console.log(`❌ ${failCount} failed`);
    process.exit(1);
  }
  console.log('');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
