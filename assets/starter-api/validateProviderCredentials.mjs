export async function validateProviderCredentials(providerSetup, credentials = {}, options = {}) {
  const providerId = providerSetup?.providerId;
  const auth = providerSetup?.auth || {};
  const checkedAt = new Date().toISOString();

  if (!providerId) {
    return failure('invalid_provider', 'Provider setup is missing providerId.', providerId, checkedAt);
  }

  const missingFields = (auth.fields || [])
    .filter((field) => field.required)
    .filter((field) => !String(credentials[field.id] || '').trim())
    .map((field) => field.id);

  if (missingFields.length > 0) {
    return failure(
      'missing_credentials',
      `Missing required credential fields: ${missingFields.join(', ')}.`,
      providerId,
      checkedAt,
      { missingFields },
    );
  }

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 15000;

  try {
    switch (providerId) {
      case 'openai':
        return await validateOpenAi(fetchImpl, credentials.apiKey, timeoutMs, checkedAt);
      case 'anthropic':
        return await validateAnthropic(fetchImpl, credentials.apiKey, timeoutMs, checkedAt);
      case 'google':
        return await validateGoogle(fetchImpl, credentials.apiKey, timeoutMs, checkedAt);
      case 'openrouter':
        return await validateOpenRouter(fetchImpl, credentials.apiKey, timeoutMs, checkedAt);
      case 'vercel-ai-gateway':
        return await validateVercelGateway(fetchImpl, credentials.apiKey, timeoutMs, checkedAt);
      case 'openai-compatible':
        return await validateOpenAiCompatible(fetchImpl, credentials.baseUrl, credentials.apiKey, timeoutMs, checkedAt);
      case 'azure-openai':
        return failure(
          'not_supported_yet',
          'Azure OpenAI validation is not implemented yet because it needs deployment-aware checks. Use the OpenAI-Compatible path if your endpoint exposes /models.',
          providerId,
          checkedAt,
        );
      case 'qwen':
      case 'minimax':
        if (credentials.baseUrl) {
          return await validateOpenAiCompatible(fetchImpl, credentials.baseUrl, credentials.apiKey, timeoutMs, checkedAt, providerId);
        }
        return failure(
          'not_supported_yet',
          'This provider needs either a provider-specific validator or a compatible base URL. Use OpenAI-Compatible if your endpoint exposes /models.',
          providerId,
          checkedAt,
        );
      default:
        return failure(
          'unsupported_provider',
          `No validation strategy is implemented for provider "${providerId}".`,
          providerId,
          checkedAt,
        );
    }
  } catch (error) {
    return failure(
      'connection_failed',
      error instanceof Error ? error.message : String(error),
      providerId,
      checkedAt,
    );
  }
}

async function validateOpenAi(fetchImpl, apiKey, timeoutMs, checkedAt) {
  return validateWithRequest({
    providerId: 'openai',
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: 'https://api.openai.com/v1/models',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    successDetails: {
      strategy: 'official-openai-models',
      endpoint: 'https://api.openai.com/v1/models',
    },
  });
}

async function validateAnthropic(fetchImpl, apiKey, timeoutMs, checkedAt) {
  return validateWithRequest({
    providerId: 'anthropic',
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    successDetails: {
      strategy: 'official-anthropic-models',
      endpoint: 'https://api.anthropic.com/v1/models',
    },
  });
}

async function validateGoogle(fetchImpl, apiKey, timeoutMs, checkedAt) {
  return validateWithRequest({
    providerId: 'google',
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`,
    headers: {},
    successDetails: {
      strategy: 'official-gemini-models',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    },
  });
}

async function validateOpenRouter(fetchImpl, apiKey, timeoutMs, checkedAt) {
  return validateWithRequest({
    providerId: 'openrouter',
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: 'https://openrouter.ai/api/v1/models/user',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    successDetails: {
      strategy: 'openrouter-user-models',
      endpoint: 'https://openrouter.ai/api/v1/models/user',
    },
  });
}

async function validateVercelGateway(fetchImpl, apiKey, timeoutMs, checkedAt) {
  return validateWithRequest({
    providerId: 'vercel-ai-gateway',
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: 'https://ai-gateway.vercel.sh/v1/models',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    successDetails: {
      strategy: 'vercel-gateway-models',
      endpoint: 'https://ai-gateway.vercel.sh/v1/models',
    },
  });
}

async function validateOpenAiCompatible(fetchImpl, baseUrl, apiKey, timeoutMs, checkedAt, providerId = 'openai-compatible') {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return validateWithRequest({
    providerId,
    checkedAt,
    fetchImpl,
    timeoutMs,
    url: `${normalizedBaseUrl}/models`,
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`,
        }
      : {},
    successDetails: {
      strategy: 'openai-compatible-models',
      endpoint: `${normalizedBaseUrl}/models`,
    },
  });
}

async function validateWithRequest({ providerId, checkedAt, fetchImpl, timeoutMs, url, headers, successDetails }) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'model-catlog-builder-validation',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = await tryParseJson(response);
  if (!response.ok) {
    return failure(
      mapStatusToErrorCode(response.status),
      extractErrorMessage(payload) || `Validation failed with status ${response.status}.`,
      providerId,
      checkedAt,
      {
        status: response.status,
        endpoint: url,
      },
    );
  }

  return {
    ok: true,
    providerId,
    checkedAt,
    status: response.status,
    details: {
      ...successDetails,
      modelCountHint: inferModelCount(payload),
    },
  };
}

function failure(errorCode, errorMessage, providerId, checkedAt, extra = {}) {
  return {
    ok: false,
    providerId,
    checkedAt,
    errorCode,
    errorMessage,
    ...extra,
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

async function tryParseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractErrorMessage(payload) {
  if (!payload) {
    return '';
  }
  if (typeof payload.error === 'string') {
    return payload.error;
  }
  if (payload.error?.message) {
    return payload.error.message;
  }
  if (payload.message) {
    return payload.message;
  }
  return '';
}

function inferModelCount(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data.length;
  }
  if (Array.isArray(payload?.models)) {
    return payload.models.length;
  }
  return null;
}

function mapStatusToErrorCode(status) {
  if (status === 400) {
    return 'bad_request';
  }
  if (status === 401) {
    return 'unauthorized';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  return 'validation_failed';
}
