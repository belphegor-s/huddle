import type { MemberProfile } from '@huddle/core';

interface TextNode {
  type: 'text';
  text: string;
}

interface ParagraphNode {
  type: 'paragraph';
  content?: TextNode[];
}

interface DocNode {
  type: 'doc';
  content: ParagraphNode[];
}

/**
 * Message bodies travel as serialized TipTap JSON. The composer is plain text
 * today, so it produces the document a rich editor would produce for the same
 * input: the wire format is already the final one, and swapping the editor in
 * later changes no server code and breaks no stored message.
 */
export function toDocument(text: string): string {
  const doc: DocNode = {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line === '' ? {} : { content: [{ type: 'text', text: line }] }),
    })),
  };

  return JSON.stringify(doc);
}

/** Never trusted as markup. The result is rendered as text nodes. */
export function toLines(body: string): string[] {
  try {
    const doc = JSON.parse(body) as DocNode;
    if (doc?.type !== 'doc' || !Array.isArray(doc.content)) return [];
    return doc.content.map((paragraph) =>
      (paragraph.content ?? []).map((node) => node.text ?? '').join(''),
    );
  } catch {
    return [];
  }
}

const MENTION = /@([\w.-]{1,80})/g;

/**
 * Mentions are resolved against the workspace roster on the client and sent as
 * ids, so a rename never breaks an old mention and the server never has to
 * parse a message body.
 */
export function findMentions(text: string, members: MemberProfile[]): string[] {
  const byHandle = new Map(members.map((member) => [handleOf(member.displayName), member.id]));
  const found = new Set<string>();

  for (const match of text.matchAll(MENTION)) {
    const id = byHandle.get((match[1] ?? '').toLowerCase());
    if (id) found.add(id);
  }

  return [...found];
}

export function handleOf(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, '.');
}
