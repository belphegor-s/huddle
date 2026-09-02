import { CreateWorkspaceInput } from '@huddle/core';
import { Button, TextField } from '@huddle/ui';
import { useState } from 'react';
import { Form, redirect, useNavigation } from 'react-router';
import { api } from '../lib/api';
import { requireMe } from '../lib/session';
import type { Route } from './+types/new-workspace';

export function meta() {
  return [{ title: 'New workspace' }];
}

export async function clientLoader() {
  const me = await requireMe();
  return { displayName: me.user.displayName };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const input = CreateWorkspaceInput.safeParse({
    name: form.get('name'),
    slug: form.get('slug'),
  });

  if (!input.success) {
    return { error: input.error.issues[0]?.message ?? 'Check the details and try again.' };
  }

  try {
    const created = await api.createWorkspace(input.data);
    return redirect(`/w/${created.workspace.slug}`);
  } catch {
    return { error: 'That address is taken. Pick another one.' };
  }
}

/** Mirrors the server rule in core, so the field cannot suggest a name the server will reject. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function NewWorkspace({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const effectiveSlug = slugTouched ? slug : toSlug(name);
  const busy = navigation.state === 'submitting';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl">Create a workspace</h1>
        <p className="text-text-secondary">
          One workspace per team. You can invite people once it exists.
        </p>
      </header>

      <Form method="post" className="flex flex-col gap-5">
        <TextField
          label="Team name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
          maxLength={80}
          placeholder="Acme"
        />

        <TextField
          label="Address"
          name="slug"
          value={effectiveSlug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(toSlug(event.target.value));
          }}
          required
          minLength={2}
          maxLength={40}
          hint="Lowercase letters, numbers and hyphens."
          error={actionData?.error ?? null}
        />

        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Creating' : 'Create workspace'}
        </Button>
      </Form>
    </main>
  );
}
