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
const INIT_MODEL_ROUTING_SCRIPT = path.join(ROOT_DIR, 'scripts', 'init_model_routing_config.mjs');
const PROVIDER_REGISTRY_TEMPLATE = path.join(ROOT_DIR, 'assets', 'provider-registry.template.json');
const CATALOG_OVERRIDES_TEMPLATE = path.join(ROOT_DIR, 'assets', 'catalog-overrides.template.json');
const CATALOG_SCHEMA_TEMPLATE = path.join(ROOT_DIR, 'assets', 'model-catalog.schema.json');

const TEMPLATE_CHOICES = new Set(['full', 'api-only']);
const DEPLOY_CHOICES = new Set(['none', 'vercel', 'render']);
const PROVIDER_PRESETS = {
  global: ['openai', 'anthropic', 'google', 'openrouter', 'vercel-ai-gateway', 'azure-openai', 'openai-compatible'],
  china: ['qwen', 'minimax', 'openrouter', 'vercel-ai-gateway', 'openai-compatible'],
  minimal: ['openai', 'anthropic', 'openai-compatible'],
  all: null,
};

const args = parseArgs(process.argv.slice(2));
const targetDir = path.resolve(args.targetDir || path.join(process.cwd(), 'model-catalog-app'));
const appName = sanitizePackageName(args.name || path.basename(targetDir));
const scaffoldOptions = await resolveScaffoldOptions(args);

await prepareTargetDirectory(targetDir, args.force);
await scaffoldApp({ targetDir, appName, scaffoldOptions });

if (!args.skipInstall) {
  await runCommand('npm', ['install'], { cwd: targetDir });
}

if (!args.skipSync) {
  await runCommand(
    process.execPath,
    ['scripts/sync_model_catalog.mjs', '--providers', scaffoldOptions.providerIds.join(',')],
    { cwd: targetDir },
  );
  await runCommand(
    process.execPath,
    ['scripts/init_model_routing_config.mjs', '--providers', scaffoldOptions.providerIds.join(',')],
    { cwd: targetDir },
  );
}

console.log(`Scaffolded ${appName} at ${targetDir}`);
console.log(`  template: ${scaffoldOptions.template}`);
console.log(`  providers: ${scaffoldOptions.providersLabel} (${scaffoldOptions.providerIds.join(', ')})`);
console.log(`  deploy target: ${scaffoldOptions.deploy}`);
console.log(`  multi-tenant: ${scaffoldOptions.multiTenant ? 'enabled' : 'disabled'}`);
console.log(`  api auth: ${scaffoldOptions.apiAuth ? 'enabled' : 'disabled'}`);
console.log('Next steps:');
console.log(`  cd ${targetDir}`);
if (args.skipInstall) {
  console.log('  npm install');
}
if (args.skipSync) {
  console.log('  npm run sync:catalog');
  console.log('  npm run init:model-routing');
}
console.log('  npm run dev');

