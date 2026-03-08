#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUTPUT = path.resolve(process.cwd(), 'output', 'model-catalog.generated.json');
const DEFAULT_REGISTRY = path.resolve(process.cwd(), 'assets', 'provider-registry.template.json');
const DEFAULT_OVERRIDES = path.resolve(process.cwd(), 'assets', 'catalog-overrides.template.json');

const SOURCE_PRIORITY = {
  registry: 100,
  'official-openai': 95,
  'official-anthropic': 95,
  'official-google': 95,
  'models.dev': 80,
  openrouter: 70,
  'vercel-ai-gateway': 70,
  litellm: 50,
};

const PROVIDER_ALIASES = new Map([
  ['openai', 'openai'],
  ['anthropic', 'anthropic'],
  ['google', 'google'],
  ['google-ai', 'google'],
  ['google-ai-studio', 'google'],
  ['gemini', 'google'],
  ['vertex', 'google-vertex'],
  ['vertex-ai', 'google-vertex'],
  ['alibaba', 'qwen'],
  ['qwen', 'qwen'],
  ['minimax', 'minimax'],
  ['moonshot', 'moonshot'],
  ['kimi', 'moonshot'],
  ['azure', 'azure-openai'],
  ['azure_ai', 'azure-openai'],
  ['azure-openai', 'azure-openai'],
  ['bedrock', 'aws-bedrock'],
  ['amazon-bedrock', 'aws-bedrock'],
  ['openrouter', 'openrouter'],
  ['vercel', 'vercel-ai-gateway'],
  ['vercel-ai-gateway', 'vercel-ai-gateway'],
  ['custom-provider', 'openai-compatible'],
]);

const args = parseArgs(process.argv.slice(2));
const filterProviders = new Set((args.providers || '').split(',').map((item) => item.trim()).filter(Boolean));

const providerRegistry = await readJsonIfExists(args.registry || DEFAULT_REGISTRY, { providers: [] });
const overrides = await readJsonIfExists(args.overrides || DEFAULT_OVERRIDES, { providers: {} });

const catalog = createCatalog(providerRegistry);
const sourceStatus = {};

const sourceTasks = [
  ...buildOfficialSourceTasks(filterProviders, sourceStatus),
  fetchJson('models.dev', 'https://models.dev/api.json'),
  fetchJson('openrouter', 'https://openrouter.ai/api/v1/models'),
  fetchJson('vercel-ai-gateway', 'https://ai-gateway.vercel.sh/v1/models'),
  fetchJson('litellm', 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'),
];

const sourceResults = await Promise.allSettled(sourceTasks);

for (const result of sourceResults) {
  if (result.status === 'fulfilled') {
    sourceStatus[result.value.name] = {
      status: 'ok',
      fetchedAt: new Date().toISOString(),
    };
    ingestSource(catalog, result.value.name, result.value.data, filterProviders);
  } else {
    sourceStatus[result.reason.sourceName || 'unknown'] = {
      status: 'error',
      error: result.reason.message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

applyOverrides(catalog, overrides);
finalizeProviders(catalog, filterProviders);

const output = {
  generatedAt: new Date().toISOString(),
  sourceStatus,
  providers: [...catalog.values()]
    .filter((provider) => !filterProviders.size || filterProviders.has(provider.providerId))
    .map(serializeProvider)
    .sort((left, right) => left.displayName.localeCompare(right.displayName)),
};

await fs.mkdir(path.dirname(args.output || DEFAULT_OUTPUT), { recursive: true });
await fs.writeFile(
  args.output || DEFAULT_OUTPUT,
  JSON.stringify(output, null, args.pretty === false ? 0 : 2) + '\n',
  'utf8',
);

console.log(`Wrote ${output.providers.length} providers to ${args.output || DEFAULT_OUTPUT}`);

function parseArgs(argv) {
  const parsed = {
    output: DEFAULT_OUTPUT,
    registry: DEFAULT_REGISTRY,
    overrides: DEFAULT_OVERRIDES,
    pretty: true,
    providers: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      parsed.output = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--registry') {
      parsed.registry = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--overrides') {
      parsed.overrides = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--providers') {
      parsed.providers = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--compact') {
      parsed.pretty = false;
    }
  }

  return parsed;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function fetchJson(sourceName, url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'llm-model-catalog-builder',
    },
  });

  if (!response.ok) {
    const error = new Error(`${sourceName} request failed with ${response.status}`);
    error.sourceName = sourceName;
    throw error;
  }

  return {
    name: sourceName,
    data: await response.json(),
  };
}

function buildOfficialSourceTasks(filterProvidersSet, sourceStatusMap) {
  const officialSources = [
    {
      sourceName: 'official-openai',
      providerId: 'openai',
      envVar: 'OPENAI_API_KEY',
      fetcher: fetchOpenAiModels,
    },
    {
      sourceName: 'official-anthropic',
      providerId: 'anthropic',
      envVar: 'ANTHROPIC_API_KEY',
      fetcher: fetchAnthropicModels,
    },
    {
      sourceName: 'official-google',
      providerId: 'google',
      envVar: 'GEMINI_API_KEY',
      fetcher: fetchGeminiModels,
    },
  ];

  const tasks = [];

  for (const source of officialSources) {
    if (shouldSkipProvider(source.providerId, filterProvidersSet)) {
      sourceStatusMap[source.sourceName] = {
        status: 'skipped',
        reason: 'provider filtered out',
        fetchedAt: new Date().toISOString(),
      };
      continue;
    }

    if (!process.env[source.envVar]) {
      sourceStatusMap[source.sourceName] = {
        status: 'skipped',
        reason: `missing env ${source.envVar}`,
        fetchedAt: new Date().toISOString(),
      };
      continue;
    }

    tasks.push(source.fetcher(process.env[source.envVar]));
  }

  return tasks;
}

async function fetchOpenAiModels(apiKey) {
  const response = await fetch('https://api.openai.com/v1/models', {
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'llm-model-catalog-builder',
    },
  });

  if (!response.ok) {
    const error = new Error(`official-openai request failed with ${response.status}`);
    error.sourceName = 'official-openai';
    throw error;
  }

  return {
    name: 'official-openai',
    data: await response.json(),
  };
}

