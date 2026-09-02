import type { ChannelSummary, MemberProfile, Me, Role, Workspace } from '@huddle/core';
import { useOutletContext } from 'react-router';
import type { Realtime } from './realtime';

export interface WorkspaceContext {
  me: Me;
  workspace: Workspace;
  role: Role;
  members: MemberProfile[];
  channels: ChannelSummary[];
  realtime: Realtime;
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
