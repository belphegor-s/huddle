import { sessionFromRequest } from '@huddle/api';
import type { User } from '@huddle/core';
import { redirect, type RouterContextProvider } from 'react-router';
import { portsContext } from './ports';

type LoadContext = Readonly<RouterContextProvider>;

/**
 * The one place a page decides whether someone is signed in. Loaders and
 * actions both go through it, so no route reads the cookie in its own
 * slightly different way.
 */
export function currentUser(context: LoadContext, request: Request): Promise<User | null> {
  return sessionFromRequest(context.get(portsContext), request);
}

export async function requireUser(context: LoadContext, request: Request): Promise<User> {
  const user = await currentUser(context, request);
  if (user) return user;

  // Carry the destination through the sign in round trip, so an invite link
  // opened by a signed out person still lands where it was pointing.
  const { pathname, search } = new URL(request.url);
  throw redirect(`/signin?next=${encodeURIComponent(pathname + search)}`);
}
