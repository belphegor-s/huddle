import { redirect } from 'react-router';
import { api } from '../lib/api';

/**
 * POST only. A GET would let any page on the internet sign someone out by
 * embedding an image.
 */
export async function clientAction() {
  await api.signOut().catch(() => undefined);
  return redirect('/');
}

export function clientLoader() {
  return redirect('/');
}

export default function SignOut() {
  return null;
}
