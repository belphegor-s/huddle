/**
 * Background work.
 *
 * Cloudflare Queues cost money past 10k messages a month, which one active
 * team burns through in days, so the default adapter runs jobs inline via
 * `ctx.waitUntil` and costs nothing. A queue backed runner is opt in for
 * installs that have the volume to need it. Both satisfy this port, so no
 * calling code knows the difference.
 */
export interface JobRunner {
  run(name: string, work: () => Promise<void>): void;
}
