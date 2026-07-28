import { CLEARED_SESSION_COOKIE, sessionTokenFrom } from '@huddle/api';
import { signOut } from '@huddle/domain';
import { redirect } from 'react-router';
import { portsContext } from '../lib/ports';
import type { Route } from './+types/signout';

/**
 * POST only. A GET would let any page on the internet sign someone out by
 * embedding an image.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const token = sessionTokenFrom(request);
  if (token) await signOut(context.get(portsContext), token);

  return redirect('/', { headers: { 'set-cookie': CLEARED_SESSION_COOKIE } });
}

export function loader() {
  return redirect('/');
}
