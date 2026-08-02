import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

export async function apiNoStoreCacheMiddleware(c: Context<Env>, next: Next): Promise<void> {
  await next();
  c.header('Cache-Control', 'no-store');
}
