'use client';

import { startTransition, useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';

const EMPTY_RUNTIME = { runtime: null };
const EMPTY_OPERATIONS = {
  catalogMeta: null,
  connections: [],
  refreshRuns: [],
  validationRuns: [],
  auditEvents: [],
};

export function CatalogAdminConsole() {
  const [tenantId, setTenantId] = useState('starter-admin');
  const [apiKey, setApiKey] = useState('');
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerSetup, setProviderSetup] = useState(null);
  const [runtimeState, setRuntimeState] = useState(EMPTY_RUNTIME);
  const [connectionState, setConnectionState] = useState(null);
  const [modelsState, setModelsState] = useState({ models: [], collections: {} });
  const [modelRoutingState, setModelRoutingState] = useState(null);
  const [operationsState, setOperationsState] = useState(EMPTY_OPERATIONS);
  const [credentialValues, setCredentialValues] = useState({});
  const [routingDraft, setRoutingDraft] = useState({ primaryRef: '', fallbackRefs: '', allowlistRefs: '' });
  const [group, setGroup] = useState('recommended');
  const [query, setQuery] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const deferredQuery = useDeferredValue(query);

  const requestHeaders = useMemo(() => {
    const headers = { 'x-tenant-id': tenantId || 'starter-admin' };
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    return headers;
  }, [apiKey, tenantId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.providerId === selectedProviderId) || null,
    [providers, selectedProviderId],
  );

  const connectionsByProvider = useMemo(
    () => new Map((operationsState.connections || []).map((connection) => [connection.providerId, connection])),
    [operationsState.connections],
  );

  const loadProviders = useEffectEvent(async () => {
    const result = await fetchJson('/api/model-catalog/providers', { headers: requestHeaders });
    setProviders(result.providers || []);
    if (!selectedProviderId && result.providers?.[0]?.providerId) {
      startTransition(() => setSelectedProviderId(result.providers[0].providerId));
    }
  });

  const loadProviderResources = useEffectEvent(async (providerId) => {
    if (!providerId) {
      return;
    }

    const [setup, runtime, connection] = await Promise.all([
      fetchJson(`/api/model-catalog/providers/${providerId}/setup`, { headers: requestHeaders }),
      fetchJson(`/api/model-catalog/providers/${providerId}/runtime`, { headers: requestHeaders }),
      fetchJson(`/api/model-catalog/providers/${providerId}/connection`, { headers: requestHeaders }),
    ]);

    setProviderSetup(setup);
    setRuntimeState(runtime);
    setConnectionState(connection.connection || null);
    setCredentialValues((current) => seedCredentialValues(setup, current));
  });

  const loadModels = useEffectEvent(async (providerId) => {
    if (!providerId) {
      return;
    }

    const search = new URLSearchParams({
      group,
      query: deferredQuery,
      includePreview: 'true',
      includeDeprecated: 'false',
    });

    const result = await fetchJson(`/api/model-catalog/providers/${providerId}/models?${search.toString()}`, {
      headers: requestHeaders,
    });
    setModelsState(result);
  });

  const loadModelRouting = useEffectEvent(async () => {
    const result = await fetchJson('/api/model-catalog/config/model-routing', {
      headers: requestHeaders,
    });
    setModelRoutingState(result.modelRouting || null);
    setRoutingDraft(createRoutingDraft(result.modelRouting));
  });

  const loadOperations = useEffectEvent(async () => {
    const [catalogMeta, connections, refreshRuns, validationRuns, auditEvents] = await Promise.all([
      fetchJson('/api/model-catalog', { headers: requestHeaders }),
      fetchJson('/api/model-catalog/operations/connections', { headers: requestHeaders }),
      fetchJson('/api/model-catalog/operations/refresh-runs?limit=6', { headers: requestHeaders }),
      fetchJson('/api/model-catalog/operations/validation-runs?limit=6', { headers: requestHeaders }),
      fetchJson('/api/model-catalog/operations/audit-events?limit=6', { headers: requestHeaders }),
    ]);

    setOperationsState({
      catalogMeta,
      connections: connections.connections || [],
      refreshRuns: refreshRuns.refreshRuns || [],
      validationRuns: validationRuns.validationRuns || [],
      auditEvents: auditEvents.auditEvents || [],
    });
  });

  const refreshAllState = useEffectEvent(async () => {
    try {
      setErrorMessage('');
      await Promise.all([loadProviders(), loadModelRouting(), loadOperations()]);
      if (selectedProviderId) {
        await Promise.all([loadProviderResources(selectedProviderId), loadModels(selectedProviderId)]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  useEffect(() => {
    void refreshAllState();
  }, [apiKey, refreshAllState, tenantId]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }
    void loadProviderResources(selectedProviderId);
  }, [loadProviderResources, selectedProviderId, tenantId, apiKey]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }
    void loadModels(selectedProviderId);
  }, [deferredQuery, group, loadModels, requestHeaders, selectedProviderId]);

  async function runProviderAction(action) {
    if (!selectedProviderId) {
      return;
    }

    setIsBusy(true);
    setErrorMessage('');
    const actor = { type: 'admin-console', id: tenantId || 'starter-admin' };

    try {
      if (action === 'connect') {
        await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/connect`, {
          method: 'POST',
          headers: requestHeaders,
          body: { credentials: credentialValues, actor },
        });
      }

      if (action === 'revalidate') {
        await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/revalidate`, {
          method: 'POST',
          headers: requestHeaders,
          body: { actor },
        });
      }

      if (action === 'disconnect') {
        await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/connection`, {
          method: 'DELETE',
          headers: requestHeaders,
          body: { actor },
        });
      }

      if (action === 'refresh') {
        await fetchJson(`/api/model-catalog/providers/${selectedProviderId}/refresh`, {
          method: 'POST',
          headers: requestHeaders,
          body: {},
        });
      }

      if (action === 'refresh-all') {
        await fetchJson('/api/model-catalog/refresh', {
          method: 'POST',
          headers: requestHeaders,
          body: {},
        });
      }

      await refreshAllState();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveRoutingConfig() {
    setIsBusy(true);
    setErrorMessage('');

    try {
      const primaryRef = routingDraft.primaryRef.trim();
      const fallbackRefs = parseRefList(routingDraft.fallbackRefs);
      const allowlistRefs = mergeAllowlistRefs(parseRefList(routingDraft.allowlistRefs), primaryRef, fallbackRefs);

      const result = await fetchJson('/api/model-catalog/config/model-routing', {
        method: 'PUT',
        headers: requestHeaders,
        body: {
          config: {
            ...(modelRoutingState?.config || {}),
            agents: {
              ...(modelRoutingState?.config?.agents || {}),
              defaults: {
                ...(modelRoutingState?.config?.agents?.defaults || {}),
                models: allowlistRefs,
                model: {
                  ...(modelRoutingState?.config?.agents?.defaults?.model || {}),
                  primary: primaryRef || null,
                  fallbacks: fallbackRefs,
                },
              },
            },
          },
        },
      });

      setModelRoutingState(result.modelRouting || null);
      setRoutingDraft(createRoutingDraft(result.modelRouting));
      await loadOperations();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  const summary = {
    providers: providers.length,
    connected: (operationsState.connections || []).filter((connection) => connection.status === 'connected').length,
    unresolvedRefs: modelRoutingState?.summary?.unresolvedRefs?.length || 0,
    lastRefresh: operationsState.refreshRuns?.[0]?.status || 'idle',
  };

  return (
    <section className="content-stack">
      <section className="panel">
        <div className="section-row">
          <div>
            <p className="eyebrow">Admin Console</p>
            <h2 className="section-heading">Operator view for provider and model policy</h2>
          </div>
          <button className="action-button primary" type="button" disabled={isBusy} onClick={() => runProviderAction('refresh-all')}>
            Refresh all providers
          </button>
        </div>
        <div className="status-grid">
          <StatusCard label="Providers" value={String(summary.providers)} note="Known providers in the current catalog" />
          <StatusCard label="Connected" value={String(summary.connected)} tone={summary.connected ? 'ok' : 'error'} note="Providers with stored credentials" />
          <StatusCard label="Routing warnings" value={String(summary.unresolvedRefs)} tone={summary.unresolvedRefs ? 'error' : 'ok'} note="Unresolved provider/model refs" />
          <StatusCard label="Last refresh" value={summary.lastRefresh} tone={summary.lastRefresh === 'success' ? 'ok' : summary.lastRefresh === 'idle' ? 'default' : 'error'} note={operationsState.refreshRuns?.[0]?.completedAt || 'No refresh yet'} />
        </div>
      </section>

      <section className="demo-grid admin-grid">
        <section className="sidebar-panel">
          <p className="eyebrow">Scope</p>
          <h2 className="panel-title">Tenant and provider selection</h2>
          <div className="controls-grid single-column" style={{ marginTop: 16 }}>
            <label className="field">
              <span className="field-label">Tenant ID</span>
              <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">API key</span>
              <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Optional bearer token" />
            </label>
          </div>
          {errorMessage ? <div className="empty-state" style={{ marginTop: 16 }}>{errorMessage}</div> : null}
          <div className="provider-list">
            {providers.map((provider) => {
              const connection = connectionsByProvider.get(provider.providerId);
              return (
                <button
                  key={provider.providerId}
                  type="button"
                  className={`provider-button ${provider.providerId === selectedProviderId ? 'is-active' : ''}`}
                  onClick={() => startTransition(() => setSelectedProviderId(provider.providerId))}
                >
                  <strong>{provider.displayName}</strong>
                  <span>{provider.collections?.recommended || 0} recommended models</span>
                  <span className={`provider-pill ${connection?.status === 'connected' ? 'is-ok' : 'is-idle'}`}>
                    {connection?.status || 'not-connected'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="content-panel">
          <div className="content-stack">
            <div className="content-top">
              <section className="panel">
                <div className="section-row">
                  <div>
                    <p className="eyebrow">Provider</p>
                    <h2 className="section-heading">{providerSetup?.displayName || 'Provider setup'}</h2>
                  </div>
                  {selectedProvider ? <span className="inline-code">{selectedProvider.providerId}</span> : null}
                </div>
                <p className="panel-copy">{providerSetup?.helpText || 'Select a provider to manage credentials and refresh behavior.'}</p>
                <div className="fields-grid" style={{ marginTop: 16 }}>
                  {(providerSetup?.auth?.fields || []).map((field) => (
                    <label key={field.id} className={`field ${field.id === 'baseUrl' ? 'full' : ''}`}>
                      <span className="field-label">{field.label}</span>
                      <input
                        type={field.type === 'password' ? 'password' : 'text'}
                        value={credentialValues[field.id] || ''}
                        placeholder={field.placeholder || ''}
                        onChange={(event) => setCredentialValues((current) => ({ ...current, [field.id]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="action-row" style={{ marginTop: 16 }}>
                  <button className="action-button primary" type="button" disabled={isBusy} onClick={() => runProviderAction('connect')}>Connect</button>
                  <button className="action-button" type="button" disabled={isBusy} onClick={() => runProviderAction('revalidate')}>Revalidate</button>
                  <button className="action-button warn" type="button" disabled={isBusy} onClick={() => runProviderAction('refresh')}>Refresh models</button>
                  <button className="action-button danger" type="button" disabled={isBusy} onClick={() => runProviderAction('disconnect')}>Disconnect</button>
                </div>
              </section>

              <section className="panel">
                <div className="section-row">
                  <div>
                    <p className="eyebrow">Health</p>
                    <h2 className="section-heading">Runtime state</h2>
                  </div>
                </div>
                <div className="status-grid">
                  <StatusCard label="Connection" value={connectionState?.status || 'not-connected'} tone={connectionState?.status === 'connected' ? 'ok' : 'error'} note={connectionState?.updatedAt || 'No stored connection'} />
                  <StatusCard label="Last refresh" value={runtimeState?.runtime?.lastRefreshStatus || 'idle'} tone={runtimeState?.runtime?.lastRefreshStatus === 'success' ? 'ok' : runtimeState?.runtime?.lastRefreshStatus === 'idle' ? 'default' : 'error'} note={runtimeState?.runtime?.lastRefreshAt || 'No refresh yet'} />
                  <StatusCard label="Last validation" value={runtimeState?.runtime?.lastValidationStatus || 'idle'} tone={runtimeState?.runtime?.lastValidationOk ? 'ok' : runtimeState?.runtime?.lastValidationStatus === 'idle' ? 'default' : 'error'} note={runtimeState?.runtime?.lastValidationAt || 'No validation yet'} />
                  <StatusCard label="Secret source" value={connectionState?.secretSource || 'not-stored'} note={connectionState?.keyVersion || 'No key version'} />
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="section-row">
                <div>
                  <p className="eyebrow">Routing Policy</p>
                  <h2 className="section-heading">Allowlist, primary, and fallback chain</h2>
                </div>
                <span className="inline-code">{modelRoutingState?.summary?.allowlistRefs?.length || 0} refs</span>
              </div>
              <div className="controls-grid single-column">
                <label className="field">
                  <span className="field-label">Primary model ref</span>
                  <input value={routingDraft.primaryRef} onChange={(event) => setRoutingDraft((current) => ({ ...current, primaryRef: event.target.value }))} placeholder="openai/gpt-5.2" />
                </label>
                <label className="field">
                  <span className="field-label">Fallback refs</span>
                  <input value={routingDraft.fallbackRefs} onChange={(event) => setRoutingDraft((current) => ({ ...current, fallbackRefs: event.target.value }))} placeholder="anthropic/claude-sonnet-4-6, google/gemini-2.5-pro" />
                </label>
                <label className="field">
                  <span className="field-label">Picker allowlist refs</span>
                  <input value={routingDraft.allowlistRefs} onChange={(event) => setRoutingDraft((current) => ({ ...current, allowlistRefs: event.target.value }))} placeholder="openai/gpt-5.2, anthropic/claude-sonnet-4-6" />
                </label>
              </div>
              <div className="action-row" style={{ marginTop: 16 }}>
                <button className="action-button primary" type="button" disabled={isBusy} onClick={saveRoutingConfig}>Save routing config</button>
              </div>
              <div className="mini-note" style={{ marginTop: 12 }}>
                Unresolved refs: {(modelRoutingState?.summary?.unresolvedRefs || []).join(', ') || 'none'}
              </div>
            </section>

            <section className="panel">
              <div className="section-row">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h2 className="section-heading">Recent runs and audit trail</h2>
                </div>
              </div>
              <div className="operations-grid">
                <OperationList title="Refresh runs" items={operationsState.refreshRuns} emptyLabel="No refresh runs yet" formatItem={formatRefreshRun} />
                <OperationList title="Validation runs" items={operationsState.validationRuns} emptyLabel="No validation runs yet" formatItem={formatValidationRun} />
                <OperationList title="Audit events" items={operationsState.auditEvents} emptyLabel="No audit events yet" formatItem={formatAuditEvent} />
              </div>
            </section>

            <section className="panel">
              <div className="section-row">
                <div>
                  <p className="eyebrow">Inventory</p>
                  <h2 className="section-heading">Current provider models</h2>
                </div>
              </div>
              <div className="filter-row">
                {['recommended', 'latest', 'all'].map((nextGroup) => (
                  <button key={nextGroup} type="button" className={`tab-button ${group === nextGroup ? 'is-active' : ''}`} onClick={() => setGroup(nextGroup)}>
                    {nextGroup}
                  </button>
                ))}
              </div>
              <div className="controls-grid" style={{ marginTop: 14 }}>
                <label className="field full">
                  <span className="field-label">Search models</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by model name or ID" />
                </label>
              </div>
              {modelsState.models?.length ? (
                <div className="table-shell" style={{ marginTop: 16 }}>
                  <table className="table-compact">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Capabilities</th>
                        <th>Context</th>
                        <th>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelsState.models.slice(0, 12).map((model) => (
                        <tr key={model.modelId}>
                          <td>
                            <strong>{model.displayName}</strong>
                            <div className="mini-note">{selectedProviderId ? `${selectedProviderId}/${model.modelId}` : model.modelId}</div>
                          </td>
                          <td>{(model.capabilities || []).slice(0, 3).join(', ') || 'n/a'}</td>
                          <td>{formatNumber(model.contextWindow)} / {formatNumber(model.maxOutputTokens)}</td>
                          <td>{model.stage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state" style={{ marginTop: 16 }}>No models matched the current filters.</div>
              )}
            </section>
          </div>
        </section>
      </section>
    </section>
  );
}

function StatusCard({ label, note, tone = 'default', value }) {
  return (
    <article className="status-card">
      <span className="status-label">{label}</span>
      <div className={`status-value ${tone === 'ok' ? 'status-ok' : tone === 'error' ? 'status-error' : ''}`}>{value || 'n/a'}</div>
      <div className="status-note">{note || 'No data yet'}</div>
    </article>
  );
}

function OperationList({ emptyLabel, formatItem, items, title }) {
  const normalizedItems = (items || []).map(formatItem).filter(Boolean);

  return (
    <section className="panel inset-panel">
      <div className="section-row">
        <h3 className="section-heading">{title}</h3>
      </div>
      {normalizedItems.length ? (
        <div className="stack-list">
          {normalizedItems.map((item) => (
            <article className="stack-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <div className="mini-note">{item.note}</div>
              </div>
              <span className={`provider-pill ${item.tone}`}>{item.badge}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">{emptyLabel}</div>
      )}
    </section>
  );
}

function formatRefreshRun(run) {
  return {
    id: run.runId || `${run.providerId}-${run.startedAt}`,
    title: run.providerId || 'all providers',
    badge: run.status || 'unknown',
    note: run.completedAt || run.startedAt || 'No timestamp',
    tone: run.status === 'success' ? 'is-ok' : run.status === 'idle' ? 'is-idle' : 'is-error',
  };
}

function formatValidationRun(run) {
  return {
    id: run.validationId || `${run.providerId}-${run.checkedAt}`,
    title: run.providerId || 'unknown provider',
    badge: run.status || (run.ok ? 'success' : 'failed'),
    note: run.errorMessage || run.checkedAt || 'No validation details',
    tone: run.ok ? 'is-ok' : 'is-error',
  };
}

function formatAuditEvent(event) {
  return {
    id: event.auditEventId || `${event.action}-${event.createdAt}`,
    title: `${event.action || 'event'}${event.providerId ? ` · ${event.providerId}` : ''}`,
    badge: event.actor?.type || 'system',
    note: event.createdAt || 'No timestamp',
    tone: 'is-idle',
  };
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

function createRoutingDraft(modelRouting) {
  return {
    primaryRef: modelRouting?.summary?.primaryRef || '',
    fallbackRefs: (modelRouting?.summary?.fallbackRefs || []).join(', '),
    allowlistRefs: (modelRouting?.summary?.allowlistRefs || []).join(', '),
  };
}

function parseRefList(value) {
  return uniqueRefs(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
}

function mergeAllowlistRefs(existingRefs, primaryRef, fallbackRefs = []) {
  return uniqueRefs([...existingRefs, primaryRef, ...fallbackRefs]);
}

function uniqueRefs(values) {
  const seen = new Set();
  const refs = [];
  for (const value of values || []) {
    const nextValue = String(value || '').trim();
    if (!nextValue || seen.has(nextValue)) {
      continue;
    }
    seen.add(nextValue);
    refs.push(nextValue);
  }
  return refs;
}

function formatNumber(value) {
  if (!value) {
    return 'n/a';
  }
  return Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
}
