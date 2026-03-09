import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Starter Example</p>
        <h1>Provider-first model catalog for real products</h1>
        <p className="hero-copy">
          This example ships with both a product-facing starter flow and an operator-facing admin console.
          The admin side lets teams manage provider connections, model routing, picker allowlists, and
          recent operational history without editing sync scripts by hand. The intended use is simple:
          import this package into an AI app, keep model configuration out of prompts, and ship a cleaner
          settings experience for users.
        </p>
        <div className="hero-actions">
          <Link className="hero-link primary" href="/admin">
            Open admin console
          </Link>
          <a className="hero-link" href="/api/model-catalog" target="_blank" rel="noreferrer">
            Inspect API
          </a>
          <a className="hero-link" href="/api/model-catalog/health" target="_blank" rel="noreferrer">
            Health check
          </a>
        </div>
      </section>

      <section className="landing-grid">
        <article className="panel feature-card">
          <p className="eyebrow">Provider management</p>
          <h2 className="section-heading">Connect and monitor model providers</h2>
          <p className="panel-copy">
            Validate credentials, refresh model catalogs, and see connection state per provider from a
            single admin surface.
          </p>
        </article>
        <article className="panel feature-card">
          <p className="eyebrow">Routing policy</p>
          <h2 className="section-heading">Edit primary and fallback chains</h2>
          <p className="panel-copy">
            Use OpenClaw-style `provider/model` refs to keep picker allowlists and production defaults
            explicit, reviewable, and safe to update.
          </p>
        </article>
        <article className="panel feature-card">
          <p className="eyebrow">Operations</p>
          <h2 className="section-heading">Review recent runs and audit events</h2>
          <p className="panel-copy">
            The starter already includes refresh logs, validation history, connection inventory, and audit
            events, so teams do not have to bolt on basic ops visibility later.
          </p>
        </article>
      </section>
    </main>
  );
}
