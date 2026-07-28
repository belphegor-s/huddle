/** Injected so time dependent behaviour is testable without waiting. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
