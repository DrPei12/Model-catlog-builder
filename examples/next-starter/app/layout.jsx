import Link from 'next/link';

import './globals.css';

export const metadata = {
  title: 'Model Catalog Starter',
  description: 'Provider-first model catalog starter example for multi-provider AI products.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="site-nav">
            <Link className="site-brand" href="/">
              Model Catalog Builder
            </Link>
            <nav className="site-nav-links">
              <Link href="/">Overview</Link>
              <Link href="/admin">Admin Console</Link>
              <a href="/api/model-catalog" target="_blank" rel="noreferrer">
                API
              </a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
