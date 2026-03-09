export function createApiAccessControl(options = {}) {
  const defaultTenantId = options.defaultTenantId || 'default';
  const apiKeys = parseApiKeys(options.apiKeys || process.env.MODEL_CATALOG_API_KEYS || '');

  return {
    describe: () => ({
      enabled: apiKeys.size > 0,
      defaultTenantId,
      tenants: [...new Set([...apiKeys.values()])],
    }),
    resolveRequestContext: (request) => {
      const requestedTenantId = normalizeTenantId(request.headers['x-tenant-id']) || defaultTenantId;

      if (apiKeys.size === 0) {
        return {
          ok: true,
          tenantId: requestedTenantId,
          actor: {
            type: 'anonymous',
            id: request.socket.remoteAddress || 'local-demo',
          },
        };
      }

      const token = extractToken(request);
      if (!token) {
        return {
          ok: false,
          statusCode: 401,
          payload: {
            error: 'missing_api_key',
            message: 'Provide a Bearer token or x-api-key header to use the API.',
          },
        };
      }

      const tenantId = apiKeys.get(token);
      if (!tenantId) {
        return {
          ok: false,
          statusCode: 403,
          payload: {
            error: 'invalid_api_key',
            message: 'The provided API key is not recognized.',
          },
        };
      }

      if (requestedTenantId !== defaultTenantId && requestedTenantId !== tenantId) {
        return {
          ok: false,
          statusCode: 403,
          payload: {
            error: 'tenant_mismatch',
            message: 'The requested tenant does not match the authenticated API key.',
          },
        };
      }

      return {
        ok: true,
        tenantId,
        actor: {
          type: 'api-key',
          id: maskToken(token),
        },
      };
    },
  };
}

function parseApiKeys(rawValue) {
  const entries = new Map();

  for (const item of String(rawValue || '').split(',')) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const tenantId = normalizeTenantId(trimmed.slice(0, separatorIndex));
    const token = trimmed.slice(separatorIndex + 1).trim();
    if (!tenantId || !token) {
      continue;
    }

    entries.set(token, tenantId);
  }

  return entries;
}

function extractToken(request) {
  const authorization = String(request.headers.authorization || '').trim();
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  return '';
}

function normalizeTenantId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized.replace(/[^a-z0-9_-]+/g, '-');
}

function maskToken(token) {
  if (token.length <= 8) {
    return '***';
  }
  return `${token.slice(0, 4)}...${token.slice(-2)}`;
}
