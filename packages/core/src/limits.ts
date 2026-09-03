/**
 * Shared limits. The client enforces these for fast feedback and the server
 * enforces them again because the client is not trusted.
 */
export const LIMITS = {
  messageTextMax: 16_000,
  attachmentsPerMessage: 20,
  mentionsPerMessage: 64,
  /** Free tier R2 is 10GB total, so a generous but bounded per file cap. */
  fileBytesMax: 100 * 1024 * 1024,
  voiceNoteMs: 5 * 60 * 1000,
  waveformPeaks: 128,
  channelNameMax: 80,
  channelTopicMax: 280,
  displayNameMax: 80,
  /** Replay window for a reconnecting client before it falls back to a fetch. */
  reconnectReplayMax: 500,
  typingTtlMs: 5_000,
} as const;

export const RATE_LIMITS = {
  sendMessagePerMinute: 60,
  magicLinkPerHourPerEmail: 5,
  /**
   * Deliberately loose, and configurable, because a whole office behind one
   * NAT address shares it. Tight enough to stop a sprayer, loose enough that
   * a team arriving on a Monday morning can all sign in. The per address
   * limit above is the one doing the real work.
   */
  magicLinkPerHourPerIp: 100,
  uploadsPerMinute: 30,
} as const;
