import { RequestMagicLinkInput } from '@huddle/core';
import { Button, Icon, TextField } from '@huddle/ui';
import { Form, redirect, useNavigation, useSearchParams } from 'react-router';
import { pageMeta } from '../lib/meta';
import { api, ApiError } from '../lib/api';
import { currentMe } from '../lib/session';
import type { Route } from './+types/signin';

export function meta() {
  return pageMeta({
    title: 'Sign in to huddle',
    description: 'Sign in with a link sent to your email.',
    private: true,
  });
}

const LINK_PROBLEMS: Record<string, string> = {
  link_expired: 'That link has already been used or has expired. Here is a fresh one.',
  missing_link: 'That link was incomplete. Ask for another one.',
};

export async function clientLoader() {
  const me = await currentMe();
  if (me) throw redirect(nextFrom() ?? '/');
  return null;
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const input = RequestMagicLinkInput.safeParse({
    email: form.get('email'),
    redirectTo: form.get('next') || null,
  });

  if (!input.success) {
    return { error: 'Enter an email address that can receive mail.', email: null };
  }

  try {
    await api.requestMagicLink(input.data.email, input.data.redirectTo);
  } catch (error) {
    const tooMany = error instanceof ApiError && error.status === 429;
    return {
      error: tooMany
        ? 'Too many sign in emails for now. Try again in an hour.'
        : 'That did not go through. Try again in a moment.',
      email: null,
    };
  }

  return { error: null, email: input.data.email };
}

function nextFrom(): string | null {
  const raw = new URLSearchParams(window.location.search).get('next');
  return raw !== null && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

export default function SignIn({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const sending = navigation.state === 'submitting';
  const next = params.get('next') ?? '';
  const problem = LINK_PROBLEMS[params.get('error') ?? ''];

  if (actionData?.email) return <CheckYourEmail email={actionData.email} next={next} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl">Sign in to huddle</h1>
        <p className="text-text-secondary">
          No password. We send a link that signs you in on this device.
        </p>
      </header>

      {problem ? (
        <p role="status" className="bg-surface-sunken rounded-lg px-4 py-3 text-sm">
          {problem}
        </p>
      ) : null}

      <Form method="post" className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          placeholder="you@company.com"
          error={actionData?.error ?? null}
        />
        <Button type="submit" size="lg" disabled={sending}>
          {sending ? 'Sending' : 'Email me a link'}
        </Button>
      </Form>
    </main>
  );
}

function CheckYourEmail({ email, next }: { email: string; next: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col gap-4">
        <span className="pop-in bg-accent-soft text-accent flex size-12 items-center justify-center rounded-2xl">
          <Icon name="mail" className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl">Check your email</h1>
          <p className="text-text-secondary">
            A sign in link is on its way to{' '}
            <span className="text-text-primary break-all">{email}</span>. It works once and
            expires in 15 minutes.
          </p>
        </div>
      </div>

      <aside
        role="note"
        className="rise-in border-caution/30 bg-caution/10 flex gap-3 rounded-xl border px-4 py-3.5"
      >
        <span className="bg-caution mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-text-primary font-medium">Not in your inbox?</p>
          <p className="text-text-secondary">
            Look in spam or junk. Sign in emails often land there the first time. Marking it as
            not spam helps the next one arrive where it should.
          </p>
        </div>
      </aside>

      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" size="lg">
          Send it again
        </Button>
      </Form>
    </main>
  );
}
