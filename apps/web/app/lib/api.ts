import type {
  Channel,
  ChannelSummary,
  CreateChannelInput,
  CreateUploadInput,
  CreateWorkspaceInput,
  DraftMessage,
  InviteSummary,
  LinkPreview,
  MemberProfile,
  Me,
  Message,
  Reaction,
  Role,
  UpdateChannelInput,
  UpdateChannelPrefsInput,
  UpdateProfileInput,
  UploadTicket,
  Workspace,
  WorkspaceMembership,
} from '@huddle/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface MessagePage {
  messages: Message[];
  latestSeq: number;
  hasMore: boolean;
}

export interface ChannelAccess {
  channel: Channel;
  role: Role;
  joined: boolean;
  lastSeq: number;
}

export interface SearchResult {
  messageId: string;
  channelId: string;
  channelName: string | null;
  authorId: string;
  snippet: string;
  createdAt: number;
  score: number;
}

/**
 * The session lives in an http only cookie, so every call carries credentials
 * and nothing in the client ever holds a token it could leak.
 */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'internal');
  }

  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const patch = <T>(path: string, body: unknown): Promise<T> =>
  call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

const remove = <T>(path: string): Promise<T> => call<T>(path, { method: 'DELETE' });

export interface Capabilities {
  ok: boolean;
  ai: boolean;
  push: boolean;
  files: boolean;
}

export const api = {
  capabilities: () => call<Capabilities>('/api/health'),
  me: () => call<Me>('/api/me'),
  updateProfile: (patchBody: UpdateProfileInput) => patch<Me['user']>('/api/me', patchBody),

  workspaces: () => call<WorkspaceMembership[]>('/api/workspaces'),
  createWorkspace: (input: CreateWorkspaceInput) =>
    post<WorkspaceMembership>('/api/workspaces', input),
  workspaceBySlug: (slug: string) =>
    call<WorkspaceMembership>(`/api/workspaces/${encodeURIComponent(slug)}`),
  createInvite: (workspaceId: string) =>
    post<{ token: string; expiresAt: number; role: Role }>(
      `/api/workspaces/${workspaceId}/invites`,
      {},
    ),
  invites: (workspaceId: string) => call<InviteSummary[]>(`/api/workspaces/${workspaceId}/invites`),
  revokeInvite: (workspaceId: string, inviteId: string) =>
    remove<{ ok: true }>(`/api/workspaces/${workspaceId}/invites/${inviteId}`),
  describeInvite: (token: string) =>
    call<{ workspace: Pick<Workspace, 'name' | 'slug'>; role: Role }>(
      `/api/invites/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) =>
    post<WorkspaceMembership>(`/api/invites/${encodeURIComponent(token)}/accept`),

  members: (workspaceId: string) => call<MemberProfile[]>(`/api/workspaces/${workspaceId}/members`),
  setMemberRole: (workspaceId: string, userId: string, role: Role) =>
    patch<MemberProfile>(`/api/workspaces/${workspaceId}/members/${userId}`, { role }),
  removeMember: (workspaceId: string, userId: string) =>
    remove<{ ok: true }>(`/api/workspaces/${workspaceId}/members/${userId}`),
  channels: (workspaceId: string) =>
    call<ChannelSummary[]>(`/api/workspaces/${workspaceId}/channels`),
  browseChannels: (workspaceId: string) =>
    call<Channel[]>(`/api/workspaces/${workspaceId}/channels/browse`),
  createChannel: (workspaceId: string, input: CreateChannelInput) =>
    post<ChannelSummary>(`/api/workspaces/${workspaceId}/channels`, input),
  openDm: (workspaceId: string, userIds: string[]) =>
    post<ChannelSummary>(`/api/workspaces/${workspaceId}/dms`, { userIds }),

  channelByRef: (workspaceId: string, ref: string) =>
    call<ChannelAccess>(
      `/api/workspaces/${workspaceId}/channels/by-ref/${encodeURIComponent(ref)}`,
    ),
  joinChannel: (channelId: string) => post<ChannelSummary>(`/api/channels/${channelId}/join`),
  leaveChannel: (channelId: string) =>
    remove<{ ok: true }>(`/api/channels/${channelId}/members/me`),
  updateChannel: (channelId: string, body: UpdateChannelInput) =>
    patch<Channel>(`/api/channels/${channelId}`, body),
  setChannelPrefs: (channelId: string, body: UpdateChannelPrefsInput) =>
    patch<{ ok: true }>(`/api/channels/${channelId}/prefs`, body),

  history: (channelId: string, before?: number) =>
    call<MessagePage>(
      `/api/channels/${channelId}/messages${before === undefined ? '' : `?before=${before}`}`,
    ),
  thread: (channelId: string, parentId: string) =>
    call<{ parent: Message; page: MessagePage }>(`/api/channels/${channelId}/threads/${parentId}`),
  send: (channelId: string, draft: DraftMessage) =>
    post<Message>(`/api/channels/${channelId}/messages`, draft),
  edit: (channelId: string, messageId: string, body: { body: string; text: string }) =>
    patch<Message>(`/api/channels/${channelId}/messages/${messageId}`, body),
  deleteMessage: (channelId: string, messageId: string) =>
    remove<{ messageId: string; seq: number }>(`/api/channels/${channelId}/messages/${messageId}`),
  react: (channelId: string, messageId: string, emoji: string, on: boolean) =>
    post<Reaction[]>(`/api/channels/${channelId}/messages/${messageId}/reactions`, { emoji, on }),
  markRead: (channelId: string, seq: number) =>
    post<{ readSeq: number }>(`/api/channels/${channelId}/read`, { seq }),

  search: (
    workspaceId: string,
    params: { q: string; channel?: string; author?: string; files?: boolean },
  ) => {
    const query = new URLSearchParams({ q: params.q });
    if (params.channel) query.set('channel', params.channel);
    if (params.author) query.set('author', params.author);
    if (params.files === true) query.set('files', 'true');
    return call<SearchResult[]>(`/api/workspaces/${workspaceId}/search?${query.toString()}`);
  },

  unfurl: (workspaceId: string, url: string) =>
    call<LinkPreview | null>(
      `/api/workspaces/${workspaceId}/unfurl?url=${encodeURIComponent(url)}`,
    ),

  requestUpload: (workspaceId: string, input: CreateUploadInput) =>
    post<UploadTicket>(`/api/workspaces/${workspaceId}/uploads`, input),

  pushKey: () => call<{ available: boolean; publicKey: string }>('/api/push/key'),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    post<{ ok: true }>('/api/push/subscriptions', subscription),
  unsubscribePush: (endpoint: string) =>
    call<{ ok: true }>('/api/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  summariseThread: (channelId: string, parentId: string) =>
    post<{ text: string }>(`/api/channels/${channelId}/threads/${parentId}/summary`),
  catchUp: (channelId: string, sinceSeq: number) =>
    post<{ text: string }>(`/api/channels/${channelId}/catch-up`, { sinceSeq }),

  signOut: () => post<{ ok: true }>('/api/auth/signout'),
  requestMagicLink: (email: string, redirectTo: string | null) =>
    post<{ ok: true; expiresAt: number }>('/api/auth/magic-link', { email, redirectTo }),
};
