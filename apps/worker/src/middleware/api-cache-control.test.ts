import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { apiNoStoreCacheMiddleware } from './api-cache-control.js';

function setupApp() {
  const app = new Hono();
  app.use('/api/*', apiNoStoreCacheMiddleware);
  app.get('/api/ok', (c) => c.json({ success: true }));
  app.get('/api/error', (c) => c.json({ success: false, error: 'Unauthorized' }, 401));
  app.get('/api/cached', () =>
    new Response('image', {
      headers: {
        'Cache-Control': 'public, max-age=86400',
        'Content-Type': 'image/png',
      },
    }),
  );
  app.options('/api/ok', () => new Response(null, { status: 204 }));
  app.get('/r/ref', (c) => c.text('landing'));
  return app;
}

describe('apiNoStoreCacheMiddleware', () => {
  it('adds no-store to successful /api/* responses', async () => {
    const res = await setupApp().request('/api/ok');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('adds no-store to /api/* error responses', async () => {
    const res = await setupApp().request('/api/error');
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('adds no-store to /api/* OPTIONS responses', async () => {
    const res = await setupApp().request('/api/ok', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('adds no-store to CORS preflight responses when mounted before CORS', async () => {
    const app = new Hono();
    app.use('/api/*', apiNoStoreCacheMiddleware);
    app.use('*', cors({ origin: 'https://admin.example.com' }));
    app.get('/api/ok', (c) => c.json({ success: true }));

    const res = await app.request('/api/ok', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://admin.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.example.com');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('overrides route-level cache headers under /api/*', async () => {
    const res = await setupApp().request('/api/cached');
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not affect non-/api/* responses', async () => {
    const res = await setupApp().request('/r/ref');
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
