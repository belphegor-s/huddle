export type Emphasis =
  'plain' | 'marker' | 'strong' | 'emphasis' | 'strike' | 'code' | 'link' | 'mention' | 'quote';

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
  { pattern: /```[\s\S]*?```|`[^`\n]+`/, style: 'code', markerLength: 0 },
  { pattern: /\[[^\]\n]+\]\((?:https?:\/\/)[^\s)]+\)/, style: 'link', markerLength: 0 },
  { pattern: /https?:\/\/[^\s<]+[^\s<>"'.,;:!?)\]}]/, style: 'link', markerLength: 0 },
  { pattern: /@[\w.-]{1,80}/, style: 'mention', markerLength: 0 },
  { pattern: /\*\*[^\n]+?\*\*/, style: 'strong', markerLength: 2 },
  { pattern: /__[^\n]+?__/, style: 'strong', markerLength: 2 },
  { pattern: /~~[^\n]+?~~/, style: 'strike', markerLength: 2 },
  { pattern: /\*[^*\n]+?\*/, style: 'emphasis', markerLength: 1 },
  { pattern: /(?:^|(?<=\s))_[^_\n]+?_(?=\s|$)/, style: 'emphasis', markerLength: 1 },
];

export function highlight(source: string): Segment[] {
  const segments: Segment[] = [];

  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) segments.push({ text: '\n', style: 'plain' });

    const quote = /^>\s?/.exec(line);
    if (quote) {
      segments.push({ text: line, style: 'quote' });
      continue;
    }

    const bullet = /^(\s*(?:[-*]|\d+[.)])\s+)(.*)$/.exec(line);
    if (bullet) {
      segments.push({ text: bullet[1] ?? '', style: 'marker' });
      segments.push(...inline(bullet[2] ?? ''));
      continue;
    }

    segments.push(...inline(line));
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
