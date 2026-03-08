import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadCatalog(catalogPath) {
  const resolvedPath = path.resolve(catalogPath);
  const content = await fs.readFile(resolvedPath, 'utf8');
  return JSON.parse(content);
}

export function listProviders(catalog) {
  return (catalog.providers || []).map((provider) => ({
    providerId: provider.providerId,
    displayName: provider.displayName,
    auth: provider.auth,
    discovery: provider.discovery,
    availabilitySource: provider.availabilitySource,
    officialSources: provider.officialSources || [],
    collections: summarizeCollections(provider.collections),
  }));
}

export function getProviderSetup(catalog, providerId) {
  const provider = findProvider(catalog, providerId);
  if (!provider) {
    return null;
  }

  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    auth: provider.auth,
    discovery: provider.discovery,
  };
}

export function listModels(catalog, providerId, filters = {}) {
  const provider = findProvider(catalog, providerId);
  if (!provider) {
    return null;
  }

  const query = String(filters.query || '').trim().toLowerCase();
  const requestedGroup = filters.group || 'all';
  const includePreview = Boolean(filters.includePreview);
  const includeDeprecated = Boolean(filters.includeDeprecated);
  const requiredCapabilities = new Set((filters.capabilities || []).map((item) => String(item).toLowerCase()));

  const groupIds = getGroupModelIds(provider, requestedGroup);
  const groupIdSet = requestedGroup === 'all' ? null : new Set(groupIds);

  const models = (provider.models || []).filter((model) => {
    if (groupIdSet && !groupIdSet.has(model.modelId)) {
      return false;
    }
    if (!includePreview && model.stage === 'preview') {
      return false;
    }
    if (!includeDeprecated && model.stage === 'deprecated') {
      return false;
    }
    if (
      query &&
      !String(model.modelId).toLowerCase().includes(query) &&
      !String(model.displayName).toLowerCase().includes(query)
    ) {
      return false;
    }
    if (requiredCapabilities.size > 0) {
      const modelCapabilities = new Set((model.capabilities || []).map((item) => String(item).toLowerCase()));
      for (const capability of requiredCapabilities) {
        if (!modelCapabilities.has(capability)) {
          return false;
        }
      }
    }
    return true;
  });

  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    collections: provider.collections,
    models,
  };
}

function findProvider(catalog, providerId) {
  return (catalog.providers || []).find((provider) => provider.providerId === providerId) || null;
}

function summarizeCollections(collections = {}) {
  return {
    recommended: (collections.recommendedIds || []).length,
    autoRecommended: (collections.autoRecommendedIds || []).length,
    latest: (collections.latestIds || []).length,
    preview: (collections.previewIds || []).length,
    deprecated: (collections.deprecatedIds || []).length,
  };
}

function getGroupModelIds(provider, group) {
  if (group === 'recommended') {
    return [
      ...(provider.collections?.recommendedIds || []),
      ...(provider.collections?.autoRecommendedIds || []),
    ];
  }
  if (group === 'latest') {
    return provider.collections?.latestIds || [];
  }
  return provider.models?.map((model) => model.modelId) || [];
}
