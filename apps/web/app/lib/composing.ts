/**
 * What the Enter key means depends on where the caret is.
 *
 * Both of these are pure and take the whole field plus a caret offset, so they
 * can be tested without a browser and reused by the message editor.
 */

export interface Edit {
  value: string;
  caret: number;
}

const FENCE = /^```/;
const CONTINUES = /^(\s*)(?:([-*])\s+|(\d+)([.)])\s+|(>)\s?)(.*)$/;

/**
 * True when the caret sits inside an unterminated fenced block.
 *
 * Enter has to make a line there rather than send. Someone halfway through
 * pasting a stack trace has an open fence by definition, and sending on the
 * first newline would cut the message in half.
 */
export function insideFence(value: string, caret: number): boolean {
  // Counted through the caret's own line, so the Enter that follows the third
  // backtick opens the block rather than sending the message.
  let open = false;
  for (const line of value.slice(0, caret).split('\n')) if (FENCE.test(line)) open = !open;

  return open;
}

/**
 * The prefix a new line should inherit: another bullet, the next number, or
 * the quote mark.
 *
 * An empty item ends the list instead of adding to it, which is the behaviour
 * every editor has and the only way out that does not involve reaching for
 * backspace.
 */
export function continueList(value: string, caret: number): Edit | null {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(start, caret);

  const match = CONTINUES.exec(line);
  if (!match) return null;

  const [, indent = '', bullet, number, delimiter, quote, rest = ''] = match;

  if (rest.trim() === '') {
    const cleared = value.slice(0, start) + value.slice(caret);
    return { value: cleared, caret: start };
  }

  const prefix =
    bullet !== undefined
      ? `${indent}${bullet} `
      : number !== undefined
        ? `${indent}${String(Number(number) + 1)}${delimiter ?? '.'} `
        : `${indent}${quote ?? '>'} `;

  const inserted = `\n${prefix}`;
  return {
    value: value.slice(0, caret) + inserted + value.slice(caret),
    caret: caret + inserted.length,
  };
}
