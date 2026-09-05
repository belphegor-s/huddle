import { Avatar, Checkbox, Select } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type SearchResult } from '../lib/api';
import { channelLabel, memberName, useWorkspace } from '../lib/workspace';

/**
 * The server sends match markers, not markup, so a message containing angle
 * brackets can never become an element here.
 */
const MATCH_START = '';
const MATCH_END = '';

export default function Search() {
  const { me, workspace, members, channels } = useWorkspace();
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

  /**
   * The server sends a channel name, which a direct message does not have. It
   * is named here instead, where the roster is, so a result reads as the
   * conversation it came from rather than as a generic label.
   */
  function whereFrom(channelId: string): string {
    const summary = channels.find((candidate) => candidate.channel.id === channelId);
    return summary ? channelLabel(summary, members, me.user.id) : 'A conversation';
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          to={`/w/${workspace.slug}`}
          aria-label="Back to conversations"
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
        <Select
          label="From"
          value={author}
          onChange={(value) => setFilter('author', value)}
          options={[
            { value: '', label: 'Anyone' },
            ...members.map((member) => ({ value: member.id, label: member.displayName })),
          ]}
        />

        <Select
          label="In"
          value={channel}
          onChange={(value) => setFilter('channel', value)}
          options={[
            { value: '', label: 'Anywhere' },
            ...channels.map((summary) => ({
              value: summary.channel.id,
              label: channelLabel(summary, members, me.user.id),
            })),
          ]}
        />

        <Checkbox
          label="With a file"
          // Matches the height of the pickers beside it, so the row of filters
          // sits on one line rather than stepping.
          className="border-border bg-surface hover:bg-surface-hover min-h-11 rounded-lg border px-3"
          checked={files}
          onChange={(event) => setFilter('files', event.target.checked ? 'true' : '')}
        />
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
                  <span>{whereFrom(hit.channelId)}</span>
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
