import {
  highlightCode,
  parseMarkdown,
  type Block,
  type Inline,
  type MemberProfile,
  type TokenKind,
} from '@huddle/core';
import { CopyButton, cx } from '@huddle/ui';
import { useMemo } from 'react';
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

    case 'heading': {
      /*
       * A heading in a chat message is a label on a paragraph, not a page
       * title, so the scale is small and the weight does the work. Anything
       * larger turns one person's list into a billboard in a shared window.
       */
      const Tag = `h${String(Math.min(block.level, 6))}` as 'h1';
      const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-[1rem]' : 'text-base';

      return (
        <Tag className={cx('mt-1 font-semibold break-words first:mt-0', size)}>
          <Inlines nodes={block.children} handles={handles} meId={meId} />
        </Tag>
      );
    }

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

const TOKENS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-syntax-comment italic',
  string: 'text-syntax-string',
  number: 'text-syntax-number',
  keyword: 'text-syntax-keyword',
  literal: 'text-syntax-number',
  function: 'text-syntax-function',
  tag: 'text-syntax-tag',
  attribute: 'text-syntax-attribute',
  punctuation: 'text-text-secondary',
};

/**
 * Code is the one thing people paste in order to have it taken back out again,
 * so copying it is a button rather than a careful selection drag.
 *
 * The colouring is ours and runs in the client on a string, never on markup:
 * the tokeniser returns runs of text and each one becomes a span, so a snippet
 * containing a tag is still text. A hosted highlighter would be a third party
 * request from a page that promises not to make any.
 */
function CodeBlock({ language, value }: { language: string | null; value: string }) {
  const tokens = useMemo(() => highlightCode(value, language), [value, language]);

  return (
    <div className="border-border bg-surface-sunken group/code relative my-1 overflow-hidden rounded-lg border">
      {language ? (
        <span className="text-text-muted border-border text-2xs block border-b px-3 py-1 font-mono">
          {language}
        </span>
      ) : null}

      <pre className="overflow-x-auto px-3 py-2">
        <code className="font-mono text-[0.85rem] leading-relaxed">
          {tokens.map((token, index) => (
            <span key={index} className={TOKENS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>

      <CopyButton
        value={value}
        what="this code"
        className="border-border bg-surface-raised absolute top-1.5 right-1.5 size-8 border opacity-0 group-hover/code:opacity-100 focus:opacity-100"
      />
    </div>
  );
}
