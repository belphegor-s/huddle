import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

/**
 * The one property everything else rests on. The styled layer sits exactly
 * behind a plain textarea, so if a single character were dropped, duplicated
 * or reordered the two would drift apart and the caret would land in the wrong
 * place. Every other test here is a detail; this one is the contract.
 */
function rebuilt(source: string): string {
  return highlight(source)
    .map((segment) => segment.text)
    .join('');
}

const SAMPLES = [
  '',
  'plain text',
  '**bold** and *italic* and ~~gone~~',
  'a `code span` inline',
  '```\nfenced\nblock\n```',
  'see [docs](https://example.com/a) and https://example.com/b',
  'morning @ada.lovelace',
  '- one\n- two\n3. three',
  '> quoted line\nplain after',
  'snake_case_name stays whole',
  '**unclosed and *this too',
  'multi\n\nblank\n\n\nlines',
  '   leading spaces kept   ',
  'emoji \u{1f44d} and accents café',
  '*a* *b* *c*',
  '```ts\nconst x = "hi"; // note\n```',
  '```js\nunterminated and still typing',
  'text\n```\ncode\n```\nmore text',
  '```\n```',
  '# Heading\n## With **bold** in it\n#not a heading',
];

describe('every character survives', () => {
  it.each(SAMPLES)('rebuilds %j exactly', (source) => {
    expect(rebuilt(source)).toBe(source);
  });
});

describe('what gets styled', () => {
  it('marks the delimiters apart from the emphasised text', () => {
    expect(highlight('**bold**')).toEqual([
      { text: '**', style: 'marker' },
      { text: 'bold', style: 'strong' },
      { text: '**', style: 'marker' },
    ]);
  });

  it('keeps a code span whole, delimiters included', () => {
    expect(highlight('`x`')).toEqual([{ text: '`x`', style: 'code' }]);
  });

  it('styles a whole quote line', () => {
    expect(highlight('> hello')).toEqual([{ text: '> hello', style: 'quote' }]);
  });

  it('separates a list marker from its content', () => {
    expect(highlight('- item')).toEqual([
      { text: '- ', style: 'marker' },
      { text: 'item', style: 'plain' },
    ]);
  });

  it('leaves snake case alone', () => {
    expect(highlight('read_message_count')).toEqual([
      { text: 'read_message_count', style: 'plain' },
    ]);
  });

  it('merges neighbouring runs of the same style', () => {
    const segments = highlight('plain more plain');
    expect(segments).toHaveLength(1);
  });
});

describe('emphasis with underscores', () => {
  it('takes punctuation after the closing mark', () => {
    expect(highlight('with _emphasis_, more').map((segment) => segment.style)).toContain(
      'emphasis',
    );
  });

  it('still leaves a snake_case_name alone', () => {
    expect(highlight('read_message_count')).toEqual([
      { text: 'read_message_count', style: 'plain' },
    ]);
  });
});

describe('code blocks', () => {
  it('colours the fence apart from what is inside it', () => {
    const styles = highlight('```ts\nconst x = 1\n```').map((segment) => segment.style);
    expect(styles.at(0)).toBe('marker');
    expect(styles.at(-1)).toBe('marker');
    expect(styles).toContain('code-keyword');
  });

  it('colours a block that has not been closed yet', () => {
    expect(highlight('```py\nreturn None').map((segment) => segment.style)).toContain(
      'code-keyword',
    );
  });

  it('leaves markdown inside a block alone', () => {
    // Asterisks in a shell command are globs, not emphasis, and a lone
    // underscore in a name is not italics.
    const styles = highlight('```sh\nrm *.log *.tmp\n```').map((segment) => segment.style);
    expect(styles).not.toContain('emphasis');
    expect(highlight('*a* b').map((segment) => segment.style)).toContain('emphasis');
  });

  it('goes back to prose after the closing fence', () => {
    const segments = highlight('```\ncode\n```\n**after**');
    expect(segments.some((segment) => segment.style === 'strong')).toBe(true);
  });
});

describe('headings', () => {
  it('separates the hashes from the words', () => {
    expect(highlight('## Title')).toEqual([
      { text: '## ', style: 'marker' },
      { text: 'Title', style: 'heading' },
    ]);
  });

  it('keeps emphasis inside a heading', () => {
    expect(highlight('# a **b**').map((segment) => segment.style)).toContain('strong');
  });

  it('needs a space, so a hashtag stays a hashtag', () => {
    expect(highlight('#release')).toEqual([{ text: '#release', style: 'plain' }]);
  });
});
