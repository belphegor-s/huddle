import type { ChannelSummary, MemberProfile, Me, Role, Workspace } from '@huddle/core';
import { useOutletContext } from 'react-router';
import type { Capabilities } from './api';
import type { Realtime } from './realtime';

export interface WorkspaceContext {
  me: Me;
  workspace: Workspace;
  role: Role;
  members: MemberProfile[];
  channels: ChannelSummary[];
  realtime: Realtime;
  /** What this deployment has configured. Drawn from, never assumed. */
  features: Capabilities;
  /** Re-reads the sidebar after something changes its contents or its badges. */
  refresh(): void;
}

export function useWorkspace(): WorkspaceContext {
  return useOutletContext<WorkspaceContext>();
}

export function memberName(members: MemberProfile[], userId: string): string {
  return members.find((member) => member.id === userId)?.displayName ?? 'Someone';
}

export function memberAvatar(members: MemberProfile[], userId: string): string | null {
  return members.find((member) => member.id === userId)?.avatarUrl ?? null;
}

/** A DM is named by the people in it, not by a name anyone typed. */
export function channelTitle(
  summary: ChannelSummary,
  members: MemberProfile[],
  meId: string,
): string {
  if (summary.channel.name) return summary.channel.name;

  const others = summary.memberIds.filter((id) => id !== meId);
  if (others.length === 0) return 'You';
  return others.map((id) => memberName(members, id)).join(', ');
}

/**
 * What to call a room in a sentence. A direct message is not a channel, and
 * copy that says otherwise reads as though the app has not noticed who you are
 * talking to.
 */
export function isDirect(summary: ChannelSummary): boolean {
  return summary.channel.kind !== 'channel';
}

/** The name with its marker, for a heading or a placeholder. */
export function channelLabel(
  summary: ChannelSummary,
  members: MemberProfile[],
  meId: string,
): string {
  const title = channelTitle(summary, members, meId);
  return isDirect(summary) ? title : `#${title}`;
}

/** How a conversation introduces itself at the top of its own history. */
export function startOfConversation(
  summary: ChannelSummary,
  members: MemberProfile[],
  meId: string,
): string {
  if (!isDirect(summary)) return 'This is the start of the channel';

  const others = summary.memberIds.filter((id) => id !== meId);
  if (others.length === 0) return 'Messages to yourself. Nobody else can see these.';
  if (others.length === 1) {
    return `This is the start of your conversation with ${memberName(members, others[0] ?? '')}`;
  }

  return 'This is the start of this conversation';
}

/** The other person's picture, for a one to one conversation. */
export function dmAvatar(
  summary: ChannelSummary,
  members: MemberProfile[],
  meId: string,
): string | null {
  const others = summary.memberIds.filter((id) => id !== meId);
  return others.length === 1 ? memberAvatar(members, others[0] ?? '') : null;
}
