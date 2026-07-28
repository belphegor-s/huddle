import { acceptInvite, describeInvite } from '@huddle/domain';
import { Button } from '@huddle/ui';
import { Form, redirect, useNavigation } from 'react-router';
import { currentUser, requireUser } from '../lib/session.server';
import { portsContext } from '../lib/ports';
import type { Route } from './+types/join';

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.workspaceName;
  return [{ title: name ? `Join ${name}` : 'Invitation' }];
}

const PROBLEMS: Record<string, string> = {
  invalid_invite: 'This invitation is not valid any more.',
  expired: 'This invitation has expired. Ask for a new one.',
  used_up: 'This invitation has been used as many times as it was meant to be.',
};

/*
 * Readable while signed out on purpose. Someone handed a link should be able
 * to see what they are being asked to join before handing over an address.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
  const described = await describeInvite(context.get(portsContext), params.token);
  const user = await currentUser(context, request);

  if (!described.ok) {
    return { problem: PROBLEMS[described.error] ?? PROBLEMS.invalid_invite, workspaceName: null };
  }

  return {
    problem: null,
    workspaceName: described.value.workspace.name,
    role: described.value.role,
    signedInAs: user?.email ?? null,
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const joined = await acceptInvite(context.get(portsContext), {
    token: params.token,
    userId: user.id,
  });

  if (!joined.ok) return { problem: PROBLEMS[joined.error] ?? PROBLEMS.invalid_invite };

  throw redirect(`/w/${joined.value.workspace.slug}`);
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
