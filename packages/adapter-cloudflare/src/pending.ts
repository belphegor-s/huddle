import type { PushResult, PushSender, RealtimeHub } from '@huddle/domain';
import type { ServerEvent } from '@huddle/core';

/**
 * Realtime fanout lands in Phase 2 with the ChannelRoom WebSocket work, and
 * Web Push lands in Phase 4. Until then these fail loudly rather than
 * pretending to work, because a notification that silently vanishes is worse
 * than one that errors.
 */

function unimplemented(feature: string): never {
  throw new Error(`${feature} is not implemented yet on this build`);
}

export const pendingRealtime: RealtimeHub = {
  async publish(_channelId: string, _event: ServerEvent) {
    unimplemented('Realtime fanout');
  },
  async publishToUser() {
    unimplemented('Realtime fanout');
  },
  async markTyping() {
    unimplemented('Realtime fanout');
  },
  async presence() {
    unimplemented('Realtime presence');
  },
};

export const pendingPush: PushSender = {
  async send(): Promise<PushResult> {
    return { ok: false, expired: false, reason: 'push_not_implemented' };
  },
};
