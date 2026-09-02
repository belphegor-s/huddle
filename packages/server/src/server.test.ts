import { ulid, type ChannelSummary, type Message, type Workspace } from '@huddle/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from './app.js';
import { ConsoleMailer } from './storage/mail.js';
import type { SearchResult } from './services/search.js';
import { createTestApp } from './testing/index.js';
import { asJson, Client } from './testing/harness.js';

let app: App;

beforeEach(async () => {
  app = await createTestApp();
});

afterEach(async () => {
  await app.close();
});

function draft(text: string, extra: Partial<{ parentId: string; mentions: string[] }> = {}) {
  return {
    id: ulid(),
    body: JSON.stringify({ type: 'doc', content: [] }),
    text,
    parentId: extra.parentId ?? null,
    attachments: [],
    mentions: extra.mentions ?? [],
  };
}

async function workspaceFor(client: Client, slug: string): Promise<Workspace> {
  const created = await client.post('/api/workspaces', { name: slug, slug });
  const body = await asJson<{ workspace: Workspace }>(created);
  return body.workspace;
}

async function channelIn(client: Client, workspaceId: string, name: string): Promise<string> {
  const created = await client.post(`/api/workspaces/${workspaceId}/channels`, { name });
  const body = await asJson<ChannelSummary>(created);
  return body.channel.id;
}

describe('boot', () => {
  it('serves health without a session', async () => {
    const response = await app.api.fetch(new Request('http://localhost:3000/api/health'));
    expect(response.status).toBe(200);
    expect(await asJson<{ ok: boolean }>(response)).toMatchObject({ ok: true });
  });

  it('refuses the API without a session', async () => {
    const response = await app.api.fetch(new Request('http://localhost:3000/api/me'));
    expect(response.status).toBe(401);
  });
});

describe('sign in', () => {
  it('creates an account from a magic link', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const me = await client.json<{ user: { email: string } }>('/api/me');
    expect(me.user.email).toBe('ada@example.com');
  });

  it('treats a link as spent once it is used', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const mailer = app.ctx.mail;
    if (!(mailer instanceof ConsoleMailer)) throw new Error('Expected the console mailer');

    const link = /https?:\/\/\S+/.exec(mailer.sent[0]?.text ?? '')?.[0] ?? '';
    const second = await app.api.fetch(new Request(link, { redirect: 'manual' }));

    expect(second.headers.get('location')).toContain('/signin?error=link_expired');
  });
});

