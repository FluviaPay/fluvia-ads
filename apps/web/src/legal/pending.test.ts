import { describe, expect, it } from 'vitest';
import { countPending, splitPending, withoutPending } from './pending';

describe('splitPending', () => {
  it('returns plain text untouched', () => {
    expect(splitPending('Hola mundo')).toEqual([{ kind: 'text', text: 'Hola mundo' }]);
    expect(splitPending('')).toEqual([]);
  });

  it('finds markers anywhere in the text, keeping the text around them', () => {
    expect(splitPending('Escríbenos a [[CORREO]] o al [[WHATSAPP: por definir]].')).toEqual([
      { kind: 'text', text: 'Escríbenos a ' },
      { kind: 'pending', text: 'CORREO' },
      { kind: 'text', text: ' o al ' },
      { kind: 'pending', text: 'WHATSAPP: por definir' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('handles a marker at the very start, at the very end, and back to back', () => {
    expect(splitPending('[[A]][[B]]')).toEqual([
      { kind: 'pending', text: 'A' },
      { kind: 'pending', text: 'B' },
    ]);
    expect(splitPending('[[SOLO]]')).toEqual([{ kind: 'pending', text: 'SOLO' }]);
  });

  it('ignores single brackets and unclosed markers (they are ordinary text)', () => {
    expect(countPending('[nota] y [[sin cerrar')).toBe(0);
    expect(countPending('[[]]')).toBe(0);
  });
});

describe('countPending / withoutPending', () => {
  it('counts markers', () => {
    expect(countPending('a [[1]] b [[2]] c [[3]]')).toBe(3);
    expect(countPending('nada')).toBe(0);
  });

  it('removes every marker, leaving only what is stated as fact', () => {
    expect(withoutPending('Correo: [[CORREO]]. Fin.')).toBe('Correo: . Fin.');
  });
});
