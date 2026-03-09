import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_NOTES = [
  'Model refs use provider/model so provider setup and model choice stay separate.',
  'agents.defaults.models acts as the picker allowlist shown to end users.',
  'auth.profiles and auth.order keep routing metadata only; encrypted secrets stay in the credential vault.',
  'Primary and fallback refs should stay pinned for production stability even if the UI labels them as latest.',
];

export function createModelRoutingConfigService(options = {}) {
  const configPath = path.resolve(
    options.configPath ||
      path.join(options.rootDir || process.cwd(), 'assets', 'model-routing.config.json'),
  );
  const loadCatalog =
    options.loadCatalog ||
    (async () => {
      if (!options.catalogPath) {
        throw new Error('catalogPath or loadCatalog is required for model routing config service.');
      }
      const content = await fs.readFile(path.resolve(options.catalogPath), 'utf8');
      return JSON.parse(content);
    });

  return {
    describe() {
      return {
        configPath,
        strategy: 'openclaw-inspired',
      };
    },
    async loadModelRouting() {
      const catalog = await loadCatalog();
      const config = await ensureConfig(configPath, catalog, options);
      return buildResolvedModelRouting(config, catalog);
    },
    async saveModelRouting(nextConfigInput) {
      const catalog = await loadCatalog();
      const existingConfig = await readJsonIfExists(configPath);
      const nextConfig = normalizeModelRoutingConfig(nextConfigInput, catalog, {
        existingConfig,
      });
      await writeJson(configPath, nextConfig);
      return buildResolvedModelRouting(nextConfig, catalog);
    },
    async bootstrapFromCatalog(overrides = {}) {
      const catalog = await loadCatalog();
      const nextConfig = buildDefaultModelRoutingConfig(catalog, overrides);
      await writeJson(configPath, nextConfig);
      return buildResolvedModelRouting(nextConfig, catalog);
    },
  };
}

export function buildDefaultModelRoutingConfig(catalog, options = {}) {
  const generatedAt = new Date().toISOString();
  const catalogProviders = Array.isArray(catalog?.providers) ? catalog.providers : [];
  const requestedProviderIds =
    Array.isArray(options.providerIds) && options.providerIds.length > 0
      ? new Set(options.providerIds)
      : null;
  const providers = requestedProviderIds
    ? catalogProviders.filter((provider) => requestedProviderIds.has(provider.providerId))
    : catalogProviders;

  const authProfiles = {};
  const authOrder = {};
  const providerEntries = {};
  const globalAllowlist = [];
  let primaryRef = null;
  const fallbackRefs = [];

  for (const provider of providers) {
    const allowlist = selectProviderAllowlist(provider);
    const defaultPrimary = allowlist[0] || null;
    const providerFallbacks = allowlist.slice(1, 3);
    providerEntries[provider.providerId] = {
      displayName: provider.displayName,
      selectionMode: 'allowlist',
      pickerGroup: 'recommended',
      allowlist,
      defaultPrimary,
      defaultFallbacks: providerFallbacks,
      notes:
        'Edit this allowlist to control what shows up in the picker for this provider.',
    };

    for (const ref of allowlist) {
      if (!globalAllowlist.includes(ref)) {
        globalAllowlist.push(ref);
      }
    }

    if (!primaryRef && defaultPrimary) {
      primaryRef = defaultPrimary;
    } else if (defaultPrimary && defaultPrimary !== primaryRef && !fallbackRefs.includes(defaultPrimary)) {
      fallbackRefs.push(defaultPrimary);
    }

    const defaultProfile = buildDefaultAuthProfile(provider);
    if (defaultProfile) {
      authProfiles[provider.providerId] = [defaultProfile];
      authOrder[provider.providerId] = [defaultProfile.id];
    }
  }

  const normalizedFallbacks = fallbackRefs
    .filter((ref) => ref && ref !== primaryRef)
    .slice(0, 3);
  const allowlist = uniqueRefs([
    ...globalAllowlist,
    primaryRef,
    ...normalizedFallbacks,
  ]);

  return {
    version: 1,
    strategy: 'openclaw-inspired',
    generatedAt,
    updatedAt: generatedAt,
    notes: [...DEFAULT_NOTES],
    picker: {
      defaultGroup: 'recommended',
      hidePreviewByDefault: true,
      hideDeprecatedByDefault: true,
      allowAdvancedModelRefs: true,
    },
    agents: {
      defaults: {
        models: allowlist,
        model: {
          primary: primaryRef,
          fallbacks: normalizedFallbacks,
        },
      },
    },
    auth: {
      profiles: authProfiles,
      order: authOrder,
    },
    providers: providerEntries,
  };
}

