import { z } from 'zod';

export const objectiveSchema = z.enum(['messages', 'traffic']);
export type Objective = z.infer<typeof objectiveSchema>;

export const messageDestinationSchema = z.enum(['whatsapp', 'instagram_direct', 'messenger']);
export type MessageDestination = z.infer<typeof messageDestinationSchema>;

export const creativeFormatSchema = z.enum(['1:1', '4:5', '9:16']);
export type CreativeFormat = z.infer<typeof creativeFormatSchema>;

export const categoryIdSchema = z.enum(['beauty', 'food', 'fashion', 'services']);
export type CategoryId = z.infer<typeof categoryIdSchema>;

export const DEFAULT_MESSAGE_DESTINATIONS: MessageDestination[] = ['whatsapp', 'instagram_direct'];

const copCents = z.int().positive();

export const audienceSchema = z
  .strictObject({
    country: z.literal('CO'),
    ageMin: z.int().min(18).max(65),
    ageMax: z.int().min(18).max(65),
    genders: z.enum(['all', 'female', 'male']),
    interests: z.array(z.string().min(1)),
  })
  .refine((a) => a.ageMin <= a.ageMax, { message: 'ageMin must be <= ageMax' });

export const dailyBudgetCopSchema = z
  .strictObject({ min: copCents, max: copCents })
  .refine((b) => b.min <= b.max, { message: 'min must be <= max' });

export const copyRulesSchema = z.strictObject({
  language: z.literal('es-CO'),
  tone: z.string().min(1),
  maxHeadlineChars: z.int().positive(),
  maxBodyChars: z.int().positive(),
  ctaOptions: z.array(z.string().min(1)).min(1),
  mustInclude: z.array(z.string().min(1)),
  mustAvoid: z.array(z.string().min(1)),
});

/**
 * Campaign template: CONFIGURATION, not logic. Values are `provisional` until
 * Angela confirms them; change the data, never the code that consumes it.
 */
export const campaignTemplateSchema = z.strictObject({
  category: categoryIdSchema,
  label: z.string().min(1),
  status: z.enum(['provisional', 'confirmed']),
  objective: objectiveSchema,
  messageDestinations: z.array(messageDestinationSchema).min(1),
  audience: audienceSchema,
  dailyBudgetCop: dailyBudgetCopSchema,
  adCount: z.int().min(1).max(10),
  formats: z
    .array(creativeFormatSchema)
    .min(1)
    .refine((f) => new Set(f).size === f.length, { message: 'formats must be unique' }),
  copyRules: copyRulesSchema,
});
export type CampaignTemplate = z.infer<typeof campaignTemplateSchema>;
