import type { Route } from './+types/specimen';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'huddle type specimen' }];
}

/*
 * Typography is judged rendered, not by name. This page exists so a font or
 * scale change can be reviewed against real message text at real sizes.
 */

const SCALE = [
  { token: 'text-4xl', label: 'Display', className: 'font-display text-4xl font-semibold' },
  { token: 'text-2xl', label: 'Section', className: 'font-display text-2xl font-semibold' },
  { token: 'text-xl', label: 'Subsection', className: 'font-display text-xl font-semibold' },
  { token: 'text-lg', label: 'Lead', className: 'text-lg' },
  { token: 'text-base', label: 'Message body', className: 'text-base' },
  { token: 'text-sm', label: 'Author, labels', className: 'text-sm font-semibold' },
  { token: 'text-xs', label: 'Timestamps', className: 'text-xs text-text-secondary' },
  { token: 'text-2xs', label: 'Avatars, counts', className: 'text-2xs text-text-muted' },
];

const SWATCHES = [
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-hover',
  'border',
  'accent',
  'accent-soft',
  'positive',
  'caution',
  'critical',
];

const SAMPLE =
  'The point of a specimen is to show the face doing its actual job. This is roughly how long a real message runs before someone hits enter, so it is the length worth judging.';

export default function Specimen() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-14 px-5 py-12 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold">Type specimen</h1>
        <p className="text-text-secondary">
          Switzer for interface, Bricolage Grotesque for display, Commit Mono for code. All self
          hosted.
        </p>
      </header>

      <section className="flex flex-col gap-6">
        <h2 className="text-text-muted text-2xs font-semibold tracking-widest uppercase">Scale</h2>
        {SCALE.map((step) => (
          <div key={step.token} className="border-border flex flex-col gap-1 border-b pb-5">
            <div className="text-text-muted flex items-baseline gap-3 font-mono text-xs">
              <span>{step.token}</span>
              <span className="text-text-secondary font-sans">{step.label}</span>
            </div>
            <p className={step.className}>Every conversation your team forgot</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-text-muted text-2xs font-semibold tracking-widest uppercase">
          Weights at message size
        </h2>
        {[400, 500, 600, 700].map((weight) => (
          <p key={weight} className="text-base" style={{ fontWeight: weight }}>
            <span className="text-text-muted mr-2 font-mono text-xs">{weight}</span>
            {SAMPLE}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-text-muted text-2xs font-semibold tracking-widest uppercase">
          Monospace
        </h2>
        <pre className="border-border bg-surface-sunken overflow-x-auto rounded-lg border p-4 text-sm">
          <code>{`const seq = latestSeq() + 1;\nawait room.append({ channelId, authorId, draft, now });`}</code>
        </pre>
        <p className="text-text-secondary text-sm">
          Timestamps use tabular numerals so they do not jitter:{' '}
          <span className="text-text-primary">09:41</span>{' '}
          <span className="text-text-primary">11:08</span>{' '}
          <span className="text-text-primary">23:57</span>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-text-muted text-2xs font-semibold tracking-widest uppercase">
          Surfaces
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map((name) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span
                className="border-border block h-12 rounded-md border"
                style={{ background: `var(--${name})` }}
              />
              <span className="text-text-muted text-2xs font-mono">{name}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