export function normalizeModelRoutingConfig(input, catalog, options = {}) {
  const existingConfig = options.existingConfig || null;
  const baseConfig = existingConfig || buildDefaultModelRoutingConfig(catalog, options);
  const rawConfig = input?.config || input || {};
  const normalizedPrimary = normalizeModelRef(
    rawConfig?.agents?.defaults?.model?.primary ?? baseConfig?.agents?.defaults?.model?.primary ?? null,
  );
  const normalizedFallbacks = uniqueRefs(
    (rawConfig?.agents?.defaults?.model?.fallbacks ??
      baseConfig?.agents?.defaults?.model?.fallbacks ??
      []).map(normalizeModelRef),
  ).filter((ref) => ref && ref !== normalizedPrimary);

  const normalizedAllowlist = uniqueRefs(
    (rawConfig?.agents?.defaults?.models ??
      baseConfig?.agents?.defaults?.models ??
      []).map(normalizeModelRef),
  );
  for (const requiredRef of [normalizedPrimary, ...normalizedFallbacks]) {
    if (requiredRef && !normalizedAllowlist.includes(requiredRef)) {
      normalizedAllowlist.push(requiredRef);
    }
  }

  const providerIds = new Set([
    ...Object.keys(rawConfig?.providers || {}),
    ...Object.keys(rawConfig?.auth?.profiles || {}),
    ...Object.keys(rawConfig?.auth?.order || {}),
    ...normalizedAllowlist.map((ref) => getProviderIdFromRef(ref)).filter(Boolean),
  ]);

  const catalogProviderMap = new Map(
    (catalog?.providers || []).map((provider) => [provider.providerId, provider]),
  );
  const normalizedProviders = {};
  for (const providerId of providerIds) {
    if (!providerId) {
      continue;
    }

    const inputProvider = rawConfig?.providers?.[providerId] || {};
    const baseProvider = baseConfig?.providers?.[providerId] || {};
    const providerAllowlist = uniqueRefs(
      (inputProvider.allowlist ?? baseProvider.allowlist ?? []).map(normalizeModelRef),
    ).filter((ref) => getProviderIdFromRef(ref) === providerId);
    const fallbackPrimary = normalizedAllowlist.find((ref) => getProviderIdFromRef(ref) === providerId) || null;
    const defaultPrimary = normalizeModelRef(inputProvider.defaultPrimary ?? baseProvider.defaultPrimary ?? fallbackPrimary);
    const defaultFallbacks = uniqueRefs(
      (inputProvider.defaultFallbacks ?? baseProvider.defaultFallbacks ?? []).map(normalizeModelRef),
    ).filter((ref) => ref && ref !== defaultPrimary && getProviderIdFromRef(ref) === providerId);

    normalizedProviders[providerId] = {
      displayName:
        inputProvider.displayName ||
        baseProvider.displayName ||
        catalogProviderMap.get(providerId)?.displayName ||
        providerId,
      selectionMode: inputProvider.selectionMode || baseProvider.selectionMode || 'allowlist',
      pickerGroup: inputProvider.pickerGroup || baseProvider.pickerGroup || 'recommended',
      allowlist: providerAllowlist,
      defaultPrimary,
      defaultFallbacks,
      notes:
        inputProvider.notes ||
        baseProvider.notes ||
        'Edit this allowlist to control what shows up in the picker for this provider.',
    };
  }

  const authProfiles = {};
  const authOrder = {};
  for (const providerId of providerIds) {
    const inputProfiles = rawConfig?.auth?.profiles?.[providerId];
    const baseProfiles = baseConfig?.auth?.profiles?.[providerId];
    const profiles = Array.isArray(inputProfiles)
      ? inputProfiles
      : Array.isArray(baseProfiles)
        ? baseProfiles
        : [];

    authProfiles[providerId] = profiles
      .map((profile, index) => normalizeAuthProfile(profile, providerId, index))
      .filter(Boolean);

    const inputOrder = rawConfig?.auth?.order?.[providerId];
    const baseOrder = baseConfig?.auth?.order?.[providerId];
    authOrder[providerId] = uniqueStrings(
      Array.isArray(inputOrder) ? inputOrder : Array.isArray(baseOrder) ? baseOrder : [],
    );
  }

  return {
    version: Number(rawConfig.version || baseConfig.version || 1),
    strategy: rawConfig.strategy || baseConfig.strategy || 'openclaw-inspired',
    generatedAt: rawConfig.generatedAt || baseConfig.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: uniqueStrings(rawConfig.notes || baseConfig.notes || DEFAULT_NOTES),
    picker: {
      defaultGroup:
        rawConfig?.picker?.defaultGroup ||
        baseConfig?.picker?.defaultGroup ||
        'recommended',
      hidePreviewByDefault:
        rawConfig?.picker?.hidePreviewByDefault ??
        baseConfig?.picker?.hidePreviewByDefault ??
        true,
      hideDeprecatedByDefault:
        rawConfig?.picker?.hideDeprecatedByDefault ??
        baseConfig?.picker?.hideDeprecatedByDefault ??
        true,
      allowAdvancedModelRefs:
        rawConfig?.picker?.allowAdvancedModelRefs ??
        baseConfig?.picker?.allowAdvancedModelRefs ??
        true,
    },
    agents: {
      defaults: {
        models: normalizedAllowlist,
        model: {
          primary: normalizedPrimary,
          fallbacks: normalizedFallbacks,
        },
      },
    },
    auth: {
      profiles: authProfiles,
      order: authOrder,
    },
    providers: normalizedProviders,
  };
}

