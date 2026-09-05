import { useCallback, useEffect, useState } from 'react';

const KEY = 'huddle:sidebar';

/**
 * Whether the sidebar is a rail, remembered across visits.
 *
 * Read after the first paint rather than during it. This is a prerendered
 * client bundle, so reading storage while rendering would produce different
 * markup on the server and in the browser, and React would throw the whole
 * tree away to reconcile them.
 */
export function useCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY) === 'rail');
    } catch {
      // Storage can be refused outright in a private window. The sidebar
      // simply opens wide, which is the better default anyway.
    }
  }, []);

  const change = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(KEY, next ? 'rail' : 'wide');
    } catch {
      // Not remembering it is survivable. Not applying it would not be.
    }
  }, []);

  return [collapsed, change];
}
