import { createStarterApiService } from '../createStarterApiService.mjs';

export function createNextRouteHandlers(options = {}) {
  let servicePromise = null;

  async function getService() {
    if (!servicePromise) {
      servicePromise = createStarterApiService(options);
    }
    return servicePromise;
  }

  async function handle(request, context = {}) {
    try {
      const service = await getService();
      const resolvedContext = await resolveContext(context);
      const pathname = buildServicePath(resolvedContext, options);
      const body = hasRequestBody(request.method) ? await readJsonRequestBody(request) : {};
      const result = await service.handleApiRequest({
        method: request.method,
        pathname,
        searchParams: new URL(request.url).searchParams,
        body,
        headers: headersToObject(request.headers),
        remoteAddress: getRemoteAddress(request.headers),
      });

      return jsonResponse(result.statusCode, result.payload);
    } catch (error) {
      return jsonResponse(500, {
        error: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
  };
}

async function resolveContext(context) {
  if (context?.params && typeof context.params.then === 'function') {
    return {
      ...context,
      params: await context.params,
    };
  }

  return context || {};
}

function buildServicePath(context, options) {
  if (typeof options.servicePathFromParams === 'function') {
    return options.servicePathFromParams(context);
  }

  const routeParamName = options.routeParamName || 'route';
  const rawSegments = context?.params?.[routeParamName];
  const segments = Array.isArray(rawSegments)
    ? rawSegments
    : rawSegments
      ? [rawSegments]
      : [];

  if (segments.length === 0) {
    return options.emptyPath || '/api/catalog/meta';
  }

  return `/api/${segments.map((segment) => encodeURIComponent(decodeURIComponent(String(segment)))).join('/')}`;
}

function hasRequestBody(method) {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE';
}

async function readJsonRequestBody(request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text);
}

function headersToObject(headers) {
  if (!headers) {
    return {};
  }

  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }

  return { ...headers };
}

function getRemoteAddress(headers) {
  if (!headers || typeof headers.get !== 'function') {
    return null;
  }

  const forwardedFor = headers.get('x-forwarded-for');
  if (!forwardedFor) {
    return null;
  }

  return forwardedFor
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) || null;
}

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
