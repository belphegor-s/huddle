import { Button } from '@huddle/ui';
import { Form, redirect, useNavigation } from 'react-router';
import { api, ApiError } from '../lib/api';
import { pageMeta } from '../lib/meta';
import { currentMe, requireMe } from '../lib/session';
import type { Route } from './+types/join';

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.workspaceName;

  /*
   * An invitation is pasted into a chat window far more often than it is
   * opened from a search result, so it gets a proper card and is kept out of
   * search rather than being given no tags at all.
   */
  return pageMeta({
    title: name ? `Join ${name} on huddle` : 'An invitation to huddle',
    description: name
      ? `You have been invited to ${name}. huddle is open source team chat: channels, threads, huddles and search, with end to end encrypted conversations.`
      : 'You have been invited to a workspace on huddle, open source team chat you host yourself.',
    private: true,
  });
}

const PROBLEMS: Record<string, string> = {
  invalid_invite: 'This invitation is not valid any more.',
  expired: 'This invitation has expired. Ask for a new one.',
  used_up: 'This invitation has been used as many times as it was meant to be.',
};

const FALLBACK = 'This invitation is not valid any more.';

/*
 * Readable while signed out on purpose. Someone handed a link should be able
 * to see what they are being asked to join before handing over an address.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const me = await currentMe();

  try {
    const described = await api.describeInvite(params.token);
    return {
      problem: null,
      workspaceName: described.workspace.name,
      signedInAs: me?.user.email ?? null,
    };
  } catch (error) {
    return {
      problem: problemFor(error),
      workspaceName: null,
      signedInAs: me?.user.email ?? null,
    };
  }
}

export async function clientAction({ params }: Route.ClientActionArgs) {
  await requireMe();

  try {
    const joined = await api.acceptInvite(params.token);
    return redirect(`/w/${joined.workspace.slug}`);
  } catch (error) {
    return { problem: problemFor(error) };
  }
}

function problemFor(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'invalid_invite';
  return PROBLEMS[code] ?? FALLBACK;
}

export default function Join({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const problem = actionData?.problem ?? loaderData.problem;

  if (problem) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl">Invitation unavailable</h1>
        <p className="text-text-secondary">{problem}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl">Join {loaderData.workspaceName}</h1>
        <p className="text-text-secondary">
          {loaderData.signedInAs
            ? `You are signed in as ${loaderData.signedInAs}.`
            : 'Sign in with your email and you will land straight in the workspace.'}
        </p>
      </header>

      <Form method="post">
        <Button type="submit" size="lg" disabled={navigation.state === 'submitting'}>
          {navigation.state === 'submitting' ? 'Joining' : 'Join workspace'}
        </Button>
      </Form>
    </main>
  );
}