async function scaffoldApp({ targetDir, appName, scaffoldOptions }) {
  await fs.mkdir(path.join(targetDir, 'app', 'api', 'model-catalog', '[[...route]]'), { recursive: true });
  await fs.mkdir(path.join(targetDir, 'app', 'admin'), { recursive: true });
  await fs.mkdir(path.join(targetDir, 'assets'), { recursive: true });
  await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(targetDir, 'output'), { recursive: true });

  await copyFile(path.join(EXAMPLE_DIR, 'app', 'layout.jsx'), path.join(targetDir, 'app', 'layout.jsx'));
  await copyFile(path.join(EXAMPLE_DIR, 'app', 'globals.css'), path.join(targetDir, 'app', 'globals.css'));

  if (scaffoldOptions.template === 'full') {
    await copyFile(path.join(EXAMPLE_DIR, 'app', 'page.jsx'), path.join(targetDir, 'app', 'page.jsx'));
    await copyFile(path.join(EXAMPLE_DIR, 'app', 'admin', 'page.jsx'), path.join(targetDir, 'app', 'admin', 'page.jsx'));
    await copyDirectory(path.join(EXAMPLE_DIR, 'components'), path.join(targetDir, 'components'));
  } else {
    await fs.writeFile(path.join(targetDir, 'app', 'page.jsx'), buildApiOnlyPage(scaffoldOptions), 'utf8');
  }

  await copyDirectory(STARTER_API_DIR, path.join(targetDir, 'lib', 'model-catalog'), {
    ignore: new Set(['demoPage.html']),
  });

  const providerRegistry = await readJson(PROVIDER_REGISTRY_TEMPLATE);
  const overrides = await readJson(CATALOG_OVERRIDES_TEMPLATE);
  const filteredRegistry = {
    ...providerRegistry,
    providers: providerRegistry.providers.filter((provider) => scaffoldOptions.providerIds.includes(provider.providerId)),
  };
  const filteredOverrides = {
    ...overrides,
    providers: Object.fromEntries(
      Object.entries(overrides.providers || {}).filter(([providerId]) => scaffoldOptions.providerIds.includes(providerId)),
    ),
  };

  await writeJson(path.join(targetDir, 'assets', 'provider-registry.template.json'), filteredRegistry);
  await writeJson(path.join(targetDir, 'assets', 'catalog-overrides.template.json'), filteredOverrides);
  await copyFile(CATALOG_SCHEMA_TEMPLATE, path.join(targetDir, 'assets', 'model-catalog.schema.json'));
  await copyFile(SYNC_SCRIPT, path.join(targetDir, 'scripts', 'sync_model_catalog.mjs'));
  await copyFile(INIT_MODEL_ROUTING_SCRIPT, path.join(targetDir, 'scripts', 'init_model_routing_config.mjs'));

  await fs.writeFile(path.join(targetDir, '.gitignore'), buildGitIgnore(), 'utf8');
  await fs.writeFile(path.join(targetDir, '.env.example'), buildEnvExample(scaffoldOptions), 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    JSON.stringify(buildPackageJson(appName, scaffoldOptions), null, 2) + '\n',
    'utf8',
  );
  await fs.writeFile(path.join(targetDir, 'next.config.mjs'), buildNextConfig(), 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'app', 'api', 'model-catalog', '[[...route]]', 'route.js'),
    buildRouteFile(scaffoldOptions),
    'utf8',
  );
  await fs.writeFile(path.join(targetDir, 'README.md'), buildReadme(appName, scaffoldOptions), 'utf8');
  await writeJson(path.join(targetDir, 'model-catalog.starter.json'), {
    appName,
    createdAt: new Date().toISOString(),
    template: scaffoldOptions.template,
    providers: scaffoldOptions.providerIds,
    providersLabel: scaffoldOptions.providersLabel,
    deploy: scaffoldOptions.deploy,
    multiTenant: scaffoldOptions.multiTenant,
    apiAuth: scaffoldOptions.apiAuth,
    modelRoutingStrategy: 'openclaw-inspired',
  });

  if (scaffoldOptions.deploy === 'vercel') {
    await fs.writeFile(path.join(targetDir, 'vercel.json'), buildVercelConfig(), 'utf8');
  }

  if (scaffoldOptions.deploy === 'render') {
    await fs.writeFile(path.join(targetDir, 'render.yaml'), buildRenderBlueprint(appName, scaffoldOptions), 'utf8');
  }
}

async function resolveScaffoldOptions(args) {
  const providerRegistry = await readJson(PROVIDER_REGISTRY_TEMPLATE);
  const availableProviderIds = providerRegistry.providers.map((provider) => provider.providerId);
  const template = TEMPLATE_CHOICES.has(args.template) ? args.template : 'full';
  const deploy = DEPLOY_CHOICES.has(args.deploy) ? args.deploy : 'none';
  const providerResolution = resolveProviderIds(args.providers, availableProviderIds);

  return {
    template,
    deploy,
    apiAuth: Boolean(args.apiAuth),
    multiTenant: Boolean(args.multiTenant),
    providerIds: providerResolution.providerIds,
    providersLabel: providerResolution.label,
  };
}

