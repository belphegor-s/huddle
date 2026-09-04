import { useEffect, useState } from 'react';

/** Where the code actually is. It was pointing at github.com itself. */
const SOURCE_URL = 'https://github.com/belphegor-s/huddle';
import { cx } from '@huddle/ui';
import { redirect } from 'react-router';
import { api } from '../lib/api';
import { currentMe } from '../lib/session';

/*
 * The landing page is for people who are not signed in. Anyone with a session
 * goes straight to work, and someone with no workspace yet goes to make one.
 *
 * This route is prerendered, so the check runs in the browser on hydration
 * rather than blocking the first paint for a visitor who has never signed in.
 */
export async function clientLoader() {
  const me = await currentMe();
  if (!me) return null;

  const workspaces = me.workspaces.length > 0 ? me.workspaces : await api.workspaces();
  const first = workspaces[0];
  throw redirect(first ? `/w/${first.workspace.slug}` : '/new');
}

export function meta() {
  return [
    { title: 'huddle: team chat you can actually host yourself' },
    {
      name: 'description',
      content:
        'Open source team chat. Channels, threads, files, voice notes and search. One container, your server, your data.',
    },
  ];
}

interface DemoLine {
  author: string;
  initials: string;
  text: string;
  tone?: 'accent';
}

/*
 * The hero is the product rather than a picture of it. These are the real
 * message list styles, so the demo cannot drift from what the app looks like.
 */
const CONVERSATION: DemoLine[] = [
  { author: 'Priya', initials: 'PR', text: 'Where did we land on the pricing page copy?' },
  {
    author: 'Sam',
    initials: 'SA',
    text: 'Thread on it in #launch, decision is in the pinned message.',
  },
  {
    author: 'Priya',
    initials: 'PR',
    text: 'Found it in two seconds. This is the part WhatsApp could never do.',
  },
  {
    author: 'Ada',
    initials: 'AD',
    text: 'Deployed the self hosted build to our own box this morning.',
    tone: 'accent',
  },
];

/** How long somebody appears to be typing before their message lands. */
const TYPING_MS = 900;

/** The pause after a message before the next person starts. */
const BETWEEN_MS = 1100;

interface Playback {
  shown: number;
  typing: boolean;
}

/**
 * Plays the conversation through, with the person who is about to speak shown
 * as typing first.
 *
 * Under reduced motion the whole conversation is there from the start. It used
 * to stop the timer instead, which left those readers looking at a single
 * message and no way to see the rest.
 */