async function fetchAnthropicModels(apiKey) {
  const data = [];
  let afterId = '';

  while (true) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('beta', 'true');
    if (afterId) {
      url.searchParams.set('after_id', afterId);
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'llm-model-catalog-builder',
      },
    });

    if (!response.ok) {
      const error = new Error(`official-anthropic request failed with ${response.status}`);
      error.sourceName = 'official-anthropic';
      throw error;
    }

    const payload = await response.json();
    data.push(...(payload.data || []));

    if (!payload.has_more || !payload.last_id) {
      break;
    }

    afterId = payload.last_id;
  }

  return {
    name: 'official-anthropic',
    data: { data },
  };
}

async function fetchGeminiModels(apiKey) {
  const models = [];
  let pageToken = '';

  while (true) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': 'llm-model-catalog-builder',
      },
    });

    if (!response.ok) {
      const error = new Error(`official-google request failed with ${response.status}`);
      error.sourceName = 'official-google';
      throw error;
    }

    const payload = await response.json();
    models.push(...(payload.models || []));

    if (!payload.nextPageToken) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  return {
    name: 'official-google',
    data: { models },
  };
}

function createCatalog(registry) {
  const providers = new Map();
  for (const entry of registry.providers || []) {
    const providerId = normalizeProviderId(entry.providerId);
    if (!providerId) {
      continue;
    }
    providers.set(providerId, {
      providerId,
      displayName: entry.displayName || titleCase(providerId),
      auth: entry.auth || null,
      discovery: entry.discovery || null,
      notes: entry.notes || null,
      registryLocked: true,
      models: new Map(),
      collections: createEmptyCollections(),
      officialSources: new Set(),
      sources: new Set(['registry']),
    });
  }
  return providers;
}

function createEmptyCollections() {
  return {
    recommendedIds: [],
    autoRecommendedIds: [],
    latestIds: [],
    previewIds: [],
    deprecatedIds: [],
    hiddenIds: [],
  };
}

