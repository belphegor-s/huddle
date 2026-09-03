import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, toPlainText, type Inline } from './markdown.js';

/** A compact reading of a tree, so an expectation stays legible. */
function shape(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return node.value;
        case 'code':
          return `code(${node.value})`;
        case 'mention':
          return `@${node.handle}`;
        case 'link':
          return `link(${node.href}|${shape(node.children)})`;
        default:
          return `${node.kind}(${shape(node.children)})`;
      }
    })
    .join('');
}

describe('inline marks', () => {
  it('reads bold, italic and strikethrough', () => {
    expect(shape(parseInline('**bold** and *italic* and ~~gone~~'))).toBe(
      'strong(bold) and emphasis(italic) and strike(gone)',
    );
  });

  it('prefers bold over two empty emphases', () => {
    expect(shape(parseInline('**both**'))).toBe('strong(both)');
  });

  it('leaves snake case names alone', () => {
    expect(shape(parseInline('call read_message_count now'))).toBe('call read_message_count now');
  });

  it('reads underscores as emphasis between words', () => {
    expect(shape(parseInline('a _word_ here'))).toBe('a emphasis(word) here');
  });

  it('suspends every other rule inside code', () => {
    expect(shape(parseInline('use `**not bold**` here'))).toBe('use code(**not bold**) here');
  });

  it('reads a labelled link', () => {
    expect(shape(parseInline('see [the docs](https://example.com/x) now'))).toBe(
      'see link(https://example.com/x|the docs) now',
    );
  });

  it('reads a bare url and stops before the full stop', () => {
    expect(shape(parseInline('go to https://example.com/a.'))).toBe(
      'go to link(https://example.com/a|https://example.com/a).',
    );
  });

  it('reads a mention', () => {
    expect(shape(parseInline('morning @ada.lovelace'))).toBe('morning @ada.lovelace');
  });

  it('never produces markup for text that looks like markup', () => {
    const nodes = parseInline('<script>alert(1)</script>');
    expect(nodes).toEqual([{ kind: 'text', value: '<script>alert(1)</script>' }]);
  });

  it('leaves an unclosed mark as the characters that were typed', () => {
    expect(shape(parseInline('**not closed'))).toBe('**not closed');
    expect(shape(parseInline('a * b * c'))).toBe('a emphasis( b ) c');
  });
});

describe('blocks', () => {
  it('reads a fenced code block with its language', () => {
    const blocks = parseMarkdown('before\n```ts\nconst a = 1;\n```\nafter');

    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toEqual({ kind: 'codeBlock', language: 'ts', value: 'const a = 1;' });
  });

  it('runs an unterminated fence to the end rather than hiding it', () => {
    const blocks = parseMarkdown('```\nstill typing');
    expect(blocks[0]).toEqual({ kind: 'codeBlock', language: null, value: 'still typing' });
  });

  it('reads a bulleted list as one block', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[0]?.kind === 'list' && blocks[0].items).toHaveLength(3);
  });

  it('reads a numbered list', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('joins consecutive quote lines into one quote', () => {
    const blocks = parseMarkdown('> first\n> second\nplain');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('quote');
    expect(blocks[1]?.kind).toBe('paragraph');
  });

  it('keeps blank lines as empty paragraphs, so spacing survives', () => {
    const blocks = parseMarkdown('one\n\ntwo');
    expect(blocks).toHaveLength(3);
  });
});

describe('plain reading', () => {
  it('strips the marks but keeps the words', () => {
    const text = toPlainText(parseMarkdown('**bold** and `code`\n- a list item'));
    expect(text).toBe('bold and code\na list item');
  });
});