describe('messages', () => {
  it('assigns a dense sequence and reads it back in order', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    for (const text of ['one', 'two', 'three']) {
      const sent = await client.post(`/api/channels/${channelId}/messages`, draft(text));
      expect(sent.status).toBe(201);
    }

    const page = await client.json<{ messages: Message[]; latestSeq: number }>(
      `/api/channels/${channelId}/messages`,
    );

    expect(page.messages.map((message) => message.text)).toEqual(['one', 'two', 'three']);
    expect(page.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
    expect(page.latestSeq).toBe(3);
  });

  it('never gives two concurrent sends the same sequence', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        client.post(`/api/channels/${channelId}/messages`, draft(`message ${index}`)),
      ),
    );

    const page = await client.json<{ messages: Message[] }>(`/api/channels/${channelId}/messages`);
    const sequences = page.messages.map((message) => message.seq);

    expect(new Set(sequences).size).toBe(12);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('treats a resent draft id as the same message', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    const body = draft('sent twice on a flaky network');
    await client.post(`/api/channels/${channelId}/messages`, body);
    await client.post(`/api/channels/${channelId}/messages`, body);

    const page = await client.json<{ messages: Message[] }>(`/api/channels/${channelId}/messages`);
    expect(page.messages).toHaveLength(1);
  });

  it('replays only the delta a reconnecting client is missing', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    for (const text of ['one', 'two', 'three']) {
      await client.post(`/api/channels/${channelId}/messages`, draft(text));
    }

    const delta = await client.json<{ messages: Message[] }>(
      `/api/channels/${channelId}/messages/since?seq=1`,
    );
    expect(delta.messages.map((message) => message.text)).toEqual(['two', 'three']);
  });

  it('keeps the sequence dense when a message is deleted', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    const first = await asJson<Message>(
      await client.post(`/api/channels/${channelId}/messages`, draft('regrettable')),
    );
    await client.post(`/api/channels/${channelId}/messages`, draft('after'));
    await client.delete(`/api/channels/${channelId}/messages/${first.id}`);

    const page = await client.json<{ messages: Message[] }>(`/api/channels/${channelId}/messages`);

    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]?.deletedAt).not.toBeNull();
    expect(page.messages[0]?.text).toBe('');
  });

  it('toggles a reaction on and back off', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');
    const message = await asJson<Message>(
      await client.post(`/api/channels/${channelId}/messages`, draft('worth a look')),
    );

    const on = await asJson<Array<{ emoji: string; userIds: string[] }>>(
      await client.post(`/api/channels/${channelId}/messages/${message.id}/reactions`, {
        emoji: '\u{1f44d}',
        on: true,
      }),
    );
    expect(on[0]?.userIds).toHaveLength(1);

    const off = await asJson<unknown[]>(
      await client.post(`/api/channels/${channelId}/messages/${message.id}/reactions`, {
        emoji: '\u{1f44d}',
        on: false,
      }),
    );
    expect(off).toHaveLength(0);
  });
});

