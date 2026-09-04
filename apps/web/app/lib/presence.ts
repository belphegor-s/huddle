import type { MemberProfile, Presence } from '@huddle/core';
import type { PresenceState } from '@huddle/ui';

export interface PresenceChoice {
  value: Presence;
  label: string;
  hint: string;
}

/** What the picker offers, in the order people reach for them. */
export const PRESENCE_CHOICES: PresenceChoice[] = [
  { value: 'active', label: 'Active', hint: 'Here and available' },
  { value: 'away', label: 'Away', hint: 'Around, but not at the keyboard' },
  { value: 'busy', label: 'Do not disturb', hint: 'Notifications stay quiet' },
  { value: 'invisible', label: 'Invisible', hint: 'You appear offline to everyone' },
];

/**
 * What to draw on somebody's avatar.
 *
 * A chosen state only shows while they are actually connected: somebody who
 * set themselves to busy last Tuesday and closed the tab is offline, not busy.
 * Being in a huddle wins over all of it, because it is the only state anybody
 * can act on.
 */
export function presenceOf(member: MemberProfile, inCall = false): PresenceState {
  if (inCall) return 'call';
  if (!member.online) return 'offline';
  if (member.presence === 'invisible') return 'offline';

  return member.presence;
}

/** The one line under a name, when there is one worth showing. */
export function statusLine(member: MemberProfile): string | null {
  const text = member.statusText?.trim();
  const emoji = member.statusEmoji?.trim();

  if (!text && !emoji) return null;
  return [emoji, text].filter(Boolean).join(' ');
}
