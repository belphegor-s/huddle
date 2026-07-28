import { InternalPath, RequestMagicLinkInput } from '@huddle/core';
import { requestMagicLink } from '@huddle/domain';
import { Button, TextField } from '@huddle/ui';
import { Form, redirect, useNavigation, useSearchParams } from 'react-router';
import { currentUser } from '../lib/session.server';
import { portsContext } from '../lib/ports';
import type { Route } from './+types/signin';

export function meta() {
  return [{ title: 'Sign in to huddle' }];
}

const LINK_PROBLEMS: Record<string, string> = {
  link_expired: 'That link has already been used or has expired. Here is a fresh one.',
  missing_link: 'That link was incomplete. Ask for another one.',
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = await currentUser(context, request);
  if (user) throw redirect(nextFrom(request) ?? '/');
  return null;
}

export async function action({ context, request }: Route.ActionArgs) {
  const form = await request.formData();
  const input = RequestMagicLinkInput.safeParse({
    email: form.get('email'),
    redirectTo: form.get('next') || null,
  });

  if (!input.success) {
    return { error: 'Enter an email address that can receive mail.', email: null };
  }

  const sent = await requestMagicLink(context.get(portsContext), {
    email: input.data.email,
    redirectTo: input.data.redirectTo,
    clientIp: request.headers.get('cf-connecting-ip') ?? 'unknown',
    appUrl: new URL(request.url).origin,
  });

  if (!sent.ok) {
    return {
      error: 'Too many sign in emails for now. Try again in an hour.',
      email: null,
    };
  }

  return { error: null, email: input.data.email };
}

function nextFrom(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('next');
  const parsed = InternalPath.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export default function SignIn({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const sending = navigation.state === 'submitting';
  const next = params.get('next') ?? '';
  const problem = LINK_PROBLEMS[params.get('error') ?? ''];

  if (actionData?.email) {
    return <CheckYourEmail email={actionData.email} />;
  }

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

function CheckYourEmail({ email }: { email: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl">Check your email</h1>
        <p className="text-text-secondary">
          A sign in link is on its way to <span className="text-text-primary">{email}</span>. It
          works once and expires in 15 minutes.
        </p>
      </div>

      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="email" value={email} />
        <Button type="submit" variant="secondary" size="lg">
          Send it again
        </Button>
      </Form>
    </main>
  );
}