export function buildResolvedModelRouting(config, catalog) {
  const modelIndex = buildModelIndex(catalog);
  const allowlistRefs = uniqueRefs(config?.agents?.defaults?.models || []);
  const primaryRef = normalizeModelRef(config?.agents?.defaults?.model?.primary || null);
  const fallbackRefs = uniqueRefs(config?.agents?.defaults?.model?.fallbacks || []).filter((ref) => ref !== primaryRef);
  const allowlistResolution = resolveModelRefs(allowlistRefs, modelIndex);
  const fallbackResolution = resolveModelRefs(fallbackRefs, modelIndex);
  const primaryResolution = primaryRef ? resolveSingleModelRef(primaryRef, modelIndex) : null;
  const providerSummaries = Object.entries(config?.providers || {}).map(([providerId, providerConfig]) =>
    buildProviderSummary(providerId, providerConfig, config, modelIndex),
  );
  const unresolvedRefs = uniqueRefs([
    ...allowlistResolution.unresolvedRefs,
    ...(primaryResolution?.resolved ? [] : primaryRef ? [primaryRef] : []),
    ...fallbackResolution.unresolvedRefs,
  ]);

  return {
    config,
    summary: {
      primaryRef,
      primary: primaryResolution?.model || null,
      fallbackRefs,
      fallbacks: fallbackResolution.models,
      allowlistRefs,
      allowlist: allowlistResolution.models,
      unresolvedRefs,
      pickerProviders: uniqueStrings(allowlistRefs.map((ref) => getProviderIdFromRef(ref)).filter(Boolean)),
      totalAllowlistModels: allowlistResolution.models.length,
    },
    providers: providerSummaries,
  };
}

async function ensureConfig(configPath, catalog, options) {
  const existingConfig = await readJsonIfExists(configPath);
  if (existingConfig) {
    return normalizeModelRoutingConfig(existingConfig, catalog, {
      existingConfig,
    });
  }

  const generatedConfig = buildDefaultModelRoutingConfig(catalog, options);
  if (options.bootstrapOnMissing !== false) {
    await writeJson(configPath, generatedConfig);
  }
  return generatedConfig;
}

function selectProviderAllowlist(provider) {
  const recommendedIds = uniqueStrings([
    ...(provider?.collections?.recommendedIds || []),
    ...(provider?.collections?.autoRecommendedIds || []),
  ]);
  const latestStableIds = uniqueStrings(
    (provider?.collections?.latestIds || []).filter((modelId) => {
      const model = (provider?.models || []).find((entry) => entry.modelId === modelId);
      return !model || (model.stage !== 'preview' && model.stage !== 'deprecated');
    }),
  );
  const stableIds = uniqueStrings(
    (provider?.models || [])
      .filter((model) => model.stage !== 'preview' && model.stage !== 'deprecated' && !model.hidden)
      .map((model) => model.modelId),
  );

  return uniqueRefs(
    [...recommendedIds, ...latestStableIds, ...stableIds]
      .slice(0, 5)
      .map((modelId) => `${provider.providerId}/${modelId}`),
  );
}

function buildDefaultAuthProfile(provider) {
  if (!provider?.providerId) {
    return null;
  }

  const strategy = String(provider?.auth?.strategy || 'apiKey').toLowerCase();
  const type = strategy.includes('oauth') ? 'oauth' : 'api_key';
  return {
    id: `${provider.providerId}:default`,
    label: `Default ${provider.displayName || provider.providerId} ${type === 'oauth' ? 'OAuth profile' : 'credential'}`,
    type,
    providerId: provider.providerId,
  };
}

