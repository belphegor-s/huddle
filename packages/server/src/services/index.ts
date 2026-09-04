export { outranks, requireMember } from './access.js';
export type { AccessError, Member } from './access.js';

export { createSession, loadSession, requestMagicLink, signOut, verifyMagicLink } from './auth.js';
export type { IssuedSession, MagicLinkRequest } from './auth.js';

export { describeMe, touchLastSeen, updateProfile } from './profile.js';

export {
  acceptInvite,
  createInvite,
  createWorkspace,
  describeInvite,
  findWorkspaceBySlug,
  listInvites,
  listWorkspaces,
  revokeInvite,
  updateWorkspace,
} from './workspaces.js';
export type { InviteError } from './workspaces.js';

export {
  browseChannels,
  channelMemberIds,
  createChannel,
  findChannelByRef,
  isDmKey,
  joinChannel,
  leaveChannel,
  listChannels,
  openDm,
  requireChannel,
  setChannelPrefs,
  toChannel,
  updateChannel,
} from './channels.js';
export type { ChannelAccess, ChannelError } from './channels.js';

export {
  deleteMessage,
  editMessage,
  fetchHistory,
  fetchThread,
  hydrateMessageEvent,
  markRead,
  markTyping,
  sendMessage,
  syncSince,
  toggleReaction,
  toMessage,
} from './messages.js';
export type { MessageError, MessagePage } from './messages.js';

export { searchMessages, MATCH_END, MATCH_START } from './search.js';
export type { SearchResult } from './search.js';

export { deleteFile, requestUpload, resolveDownload } from './files.js';
export type { UploadError } from './files.js';

export { notifyNewMessage, removePushSubscription, savePushSubscription } from './notifications.js';
export type { PushError, SavePushInput } from './notifications.js';

export { unfurlLink } from './unfurl.js';
export type { UnfurlError } from './unfurl.js';

export { catchUp, summariseThread } from './assistant.js';
export type { AssistantError } from './assistant.js';

export { listMembers, removeMember, setMemberRole } from './members.js';
export type { MemberError } from './members.js';

export {
  callCounts,
  heartbeatCall,
  joinCall,
  leaveCall,
  relaySignal,
  roster,
  updateCallState,
} from './calls.js';
export type { CallError } from './calls.js';