function buildPackageJson(appName, scaffoldOptions) {
  const syncCommand = scaffoldOptions.providerIds.length
    ? `node scripts/sync_model_catalog.mjs --providers ${scaffoldOptions.providerIds.join(',')}`
    : 'node scripts/sync_model_catalog.mjs';

  return {
    name: appName,
    private: true,
    type: 'module',
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      'sync:catalog': syncCommand,
      'init:model-routing': 'node scripts/init_model_routing_config.mjs',
    },
    dependencies: {
      next: 'latest',
      react: 'latest',
      'react-dom': 'latest',
    },
  };
}

function buildRouteFile(scaffoldOptions) {
  return `import path from 'node:path';

import { createNextRouteHandlers } from '../../../../lib/model-catalog/index.mjs';

export const runtime = 'nodejs';

const rootDir = process.cwd();
const handlers = createNextRouteHandlers({
  rootDir,
  catalogPath: path.join(rootDir, 'output', 'model-catalog.generated.json'),
  modelRoutingConfigPath: path.join(rootDir, 'assets', 'model-routing.config.json'),
  jsonStatePath: path.join(rootDir, 'output', 'runtime-state.json'),
  sqlitePath: path.join(rootDir, 'output', 'runtime-state.sqlite'),
  tenantsRoot: path.join(rootDir, 'output', 'tenants'),
  syncScriptPath: path.join(rootDir, 'scripts', 'sync_model_catalog.mjs'),
  defaultTenantId: process.env.MODEL_CATALOG_DEFAULT_TENANT || '${scaffoldOptions.multiTenant ? 'team-a' : 'default'}',
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

function buildEnvExample(scaffoldOptions) {
  const lines = [
    'MODEL_CATALOG_SECRET=replace-me-for-production',
    `MODEL_CATALOG_DEFAULT_TENANT=${scaffoldOptions.multiTenant ? 'team-a' : 'default'}`,
  ];

  if (scaffoldOptions.apiAuth) {
    lines.push('MODEL_CATALOG_API_KEYS=team-a:replace-with-real-token');
  } else {
    lines.push('# MODEL_CATALOG_API_KEYS=team-a:replace-with-real-token');
  }

  lines.push('# MODEL_CATALOG_SECRET_SOURCE=embedded');
  lines.push('# MODEL_CATALOG_SECRET_FILE_ROOT=./secrets');

  return `${lines.join('\n')}\n`;
}

function buildReadme(appName, scaffoldOptions) {
  return `# ${appName}

This app was scaffolded from the Model Catalog Builder starter.

## Chosen options

- Template: ${scaffoldOptions.template}
- Provider preset: ${scaffoldOptions.providersLabel}
- Deploy target: ${scaffoldOptions.deploy}
- Multi-tenant runtime: ${scaffoldOptions.multiTenant ? 'enabled' : 'disabled'}
- API auth preset: ${scaffoldOptions.apiAuth ? 'enabled' : 'disabled'}

## Included providers

${scaffoldOptions.providerIds.map((providerId) => `- ${providerId}`).join('\n')}

## Commands

\`\`\`bash
npm install
npm run sync:catalog
npm run init:model-routing
npm run dev
\`\`\`

## Notes

- The starter API lives in \`lib/model-catalog/\`.
- The operator console lives at \`/admin\` in the full template.
- Provider definitions live in \`assets/provider-registry.template.json\`.
- Product rules live in \`assets/catalog-overrides.template.json\`.
- OpenClaw-style model routing lives in \`assets/model-routing.config.json\`.
- Generated catalog output is written to \`output/model-catalog.generated.json\`.
- The sync command is already pinned to the selected provider preset.
`;
}

function buildVercelConfig() {
  return `{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
`;
}

function buildRenderBlueprint(appName, scaffoldOptions) {
  return `services:
  - type: web
    name: ${appName}
    runtime: node
    plan: starter
    buildCommand: npm install && npm run build
    startCommand: npm run start -- --hostname 0.0.0.0 --port $PORT
    envVars:
      - key: NODE_VERSION
        value: 22
      - key: MODEL_CATALOG_SECRET
        sync: false
      - key: MODEL_CATALOG_DEFAULT_TENANT
        value: ${scaffoldOptions.multiTenant ? 'team-a' : 'default'}
${scaffoldOptions.apiAuth ? '      - key: MODEL_CATALOG_API_KEYS\n        sync: false\n' : ''}`;
}

