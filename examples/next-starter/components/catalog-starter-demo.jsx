'use client';

import { startTransition, useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';

const EMPTY_RUNTIME = {
  runtime: null,
};

export function CatalogStarterDemo() {
  const [tenantId, setTenantId] = useState('starter-demo');
  const [apiKey, setApiKey] = useState('');
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerSetup, setProviderSetup] = useState(null);
  const [runtimeState, setRuntimeState] = useState(EMPTY_RUNTIME);
  const [connectionState, setConnectionState] = useState(null);
  const [validationState, setValidationState] = useState(null);
  const [modelsState, setModelsState] = useState({ models: [], collections: {} });
  const [credentialValues, setCredentialValues] = useState({});
  const [group, setGroup] = useState('recommended');
  const [query, setQuery] = useState('');
  const [includePreview, setIncludePreview] = useState(false);
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const deferredQuery = useDeferredValue(query);

  const requestHeaders = useMemo(() => {
    const headers = {
      'x-tenant-id': tenantId || 'starter-demo',
    };

    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    return headers;
  }, [apiKey, tenantId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.providerId === selectedProviderId) || null,
    [providers, selectedProviderId],
  );

  const loadProviders = useEffectEvent(async () => {
    try {
      setErrorMessage('');
      const result = await fetchJson('/api/model-catalog/providers', { headers: requestHeaders });
      setProviders(result.providers || []);
      if (!selectedProviderId && result.providers?.[0]?.providerId) {
        startTransition(() => {
          setSelectedProviderId(result.providers[0].providerId);
        });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const loadProviderResources = useEffectEvent(async (providerId) => {
    if (!providerId) {
      return;
    }

    try {
      setErrorMessage('');
      const [setup, runtime, connection] = await Promise.all([
        fetchJson(`/api/model-catalog/providers/${providerId}/setup`, { headers: requestHeaders }),
        fetchJson(`/api/model-catalog/providers/${providerId}/runtime`, { headers: requestHeaders }),
        fetchJson(`/api/model-catalog/providers/${providerId}/connection`, { headers: requestHeaders }),
      ]);

      setProviderSetup(setup);
      setRuntimeState(runtime);
      setConnectionState(connection.connection || null);
      setCredentialValues((current) => seedCredentialValues(setup, current));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const loadModels = useEffectEvent(async (providerId) => {
    if (!providerId) {
      return;
    }

    try {
      setErrorMessage('');
      const search = new URLSearchParams({
        group,
        query: deferredQuery,
        includePreview: String(includePreview),
        includeDeprecated: String(includeDeprecated),
      });
      const result = await fetchJson(
        `/api/model-catalog/providers/${providerId}/models?${search.toString()}`,
        { headers: requestHeaders },
      );
      setModelsState(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  useEffect(() => {
    void loadProviders();
  }, [apiKey, loadProviders, tenantId]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }

    void loadProviderResources(selectedProviderId);
  }, [apiKey, loadProviderResources, selectedProviderId, tenantId]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }

    void loadModels(selectedProviderId);
  }, [
    deferredQuery,
    group,
    includeDeprecated,
    includePreview,
    loadModels,
    requestHeaders,
    selectedProviderId,
    tenantId,
  ]);

  async function runAction(action) {
    if (!selectedProviderId) {
      return;
    }

    setIsBusy(true);
    try {
      setErrorMessage('');
      const actor = {
        type: 'example-ui',
        id: tenantId || 'starter-demo',
      };

      if (action === 'validate') {
        const result = await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/validate`, {
          method: 'POST',
          headers: requestHeaders,
          body: {
            credentials: credentialValues,
          },
        });
        setValidationState(result);
      }

      if (action === 'connect') {
        const result = await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/connect`, {
          method: 'POST',
          headers: requestHeaders,
          body: {
            credentials: credentialValues,
            actor,
          },
        });
        setConnectionState(result.connection || null);
        setValidationState(result.validation || result);
      }

      if (action === 'revalidate') {
        const result = await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/revalidate`, {
          method: 'POST',
          headers: requestHeaders,
          body: {
            actor,
          },
        });
        setConnectionState(result.connection || null);
        setValidationState(result.validation || result);
      }

      if (action === 'disconnect') {
        const result = await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/connection`, {
          method: 'DELETE',
          headers: requestHeaders,
          body: {
            actor,
          },
        });
        setConnectionState(result.connection || null);
        setValidationState(result);
      }

      if (action === 'refresh') {
        await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/refresh`, {
          method: 'POST',
          headers: requestHeaders,
          body: {},
        });
      }

      await Promise.all([
        loadProviderResources(selectedProviderId),
        loadModels(selectedProviderId),
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="demo-grid">
      <section className="sidebar-panel">
        <p className="eyebrow">Providers</p>
        <h2 className="panel-title">Choose a provider first</h2>
        <p className="panel-copy">
          This list comes from the normalized catalog, not from hard-coded client state.
        </p>
        <div className="provider-list">
          {providers.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              className={`provider-button ${provider.providerId === selectedProviderId ? 'is-active' : ''}`}
              onClick={() => {
                startTransition(() => {
                  setSelectedProviderId(provider.providerId);
                });
              }}
            >
              <strong>{provider.displayName}</strong>
              <span>{provider.collectionsSummary?.recommended || 0} recommended models</span>
            </button>
          ))}
        </div>
      </section>

      <section className="content-panel">
        <div className="content-stack">
          <section className="panel">
            <div className="section-row">
              <div>
                <p className="eyebrow">Request context</p>
                <h2 className="section-heading">Tenant and API auth</h2>
              </div>
              <span className="inline-code">{selectedProvider?.providerId || 'no-provider'}</span>
            </div>
            <div className="controls-grid">
              <label className="field">
                <span className="field-label">Tenant ID</span>
                <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
                <span className="field-help">Maps to the tenant-aware runtime store.</span>
              </label>
              <label className="field">
                <span className="field-label">API key</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Optional unless MODEL_CATALOG_API_KEYS is configured"
                />
                <span className="field-help">Sent as a Bearer token to the starter API.</span>
              </label>
            </div>
            {errorMessage ? (
              <div className="empty-state" style={{ marginTop: 16 }}>
                {errorMessage}
              </div>
            ) : null}
          </section>

          <div className="content-top">
            <section className="panel">
              <div className="section-row">
                <div>
                  <p className="eyebrow">Setup</p>
                  <h2 className="section-heading">{providerSetup?.displayName || 'Provider setup'}</h2>
                </div>
                {providerSetup?.auth?.strategy ? (
                  <span className="inline-code">{providerSetup.auth.strategy}</span>
                ) : null}
              </div>
              <p className="panel-copy">
                {providerSetup?.helpText ||
                  'Pick a provider to see the auth form that this starter API exposes.'}
              </p>
              <div className="fields-grid" style={{ marginTop: 16 }}>
                {(providerSetup?.auth?.fields || []).map((field) => (
                  <label
                    key={field.id}
                    className={`field ${field.type === 'textarea' || field.id === 'baseUrl' ? 'full' : ''}`}
                  >
                    <span className="field-label">{field.label}</span>
                    <input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={credentialValues[field.id] || ''}
                      placeholder={field.placeholder || ''}
                      onChange={(event) =>
                        setCredentialValues((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                    />
                    <span className="field-help">
                      {field.required ? 'Required.' : 'Optional.'} {field.helpText || ''}
                    </span>
                  </label>
                ))}
              </div>
              <div className="action-row" style={{ marginTop: 16 }}>
                <button className="action-button primary" type="button" disabled={isBusy} onClick={() => runAction('validate')}>
                  Validate
                </button>
                <button className="action-button" type="button" disabled={isBusy} onClick={() => runAction('connect')}>
                  Connect
                </button>
                <button className="action-button" type="button" disabled={isBusy} onClick={() => runAction('revalidate')}>
                  Revalidate
                </button>
                <button className="action-button warn" type="button" disabled={isBusy} onClick={() => runAction('refresh')}>
                  Refresh models
                </button>
                <button className="action-button danger" type="button" disabled={isBusy} onClick={() => runAction('disconnect')}>
                  Disconnect
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="section-row">
                <div>
                  <p className="eyebrow">Runtime</p>
                  <h2 className="section-heading">Connection and validation</h2>
                </div>
              </div>
              <div className="status-grid">
                <StatusCard
                  label="Connection"
                  value={connectionState?.status || 'not-connected'}
                  tone={connectionState?.status === 'connected' ? 'ok' : 'error'}
                  note={connectionState?.updatedAt || 'No stored connection yet'}
                />
                <StatusCard
                  label="Validation"
                  value={validationState?.status || runtimeState?.runtime?.lastValidationStatus || 'idle'}
                  tone={validationState?.ok ?? runtimeState?.runtime?.lastValidationOk ? 'ok' : 'error'}
                  note={validationState?.errorMessage || runtimeState?.runtime?.lastValidationErrorMessage || 'No recent validation message'}
                />
                <StatusCard
                  label="Last refresh"
                  value={runtimeState?.runtime?.lastRefreshStatus || 'idle'}
                  tone={runtimeState?.runtime?.lastRefreshStatus === 'success' ? 'ok' : 'error'}
                  note={runtimeState?.runtime?.lastRefreshAt || 'No refresh yet'}
                />
                <StatusCard
                  label="Stored secret"
                  value={connectionState?.secretSource || 'not-stored'}
                  note={connectionState?.keyVersion || 'No key version yet'}
                />
              </div>
              <pre className="json-block" style={{ marginTop: 16 }}>
                {JSON.stringify(
                  {
                    selectedProviderId,
                    connectionState,
                    validationState,
                  },
                  null,
                  2,
                )}
              </pre>
            </section>
          </div>

          <section className="panel">
            <div className="section-row">
              <div>
                <p className="eyebrow">Models</p>
                <h2 className="section-heading">Normalized model picker</h2>
              </div>
              <span className="inline-code">{modelsState.models?.length || 0} visible models</span>
            </div>
            <div className="filter-row">
              {['recommended', 'latest', 'all'].map((nextGroup) => (
                <button
                  key={nextGroup}
                  type="button"
                  className={`tab-button ${group === nextGroup ? 'is-active' : ''}`}
                  onClick={() => setGroup(nextGroup)}
                >
                  {nextGroup}
                </button>
              ))}
            </div>
            <div className="controls-grid" style={{ marginTop: 14 }}>
              <label className="field full">
                <span className="field-label">Search models</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter by name, family, capability, or model ID"
                />
              </label>
            </div>
            <div className="toggle-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className={`toggle-chip ${includePreview ? 'is-active' : ''}`}
                onClick={() => setIncludePreview((current) => !current)}
              >
                Include preview
              </button>
              <button
                type="button"
                className={`toggle-chip ${includeDeprecated ? 'is-active' : ''}`}
                onClick={() => setIncludeDeprecated((current) => !current)}
              >
                Include deprecated
              </button>
            </div>
            {modelsState.models?.length ? (
              <div className="model-grid" style={{ marginTop: 16 }}>
                {modelsState.models.slice(0, 12).map((model) => (
                  <article className="model-card" key={model.modelId}>
                    <strong>{model.displayName}</strong>
                    <span className="model-meta">{model.modelId}</span>
                    <div className="badge-row">
                      {(model.capabilities || []).slice(0, 4).map((capability) => (
                        <span className="badge" key={capability}>
                          {capability}
                        </span>
                      ))}
                      {model.stage === 'preview' ? <span className="badge warn">preview</span> : null}
                      {model.recommended ? <span className="badge muted">recommended</span> : null}
                    </div>
                    <div className="field-summary">
                      Context {formatNumber(model.contextWindow)} · Max output {formatNumber(model.maxOutputTokens)}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ marginTop: 16 }}>
                No models matched the current filters.
              </div>
            )}
          </section>
        </div>
      </section>
    </section>
  );
}

function StatusCard({ label, note, tone = 'default', value }) {
  return (
    <article className="status-card">
      <span className="status-label">{label}</span>
      <div className={`status-value ${tone === 'ok' ? 'status-ok' : tone === 'error' ? 'status-error' : ''}`}>
        {value || 'n/a'}
      </div>
      <div className="status-note">{note || 'No data yet'}</div>
    </article>
  );
}

function seedCredentialValues(setup, currentValues) {
  const nextValues = { ...currentValues };
  for (const field of setup?.auth?.fields || []) {
    if (!(field.id in nextValues)) {
      nextValues[field.id] = '';
    }
  }
  return nextValues;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || 'Request failed');
  }
  return payload;
}

function formatNumber(value) {
  if (!value) {
    return 'n/a';
  }
  return Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
}
