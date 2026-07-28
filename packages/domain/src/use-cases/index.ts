export { createSession, loadSession, requestMagicLink, signOut, verifyMagicLink } from './auth.js';
export type { AuthDeps, IssuedSession, MagicLinkRequest } from './auth.js';

export { describeMe, updateProfile } from './profile.js';
export type { ProfileDeps } from './profile.js';

export {
  acceptInvite,
  createInvite,
  createWorkspace,
  describeInvite,
  findWorkspaceBySlug,
  listWorkspaces,
  revokeInvite,
} from './workspaces.js';
export type { InviteError, WorkspaceDeps } from './workspaces.js';
