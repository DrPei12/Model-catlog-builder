#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const { buildDefaultModelRoutingConfig } = await loadModelRoutingModule();

const args = parseArgs(process.argv.slice(2));
const catalogPath = path.resolve(args.catalog || path.join(ROOT_DIR, 'output', 'model-catalog.generated.json'));
const outputPath = path.resolve(args.output || path.join(ROOT_DIR, 'assets', 'model-routing.config.json'));

const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const providerIds = args.providers
  ? args.providers
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : null;

const config = buildDefaultModelRoutingConfig(catalog, {
  providerIds,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`Wrote model routing config to ${outputPath}`);
console.log(`  primary: ${config.agents.defaults.model.primary || 'none'}`);
console.log(`  fallbacks: ${config.agents.defaults.model.fallbacks.length}`);
console.log(`  allowlist models: ${config.agents.defaults.models.length}`);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog') {
      parsed.catalog = argv[index + 1] || parsed.catalog;
      index += 1;
      continue;
    }

    if (arg === '--output') {
      parsed.output = argv[index + 1] || parsed.output;
      index += 1;
      continue;
    }

    if (arg === '--providers') {
      parsed.providers = argv[index + 1] || parsed.providers;
      index += 1;
    }
  }

  return parsed;
}

async function loadModelRoutingModule() {
  const candidatePaths = [
    path.join(ROOT_DIR, 'assets', 'starter-api', 'modelRoutingConfigService.mjs'),
    path.join(ROOT_DIR, 'lib', 'model-catalog', 'modelRoutingConfigService.mjs'),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(candidatePath);
      return import(pathToFileURL(candidatePath).href);
    } catch {
      // keep searching
    }
  }

  throw new Error('Could not find modelRoutingConfigService.mjs in either assets/starter-api or lib/model-catalog.');
}
