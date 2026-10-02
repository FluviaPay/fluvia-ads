import type { CampaignTemplate, CategoryId } from './schema';
import { DEFAULT_MESSAGE_DESTINATIONS } from './schema';

/**
 * PROVISIONAL: every value below is a placeholder until Angela confirms.
 * Edit the data only; no logic depends on specific values.
 */

const baseCopyRules = {
  language: 'es-CO',
  maxHeadlineChars: 40,
  maxBodyChars: 125,
  mustAvoid: ['garantizado', 'el mejor', 'resultados asegurados'],
} as const;

export const templates: Record<CategoryId, CampaignTemplate> = {
  beauty: {
    category: 'beauty',
    label: 'Belleza',
    status: 'provisional',
    objective: 'messages',
    messageDestinations: [...DEFAULT_MESSAGE_DESTINATIONS],
    audience: {
      country: 'CO',
      ageMin: 20,
      ageMax: 50,
      genders: 'female',
      interests: ['Belleza', 'Cuidado de la piel', 'Peluquería'],
    },
    dailyBudgetCop: { min: 15_000, max: 40_000 },
    adCount: 3,
    formats: ['1:1', '4:5', '9:16'],
    copyRules: {
      ...baseCopyRules,
      mustAvoid: [...baseCopyRules.mustAvoid],
      tone: 'cercano, aspiracional y cálido',
      ctaOptions: ['Escríbenos', 'Agenda tu cita', 'Cotiza por WhatsApp'],
      mustInclude: ['servicio o producto concreto', 'invitación a escribir'],
    },
  },
  food: {
    category: 'food',
    label: 'Comida',
    status: 'provisional',
    objective: 'messages',
    messageDestinations: [...DEFAULT_MESSAGE_DESTINATIONS],
    audience: {
      country: 'CO',
      ageMin: 18,
      ageMax: 55,
      genders: 'all',
      interests: ['Restaurantes', 'Comida a domicilio', 'Gastronomía'],
    },
    dailyBudgetCop: { min: 15_000, max: 50_000 },
    adCount: 3,
    formats: ['1:1', '4:5', '9:16'],
    copyRules: {
      ...baseCopyRules,
      mustAvoid: [...baseCopyRules.mustAvoid],
      tone: 'apetitoso, directo y amigable',
      ctaOptions: ['Pide por WhatsApp', 'Haz tu pedido', 'Escríbenos'],
      mustInclude: ['producto estrella', 'cómo pedir'],
    },
  },
  fashion: {
    category: 'fashion',
    label: 'Ropa',
    status: 'provisional',
    objective: 'messages',
    messageDestinations: [...DEFAULT_MESSAGE_DESTINATIONS],
    audience: {
      country: 'CO',
      ageMin: 18,
      ageMax: 45,
      genders: 'all',
      interests: ['Moda', 'Compras en línea', 'Ropa y accesorios'],
    },
    dailyBudgetCop: { min: 20_000, max: 60_000 },
    adCount: 4,
    formats: ['1:1', '4:5', '9:16'],
    copyRules: {
      ...baseCopyRules,
      mustAvoid: [...baseCopyRules.mustAvoid],
      tone: 'moderno, cercano y con estilo',
      ctaOptions: ['Escríbenos', 'Mira el catálogo', 'Pide tu talla'],
      mustInclude: ['prenda o colección', 'invitación a escribir'],
    },
  },
  services: {
    category: 'services',
    label: 'Servicios',
    status: 'provisional',
    objective: 'messages',
    messageDestinations: [...DEFAULT_MESSAGE_DESTINATIONS],
    audience: {
      country: 'CO',
      ageMin: 25,
      ageMax: 60,
      genders: 'all',
      interests: ['Servicios para el hogar', 'Emprendimiento', 'Pequeñas empresas'],
    },
    dailyBudgetCop: { min: 20_000, max: 50_000 },
    adCount: 3,
    formats: ['1:1', '4:5'],
    copyRules: {
      ...baseCopyRules,
      mustAvoid: [...baseCopyRules.mustAvoid],
      tone: 'confiable, claro y profesional',
      ctaOptions: ['Cotiza gratis', 'Escríbenos', 'Solicita tu servicio'],
      mustInclude: ['qué servicio ofreces', 'zona de cobertura'],
    },
  },
};

export function getTemplate(category: CategoryId): CampaignTemplate {
  return templates[category];
}