describe('unread', () => {
  it('counts what someone else sent and clears it on read', async () => {
    const ada = new Client(app);
    const sam = new Client(app);
    await ada.signIn('ada@example.com');
    await sam.signIn('sam@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const channelId = await channelIn(ada, workspace.id, 'general');

    const invite = await asJson<{ token: string }>(
      await ada.post(`/api/workspaces/${workspace.id}/invites`, {}),
    );
    await sam.post(`/api/invites/${invite.token}/accept`);
    await sam.post(`/api/channels/${channelId}/join`);

    await ada.post(`/api/channels/${channelId}/messages`, draft('anyone there'));
    await ada.post(`/api/channels/${channelId}/messages`, draft('still here'));

    const before = await sam.json<ChannelSummary[]>(`/api/workspaces/${workspace.id}/channels`);
    expect(before[0]?.unreadCount).toBe(2);

    await sam.post(`/api/channels/${channelId}/read`, { seq: 2 });

    const after = await sam.json<ChannelSummary[]>(`/api/workspaces/${workspace.id}/channels`);
    expect(after[0]?.unreadCount).toBe(0);
  });

  it('counts a mention separately from an ordinary message', async () => {
    const ada = new Client(app);
    const sam = new Client(app);
    await ada.signIn('ada@example.com');
    await sam.signIn('sam@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const channelId = await channelIn(ada, workspace.id, 'general');
    const invite = await asJson<{ token: string }>(
      await ada.post(`/api/workspaces/${workspace.id}/invites`, {}),
    );
    await sam.post(`/api/invites/${invite.token}/accept`);
    await sam.post(`/api/channels/${channelId}/join`);

    const samId = (await sam.json<{ user: { id: string } }>('/api/me')).user.id;
    await ada.post(
      `/api/channels/${channelId}/messages`,
      draft('@sam can you look', { mentions: [samId] }),
    );

    const summaries = await sam.json<ChannelSummary[]>(`/api/workspaces/${workspace.id}/channels`);
    expect(summaries[0]?.mentionCount).toBe(1);
  });
});

describe('isolation', () => {
  it('hides a channel in a workspace the caller is not in', async () => {
    const ada = new Client(app);
    const mallory = new Client(app);
    await ada.signIn('ada@example.com');
    await mallory.signIn('mallory@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const channelId = await channelIn(ada, workspace.id, 'general');

    const peek = await mallory.get(`/api/channels/${channelId}/messages`);
    expect(peek.status).toBe(404);
  });

  it('hides a private channel from a member who is not in it', async () => {
    const ada = new Client(app);
    const sam = new Client(app);
    await ada.signIn('ada@example.com');
    await sam.signIn('sam@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const invite = await asJson<{ token: string }>(
      await ada.post(`/api/workspaces/${workspace.id}/invites`, {}),
    );
    await sam.post(`/api/invites/${invite.token}/accept`);

    const created = await asJson<ChannelSummary>(
      await ada.post(`/api/workspaces/${workspace.id}/channels`, {
        name: 'leadership',
        isPrivate: true,
      }),
    );

    expect((await sam.get(`/api/channels/${created.channel.id}`)).status).toBe(404);
  });
});

describe('direct messages', () => {
  it('returns the same room when the same people open it twice', async () => {
    const ada = new Client(app);
    const sam = new Client(app);
    await ada.signIn('ada@example.com');
    await sam.signIn('sam@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const invite = await asJson<{ token: string }>(
      await ada.post(`/api/workspaces/${workspace.id}/invites`, {}),
    );
    await sam.post(`/api/invites/${invite.token}/accept`);
    const samId = (await sam.json<{ user: { id: string } }>('/api/me')).user.id;

    const first = await asJson<ChannelSummary>(
      await ada.post(`/api/workspaces/${workspace.id}/dms`, { userIds: [samId] }),
    );
    const second = await asJson<ChannelSummary>(
      await ada.post(`/api/workspaces/${workspace.id}/dms`, { userIds: [samId] }),
    );

    expect(second.channel.id).toBe(first.channel.id);
    expect(first.channel.name).toBeNull();
  });
});

describe('search', () => {
  it('finds a message and marks the match', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');
    await client.post(
      `/api/channels/${channelId}/messages`,
      draft('the deployment pipeline is green again'),
    );

    const hits = await client.json<SearchResult[]>(
      `/api/workspaces/${workspace.id}/search?q=pipeline`,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.channelName).toBe('general');
    expect(hits[0]?.snippet).toContain('pipeline');
  });

  it('never returns a message from a channel the caller cannot read', async () => {
    const ada = new Client(app);
    const sam = new Client(app);
    await ada.signIn('ada@example.com');
    await sam.signIn('sam@example.com');

    const workspace = await workspaceFor(ada, 'acme');
    const invite = await asJson<{ token: string }>(
      await ada.post(`/api/workspaces/${workspace.id}/invites`, {}),
    );
    await sam.post(`/api/invites/${invite.token}/accept`);

    const secret = await asJson<ChannelSummary>(
      await ada.post(`/api/workspaces/${workspace.id}/channels`, {
        name: 'leadership',
        isPrivate: true,
      }),
    );
    await ada.post(`/api/channels/${secret.channel.id}/messages`, draft('the acquisition closes'));

    const hits = await sam.json<SearchResult[]>(
      `/api/workspaces/${workspace.id}/search?q=acquisition`,
    );
    expect(hits).toEqual([]);
  });
});

describe('threads', () => {
  it('keeps a reply out of the channel view and inside the thread', async () => {
    const client = new Client(app);
    await client.signIn('ada@example.com');

    const workspace = await workspaceFor(client, 'acme');
    const channelId = await channelIn(client, workspace.id, 'general');

    const parent = await asJson<Message>(
      await client.post(`/api/channels/${channelId}/messages`, draft('what do we ship first')),
    );
    await client.post(
      `/api/channels/${channelId}/messages`,
      draft('search, then files', { parentId: parent.id }),
    );

    const thread = await client.json<{ parent: Message; page: { messages: Message[] } }>(
      `/api/channels/${channelId}/threads/${parent.id}`,
    );

    expect(thread.parent.id).toBe(parent.id);
    expect(thread.page.messages.map((message) => message.text)).toEqual(['search, then files']);
  });
});
