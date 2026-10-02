/**
 * Points that need a decision or a fact only the team or the lawyer can provide are written
 * as `[[...]]` inside the text. They are highlighted on the page and counted by a test.
 */
export type Segment = { kind: 'text' | 'pending'; text: string };

const MARKER = /\[\[([^\]]+?)\]\]/g;

export function splitPending(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'pending', text: match[1] ?? '' });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

export const countPending = (text: string): number =>
  splitPending(text).filter((s) => s.kind === 'pending').length;

/** The text with every marker removed: what is left must not contain invented facts. */
export const withoutPending = (text: string): string =>
  splitPending(text)
    .filter((s) => s.kind === 'text')
    .map((s) => s.text)
    .join('');
