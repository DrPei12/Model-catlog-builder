import { CatalogStarterDemo } from '../components/catalog-starter-demo.jsx';

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Starter Example</p>
        <h1>Provider-first model catalog for real products</h1>
        <p className="hero-copy">
          This example mounts the shared starter API through a Next.js route adapter, then walks through
          the full product flow: choose provider, validate credentials, connect, refresh, and pick a
          model from normalized groups. It also exposes an OpenClaw-inspired model routing layer so the
          picker allowlist, primary model, and fallback chain stay editable outside the sync pipeline.
        </p>
      </section>
      <CatalogStarterDemo />
    </main>
  );
}