function ingestSource(catalog, sourceName, data, filterProvidersSet) {
  if (sourceName === 'official-openai') {
    ingestOfficialOpenAi(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'official-anthropic') {
    ingestOfficialAnthropic(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'official-google') {
    ingestOfficialGoogle(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'models.dev') {
    ingestModelsDev(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'openrouter') {
    ingestOpenRouter(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'vercel-ai-gateway') {
    ingestVercel(catalog, data, filterProvidersSet);
    return;
  }

  if (sourceName === 'litellm') {
    ingestLiteLlm(catalog, data, filterProvidersSet);
  }
}

function ingestOfficialOpenAi(catalog, data, filterProvidersSet) {
  const providerId = 'openai';
  if (shouldSkipProvider(providerId, filterProvidersSet)) {
    return;
  }

  const provider = ensureProvider(catalog, {
    providerId,
    displayName: 'OpenAI',
    sourceName: 'official-openai',
  });

  for (const model of data.data || []) {
    const modelId = model.id;
    const stage = detectStage({ id: modelId });

    upsertModel(provider, modelId, {
      displayName: humanizeModelId(modelId),
      family: deriveFamily(modelId),
      vendorId: normalizeProviderId(model.owned_by),
      stage,
      releaseDate: normalizeTimestamp(model.created),
      lastUpdated: normalizeTimestamp(model.created),
      capabilities: inferCapabilitiesFromId(modelId),
      tags: buildTags({
        id: modelId,
        name: modelId,
        stage,
      }),
    }, 'official-openai');
  }
}

function ingestOfficialAnthropic(catalog, data, filterProvidersSet) {
  const providerId = 'anthropic';
  if (shouldSkipProvider(providerId, filterProvidersSet)) {
    return;
  }

  const provider = ensureProvider(catalog, {
    providerId,
    displayName: 'Anthropic',
    sourceName: 'official-anthropic',
  });

  for (const model of data.data || []) {
    const modelId = model.id;
    const stage = detectStage({
      id: modelId,
      name: model.display_name,
    });

    upsertModel(provider, modelId, {
      displayName: model.display_name || humanizeModelId(modelId),
      family: deriveFamily(modelId),
      stage,
      releaseDate: normalizeDate(model.created_at),
      lastUpdated: normalizeDate(model.created_at),
      capabilities: inferCapabilitiesFromId(modelId),
      tags: buildTags({
        id: modelId,
        name: model.display_name,
        stage,
      }),
    }, 'official-anthropic');
  }
}

function ingestOfficialGoogle(catalog, data, filterProvidersSet) {
  const providerId = 'google';
  if (shouldSkipProvider(providerId, filterProvidersSet)) {
    return;
  }

  const provider = ensureProvider(catalog, {
    providerId,
    displayName: 'Google Gemini',
    sourceName: 'official-google',
  });

  for (const model of data.models || []) {
    const modelId = (model.baseModelId || model.name || '').replace(/^models\//, '');
    if (!modelId) {
      continue;
    }

    const stage = detectStage({
      id: modelId,
      name: model.displayName,
      tags: model.supportedGenerationMethods || [],
    });

    upsertModel(provider, modelId, {
      displayName: model.displayName || humanizeModelId(modelId),
      family: deriveFamily(modelId),
      stage,
      contextWindow: model.inputTokenLimit ?? null,
      maxOutputTokens: model.outputTokenLimit ?? null,
      capabilities: buildCapabilities({
        modalities: inferGeminiModalities(model),
        supportedParameters: model.supportedGenerationMethods,
        family: deriveFamily(modelId),
      }),
      tags: buildTags({
        id: modelId,
        name: model.displayName,
        extraTags: model.supportedGenerationMethods || [],
        stage,
      }),
    }, 'official-google');
  }
}

function ingestModelsDev(catalog, data, filterProvidersSet) {
  for (const [providerKey, providerData] of Object.entries(data)) {
    if (!providerData || typeof providerData !== 'object' || !providerData.models) {
      continue;
    }

    const providerId = normalizeProviderId(providerData.id || providerKey);
    if (!providerId || shouldSkipProvider(providerId, filterProvidersSet)) {
      continue;
    }

    const provider = ensureProvider(catalog, {
      providerId,
      displayName: providerData.name || titleCase(providerId),
      sourceName: 'models.dev',
    });

    for (const model of Object.values(providerData.models)) {
      if (!model || typeof model !== 'object') {
        continue;
      }

      const stage = detectStage({
        id: model.id,
        name: model.name,
      });

      upsertModel(provider, model.id, {
        displayName: model.name || model.id,
        family: model.family || deriveFamily(model.id),
        stage,
        releaseDate: normalizeDate(model.release_date),
        lastUpdated: normalizeDate(model.last_updated),
        contextWindow: model.limit?.context ?? null,
        maxOutputTokens: model.limit?.output ?? null,
        capabilities: buildCapabilities({
          modalities: model.modalities,
          reasoning: model.reasoning,
          toolCall: model.tool_call,
          structuredOutput: model.structured_output,
          attachment: model.attachment,
          family: model.family,
        }),
        pricing: normalizePricing({
          sourceName: 'models.dev',
          input: model.cost?.input,
          output: model.cost?.output,
          cacheRead: model.cost?.cache_read,
        }),
        modalities: model.modalities || null,
        tags: buildTags({
          id: model.id,
          name: model.name,
          stage,
        }),
      }, 'models.dev');
    }
  }
}

function ingestOpenRouter(catalog, data, filterProvidersSet) {
  const providerId = 'openrouter';
  if (shouldSkipProvider(providerId, filterProvidersSet)) {
    return;
  }

  const provider = ensureProvider(catalog, {
    providerId,
    displayName: 'OpenRouter',
    sourceName: 'openrouter',
  });

  for (const model of data.data || []) {
    const modelId = model.canonical_slug || model.id;
    const stage = detectStage({
      id: modelId,
      name: model.name,
      expirationDate: model.expiration_date,
    });

    upsertModel(provider, modelId, {
      displayName: model.name || modelId,
      family: deriveFamily(modelId),
      vendorId: normalizeProviderId((model.id || '').split('/')[0] || model.owned_by),
      stage,
      releaseDate: normalizeTimestamp(model.created),
      lastUpdated: normalizeTimestamp(model.created),
      contextWindow: model.context_length ?? null,
      maxOutputTokens: model.top_provider?.max_completion_tokens ?? null,
      capabilities: buildCapabilities({
        modalities: model.architecture
          ? {
              input: model.architecture.input_modalities,
              output: model.architecture.output_modalities,
            }
          : null,
        supportedParameters: model.supported_parameters,
      }),
      pricing: normalizePricing({
        sourceName: 'openrouter',
        input: model.pricing?.prompt,
        output: model.pricing?.completion,
      }),
      modalities: model.architecture
        ? {
            input: model.architecture.input_modalities || [],
            output: model.architecture.output_modalities || [],
          }
        : null,
      tags: buildTags({
        id: modelId,
        name: model.name,
        stage,
      }),
    }, 'openrouter');
  }
}

function ingestVercel(catalog, data, filterProvidersSet) {
  const providerId = 'vercel-ai-gateway';
  if (shouldSkipProvider(providerId, filterProvidersSet)) {
    return;
  }

  const provider = ensureProvider(catalog, {
    providerId,
    displayName: 'Vercel AI Gateway',
    sourceName: 'vercel-ai-gateway',
  });

  for (const model of data.data || []) {
    const stage = detectStage({
      id: model.id,
      name: model.name,
      tags: model.tags,
    });

    upsertModel(provider, model.id, {
      displayName: model.name || model.id,
      family: deriveFamily(model.id),
      vendorId: normalizeProviderId(model.owned_by || model.id.split('/')[0]),
      stage,
      releaseDate: normalizeTimestamp(model.released || model.created),
      lastUpdated: normalizeTimestamp(model.created),
      contextWindow: model.context_window ?? null,
      maxOutputTokens: model.max_tokens ?? null,
      capabilities: buildCapabilities({
        modalities: {
          input: model.type === 'language' ? ['text'] : [model.type || 'text'],
          output: model.type === 'language' ? ['text'] : [model.type || 'text'],
        },
        supportedParameters: model.tags,
        family: deriveFamily(model.id),
      }),
      pricing: normalizePricing({
        sourceName: 'vercel-ai-gateway',
        input: model.pricing?.input,
        output: model.pricing?.output,
      }),
      tags: buildTags({
        id: model.id,
        name: model.name,
        extraTags: model.tags,
        stage,
      }),
    }, 'vercel-ai-gateway');
  }
}

function ingestLiteLlm(catalog, data, filterProvidersSet) {
  for (const [rawKey, model] of Object.entries(data)) {
    if (!model || typeof model !== 'object' || rawKey === 'sample_spec') {
      continue;
    }

    const providerId = normalizeProviderId(model.litellm_provider || rawKey.split('/')[0]);
    if (!providerId || shouldSkipProvider(providerId, filterProvidersSet)) {
      continue;
    }

    const provider = ensureProvider(catalog, {
      providerId,
      displayName: titleCase(providerId),
      sourceName: 'litellm',
    });

    const modelId = normalizeLiteLlmModelId(providerId, rawKey);
    const stage = detectStage({
      id: modelId,
      name: rawKey,
      deprecationDate: model.deprecation_date,
    });

    upsertModel(provider, modelId, {
      displayName: rawKey,
      family: deriveFamily(modelId),
      stage,
      releaseDate: normalizeDate(model.created_at),
      lastUpdated: normalizeDate(model.updated_at || model.deprecation_date),
      contextWindow: model.max_input_tokens ?? null,
      maxOutputTokens: model.max_output_tokens ?? model.max_tokens ?? null,
      capabilities: buildCapabilities({
        modalities: {
          input: model.supports_vision ? ['text', 'image'] : ['text'],
          output: ['text'],
        },
        toolCall: model.supports_function_calling,
        structuredOutput: model.supports_response_schema,
      }),
      pricing: normalizePricing({
        sourceName: 'litellm',
        input: model.input_cost_per_token,
        output: model.output_cost_per_token,
        cacheRead: model.cache_read_input_token_cost,
      }),
      tags: buildTags({
        id: modelId,
        name: rawKey,
        stage,
      }),
    }, 'litellm');
  }
}

function applyOverrides(catalog, overrides) {
  for (const [providerIdRaw, providerOverride] of Object.entries(overrides.providers || {})) {
    const providerId = normalizeProviderId(providerIdRaw);
    const provider = ensureProvider(catalog, {
      providerId,
      displayName: titleCase(providerId),
      sourceName: 'registry',
    });

    for (const modelId of providerOverride.recommendedModelIds || []) {
      const model = ensureModel(provider, modelId);
      model.recommended = true;
    }

    for (const modelId of providerOverride.hiddenModelIds || []) {
      const model = ensureModel(provider, modelId);
      model.hidden = true;
    }

    for (const [aliasId, pinnedTarget] of Object.entries(providerOverride.pinnedAliases || {})) {
      const model = ensureModel(provider, aliasId);
      model.pinnedTargetModelId = pinnedTarget;
      addTag(model, 'pinned-alias');
    }

    for (const [modelId, modelOverride] of Object.entries(providerOverride.models || {})) {
      const model = ensureModel(provider, modelId);
      if (modelOverride.displayName) {
        model.displayName = modelOverride.displayName;
      }
      if (typeof modelOverride.recommended === 'boolean') {
        model.recommended = modelOverride.recommended;
      }
      if (typeof modelOverride.hidden === 'boolean') {
        model.hidden = modelOverride.hidden;
      }
      if (modelOverride.stage) {
        model.stage = modelOverride.stage;
      }
      if (Array.isArray(modelOverride.tags)) {
        model.tags = mergeUnique(model.tags, modelOverride.tags);
      }
    }
  }
}

function finalizeProviders(catalog, filterProvidersSet) {
  for (const provider of catalog.values()) {
    if (shouldSkipProvider(provider.providerId, filterProvidersSet)) {
      continue;
    }

    const models = [...provider.models.values()];
    const families = new Map();

    for (const model of models) {
      if (!model.family) {
        continue;
      }
      if (!families.has(model.family)) {
        families.set(model.family, []);
      }
      families.get(model.family).push(model);
    }

    for (const familyModels of families.values()) {
      const stableModels = familyModels
        .filter((model) => {
          if (model.stage !== 'stable' || !model.releaseDate) {
            return false;
          }

          if (provider.officialSources.size > 0) {
            return hasOfficialSource(model);
          }

          return true;
        })
        .sort((left, right) => (right.releaseDate || '').localeCompare(left.releaseDate || ''));

      if (stableModels.length > 0) {
        stableModels[0].isLatestStableRelease = true;
        addTag(stableModels[0], 'latest');
      }
    }

    const sortedModels = models.sort(compareModels);
    provider.collections = {
      recommendedIds: sortedModels.filter((model) => model.recommended && !model.hidden).map((model) => model.modelId),
      autoRecommendedIds: sortedModels
        .filter((model) => {
          if (model.recommended || !model.isLatestStableRelease || model.stage !== 'stable' || model.hidden) {
            return false;
          }

          if (provider.officialSources.size > 0) {
            return hasOfficialSource(model);
          }

          return true;
        })
        .slice(0, 5)
        .map((model) => model.modelId),
      latestIds: sortedModels
        .filter((model) => {
          if (!(model.isLatestAlias || model.isLatestStableRelease) || model.hidden) {
            return false;
          }

          if (provider.officialSources.size > 0) {
            return hasOfficialSource(model);
          }

          return true;
        })
        .slice(0, 20)
        .map((model) => model.modelId),
      previewIds: sortedModels.filter((model) => model.stage === 'preview').map((model) => model.modelId),
      deprecatedIds: sortedModels.filter((model) => model.stage === 'deprecated').map((model) => model.modelId),
      hiddenIds: sortedModels.filter((model) => model.hidden).map((model) => model.modelId),
    };
  }
}

function serializeProvider(provider) {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    auth: provider.auth,
    discovery: provider.discovery,
    collections: provider.collections,
    availabilitySource: provider.officialSources.size > 0 ? 'official-plus-public' : 'public-catalog',
    officialSources: [...provider.officialSources].sort(),
    sources: [...provider.sources].sort(),
    modelCount: provider.models.size,
    models: [...provider.models.values()].sort(compareModels).map(serializeModel),
  };
}

function serializeModel(model) {
  const {
    _fieldPriority,
    modelId,
    displayName,
    family,
    vendorId = null,
    stage = 'stable',
    releaseDate = null,
    lastUpdated = null,
    contextWindow = null,
    maxOutputTokens = null,
    capabilities = [],
    pricing = null,
    modalities = null,
    tags = [],
    recommended = false,
    hidden = false,
    sources = [],
    isLatestAlias = false,
    isLatestStableRelease = false,
    pinnedTargetModelId = null,
  } = model;

  return {
    modelId,
    displayName,
    family,
    vendorId,
    stage,
    releaseDate,
    lastUpdated,
    contextWindow,
    maxOutputTokens,
    capabilities: [...capabilities].sort(),
    pricing,
    modalities,
    tags: [...tags].sort(),
    recommended,
    hidden,
    availabilityConfidence: inferAvailabilityConfidence(model),
    isLatestAlias,
    isLatestStableRelease,
    pinnedTargetModelId,
    sources: [...sources].sort(),
  };
}

function ensureProvider(catalog, { providerId, displayName, sourceName }) {
  if (!catalog.has(providerId)) {
    catalog.set(providerId, {
      providerId,
      displayName: displayName || titleCase(providerId),
      auth: null,
      discovery: null,
      models: new Map(),
      collections: createEmptyCollections(),
      officialSources: new Set(),
      sources: new Set(),
    });
  }

  const provider = catalog.get(providerId);
  if (
    displayName &&
    !provider.registryLocked &&
    (!provider.displayName || provider.displayName === titleCase(provider.providerId))
  ) {
    provider.displayName = displayName;
  }
  if (sourceName.startsWith('official-')) {
    provider.officialSources.add(sourceName);
  }
  provider.sources.add(sourceName);
  return provider;
}

function ensureModel(provider, modelId) {
  if (!provider.models.has(modelId)) {
    provider.models.set(modelId, {
      modelId,
      displayName: modelId,
      family: deriveFamily(modelId),
      stage: detectStage({ id: modelId }),
      capabilities: [],
      tags: [],
      sources: [],
      recommended: false,
      hidden: false,
      _fieldPriority: {},
    });
  }
  return provider.models.get(modelId);
}

function upsertModel(provider, modelId, partial, sourceName) {
  const model = ensureModel(provider, modelId);
  const priority = SOURCE_PRIORITY[sourceName] ?? 0;

  setField(model, 'displayName', partial.displayName, priority);
  setField(model, 'family', partial.family, priority);
  setField(model, 'vendorId', partial.vendorId, priority);
  setField(model, 'stage', partial.stage, priority);
  setField(model, 'releaseDate', partial.releaseDate, priority);
  setField(model, 'lastUpdated', partial.lastUpdated, priority);
  setField(model, 'contextWindow', partial.contextWindow, priority);
  setField(model, 'maxOutputTokens', partial.maxOutputTokens, priority);
  setField(model, 'pricing', partial.pricing, priority);
  setField(model, 'modalities', partial.modalities, priority);

  model.capabilities = mergeUnique(model.capabilities, partial.capabilities || []);
  model.tags = mergeUnique(model.tags, partial.tags || []);
  model.sources = mergeUnique(model.sources, [sourceName]);
  model.isLatestAlias = model.isLatestAlias || hasLatestKeyword(modelId) || hasLatestKeyword(partial.displayName);

  if (model.isLatestAlias) {
    addTag(model, 'latest');
  }
}

function setField(model, field, value, priority) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  const currentPriority = model._fieldPriority[field] ?? -1;
  if (currentPriority <= priority || model[field] === undefined || model[field] === null || model[field] === '') {
    model[field] = value;
    model._fieldPriority[field] = priority;
  }
}

function buildCapabilities({ modalities, reasoning, toolCall, structuredOutput, attachment, supportedParameters, family }) {
  const capabilities = [];
  const inputModalities = modalities?.input || [];
  const outputModalities = modalities?.output || [];
  const parameters = (supportedParameters || []).map((item) => String(item).toLowerCase());
  const combined = [...inputModalities, ...outputModalities].map((item) => String(item).toLowerCase());

  if (combined.includes('image')) {
    capabilities.push('vision');
  }
  if (combined.includes('audio')) {
    capabilities.push('audio');
  }
  if (combined.includes('file') || combined.includes('pdf') || attachment) {
    capabilities.push('file-input');
  }
  if (reasoning || parameters.includes('reasoning') || parameters.includes('include_reasoning')) {
    capabilities.push('reasoning');
  }
  if (toolCall || parameters.includes('tools') || parameters.includes('tool_choice') || parameters.includes('tool-use')) {
    capabilities.push('tools');
  }
  if (structuredOutput || parameters.includes('structured_outputs') || parameters.includes('response_format')) {
    capabilities.push('structured-output');
  }
  if (String(family || '').includes('embed') || parameters.includes('embedcontent')) {
    capabilities.push('embeddings');
  }
  if (combined.includes('image') && outputModalities.map((item) => String(item).toLowerCase()).includes('image')) {
    capabilities.push('image-generation');
  }

  return capabilities;
}

function buildTags({ id, name, stage, extraTags = [] }) {
  const tags = [];
  if (hasLatestKeyword(id) || hasLatestKeyword(name)) {
    tags.push('latest');
  }
  if (stage === 'preview') {
    tags.push('preview');
  }
  if (stage === 'deprecated') {
    tags.push('deprecated');
  }
  for (const tag of extraTags) {
    tags.push(String(tag).toLowerCase());
  }
  return [...new Set(tags)];
}

function detectStage({ id = '', name = '', tags = [], deprecationDate, expirationDate }) {
  const haystack = [id, name, ...tags].join(' ').toLowerCase();
  const deprecatedWords = ['deprecated', 'legacy', 'retired', 'sunset'];
  const previewWords = ['preview', 'beta', 'experimental', 'exp', 'alpha'];

  if (deprecatedWords.some((word) => haystack.includes(word))) {
    return 'deprecated';
  }

  if (expirationDate && new Date(expirationDate).getTime() < Date.now()) {
    return 'deprecated';
  }

  if (previewWords.some((word) => haystack.includes(word))) {
    return 'preview';
  }

  if (deprecationDate && new Date(deprecationDate).getTime() < Date.now()) {
    return 'deprecated';
  }

  return 'stable';
}

function normalizePricing({ sourceName, input, output, cacheRead }) {
  const normalized = {
    unit: 'usd_per_1m_tokens',
  };

  const multiplier = sourceName === 'models.dev' ? 1 : 1000000;
  if (input !== undefined && input !== null && input !== '') {
    normalized.inputUsdPer1M = roundNumber(Number(input) * multiplier);
  }
  if (output !== undefined && output !== null && output !== '') {
    normalized.outputUsdPer1M = roundNumber(Number(output) * multiplier);
  }
  if (cacheRead !== undefined && cacheRead !== null && cacheRead !== '') {
    normalized.cacheReadUsdPer1M = roundNumber(Number(cacheRead) * multiplier);
  }

  if (Object.keys(normalized).length === 1) {
    return null;
  }

  return normalized;
}

function normalizeProviderId(value) {
  if (!value) {
    return '';
  }

  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return PROVIDER_ALIASES.get(cleaned) || cleaned;
}

function normalizeLiteLlmModelId(providerId, rawKey) {
  const parts = rawKey.split('/');
  if (parts.length === 1) {
    return rawKey;
  }

  const firstPart = normalizeProviderId(parts[0]);
  if (firstPart === providerId || providerId === 'azure-openai') {
    return parts[parts.length - 1];
  }

  return rawKey;
}

function deriveFamily(modelId) {
  return String(modelId)
    .split('/')
    .pop()
    .toLowerCase()
    .replace(/-latest$/g, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/g, '')
    .replace(/-\d{6,8}$/g, '')
    .replace(/-(preview|beta|exp|experimental)$/g, '')
    .replace(/-\d{4,}$/g, '')
    .replace(/-v\d+(:\d+)?$/g, '')
    .trim();
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function inferGeminiModalities(model) {
  const methods = (model.supportedGenerationMethods || []).map((item) => String(item).toLowerCase());
  const name = `${model.name || ''} ${model.displayName || ''}`.toLowerCase();
  const input = ['text'];
  const output = ['text'];

  if (name.includes('vision') || name.includes('image')) {
    input.push('image');
  }
  if (methods.includes('embedcontent')) {
    output.push('embedding');
  }

  return {
    input: [...new Set(input)],
    output: [...new Set(output)],
  };
}

function inferCapabilitiesFromId(modelId) {
  const id = String(modelId || '').toLowerCase();
  const capabilities = [];

  if (id.includes('embed')) {
    capabilities.push('embeddings');
  }
  if (id.includes('vision') || id.includes('image') || id.includes('4o')) {
    capabilities.push('vision');
  }
  if (id.includes('audio') || id.includes('transcribe') || id.includes('tts') || id.includes('realtime')) {
    capabilities.push('audio');
  }
  if (id.startsWith('o') || id.includes('reason') || id.includes('think')) {
    capabilities.push('reasoning');
  }
  if (id.includes('gpt-') || id.includes('claude') || id.includes('gemini')) {
    capabilities.push('tools');
  }

  return [...new Set(capabilities)];
}

function humanizeModelId(modelId) {
  return String(modelId)
    .replace(/^models\//, '')
    .split(/[-/]/g)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)?$/.test(part) || /^[a-z]\d/i.test(part) || part === part.toUpperCase()) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function hasLatestKeyword(value) {
  return String(value || '').toLowerCase().includes('latest');
}

function mergeUnique(left, right) {
  return [...new Set([...(left || []), ...(right || [])].filter(Boolean))];
}

function addTag(model, tag) {
  model.tags = mergeUnique(model.tags, [tag]);
}

function hasOfficialSource(model) {
  return (model.sources || []).some((source) => String(source).startsWith('official-'));
}

function inferAvailabilityConfidence(model) {
  if (hasOfficialSource(model)) {
    return 'official';
  }
  if ((model.sources || []).length > 1) {
    return 'mixed-public';
  }
  return 'public-only';
}

function shouldSkipProvider(providerId, filterProvidersSet) {
  return filterProvidersSet.size > 0 && !filterProvidersSet.has(providerId);
}

function compareModels(left, right) {
  if (left.hidden !== right.hidden) {
    return Number(left.hidden) - Number(right.hidden);
  }
  if (left.recommended !== right.recommended) {
    return Number(right.recommended) - Number(left.recommended);
  }
  if ((left.isLatestAlias || left.isLatestStableRelease) !== (right.isLatestAlias || right.isLatestStableRelease)) {
    return Number(right.isLatestAlias || right.isLatestStableRelease) - Number(left.isLatestAlias || left.isLatestStableRelease);
  }

  const leftStageScore = stageScore(left.stage);
  const rightStageScore = stageScore(right.stage);
  if (leftStageScore !== rightStageScore) {
    return rightStageScore - leftStageScore;
  }

  if ((left.releaseDate || '') !== (right.releaseDate || '')) {
    return (right.releaseDate || '').localeCompare(left.releaseDate || '');
  }

  return left.displayName.localeCompare(right.displayName);
}

function stageScore(stage) {
  if (stage === 'stable') {
    return 3;
  }
  if (stage === 'preview') {
    return 2;
  }
  if (stage === 'deprecated') {
    return 1;
  }
  return 0;
}

function titleCase(value) {
  return String(value)
    .split(/[-/]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function roundNumber(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 10000) / 10000;
}
