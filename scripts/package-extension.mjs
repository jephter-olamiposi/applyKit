/**
 * @fileoverview Automated Chrome Extension Packaging & Release Script (Phase 15 - ADR-0022).
 *
 * Validates manifest schema, inspects asset integrity, builds production artifacts,
 * and packages a store-compliant distribution ZIP for Chrome Web Store release.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT_DIR, 'apps/extension');
const DIST_DIR = path.join(EXT_DIR, 'dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'dist-release');

console.log('📦 Starting ApplyKit Extension Packaging Pipeline...');

// 1. Build Production Artifacts
console.log('🔨 Step 1: Compiling workspaces and bundling extension...');
try {
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (err) {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
}

// 2. Validate Manifest Conformance
console.log('🔍 Step 2: Validating Chrome Manifest V3 conformance...');
const manifestPath = path.join(DIST_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found in dist directory.');
  process.exit(1);
}

const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (e) {
  console.error('❌ Error: Failed to parse dist/manifest.json as valid JSON.');
  process.exit(1);
}

// Validate manifest schema
if (manifest.manifest_version !== 3) {
  console.error(`❌ Error: manifest_version must be 3, found ${manifest.manifest_version}`);
  process.exit(1);
}

if (!manifest.name || !manifest.version || !manifest.description) {
  console.error('❌ Error: Manifest missing name, version, or description.');
  process.exit(1);
}

// Check icons
if (!manifest.icons || !manifest.icons['16'] || !manifest.icons['48'] || !manifest.icons['128']) {
  console.error('❌ Error: Manifest must declare 16, 48, and 128 pixel icons.');
  process.exit(1);
}

const requiredIcons = ['16', '48', '128'];
for (const size of requiredIcons) {
  const iconRel = manifest.icons[size];
  const iconFull = path.join(DIST_DIR, iconRel);
  if (!fs.existsSync(iconFull)) {
    console.error(`❌ Error: Declared icon file missing: ${iconRel}`);
    process.exit(1);
  }
}

// Check Content Security Policy
if (
  !manifest.content_security_policy ||
  !manifest.content_security_policy.extension_pages ||
  !manifest.content_security_policy.extension_pages.includes("script-src 'self'")
) {
  console.error('❌ Error: Manifest V3 strict CSP missing or invalid.');
  process.exit(1);
}

// Check required bundles
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'sidepanel.html',
  'sidepanel.js',
  'assets/sidepanel.css',
];

for (const file of requiredFiles) {
  const filePath = path.join(DIST_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Required bundle file missing: ${file}`);
    process.exit(1);
  }
}

console.log('✅ Manifest and bundle validation passed.');

// 3. Create Distribution ZIP Archive
console.log('📦 Step 3: Packaging distribution archive...');
fs.mkdirSync(RELEASE_DIR, { recursive: true });

const version = manifest.version;
const zipFileName = `applykit-extension-v${version}.zip`;
const zipFilePath = path.join(RELEASE_DIR, zipFileName);

// Remove prior zip if exists
if (fs.existsSync(zipFilePath)) {
  fs.unlinkSync(zipFilePath);
}

// Create ZIP from DIST_DIR
try {
  execSync(`cd "${DIST_DIR}" && zip -r "${zipFilePath}" . -x "*.DS_Store"`, {
    stdio: 'inherit',
  });
} catch (err) {
  console.error('❌ Error creating zip archive:', err.message);
  process.exit(1);
}

// 4. Compute SHA-256 and Release Audit
const zipBuffer = fs.readFileSync(zipFilePath);
const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');
const sizeKb = (zipBuffer.length / 1024).toFixed(2);

console.log('\n======================================================');
console.log('🎉 ApplyKit Extension Package Ready for Release!');
console.log('======================================================');
console.log(`📁 Archive:      ${zipFilePath}`);
console.log(`🏷️  Version:      v${version}`);
console.log(`⚖️  Size:         ${sizeKb} KB`);
console.log(`🔒 SHA-256:      ${sha256}`);
console.log('======================================================\n');
