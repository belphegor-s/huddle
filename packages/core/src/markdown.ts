/**
 * A deliberately small markdown, parsed to a tree rather than to HTML.
 *
 * Nothing here ever produces markup. The client turns these nodes into React
 * elements, so a message containing `<script>` is text in every path, and no
 * renderer anywhere needs to be trusted to escape it.
 *
 * The subset is what people actually type in chat. Headings, tables, images and
 * reference links are left out on purpose: they are rare in a message, and each
 * one is a way for a stray character to change how a sentence looks.
 */

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'emphasis'; children: Inline[] }
  | { kind: 'strike'; children: Inline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'mention'; handle: string };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'codeBlock'; language: string | null; value: string };

const FENCE = /^```(\w*)\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] === '' ? null : (fence[1] ?? null);
      const body: string[] = [];
      index += 1;

      // An unterminated fence runs to the end. Refusing to render it would
      // hide the message someone actually sent.
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;

      blocks.push({ kind: 'codeBlock', language, value: body.join('\n') });
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items: Inline[][] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (!match) break;

        items.push(parseInline(match[1] ?? ''));
        index += 1;
      }

      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const body: string[] = [quote[1] ?? ''];
      index += 1;

      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        body.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '');
        index += 1;
      }

      blocks.push({ kind: 'quote', children: parseInline(body.join('\n')) });
      continue;
    }

    blocks.push({ kind: 'paragraph', children: parseInline(line) });
    index += 1;
  }

  return blocks;
}

/**
 * Ordered by binding strength: code first, because backticks suspend every
 * other rule, then links, then the wrapping marks. `**` is tried before `*` so
 * bold is never read as two empty emphases.
 */
const RULES: Array<{
  pattern: RegExp;
  build(match: RegExpExecArray): Inline;
}> = [
  {
    pattern: /`([^`\n]+)`/,
    build: (match) => ({ kind: 'code', value: match[1] ?? '' }),
  },
  {
    pattern: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    build: (match) => ({
      kind: 'link',
      href: match[2] ?? '',
      children: parseInline(match[1] ?? ''),
    }),
  },
  {
    // A bare URL, stopped before trailing sentence punctuation.
    pattern: /(https?:\/\/[^\s<]+[^\s<>"'.,;:!?)\]}])/,
    build: (match) => ({
      kind: 'link',
      href: match[1] ?? '',
      children: [{ kind: 'text', value: match[1] ?? '' }],
    }),
  },
  {
    pattern: /@([\w.-]{1,80})/,
    build: (match) => ({ kind: 'mention', handle: (match[1] ?? '').toLowerCase() }),
  },
  {
    pattern: /\*\*([^\n]+?)\*\*/,
    build: (match) => ({ kind: 'strong', children: parseInline(match[1] ?? '') }),
  },
  {
    pattern: /__([^\n]+?)__/,
    build: (match) => ({ kind: 'strong', children: parseInline(match[1] ?? '') }),
  },
  {
    pattern: /~~([^\n]+?)~~/,
    build: (match) => ({ kind: 'strike', children: parseInline(match[1] ?? '') }),
  },
  {
    pattern: /\*([^*\n]+?)\*/,
    build: (match) => ({ kind: 'emphasis', children: parseInline(match[1] ?? '') }),
  },
  {
    // Underscores only between word boundaries, or snake_case_names break up.
    pattern: /(?:^|(?<=\s))_([^_\n]+?)_(?=\s|$)/,
    build: (match) => ({ kind: 'emphasis', children: parseInline(match[1] ?? '') }),
  },
];

export function parseInline(source: string): Inline[] {
  if (source === '') return [];

  let earliest: { at: number; length: number; node: Inline } | null = null;

  for (const rule of RULES) {
    const match = rule.pattern.exec(source);
    if (!match) continue;

    const at = match.index + match[0].indexOf(match[0].trimStart());
    if (earliest === null || at < earliest.at) {
      earliest = { at: match.index, length: match[0].length, node: rule.build(match) };
    }
  }

  if (earliest === null) return [{ kind: 'text', value: source }];

  const before = source.slice(0, earliest.at);
  const after = source.slice(earliest.at + earliest.length);

  return [
    ...(before === '' ? [] : ([{ kind: 'text', value: before }] as Inline[])),
    earliest.node,
    ...parseInline(after),
  ];
}

/** The plain reading of a message, for search, notifications and previews. */
export function toPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'codeBlock') return block.value;
      if (block.kind === 'list') return block.items.map(flatten).join('\n');
      return flatten(block.children);
    })
    .join('\n');
}

function flatten(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.value;
        case 'mention':
          return `@${node.handle}`;
        default:
          return flatten(node.children);
      }
    })
    .join('');
}
