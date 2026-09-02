import { Avatar } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type SearchResult } from '../lib/api';
import { memberName, useWorkspace } from '../lib/workspace';

/**
 * The server sends match markers, not markup, so a message containing angle
 * brackets can never become an element here.
 */
const MATCH_START = '';
const MATCH_END = '';

export default function Search() {
  const { workspace, members } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const query = params.get('q') ?? '';

  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    // Debounced, so typing a word does not spend one query per keystroke.
    const timer = setTimeout(() => {
      void api
        .search(workspace.id, { q: query })
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, workspace.id]);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          to={`/w/${workspace.slug}`}
          aria-label="Back to channels"
          className="text-text-secondary grid size-9 place-items-center rounded-lg no-underline md:hidden"
        >
          {'‹'}
        </Link>
        <h1 className="text-xl">Search</h1>
      </header>

      <input
        value={query}
        onChange={(event) => setParams(event.target.value === '' ? {} : { q: event.target.value })}
        placeholder="Words in a message"
        autoFocus
        aria-label="Search messages"
        className="border-border bg-surface-sunken min-h-12 rounded-xl border px-4 text-base"
      />

      {query.trim() !== '' && !searching && results.length === 0 ? (
        <p className="text-text-secondary text-sm">Nothing matches that.</p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {results.map((hit) => (
          <li key={hit.messageId}>
            <Link
              to={`/w/${workspace.slug}/c/${hit.channelName ?? hit.channelId}`}
              className="border-border bg-surface-raised hover:bg-surface-hover flex gap-3 rounded-lg border px-3 py-2.5 no-underline"
            >
              <Avatar name={memberName(members, hit.authorId)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-text-muted flex gap-2 text-xs">
                  <span className="text-text-primary font-medium">
                    {memberName(members, hit.authorId)}
                  </span>
                  <span>{hit.channelName ? `#${hit.channelName}` : 'Direct message'}</span>
                  <span>{new Date(hit.createdAt).toLocaleDateString()}</span>
                </p>
                <p className="leading-message text-base">{highlight(hit.snippet)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function highlight(snippet: string): React.ReactNode[] {
  return snippet.split(MATCH_START).flatMap((chunk, index) => {
    if (index === 0) return [<span key={`p${index}`}>{chunk}</span>];

    const [matched = '', rest = ''] = chunk.split(MATCH_END);
    return [
      <mark key={`m${index}`} className="bg-accent-soft text-text-primary rounded-xs px-0.5">
        {matched}
      </mark>,
      <span key={`r${index}`}>{rest}</span>,
    ];
  });
}
