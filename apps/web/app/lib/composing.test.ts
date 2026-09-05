import { describe, expect, it } from 'vitest';
import { continueList, insideFence } from './composing';

/** `|` marks the caret, which is how these read as the field someone sees. */
function at(marked: string): { value: string; caret: number } {
  const caret = marked.indexOf('|');
  return { value: marked.replace('|', ''), caret };
}

describe('insideFence', () => {
  it('is false in ordinary text', () => {
    const { value, caret } = at('hello|');
    expect(insideFence(value, caret)).toBe(false);
  });

  it('is true on the line after an opening fence', () => {
    const { value, caret } = at('```ts\nconst x = 1|');
    expect(insideFence(value, caret)).toBe(true);
  });

  it('is false once the block is closed', () => {
    const { value, caret } = at('```\ncode\n```\nafter|');
    expect(insideFence(value, caret)).toBe(false);
  });

  it('is true as soon as the opening fence is complete', () => {
    // The Enter that follows those backticks has to make a line, not send.
    const { value, caret } = at('```|');
    expect(insideFence(value, caret)).toBe(true);
  });

  it('is false with the caret on a line that is not a fence yet', () => {
    const { value, caret } = at('``|');
    expect(insideFence(value, caret)).toBe(false);
  });

  it('is true again in a second block', () => {
    const { value, caret } = at('```\na\n```\n\n```\nb|');
    expect(insideFence(value, caret)).toBe(true);
  });
});

describe('continueList', () => {
  it('has nothing to say about a plain line', () => {
    const { value, caret } = at('just a sentence|');
    expect(continueList(value, caret)).toBeNull();
  });

  it('carries a bullet to the next line', () => {
    const { value, caret } = at('- first|');
    expect(continueList(value, caret)).toEqual({ value: '- first\n- ', caret: 10 });
  });

  it('counts the next number rather than repeating one', () => {
    const { value, caret } = at('1. first\n2. second|');
    expect(continueList(value, caret)?.value).toBe('1. first\n2. second\n3. ');
  });

  it('keeps the delimiter that was used', () => {
    const { value, caret } = at('1) one|');
    expect(continueList(value, caret)?.value).toBe('1) one\n2) ');
  });

  it('keeps the indent of a nested item', () => {
    const { value, caret } = at('- top\n  - nested|');
    expect(continueList(value, caret)?.value).toBe('- top\n  - nested\n  - ');
  });

  it('carries a quote mark', () => {
    const { value, caret } = at('> quoted|');
    expect(continueList(value, caret)?.value).toBe('> quoted\n> ');
  });

  it('ends the list on an empty item instead of adding another', () => {
    const { value, caret } = at('- first\n- |');
    expect(continueList(value, caret)).toEqual({ value: '- first\n', caret: 8 });
  });

  it('keeps whatever followed the caret', () => {
    const { value, caret } = at('- first| and more');
    expect(continueList(value, caret)?.value).toBe('- first\n-  and more');
  });
});
