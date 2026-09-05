/**
 * Syntax colouring for fenced code, written here rather than pulled in.
 *
 * A full highlighter is a megabyte of grammars and, in most of them, a fetch
 * from somebody else's CDN, which the privacy rule forbids outright. What a
 * chat message needs is far less: enough to tell a string from a keyword from
 * a comment at a glance, in the handful of languages people actually paste.
 *
 * Everything unknown falls back to strings, numbers and comments, which is
 * most of the value in any language.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'literal'
  | 'function'
  | 'tag'
  | 'attribute'
  | 'punctuation';

export interface Token {
  text: string;
  kind: TokenKind;
}

interface Rule {
  pattern: RegExp;
  kind: TokenKind;
}

const COMMON: Rule[] = [
  { pattern: /^[0-9]+\.?[0-9]*(?:e[+-]?[0-9]+)?\b/i, kind: 'number' },
  { pattern: /^[{}[\]()<>;,.:?!+\-*/%=&|^~]+/, kind: 'punctuation' },
];

const QUOTES: Rule[] = [
  { pattern: /^"(?:[^"\\\n]|\\.)*"?/, kind: 'string' },
  { pattern: /^'(?:[^'\\\n]|\\.)*'?/, kind: 'string' },
  { pattern: /^`(?:[^`\\]|\\.)*`?/, kind: 'string' },
];

function words(list: string, kind: TokenKind, flags = ''): Rule {
  return { pattern: new RegExp(`^(?:${list})\\b`, flags), kind };
}

const SCRIPT = [
  { pattern: /^\/\/[^\n]*/, kind: 'comment' as const },
  { pattern: /^\/\*[\s\S]*?(?:\*\/|$)/, kind: 'comment' as const },
  ...QUOTES,
  words(
    'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|as|default|interface|type|enum|implements|public|private|protected|readonly|static|declare|namespace|satisfies|keyof|infer',
    'keyword',
  ),
  words('true|false|null|undefined|NaN|Infinity', 'literal'),
  { pattern: /^[A-Za-z_$][\w$]*(?=\s*\()/, kind: 'function' as const },
  ...COMMON,
];

const LANGUAGES: Record<string, Rule[]> = {
  javascript: SCRIPT,
  typescript: SCRIPT,

  json: [
    ...QUOTES,
    words('true|false|null', 'literal'),
    { pattern: /^[A-Za-z_][\w-]*(?=\s*:)/, kind: 'attribute' },
    ...COMMON,
  ],

  css: [
    { pattern: /^\/\*[\s\S]*?(?:\*\/|$)/, kind: 'comment' },
    ...QUOTES,
    { pattern: /^[.#]?[A-Za-z_-][\w-]*(?=[^;{}]*\{)/, kind: 'tag' },
    { pattern: /^[a-z-]+(?=\s*:)/, kind: 'attribute' },
    { pattern: /^[0-9.]+(?:px|rem|em|%|vh|vw|s|ms|deg)?/, kind: 'number' },
    ...COMMON,
  ],

  html: [
    { pattern: /^<!--[\s\S]*?(?:-->|$)/, kind: 'comment' },
    { pattern: /^<\/?[A-Za-z][\w-]*/, kind: 'tag' },
    ...QUOTES,
    { pattern: /^[A-Za-z-]+(?==)/, kind: 'attribute' },
    ...COMMON,
  ],

  shell: [
    { pattern: /^#[^\n]*/, kind: 'comment' },
    ...QUOTES,
    words(
      'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|source|echo|cd|set|unset',
      'keyword',
    ),
    { pattern: /^\$\{?[\w]+\}?/, kind: 'literal' },
    { pattern: /^-{1,2}[\w-]+/, kind: 'attribute' },
    ...COMMON,
  ],

  python: [
    { pattern: /^#[^\n]*/, kind: 'comment' },
    { pattern: /^(?:"""|''')[\s\S]*?(?:"""|'''|$)/, kind: 'string' },
    ...QUOTES,
    words(
      'def|class|return|if|elif|else|for|while|break|continue|import|from|as|with|try|except|finally|raise|lambda|yield|global|nonlocal|pass|assert|async|await|and|or|not|in|is',
      'keyword',
    ),
    words('True|False|None|self', 'literal'),
    { pattern: /^[A-Za-z_][\w]*(?=\s*\()/, kind: 'function' },
    ...COMMON,
  ],

  sql: [
    { pattern: /^--[^\n]*/, kind: 'comment' },
    ...QUOTES,
    words(
      'select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|index|join|left|right|inner|outer|on|group|order|by|having|limit|offset|returning|and|or|not|as|distinct|union|primary|key|foreign|references|default|constraint',
      'keyword',
      // SQL is the one language people write shouting.
      'i',
    ),
    words('null|true|false', 'literal', 'i'),
    ...COMMON,
  ],
};

/**
 * The names people actually type after three backticks. A name that is already
 * one of the grammars above needs no entry.
 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'css',
  html: 'html',
  xml: 'html',
  svg: 'html',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  py: 'python',
  python: 'python',
  sql: 'sql',
  postgres: 'sql',
};

/** Strings, numbers and comments, which is most of the value anywhere. */
const FALLBACK: Rule[] = [
  { pattern: /^(?:\/\/|#|--)[^\n]*/, kind: 'comment' },
  ...QUOTES,
  ...COMMON,
];

function grammarFor(language: string | null): Rule[] | null {
  const name = (language ?? '').toLowerCase();
  return LANGUAGES[ALIASES[name] ?? name] ?? null;
}

export function isKnownLanguage(language: string | null): boolean {
  return language !== null && grammarFor(language) !== null;
}

/**
 * Splits code into coloured runs.
 *
 * Every character of the input appears in the output exactly once and in
 * order, which is what lets this be drawn behind a caret as well as in a
 * message. The scanner takes the first rule that matches at the cursor and
 * otherwise consumes one character, so it can never loop or drop anything.
 */
export function highlightCode(source: string, language: string | null): Token[] {
  const rules = grammarFor(language) ?? FALLBACK;
  const tokens: Token[] = [];

  let at = 0;
  let plain = '';

  const flush = () => {
    if (plain !== '') tokens.push({ text: plain, kind: 'plain' });
    plain = '';
  };

  while (at < source.length) {
    const rest = source.slice(at);
    const matched = rules
      .map((rule) => ({ rule, found: rule.pattern.exec(rest) }))
      .find((one) => one.found !== null && one.found[0].length > 0);

    if (!matched?.found) {
      plain += source[at] ?? '';
      at += 1;
      continue;
    }

    flush();
    tokens.push({ text: matched.found[0], kind: matched.rule.kind });
    at += matched.found[0].length;
  }

  flush();
  return tokens;
}
