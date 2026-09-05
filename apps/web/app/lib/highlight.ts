import { highlightCode, type TokenKind } from '@huddle/core';

export type Emphasis =
  | 'plain'
  | 'marker'
  | 'heading'
  | 'strong'
  | 'emphasis'
  | 'strike'
  | 'code'
  | 'link'
  | 'mention'
  | 'quote'
  | 'code-plain'
  | 'code-comment'
  | 'code-string'
  | 'code-number'
  | 'code-keyword'
  | 'code-literal'
  | 'code-function'
  | 'code-tag'
  | 'code-attribute'
  | 'code-punctuation';

export interface Segment {
  text: string;
  style: Emphasis;
}

/**
 * Styles markdown source without rewriting it.
 *
 * This is not the message renderer: it paints the characters someone is
 * actually typing, delimiters included, so the field can show bold as bold
 * while `**` stays visible and editable. Every character of the input appears
 * in the output exactly once and in order, which is what lets the styled layer
 * sit precisely behind the caret of a plain textarea.
 */
const RULES: Array<{ pattern: RegExp; style: Emphasis; markerLength: number }> = [
  { pattern: /`[^`\n]+`/, style: 'code', markerLength: 0 },
  { pattern: /\[[^\]\n]+\]\((?:https?:\/\/)[^\s)]+\)/, style: 'link', markerLength: 0 },
  { pattern: /https?:\/\/[^\s<]+[^\s<>"'.,;:!?)\]}]/, style: 'link', markerLength: 0 },
  { pattern: /@[\w.-]{1,80}/, style: 'mention', markerLength: 0 },
  { pattern: /\*\*[^\n]+?\*\*/, style: 'strong', markerLength: 2 },
  { pattern: /__[^\n]+?__/, style: 'strong', markerLength: 2 },
  { pattern: /~~[^\n]+?~~/, style: 'strike', markerLength: 2 },
  { pattern: /\*[^*\n]+?\*/, style: 'emphasis', markerLength: 1 },
  { pattern: /(?:^|(?<=\s))_[^_\n]+?_(?=[\s.,;:!?)\]}'"]|$)/, style: 'emphasis', markerLength: 1 },
];

const CODE_STYLE: Record<TokenKind, Emphasis> = {
  plain: 'code-plain',
  comment: 'code-comment',
  string: 'code-string',
  number: 'code-number',
  keyword: 'code-keyword',
  literal: 'code-literal',
  function: 'code-function',
  tag: 'code-tag',
  attribute: 'code-attribute',
  punctuation: 'code-punctuation',
};

const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,6}\s+)(.*)$/;
const QUOTE = /^>\s?/;
const BULLET = /^(\s*(?:[-*]|\d+[.)])\s+)(.*)$/;

export function highlight(source: string): Segment[] {
  const lines = source.split('\n');
  const segments: Segment[] = [];

  let index = 0;
  while (index < lines.length) {
    if (index > 0) segments.push({ text: '\n', style: 'plain' });
    const line = lines[index] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      /*
       * A fence spans lines, so it cannot be an inline rule: the scanner works
       * a line at a time to keep the newlines exactly where the textarea puts
       * them. The body is coloured by the same tokeniser the rendered message
       * uses, so a block looks the same while it is typed and after it is sent.
       */
      segments.push({ text: line, style: 'marker' });
      index += 1;

      const body: string[] = [];
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }

      if (body.length > 0) {
        segments.push({ text: '\n', style: 'code-plain' });
        for (const token of highlightCode(body.join('\n'), fence[1] || null)) {
          segments.push({ text: token.text, style: CODE_STYLE[token.kind] });
        }
      }

      // An unterminated fence is the normal state halfway through typing one.
      if (index < lines.length) {
        segments.push({ text: '\n', style: 'plain' });
        segments.push({ text: lines[index] ?? '', style: 'marker' });
        index += 1;
      }

      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      segments.push({ text: heading[1] ?? '', style: 'marker' });
      for (const segment of inline(heading[2] ?? '')) {
        segments.push(segment.style === 'plain' ? { ...segment, style: 'heading' } : segment);
      }
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      segments.push({ text: line, style: 'quote' });
      index += 1;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      segments.push({ text: bullet[1] ?? '', style: 'marker' });
      segments.push(...inline(bullet[2] ?? ''));
      index += 1;
      continue;
    }

    segments.push(...inline(line));
    index += 1;
  }

  return merge(segments);
}

function inline(source: string): Segment[] {
  if (source === '') return [];

  let earliest: { at: number; text: string; style: Emphasis; markerLength: number } | null = null;

  for (const rule of RULES) {
    const match = rule.pattern.exec(source);
    if (!match) continue;

    // A leading space belongs to the text before, not to the mark.
    const lead = match[0].length - match[0].trimStart().length;
    const at = match.index + lead;

    if (earliest === null || at < earliest.at) {
      earliest = {
        at,
        text: match[0].slice(lead),
        style: rule.style,
        markerLength: rule.markerLength,
      };
    }
  }

  if (earliest === null) return [{ text: source, style: 'plain' }];

  const before = source.slice(0, earliest.at);
  const after = source.slice(earliest.at + earliest.text.length);

  return [
    ...(before === '' ? [] : [{ text: before, style: 'plain' as const }]),
    ...withMarkers(earliest.text, earliest.style, earliest.markerLength),
    ...inline(after),
  ];
}

/**
 * The delimiters stay visible but recede, so the emphasis reads at a glance
 * and the source is still there to edit.
 */
function withMarkers(text: string, style: Emphasis, markerLength: number): Segment[] {
  if (markerLength === 0) return [{ text, style }];

  return [
    { text: text.slice(0, markerLength), style: 'marker' },
    { text: text.slice(markerLength, text.length - markerLength), style },
    { text: text.slice(text.length - markerLength), style: 'marker' },
  ];
}

/** Fewer spans means less for the browser to lay out on every keystroke. */
function merge(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];

  for (const segment of segments) {
    if (segment.text === '') continue;

    const last = merged.at(-1);
    if (last && last.style === segment.style) last.text += segment.text;
    else merged.push({ ...segment });
  }

  return merged;
}
