import { CatalogAdminConsole } from '../../components/catalog-admin-console.jsx';

export default function AdminPage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Admin Console</p>
        <h1>Model operations and routing policy</h1>
        <p className="hero-copy">
          This page is the operator-facing side of the starter. It centralizes provider setup, runtime
          health, model routing defaults, and recent activity so teams can manage model policy like a real
          product surface.
        </p>
      </section>
      <CatalogAdminConsole />
    </main>
  );
}
