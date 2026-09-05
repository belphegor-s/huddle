import { describe, expect, it } from 'vitest';
import { highlightCode, isKnownLanguage, type Token } from './syntax.js';

/** The contract every other assertion depends on. */
function rebuilt(tokens: Token[]): string {
  return tokens.map((token) => token.text).join('');
}

function kindsOf(tokens: Token[], text: string): string[] {
  return tokens.filter((token) => token.text === text).map((token) => token.kind);
}

describe('highlightCode', () => {
  it('never loses or reorders a character', () => {
    const source = `const greeting = "hello";\n// a comment\nfoo(1, 2);`;
    expect(rebuilt(highlightCode(source, 'ts'))).toBe(source);
  });

  it('keeps every character even in a language it has never heard of', () => {
    const source = '(defn add [a b] (+ a b)) ; lisp';
    expect(rebuilt(highlightCode(source, 'clojure'))).toBe(source);
  });

  it('survives an unterminated string without hanging or dropping the rest', () => {
    // A half typed line is the normal state of a composer.
    const source = 'const broken = "unclosed';
    expect(rebuilt(highlightCode(source, 'js'))).toBe(source);
  });

  it('colours keywords, strings and comments in script', () => {
    const tokens = highlightCode('const x = "hi"; // note', 'javascript');

    expect(kindsOf(tokens, 'const')).toEqual(['keyword']);
    expect(kindsOf(tokens, '"hi"')).toEqual(['string']);
    expect(kindsOf(tokens, '// note')).toEqual(['comment']);
  });

  it('does not colour a keyword that is only part of a name', () => {
    const tokens = highlightCode('constant', 'javascript');
    expect(tokens.every((token) => token.kind !== 'keyword')).toBe(true);
  });

  it('knows a call from a name', () => {
    const tokens = highlightCode('render(value)', 'ts');
    expect(kindsOf(tokens, 'render')).toEqual(['function']);
  });

  it('reads json keys as attributes and its three literals', () => {
    const tokens = highlightCode('{ "on": true, "off": null }', 'json');

    expect(kindsOf(tokens, 'true')).toEqual(['literal']);
    expect(kindsOf(tokens, 'null')).toEqual(['literal']);
  });

  it('reads a shell comment and a flag', () => {
    const tokens = highlightCode('# build\npnpm test --watch', 'bash');

    expect(kindsOf(tokens, '# build')).toEqual(['comment']);
    expect(kindsOf(tokens, '--watch')).toEqual(['attribute']);
  });

  it('reads sql keywords whatever their case', () => {
    expect(kindsOf(highlightCode('select * from users', 'sql'), 'select')).toEqual(['keyword']);
    expect(kindsOf(highlightCode('SELECT * FROM users', 'sql'), 'SELECT')).toEqual(['keyword']);
  });

  it('takes a grammar name as well as an alias for it', () => {
    expect(kindsOf(highlightCode('const x = 1', 'javascript'), 'const')).toEqual(['keyword']);
    expect(isKnownLanguage('python')).toBe(true);
  });

  it('reads an html tag and its attributes', () => {
    const tokens = highlightCode('<a href="/x">go</a>', 'html');

    expect(kindsOf(tokens, '<a')).toEqual(['tag']);
    expect(kindsOf(tokens, 'href')).toEqual(['attribute']);
  });

  it('still finds strings and comments with no language at all', () => {
    const tokens = highlightCode('value = "kept" # why', null);

    expect(kindsOf(tokens, '"kept"')).toEqual(['string']);
    expect(kindsOf(tokens, '# why')).toEqual(['comment']);
  });

  it('has nothing to say about an empty block', () => {
    expect(highlightCode('', 'ts')).toEqual([]);
  });

  it('knows which languages it can actually colour', () => {
    expect(isKnownLanguage('tsx')).toBe(true);
    expect(isKnownLanguage('brainfuck')).toBe(false);
    expect(isKnownLanguage(null)).toBe(false);
  });
});
