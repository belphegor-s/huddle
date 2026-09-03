import { parseMarkdown, type Block, type Inline, type MemberProfile } from '@huddle/core';
import { cx, Icon } from '@huddle/ui';
import { useMemo, useState } from 'react';
import { handleOf } from '../lib/rich-text';

interface MessageBodyProps {
  /** The markdown someone typed, not the flattened reading of it. */
  source: string;
  members: MemberProfile[];
  meId: string;
}

/**
 * Renders a message as elements, never as markup.
 *
 * The markdown parser produces a tree and this turns that tree into React
 * nodes, so a message containing a script tag is text at every step and there
 * is no escaping anywhere to get wrong.
 */
export function MessageBody({ source, members, meId }: MessageBodyProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const handles = useMemo(() => {
    const map = new Map<string, MemberProfile>();
    for (const member of members) map.set(handleOf(member.displayName), member);
    return map;
  }, [members]);

  return (
    <div className="leading-message flex flex-col gap-1 text-base">
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} handles={handles} meId={meId} />
      ))}
    </div>
  );
}

interface Context {
  handles: Map<string, MemberProfile>;
  meId: string;
}

function BlockNode({ block, handles, meId }: { block: Block } & Context) {
  switch (block.kind) {
    case 'codeBlock':
      return <CodeBlock language={block.language} value={block.value} />;

    case 'quote':
      return (
        <blockquote className="border-border-strong text-text-secondary border-l-2 pl-3">
          <Inlines nodes={block.children} handles={handles} meId={meId} />
        </blockquote>
      );

    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          className={cx('flex flex-col gap-0.5 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <Inlines nodes={item} handles={handles} meId={meId} />
            </li>
          ))}
        </List>
      );
    }

    default:
      return (
        <p className="break-words whitespace-pre-wrap">
          {block.children.length === 0 ? (
            ' '
          ) : (
            <Inlines nodes={block.children} handles={handles} meId={meId} />
          )}
        </p>
      );
  }
}

function Inlines({ nodes, handles, meId }: { nodes: Inline[] } & Context) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} handles={handles} meId={meId} />
      ))}
    </>
  );
}

function InlineNode({ node, handles, meId }: { node: Inline } & Context) {
  switch (node.kind) {
    case 'text':
      return node.value;

    case 'strong':
      return (
        <strong className="font-semibold">
          <Inlines nodes={node.children} handles={handles} meId={meId} />
        </strong>
      );

    case 'emphasis':
      return (
        <em className="italic">
          <Inlines nodes={node.children} handles={handles} meId={meId} />
        </em>
      );

    case 'strike':
      return (
        <s className="text-text-secondary line-through">
          <Inlines nodes={node.children} handles={handles} meId={meId} />
        </s>
      );

    case 'code':
      return (
        <code className="border-border bg-surface-sunken mx-px rounded-sm border px-[0.3em] py-px font-mono text-[0.9em]">
          {node.value}
        </code>
      );

    case 'link':
      return (
        <a
          href={node.href}
          target="_blank"
          // noreferrer as well as noopener: an outbound click should not tell
          // the other end which conversation it came from.
          rel="noreferrer noopener"
          className="text-accent underline decoration-1 underline-offset-2"
        >
          <Inlines nodes={node.children} handles={handles} meId={meId} />
        </a>
      );

    case 'mention': {
      const member = handles.get(node.handle);
      if (!member) return `@${node.handle}`;

      return (
        <span
          className={cx(
            'rounded-xs px-0.5 font-medium',
            member.id === meId ? 'bg-accent-soft text-accent' : 'text-accent',
          )}
        >
          @{member.displayName}
        </span>
      );
    }
  }
}

/**
 * Code is the one thing people paste in order to have it taken back out again,
 * so copying it is a button rather than a careful selection drag.
 */
function CodeBlock({ language, value }: { language: string | null; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-border bg-surface-sunken group/code relative my-1 overflow-hidden rounded-lg border">
      {language ? (
        <span className="text-text-muted border-border text-2xs block border-b px-3 py-1 font-mono">
          {language}
        </span>
      ) : null}

      <pre className="overflow-x-auto px-3 py-2">
        <code className="font-mono text-[0.85rem] leading-relaxed">{value}</code>
      </pre>

      <button
        type="button"
        aria-label="Copy this code"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="border-border bg-surface-raised text-text-muted hover:text-text-primary absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md border opacity-0 transition-opacity group-hover/code:opacity-100 focus:opacity-100"
      >
        <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
      </button>
    </div>
  );
}