function normalizeAuthProfile(profile, providerId, index) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  return {
    id: String(profile.id || `${providerId}:profile-${index + 1}`),
    label: String(profile.label || `Profile ${index + 1}`),
    type: String(profile.type || 'api_key'),
    providerId,
  };
}

function buildProviderSummary(providerId, providerConfig, config, modelIndex) {
  const allowlistResolution = resolveModelRefs(providerConfig.allowlist || [], modelIndex);
  const defaultPrimary = normalizeModelRef(providerConfig.defaultPrimary || null);
  const primaryResolution = defaultPrimary ? resolveSingleModelRef(defaultPrimary, modelIndex) : null;
  const defaultFallbacks = uniqueRefs(providerConfig.defaultFallbacks || []).filter((ref) => ref !== defaultPrimary);
  const fallbackResolution = resolveModelRefs(defaultFallbacks, modelIndex);
  const authProfiles = config?.auth?.profiles?.[providerId] || [];
  const authOrder = config?.auth?.order?.[providerId] || [];

  return {
    providerId,
    displayName: providerConfig.displayName || providerId,
    selectionMode: providerConfig.selectionMode || 'allowlist',
    pickerGroup: providerConfig.pickerGroup || 'recommended',
    notes: providerConfig.notes || '',
    allowlistRefs: uniqueRefs(providerConfig.allowlist || []),
    allowlist: allowlistResolution.models,
    defaultPrimary,
    defaultPrimaryModel: primaryResolution?.model || null,
    defaultFallbackRefs: defaultFallbacks,
    defaultFallbacks: fallbackResolution.models,
    unresolvedRefs: uniqueRefs([
      ...allowlistResolution.unresolvedRefs,
      ...(primaryResolution?.resolved ? [] : defaultPrimary ? [defaultPrimary] : []),
      ...fallbackResolution.unresolvedRefs,
    ]),
    authProfiles,
    authOrder,
  };
}

function buildModelIndex(catalog) {
  const index = new Map();

  for (const provider of catalog?.providers || []) {
    const latestIdSet = new Set(provider?.collections?.latestIds || []);
    const recommendedIdSet = new Set([
      ...(provider?.collections?.recommendedIds || []),
      ...(provider?.collections?.autoRecommendedIds || []),
    ]);

    for (const model of provider?.models || []) {
      const ref = `${provider.providerId}/${model.modelId}`;
      index.set(ref, {
        ref,
        providerId: provider.providerId,
        providerDisplayName: provider.displayName,
        modelId: model.modelId,
        displayName: model.displayName,
        stage: model.stage,
        family: model.family,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        capabilities: model.capabilities || [],
        recommended: Boolean(model.recommended || recommendedIdSet.has(model.modelId)),
        isLatestStableRelease: Boolean(model.isLatestStableRelease || latestIdSet.has(model.modelId)),
        pinnedTargetModelId: model.pinnedTargetModelId || null,
      });
    }
  }

  return index;
}

function resolveModelRefs(refs, modelIndex) {
  const models = [];
  const unresolvedRefs = [];

  for (const ref of uniqueRefs(refs)) {
    const resolved = resolveSingleModelRef(ref, modelIndex);
    if (resolved.resolved) {
      models.push(resolved.model);
    } else {
      unresolvedRefs.push(ref);
    }
  }

  return {
    refs: uniqueRefs(refs),
    models,
    unresolvedRefs,
  };
}

function resolveSingleModelRef(ref, modelIndex) {
  const normalizedRef = normalizeModelRef(ref);
  if (!normalizedRef) {
    return {
      resolved: false,
      model: null,
    };
  }

  return {
    resolved: modelIndex.has(normalizedRef),
    model: modelIndex.get(normalizedRef) || null,
  };
}

function normalizeModelRef(value) {
  if (!value) {
    return null;
  }

  const nextValue = String(value).trim();
  if (!nextValue || !nextValue.includes('/')) {
    return null;
  }

  const [providerId, ...modelParts] = nextValue.split('/');
  const modelId = modelParts.join('/').trim();
  if (!providerId.trim() || !modelId) {
    return null;
  }

  return `${providerId.trim()}/${modelId}`;
}

function getProviderIdFromRef(ref) {
  const normalizedRef = normalizeModelRef(ref);
  if (!normalizedRef) {
    return null;
  }

  return normalizedRef.split('/')[0];
}

function uniqueRefs(values) {
  return uniqueStrings(values.map(normalizeModelRef).filter(Boolean));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values || []) {
    const nextValue = String(value || '').trim();
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }
    seen.add(nextValue);
    result.push(nextValue);
  }

  return result;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
