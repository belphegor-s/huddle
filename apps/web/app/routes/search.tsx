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
  const { workspace, members, channels } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const query = params.get('q') ?? '';
  const author = params.get('author') ?? '';
  const channel = params.get('channel') ?? '';
  const files = params.get('files') === 'true';

  /** Keeps the other filters when one of them changes. */
  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(name);
    else next.set(name, value);
    setParams(next);
  }

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
        .search(workspace.id, {
          q: query,
          author: author === '' ? undefined : author,
          channel: channel === '' ? undefined : channel,
          files: files ? true : undefined,
        })
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
  }, [query, author, channel, files, workspace.id]);

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
        onChange={(event) => setFilter('q', event.target.value)}
        placeholder="Words in a message"
        autoFocus
        aria-label="Search messages"
        className="border-border bg-surface-sunken min-h-12 rounded-xl border px-4 text-base"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="search-author">
          From
        </label>
        <select
          id="search-author"
          value={author}
          onChange={(event) => setFilter('author', event.target.value)}
          className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
        >
          <option value="">Anyone</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="search-channel">
          In
        </label>
        <select
          id="search-channel"
          value={channel}
          onChange={(event) => setFilter('channel', event.target.value)}
          className="border-border bg-surface min-h-9 rounded-lg border px-2 text-sm"
        >
          <option value="">Any channel</option>
          {channels.map((summary) => (
            <option key={summary.channel.id} value={summary.channel.id}>
              {summary.channel.name === null ? 'Direct message' : `#${summary.channel.name}`}
            </option>
          ))}
        </select>

        <label className="border-border flex min-h-9 items-center gap-2 rounded-lg border px-2 text-sm">
          <input
            type="checkbox"
            checked={files}
            onChange={(event) => setFilter('files', event.target.checked ? 'true' : '')}
            className="size-4"
          />
          With a file
        </label>
      </div>

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
