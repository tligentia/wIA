import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { autoIncrementVersion } from './increment-version.js';

const extensionDir = path.join(process.cwd(), 'src', 'extension');
const frontendDir = path.join(process.cwd(), 'src', 'frontend');

function resetDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

// Helper to compile rules.yaml to default_rules.json
function compileRulesToJSON() {
  const yamlPath = path.join(process.cwd(), 'config', 'rules.yaml');
  const jsonOutDir = path.join(process.cwd(), 'src', 'extension', 'lib');
  const jsonPath = path.join(jsonOutDir, 'default_rules.json');
  
  if (!fs.existsSync(jsonOutDir)) {
    fs.mkdirSync(jsonOutDir, { recursive: true });
  }

  if (fs.existsSync(yamlPath)) {
    console.log('🔄 Compiling config/rules.yaml to default_rules.json...');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const parsed = YAML.parse(yamlContent);
    fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');
    console.log('   [✓] Compiled successfully!');
  } else {
    console.warn('⚠️ Warning: config/rules.yaml not found, skipping compilation.');
  }
}

function syncNpmFrontendFromConsole() {
  console.log('🔄 Syncing autonomous console to npm frontend...');

  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }

  const dashboardHtmlPath = path.join(extensionDir, 'dashboard.html');
  const dashboardJsPath = path.join(extensionDir, 'dashboard.js');
  const sourceLibDir = path.join(extensionDir, 'lib');
  const sourceIconsDir = path.join(extensionDir, 'icons');
  const frontendLibDir = path.join(frontendDir, 'lib');
  const frontendIconsDir = path.join(frontendDir, 'icons');

  if (!fs.existsSync(dashboardHtmlPath) || !fs.existsSync(dashboardJsPath)) {
    throw new Error('Console dashboard source files are missing.');
  }

  const html = fs.readFileSync(dashboardHtmlPath, 'utf8')
    .replace('<script src="dashboard.js"></script>', '<script src="app.js"></script>');

  fs.writeFileSync(path.join(frontendDir, 'index.html'), html, 'utf8');
  fs.copyFileSync(dashboardJsPath, path.join(frontendDir, 'app.js'));

  if (fs.existsSync(sourceLibDir)) {
    resetDirectory(frontendLibDir);
    for (const item of fs.readdirSync(sourceLibDir)) {
      const src = path.join(sourceLibDir, item);
      const dest = path.join(frontendLibDir, item);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    }
  }

  if (fs.existsSync(sourceIconsDir)) {
    resetDirectory(frontendIconsDir);
    for (const item of fs.readdirSync(sourceIconsDir)) {
      const src = path.join(sourceIconsDir, item);
      const dest = path.join(frontendIconsDir, item);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    }
  }

  console.log('   [✓] npm frontend now uses the unified autonomous console.');
}

try {
  // Auto-increment and sync version prior to bundling
  autoIncrementVersion();
  
  // Compile rules to JSON
  compileRulesToJSON();

  // Copy styles.css from frontend to extension
  const srcStyles = path.join(process.cwd(), 'src', 'frontend', 'styles.css');
  const destStyles = path.join(process.cwd(), 'src', 'extension', 'styles.css');
  if (fs.existsSync(srcStyles)) {
    console.log('🔄 Syncing src/frontend/styles.css to src/extension/styles.css...');
    fs.copyFileSync(srcStyles, destStyles);
    console.log('   [✓] Styles synced successfully!');
  } else {
    console.warn('⚠️ Warning: src/frontend/styles.css not found, skipping sync.');
  }

  syncNpmFrontendFromConsole();

  console.log('===========================================================');
  console.log('📦 SYNCING UNPACKED BROWSER EXTENSION (AnonimAE)');
  console.log('===========================================================');
  
  if (!fs.existsSync(extensionDir)) {
    throw new Error(`Extension source folder not found at: ${extensionDir}`);
  }

  let count = 0;

  /**
   * Helper to recursively sync files/directories to unpacked extension folders,
   * skipping hidden files and DS_Store.
   */
  function syncRecursive(currentDir, outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      if (item === '.DS_Store' || item.startsWith('.')) {
        continue;
      }
      
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      const outputPath = path.join(outputDir, item);
      
      if (stat.isDirectory()) {
        syncRecursive(fullPath, outputPath);
      } else if (stat.isFile()) {
        fs.copyFileSync(fullPath, outputPath);
        console.log(`   [+] Synced: ${path.relative(process.cwd(), outputPath)}`);
        count++;
      }
    }
  }

  const rootExtensionDir = path.join(process.cwd(), 'extension');

  resetDirectory(rootExtensionDir);
  syncRecursive(extensionDir, rootExtensionDir);
  
  if (count === 0) {
    throw new Error('No files found to sync in extension directory');
  }

  console.log('===========================================================');
  console.log(`🎉 SUCCESS! Browser extension synced into unpacked folder:\n   ${rootExtensionDir}`);
  console.log('===========================================================');
  console.log('💡 Para instalarla:');
  console.log('   1. Abre tu navegador (Chrome, Edge, Brave, Opera).');
  console.log('   2. Ve a "chrome://extensions/".');
  console.log('   3. Activa el "Modo de desarrollador" en la esquina superior derecha.');
  console.log('   4. Haz clic en "Cargar descomprimida" (Load unpacked) y selecciona la carpeta "extension".');
  console.log('===========================================================');
} catch (error) {
  console.error('\n❌ FAILED TO PACKAGE BROWSER EXTENSION:', error.message);
  process.exit(1);
}
