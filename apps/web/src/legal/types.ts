import { countPending } from './pending';

export type Block =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  /** Text the client copies and sends; shown as a preformatted block. */
  | { type: 'template'; text: string };

export type LegalSection = { id: string; heading: string; blocks: Block[] };

export type LegalDoc = {
  title: string;
  intro: string[];
  sections: LegalSection[];
};

export const p = (text: string): Block => ({ type: 'p', text });
export const ul = (...items: string[]): Block => ({ type: 'ul', items });
export const table = (head: string[], rows: string[][]): Block => ({ type: 'table', head, rows });
export const template = (text: string): Block => ({ type: 'template', text });

/** Every piece of text on the page, in order. */
export function allText(doc: LegalDoc): string[] {
  const blockText = (block: Block): string[] => {
    switch (block.type) {
      case 'p':
      case 'template':
        return [block.text];
      case 'ul':
        return block.items;
      case 'table':
        return [...block.head, ...block.rows.flat()];
    }
  };
  return [
    doc.title,
    ...doc.intro,
    ...doc.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockText)]),
  ];
}

export const pendingCount = (doc: LegalDoc): number =>
  allText(doc).reduce((total, text) => total + countPending(text), 0);
