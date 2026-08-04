import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
}));

import {
  getEntryRouteByRefCode,
  getPoolAccounts,
  getRandomPoolAccount,
  getTrafficPoolById,
  getTrafficPoolBySlug,
} from '@line-crm/db';
import worker, { type Env } from './index.js';

const baseEnv = {
  DB: {} as D1Database,
  LIFF_URL: 'https://liff.line.me/2010944622-92mAoJXV',
  API_KEY: 'test-api-key',
} satisfies Partial<Env['Bindings']>;

const routeCases = [
  {
    label: '大阪LINEグループ用',
    ref: 'osaka-yuka-form',
    target:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&ref=osaka-yuka-form',
    htmlTarget:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&amp;ref=osaka-yuka-form',
    encodedTarget:
      'https%3A%2F%2Fliff.line.me%2F2010944622-92mAoJXV%3FliffId%3D2010944622-92mAoJXV%26ref%3Dosaka-yuka-form',
  },
  {
    label: '大阪一般用',
    ref: 'osaka-general-form',
    target:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&ref=osaka-general-form',
    htmlTarget:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&amp;ref=osaka-general-form',
    encodedTarget:
      'https%3A%2F%2Fliff.line.me%2F2010944622-92mAoJXV%3FliffId%3D2010944622-92mAoJXV%26ref%3Dosaka-general-form',
  },
  {
    label: '東京一般用',
    ref: 'tokyo-form',
    target:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&ref=tokyo-form',
    htmlTarget:
      'https://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&amp;ref=tokyo-form',
    encodedTarget:
      'https%3A%2F%2Fliff.line.me%2F2010944622-92mAoJXV%3FliffId%3D2010944622-92mAoJXV%26ref%3Dtokyo-form',
  },
];

async function fetchRoute(path: string, userAgent: string) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      headers: { 'user-agent': userAgent },
    }),
    baseEnv as Env['Bindings'],
  );
}

describe('/r/:ref LIFF target', () => {
  beforeEach(() => {
    vi.mocked(getEntryRouteByRefCode).mockReset().mockResolvedValue(null);
    vi.mocked(getTrafficPoolBySlug).mockReset().mockResolvedValue(null);
    vi.mocked(getTrafficPoolById).mockReset().mockResolvedValue(null);
    vi.mocked(getRandomPoolAccount).mockReset().mockResolvedValue(null);
    vi.mocked(getPoolAccounts).mockReset().mockResolvedValue([]);
  });

  it('uses query-style LIFF URL for the mobile LINE button without re-entering /r/:ref', async () => {
    for (const routeCase of routeCases) {
      const res = await fetchRoute(
        `/r/${routeCase.ref}`,
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      );
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain(`href="${routeCase.htmlTarget}"`);
      expect(html).not.toContain(`/2010944622-92mAoJXV/r/${routeCase.ref}`);
      expect(html).not.toContain(`/r/${routeCase.ref}">LINEで開く`);
    }
  });

  it('uses query-style LIFF URL inside the Android intent and fallback URL', async () => {
    for (const routeCase of routeCases) {
      const res = await fetchRoute(
        `/r/${routeCase.ref}`,
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile',
      );
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain(
        `href="intent://liff.line.me/2010944622-92mAoJXV?liffId=2010944622-92mAoJXV&amp;ref=${routeCase.ref}#Intent;`,
      );
      expect(html).toContain(`S.browser_fallback_url=${routeCase.encodedTarget}`);
      expect(html).not.toContain(`/2010944622-92mAoJXV/r/${routeCase.ref}`);
    }
  });

  it('encodes query-style LIFF URL in the desktop QR code', async () => {
    for (const routeCase of routeCases) {
      const res = await fetchRoute(
        `/r/${routeCase.ref}`,
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
      );
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain(`/api/qr?size=240x240&data=${routeCase.encodedTarget}`);
      expect(html).not.toContain(`%2F2010944622-92mAoJXV%2Fr%2F${routeCase.ref}`);
    }
  });

  it('preserves form and each referral route in the LIFF query string', async () => {
    for (const routeCase of routeCases) {
      const res = await fetchRoute(
        `/r/${routeCase.ref}?form=lesson-form-id&gate=autumn-2026&ig=ig-session`,
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      );
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain(`ref=${routeCase.ref}`);
      expect(html).toContain('form=lesson-form-id');
      expect(html).toContain('gate=autumn-2026');
      expect(html).toContain('ig=ig-session');
      expect(html).not.toContain(`/2010944622-92mAoJXV/r/${routeCase.ref}`);
    }
  });
});
