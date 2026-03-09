#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EXAMPLE_DIR = path.join(ROOT_DIR, 'examples', 'next-starter');
const STARTER_API_DIR = path.join(ROOT_DIR, 'assets', 'starter-api');
const SYNC_SCRIPT = path.join(ROOT_DIR, 'scripts', 'sync_model_catalog.mjs');
const PROVIDER_REGISTRY_TEMPLATE = path.join(ROOT_DIR, 'assets', 'provider-registry.template.json');
const CATALOG_OVERRIDES_TEMPLATE = path.join(ROOT_DIR, 'assets', 'catalog-overrides.template.json');
const CATALOG_SCHEMA_TEMPLATE = path.join(ROOT_DIR, 'assets', 'model-catalog.schema.json');

const args = parseArgs(process.argv.slice(2));
const targetDir = path.resolve(args.targetDir || path.join(process.cwd(), 'model-catalog-app'));
const appName = sanitizePackageName(args.name || path.basename(targetDir));

await prepareTargetDirectory(targetDir, args.force);
await scaffoldApp({ targetDir, appName });

if (!args.skipInstall) {
  await runCommand('npm', ['install'], { cwd: targetDir });
}

if (!args.skipSync) {
  await runCommand(process.execPath, ['scripts/sync_model_catalog.mjs'], { cwd: targetDir });
}

console.log(`Scaffolded ${appName} at ${targetDir}`);
console.log('Next steps:');
console.log(`  cd ${targetDir}`);
if (args.skipInstall) {
  console.log('  npm install');
}
if (args.skipSync) {
  console.log('  npm run sync:catalog');
}
console.log('  npm run dev');

async function scaffoldApp({ targetDir, appName }) {
  await copyDirectory(path.join(EXAMPLE_DIR, 'app'), path.join(targetDir, 'app'));
  await copyDirectory(path.join(EXAMPLE_DIR, 'components'), path.join(targetDir, 'components'));

  await copyDirectory(STARTER_API_DIR, path.join(targetDir, 'lib', 'model-catalog'), {
    ignore: new Set(['demoPage.html']),
  });

  await copyFile(PROVIDER_REGISTRY_TEMPLATE, path.join(targetDir, 'assets', 'provider-registry.template.json'));
  await copyFile(CATALOG_OVERRIDES_TEMPLATE, path.join(targetDir, 'assets', 'catalog-overrides.template.json'));
  await copyFile(CATALOG_SCHEMA_TEMPLATE, path.join(targetDir, 'assets', 'model-catalog.schema.json'));
  await copyFile(SYNC_SCRIPT, path.join(targetDir, 'scripts', 'sync_model_catalog.mjs'));

  await fs.mkdir(path.join(targetDir, 'output'), { recursive: true });

  await fs.writeFile(path.join(targetDir, '.gitignore'), buildGitIgnore(), 'utf8');
  await fs.writeFile(path.join(targetDir, '.env.example'), buildEnvExample(), 'utf8');
  await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(buildPackageJson(appName), null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(targetDir, 'next.config.mjs'), buildNextConfig(), 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'app', 'api', 'model-catalog', '[[...route]]', 'route.js'),
    buildRouteFile(),
    'utf8',
  );
}

function buildPackageJson(appName) {
  return {
    name: appName,
    private: true,
    type: 'module',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      'sync:catalog': 'node scripts/sync_model_catalog.mjs',
    },
    dependencies: {
      next: 'latest',
      react: 'latest',
      'react-dom': 'latest',
    },
  };
}

function buildRouteFile() {
  return `import path from 'node:path';

import { createNextRouteHandlers } from '../../../../lib/model-catalog/index.mjs';

export const runtime = 'nodejs';

const rootDir = process.cwd();
const handlers = createNextRouteHandlers({
  rootDir,
  catalogPath: path.join(rootDir, 'output', 'model-catalog.generated.json'),
  jsonStatePath: path.join(rootDir, 'output', 'runtime-state.json'),
  sqlitePath: path.join(rootDir, 'output', 'runtime-state.sqlite'),
  tenantsRoot: path.join(rootDir, 'output', 'tenants'),
  syncScriptPath: path.join(rootDir, 'scripts', 'sync_model_catalog.mjs'),
  defaultTenantId: process.env.MODEL_CATALOG_DEFAULT_TENANT || 'starter-demo',
  apiKeys: process.env.MODEL_CATALOG_API_KEYS || '',
  encryptionSecret: process.env.MODEL_CATALOG_SECRET,
  secretSourceType: process.env.MODEL_CATALOG_SECRET_SOURCE || 'embedded',
  secretSourceRoot: process.env.MODEL_CATALOG_SECRET_FILE_ROOT,
});

export const { GET, POST, PUT, PATCH, DELETE } = handlers;
`;
}

function buildNextConfig() {
  return `const nextConfig = {};

export default nextConfig;
`;
}

function buildGitIgnore() {
  return `node_modules/
.next/
output/
.DS_Store
Thumbs.db
`;
}

function buildEnvExample() {
  return `MODEL_CATALOG_SECRET=replace-me-for-production
MODEL_CATALOG_DEFAULT_TENANT=starter-demo
# MODEL_CATALOG_API_KEYS=team-a:demo-token
# MODEL_CATALOG_SECRET_SOURCE=embedded
# MODEL_CATALOG_SECRET_FILE_ROOT=./secrets
`;
}

async function prepareTargetDirectory(targetDir, force) {
  const exists = await pathExists(targetDir);
  if (!exists) {
    await fs.mkdir(targetDir, { recursive: true });
    return;
  }

  const entries = await fs.readdir(targetDir);
  if (entries.length === 0) {
    return;
  }

  if (!force) {
    throw new Error(`Target directory "${targetDir}" is not empty. Pass --force to overwrite it.`);
  }

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
}

async function copyDirectory(sourceDir, targetDir, options = {}) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (options.ignore?.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, options);
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

async function copyFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

function parseArgs(argv) {
  const parsed = {
    targetDir: '',
    name: '',
    force: false,
    skipInstall: false,
    skipSync: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--name') {
      parsed.name = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--force') {
      parsed.force = true;
      continue;
    }

    if (arg === '--skip-install') {
      parsed.skipInstall = true;
      continue;
    }

    if (arg === '--skip-sync') {
      parsed.skipSync = true;
      continue;
    }

    if (!arg.startsWith('--') && !parsed.targetDir) {
      parsed.targetDir = arg;
    }
  }

  return parsed;
}

function sanitizePackageName(value) {
  return String(value || 'model-catalog-app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model-catalog-app';
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32' && command === 'npm',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}
