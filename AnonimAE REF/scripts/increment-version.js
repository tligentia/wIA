import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Helper to convert base-26 letters to integer (used for one-time migration)
function lettersToInteger(str) {
  let val = 0;
  const uppercase = str.toUpperCase();
  for (let i = 0; i < uppercase.length; i++) {
    val = val * 26 + (uppercase.charCodeAt(i) - 65);
  }
  return val;
}

export function autoIncrementVersion() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const manifestPath = path.join(process.cwd(), 'src', 'extension', 'manifest.json');

  console.log('===========================================================');
  console.log('🔄 SYNCHRONIZING & INCREMENTING UNIFIED VERSION NUMBER');
  console.log('===========================================================');

  // 1. Read and parse package.json
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json file not found in root directory');
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const currentVersion = pkg.version || '26.6.0';

  let newVersion = '';

  // Case A: Legacy Alphabetical representation detected (e.g. "26.06.AH") -> One-time migration to Unified Numeric
  const alphaMatch = currentVersion.match(/^(\d{2})\.(\d{2})\.([a-zA-Z]+)$/);
  if (alphaMatch) {
    const yy = parseInt(alphaMatch[1], 10);
    const mm = parseInt(alphaMatch[2], 10);
    const letters = alphaMatch[3];
    const patchVal = lettersToInteger(letters);
    
    newVersion = `${yy}.${mm}.${patchVal}`;
    console.log(`   [!] Alphabetical version detected ("${currentVersion}").`);
    console.log(`   [!] Migrated to unified numeric version: "${newVersion}"`);
  } else {
    // Case B: Standard Unified Numeric representation (e.g. "26.6.7" or "26.06.7")
    const numericMatch = currentVersion.match(/^(\d{2}\.\d{1,2}\.)(\d+)$/);
    if (!numericMatch) {
      throw new Error(`Invalid version format in package.json: "${currentVersion}". Expected format: YY.MM.PATCH (e.g. 26.6.7)`);
    }
    const prefix = numericMatch[1];
    const patch = parseInt(numericMatch[2], 10);
    const newPatch = patch + 1;
    newVersion = `${prefix}${newPatch}`;
  }

  console.log(`   [+] Old Unified Version:  ${currentVersion}`);
  console.log(`   [+] New Unified Version:  ${newVersion}`);

  // 2. Write new unified version back to package.json
  pkg.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('   [✓] package.json updated successfully.');

  // 3. Read and update manifest.json with the identical version number
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json file not found at: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  manifest.version = newVersion;
  manifest.version_name = newVersion; // Kept identical to fully unify

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('   [✓] manifest.json updated successfully with unified version.');
  console.log('===========================================================');
  
  return newVersion;
}

// Allow running directly from command line
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(__filename) === path.resolve(process.argv[1])) {
  try {
    autoIncrementVersion();
  } catch (err) {
    console.error('❌ Failed to increment version:', err.message);
    process.exit(1);
  }
}
