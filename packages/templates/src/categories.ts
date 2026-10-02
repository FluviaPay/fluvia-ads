import type { CategoryId } from './schema';

/**
 * PROVISIONAL, like the templates. Excluded categories are out of the MVP
 * (Meta special ad categories / Fluvia policy). Keywords are matched as whole
 * words after lowercasing and stripping accents.
 */
export const excludedCategories = {
  credit: {
    label: 'Crédito',
    keywords: ['credito', 'creditos', 'prestamo', 'prestamos', 'libranza'],
  },
  financial: {
    label: 'Financieras',
    keywords: ['financiera', 'financieras', 'financiero', 'financieros', 'finanzas'],
  },
  banking: { label: 'Banca', keywords: ['banca', 'banco', 'bancos', 'bancario'] },
  employment: {
    label: 'Empleo',
    keywords: ['empleo', 'empleos', 'vacante', 'vacantes', 'oferta laboral', 'reclutamiento'],
  },
  housing: {
    label: 'Vivienda',
    keywords: ['vivienda', 'viviendas', 'inmobiliaria', 'inmobiliarias'],
  },
  politics: {
    label: 'Política',
    keywords: ['politica', 'politico', 'politicos', 'partido politico', 'elecciones'],
  },
  health: {
    label: 'Salud',
    keywords: ['salud', 'medico', 'medicos', 'clinica', 'clinicas', 'medicina'],
  },
} as const;

export type ExcludedCategoryId = keyof typeof excludedCategories;

export const EXCLUDED_CATEGORY_IDS = Object.keys(excludedCategories) as ExcludedCategoryId[];

/** Free-text aliases (normalized) that map to an allowed template category. */
const allowedAliases: Record<CategoryId, string[]> = {
  beauty: ['belleza', 'beauty', 'peluqueria', 'barberia', 'salon de belleza', 'manicure'],
  food: ['comida', 'food', 'restaurante', 'cafeteria', 'panaderia', 'reposteria'],
  fashion: ['ropa', 'fashion', 'moda', 'boutique'],
  services: ['servicios', 'services', 'servicio'],
};

export type CategoryClassification =
  | { status: 'allowed'; category: CategoryId }
  | { status: 'excluded'; reason: ExcludedCategoryId }
  | { status: 'unknown' };

export function normalizeCategory(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Excluded wins over allowed (a "servicios de salud" business is excluded).
 * Anything unrecognized is `unknown`, which callers must treat as not allowed
 * (and route to a human task).
 */
export function classifyCategory(input: string): CategoryClassification {
  const text = normalizeCategory(input);
  if (!text) return { status: 'unknown' };
  const padded = ` ${text} `;

  for (const id of EXCLUDED_CATEGORY_IDS) {
    if (excludedCategories[id].keywords.some((k) => padded.includes(` ${k} `))) {
      return { status: 'excluded', reason: id };
    }
  }
  for (const [category, aliases] of Object.entries(allowedAliases)) {
    if (aliases.includes(text)) return { status: 'allowed', category: category as CategoryId };
  }
  return { status: 'unknown' };
}

export function isCategoryAllowed(input: string): boolean {
  return classifyCategory(input).status === 'allowed';
}
