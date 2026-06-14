#!/usr/bin/env node
/**
 * Set Version Script
 * Usage: node scripts/set-version.js 1.2.0
 * 
 * Updates both the VERSION file and package.json to keep them in sync.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = path.join(__dirname, '..', 'VERSION');
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

const version = process.argv[2];

if (!version) {
  console.error('❌ Usage: node scripts/set-version.js <version>');
  console.error('   Example: node scripts/set-version.js 1.2.0');
  process.exit(1);
}

// Validate semver format
const semverRegex = /^\d+\.\d+\.\d+$/;
if (!semverRegex.test(version)) {
  console.error('❌ Invalid version format. Use semantic versioning (e.g., 1.2.0)');
  process.exit(1);
}

try {
  // Update VERSION file
  fs.writeFileSync(VERSION_FILE, version.trim());
  console.log(`✅ VERSION file updated to ${version}`);
  
  // Update package.json
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const oldVersion = packageJson.version;
  packageJson.version = version.trim();
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✅ package.json updated: ${oldVersion} → ${version}`);
  
  console.log('');
  console.log('📦 Both files are now in sync!');
} catch (error) {
  console.error('❌ Failed to write version:', error.message);
  process.exit(1);
}