function usePlayback(total: number): Playback {
  const [state, setState] = useState<Playback>({ shown: 1, typing: false });

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState({ shown: total, typing: false });
      return;
    }
  }, [total]);

  useEffect(() => {
    if (state.shown >= total) return;

    if (!state.typing) {
      const timer = window.setTimeout(
        () => setState((was) => ({ ...was, typing: true })),
        BETWEEN_MS,
      );
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(
      () => setState((was) => ({ shown: was.shown + 1, typing: false })),
      TYPING_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state, total]);

  return state;
}

function ConversationDemo() {
  const { shown, typing } = usePlayback(CONVERSATION.length);

  return (
    <div className="border-border bg-surface-raised shadow-popover overflow-hidden rounded-xl border">
      <div className="border-border text-text-secondary flex items-center gap-2 border-b px-4 py-2.5 text-xs">
        <span className="text-text-muted font-mono">#</span>
        <span className="text-text-primary font-medium">launch</span>
        <span className="text-text-muted">4 members</span>
      </div>

      {/*
        Every line is rendered from the start and the ones not yet said are
        hidden rather than absent, so the panel is the height it will end at
        and nothing below it moves while the conversation plays.
      */}
      <ul className="flex flex-col gap-4 p-4">
        {CONVERSATION.map((line, index) => {
          const said = index < shown;
          const speaking = index === shown && typing;

          return (
            <li
              key={line.author + line.text}
              aria-hidden={said ? undefined : true}
              className={cx(
                'flex gap-3 transition-[opacity,transform] duration-500',
                // A gentle overshoot, so a message settles rather than snaps.
                '[transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
                said || speaking
                  ? 'translate-y-0 opacity-100'
                  : 'invisible translate-y-2 opacity-0',
              )}
            >
              <span
                aria-hidden="true"
                className="bg-surface-sunken text-text-secondary text-2xs mt-0.5 grid size-8 shrink-0 place-items-center rounded-md font-semibold"
              >
                {line.initials}
              </span>

              <div className="min-w-0">
                <span className="text-text-primary text-sm font-semibold">{line.author}</span>
                {/*
                  The dots sit on top of the message rather than above it. In
                  their own row they added ten pixels while somebody was
                  typing, which is exactly the shifting this is meant to stop.
                */}
                <div className="relative">
                  <p
                    className={cx(
                      'text-base transition-opacity duration-300',
                      line.tone === 'accent' ? 'text-accent' : 'text-text-primary',
                      said ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    {line.text}
                  </p>
                  {speaking ? (
                    <span className="absolute inset-0 flex items-start pt-2">
                      <TypingDots />
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Three dots, out of step with each other, in the space the message will take. */
function TypingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="bg-text-muted size-1.5 rounded-full motion-safe:animate-bounce"
          style={{ animationDelay: `${String(dot * 120)}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

const CAPABILITIES = [
  {
    title: 'Threads that hold a decision',
    body: 'Replies stay attached to what they answer. Pin the outcome so nobody re-litigates it next week.',
  },
  {
    title: 'Search that finds it',
    body: 'Full text across every channel you can read, filtered by person, date, or whether it had a file.',
  },
  {
    title: 'Voice notes without the mess',
    body: 'Hold to record, slide to cancel, scrub the waveform. The habit people actually brought from WhatsApp.',
  },
  {
    title: 'Notifications on a phone',
    body: 'Install it from the browser and get real push, with per channel rules and a do not disturb window.',
  },
];

const DEPLOY_TARGETS = [
  { name: 'Docker Compose', detail: 'One command, your server' },
  { name: 'Railway, Render, Coolify', detail: 'One click templates' },
  { name: 'Kubernetes', detail: 'Helm chart' },
  { name: 'Anything with Postgres', detail: 'Plain Node process' },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <span className="font-display text-lg font-semibold tracking-tight">huddle</span>
        <nav className="flex items-center gap-4">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-text-secondary hover:text-text-primary text-sm no-underline"
          >
            Source
          </a>
          <a href="/signin" className="text-text-primary text-sm font-medium no-underline">
            Sign in
          </a>
        </nav>
      </header>

      <section className="grid items-center gap-10 pt-8 pb-20 md:grid-cols-[1.05fr_1fr] md:gap-14">
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-3xl leading-[1.05] font-semibold sm:text-4xl">
            Your team is running on a group chat that forgets everything.
          </h1>
          <p className="text-text-secondary max-w-prose text-lg">
            huddle is team chat with channels, threads, files, voice notes and search that works. It
            is open source, it runs anywhere Docker runs, and the whole thing is one command on a
            machine you already pay for.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="#deploy"
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-md px-4 py-2.5 text-sm font-medium no-underline transition-colors"
            >
              Deploy your own
            </a>
            <a
              href="/specimen"
              className="border-border text-text-primary hover:bg-surface-hover rounded-md border px-4 py-2.5 text-sm font-medium no-underline transition-colors"
            >
              See the type system
            </a>
          </div>
        </div>
        <ConversationDemo />
      </section>

      <section className="border-border grid gap-6 border-t pt-12 sm:grid-cols-2 sm:gap-x-10 sm:gap-y-8">
        {CAPABILITIES.map((item) => (
          <article key={item.title} className="flex flex-col gap-1.5 py-4">
            <h2 className="font-display text-lg font-semibold">{item.title}</h2>
            <p className="text-text-secondary text-base">{item.body}</p>
          </article>
        ))}
      </section>

      <section id="deploy" className="border-border mt-16 border-t pt-12">
        <h2 className="font-display text-xl font-semibold">Runs where you want it</h2>
        <p className="text-text-secondary mt-2 max-w-prose text-base">
          Nothing in huddle is tied to one provider. It is a Node process, a Postgres database and
          an S3 bucket, which every host on earth already has, including a network with no internet
          access at all.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {DEPLOY_TARGETS.map((target) => (
            <li
              key={target.name}
              className="border-border bg-surface-raised flex items-baseline justify-between gap-4 rounded-lg border px-4 py-3"
            >
              <span className="text-text-primary text-sm font-medium">{target.name}</span>
              <span className="text-text-muted text-xs">{target.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border mt-16 border-t pt-12">
        <h2 className="font-display text-xl font-semibold">Private because of how it is built</h2>
        <p className="text-text-secondary mt-2 max-w-prose text-base">
          No analytics, no trackers, and no third party requests from the app. Fonts and assets are
          served from your own instance. AI features are off until you add a key, so message content
          never leaves your deployment on its own.
        </p>
      </section>
    </main>
  );
}
