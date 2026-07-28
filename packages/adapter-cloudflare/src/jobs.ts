import type { JobRunner } from '@huddle/domain';

/**
 * The default runner, and the reason a busy workspace still costs nothing.
 *
 * Cloudflare Queues bill past 10k messages a month, which one active team
 * passes in days, so background work rides on the request that caused it via
 * `waitUntil`. The response has already been sent by then, so the user waits
 * for nothing.
 *
 * `ctx` is held rather than destructured because ExecutionContext methods lose
 * their binding when pulled off the object.
 */
export class WaitUntilJobRunner implements JobRunner {
  constructor(
    private readonly ctx: ExecutionContext,
    private readonly onError: (name: string, error: unknown) => void = defaultOnError,
  ) {}

  run(name: string, work: () => Promise<void>): void {
    this.ctx.waitUntil(
      work().catch((error: unknown) => {
        this.onError(name, error);
      }),
    );
  }
}

function defaultOnError(name: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'job_failed',
      job: name,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}
