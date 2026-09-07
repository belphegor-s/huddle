import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import type { Route } from './+types/root';
import { fontPreloads } from '@huddle/ui';
import './app.css';

/**
 * Start the fonts downloading while the document is still parsing, rather than
 * when React first paints text in them. See fontPreloads for why.
 *
 * crossOrigin is not optional on a font preload even for a same origin file:
 * fonts are fetched anonymously, and a preload whose mode does not match is
 * discarded and fetched a second time.
 */
export const links: Route.LinksFunction = () =>
  fontPreloads.map((href) => ({
    rel: 'preload',
    as: 'font',
    type: 'font/woff2',
    href,
    crossOrigin: 'anonymous',
  }));

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#2258d8" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isResponse = isRouteErrorResponse(error);
  const title = isResponse && error.status === 404 ? 'Page not found' : 'Something broke';
  const detail = isResponse
    ? error.statusText || 'That address does not lead anywhere.'
    : 'The page could not load. Reloading usually fixes it.';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl">{title}</h1>
      <p className="text-text-secondary">{detail}</p>
      <a href="/" className="text-accent">
        Go back home
      </a>
    </main>
  );
}
