import type { Me } from '@huddle/core';
import { redirect } from 'react-router';
import { ApiError, api } from './api';

/**
 * The one place a screen decides whether someone is signed in. The session is
 * a cookie the client cannot read, so this is a real request rather than a
 * local check, and its result is what every guarded route waits on.
 */
export async function currentMe(): Promise<Me | null> {
  try {
    return await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requireMe(): Promise<Me> {
  const me = await currentMe();
  if (me) return me;

  // Carry the destination through the sign in round trip, so an invite link
  // opened by a signed out person still lands where it was pointing.
  const { pathname, search } = window.location;
  throw redirect(`/signin?next=${encodeURIComponent(pathname + search)}`);
}
