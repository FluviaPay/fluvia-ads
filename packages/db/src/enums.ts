import { pgEnum } from 'drizzle-orm/pg-core';

export const clientStatus = pgEnum('client_status', [
  'lead',
  'pending_verification',
  'verified',
  'active',
  'suspended',
]);

export const assetType = pgEnum('asset_type', ['logo', 'photo', 'video', 'invoice', 'other']);

export const messageDestination = pgEnum('message_destination', [
  'whatsapp',
  'instagram_direct',
  'messenger',
]);

export const metaConnectionStatus = pgEnum('meta_connection_status', [
  'pending',
  'connected',
  'needs_action',
  'revoked',
]);

export const campaignObjective = pgEnum('campaign_objective', ['messages', 'traffic']);

export const orderStatus = pgEnum('order_status', [
  'draft',
  'awaiting_payment',
  'paid',
  'funded',
  'active',
  'completed',
  'cancelled',
]);

export const paymentMethod = pgEnum('payment_method', ['bre_b', 'nequi', 'pse', 'card']);

export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'confirmed',
  'failed',
  'expired',
  'refunded',
]);

export const fundingStatus = pgEnum('funding_status', ['pending', 'allocated', 'failed']);

export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'pending_approval',
  'approved',
  'active',
  'paused',
  'completed',
  'rejected',
]);

export const creativeFormat = pgEnum('creative_format', [
  'square_1_1',
  'portrait_4_5',
  'vertical_9_16',
]);

export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'rejected']);

export const taskStatus = pgEnum('task_status', ['open', 'in_progress', 'done', 'dismissed']);

/** 'pauta' = third-party money (purchase mandate); 'servicio' = Fluvia's own income. */
export const ledgerKind = pgEnum('ledger_kind', ['pauta', 'servicio']);

export const ledgerDirection = pgEnum('ledger_direction', ['in', 'out']);

export const actorType = pgEnum('actor_type', ['ai', 'human', 'system']);

export const staffRole = pgEnum('staff_role', ['admin', 'operator']);

/** Where a staff session is in the two-factor login: email code done, TOTP pending or full. */
export const sessionStage = pgEnum('session_stage', ['email_verified', 'full']);

export const webauthnPurpose = pgEnum('webauthn_purpose', ['register', 'login']);
