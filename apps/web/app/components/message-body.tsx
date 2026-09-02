import { toLines } from '../lib/rich-text';

/**
 * Renders a message body as text nodes. The body is stored as TipTap JSON and
 * is never trusted as markup, so nothing here can turn message content into an
 * element.
 */
export function MessageBody({ body }: { body: string }) {
  return (
    <div className="leading-message text-base whitespace-pre-wrap">
      {toLines(body).map((line, index) => (
        <p key={index}>{line === '' ? ' ' : line}</p>
      ))}
    </div>
  );
}
