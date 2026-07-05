import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getOperators: vi.fn(),
  getOperatorById: vi.fn(),
  createOperator: vi.fn(),
  updateOperator: vi.fn(),
  deleteOperator: vi.fn(),
  getChats: vi.fn(),
  getChatById: vi.fn(),
  createChat: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-07-05T00:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const { chats: chatsModule } = await import('./chats.js');

function makeChatDb(opts: { friendId: string; messageRows: { id: string; created_at: string }[] }) {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind(..._args: unknown[]) {
          return stmt;
        },
        async first<_T>() {
          if (/SELECT \* FROM chats WHERE friend_id/i.test(sql)) return null;
          if (/SELECT display_name, picture_url, line_user_id FROM friends/i.test(sql)) {
            return { display_name: 'Test User', picture_url: null, line_user_id: 'U123' };
          }
          return null;
        },
        async all<_T>() {
          if (/FROM messages_log/i.test(sql)) {
            return { results: opts.messageRows };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function setupApp(db: D1Database) {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    await next();
  });
  app.route('/', chatsModule);
  return app;
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset?.();
  dbMocks.jstNow.mockReturnValue('2026-07-05T00:00:00.000+09:00');
});

describe('GET /api/chats/:id message history truncation', () => {
  test('flags truncated=true when the 1000-row buffer is fully used up', async () => {
    dbMocks.getChatById.mockResolvedValue(null);
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', is_following: 1 });
    const messageRows = Array.from({ length: 1000 }, (_, i) => ({
      id: `m${i}`,
      friend_id: 'friend-1',
      direction: 'outgoing',
      message_type: 'text',
      content: `msg ${i}`,
      created_at: '2026-07-01T00:00:00.000',
    }));
    const db = makeChatDb({ friendId: 'friend-1', messageRows });

    const res = await setupApp(db).request('/api/chats/friend-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { truncated?: boolean } };
    expect(body.success).toBe(true);
    // A friend with >=1000 logged messages means older history was silently
    // dropped by the LIMIT 1000 buffer (chats.ts's Phase-2-pagination TODO).
    // The UI needs this flag to warn the operator instead of staying silent.
    expect(body.data.truncated).toBe(true);
  });

  test('flags truncated=false when under the buffer size', async () => {
    dbMocks.getChatById.mockResolvedValue(null);
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', is_following: 1 });
    const messageRows = [
      { id: 'm1', friend_id: 'friend-1', direction: 'outgoing', message_type: 'text', content: 'hi', created_at: '2026-07-01T00:00:00.000' },
    ];
    const db = makeChatDb({ friendId: 'friend-1', messageRows });

    const res = await setupApp(db).request('/api/chats/friend-1');
    const body = (await res.json()) as { success: boolean; data: { truncated?: boolean } };
    expect(body.data.truncated).toBe(false);
  });
});