function buildApiOnlyPage(scaffoldOptions) {
  return `const endpoints = [
  ['GET', '/api/model-catalog/providers'],
  ['GET', '/api/model-catalog/providers/:providerId/setup'],
  ['GET', '/api/model-catalog/providers/:providerId/models'],
  ['GET', '/api/model-catalog/config/model-routing'],
  ['PUT', '/api/model-catalog/config/model-routing'],
  ['POST', '/api/model-catalog/providers/:providerId/validate'],
  ['POST', '/api/model-catalog/providers/:providerId/connect'],
  ['POST', '/api/model-catalog/providers/:providerId/refresh'],
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">API Starter</p>
        <h1>Provider-first model catalog backend</h1>
        <p className="hero-copy">
          This starter was generated in api-only mode. You still get the full model catalog runtime,
          provider validation, credential storage, refresh orchestration, and normalized model API.
        </p>
      </section>

      <section className="content-panel">
        <div className="content-stack">
          <section className="panel">
            <div className="section-row">
              <div>
                <p className="eyebrow">Preset</p>
                <h2 className="section-heading">Generated configuration</h2>
              </div>
            </div>
            <div className="status-grid">
              <article className="status-card">
                <span className="status-label">Provider preset</span>
                <div className="status-value">${scaffoldOptions.providersLabel}</div>
              </article>
              <article className="status-card">
                <span className="status-label">Deploy target</span>
                <div className="status-value">${scaffoldOptions.deploy}</div>
              </article>
              <article className="status-card">
                <span className="status-label">Multi-tenant</span>
                <div className="status-value">${scaffoldOptions.multiTenant ? 'enabled' : 'disabled'}</div>
              </article>
              <article className="status-card">
                <span className="status-label">API auth</span>
                <div className="status-value">${scaffoldOptions.apiAuth ? 'enabled' : 'disabled'}</div>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="section-row">
              <div>
                <p className="eyebrow">Endpoints</p>
                <h2 className="section-heading">Starter API surface</h2>
              </div>
            </div>
            <div className="model-grid">
              {endpoints.map(([method, endpoint]) => (
                <article className="model-card" key={endpoint}>
                  <strong>{endpoint}</strong>
                  <span className="inline-code">{method}</span>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
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
    template: 'full',
    providers: 'global',
    deploy: 'none',
    apiAuth: false,
    multiTenant: false,
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

    if (arg === '--template') {
      parsed.template = argv[index + 1] || parsed.template;
      index += 1;
      continue;
    }

    if (arg === '--providers') {
      parsed.providers = argv[index + 1] || parsed.providers;
      index += 1;
      continue;
    }

    if (arg === '--deploy') {
      parsed.deploy = argv[index + 1] || parsed.deploy;
      index += 1;
      continue;
    }

    if (arg === '--api-auth') {
      parsed.apiAuth = true;
      continue;
    }

    if (arg === '--multi-tenant') {
      parsed.multiTenant = true;
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

function resolveProviderIds(rawValue, availableProviderIds) {
  const value = String(rawValue || 'global').trim();
  const presetIds = PROVIDER_PRESETS[value];
  if (presetIds) {
    return {
      label: value,
      providerIds: presetIds.filter((providerId) => availableProviderIds.includes(providerId)),
    };
  }

  if (value === 'all') {
    return {
      label: 'all',
      providerIds: [...availableProviderIds],
    };
  }

  const providerIds = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const unknownProviderIds = providerIds.filter((providerId) => !availableProviderIds.includes(providerId));
  if (unknownProviderIds.length > 0) {
    throw new Error(`Unknown provider IDs: ${unknownProviderIds.join(', ')}`);
  }

  if (providerIds.length === 0) {
    throw new Error('At least one provider must be selected.');
  }

  return {
    label: 'custom',
    providerIds,
  };
}

function sanitizePackageName(value) {
  return String(value || 'model-catalog-app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model-catalog-app';
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
