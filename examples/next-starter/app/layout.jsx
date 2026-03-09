import './globals.css';

export const metadata = {
  title: 'Model Catalog Starter',
  description: 'Provider-first model catalog starter example for multi-provider AI products.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
