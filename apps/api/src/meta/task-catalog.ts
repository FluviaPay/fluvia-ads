/**
 * Human tasks created when the Meta setup cannot finish by itself (CLAUDE.md: any failure
 * becomes a row in `tasks` instead of stopping the flow). Each one carries the exact
 * instruction for the team, in Spanish, and how to resume.
 *
 * Meta's menus change and docs/plan-meta.md could not be checked against Meta's docs, so
 * the instructions say WHAT to do and WHERE in general terms, never a menu path as fact.
 */
export const SETUP_TASK_CODES = [
  'PERMISSIONS_MISSING',
  'PAGE_NOT_ADMIN',
  'PAGE_UNPUBLISHED',
  'IG_NOT_PROFESSIONAL',
  'WA_NOT_LINKED',
  'WA_VERIFY_MANUAL',
  'AD_ACCOUNT_CREATION_FAILED',
  'AD_ACCOUNT_CONFLICT',
  'PAGE_ASSIGN_MANUAL',
  'PAGE_ASSIGN_PENDING_CLIENT',
  'PAGE_RESTRICTED',
  'PAGE_RESTRICTION_UNVERIFIED',
  'AUTH_EXPIRED',
  'RECONNECT_REQUIRED',
  'CONFIG_MISSING',
  'SETUP_FAILED_TECHNICAL',
  'ENQUEUE_FAILED',
] as const;

export type SetupTaskCode = (typeof SETUP_TASK_CODES)[number];

export type TaskContext = {
  clientId: string;
  clientName?: string | undefined;
  whatsapp?: string | undefined;
  pageId?: string | null | undefined;
  igId?: string | null | undefined;
  adAccountId?: string | null | undefined;
  /** Category/code/step only: never Meta's message text. */
  detail?: string | undefined;
};

export type TaskDraft = {
  type: string;
  title: string;
  payload: Record<string, unknown>;
};

type Entry = { title: string; instruction: (c: Resolved) => string };

type Resolved = TaskContext & {
  who: string;
  page: string;
  retryCall: string;
  retryWith: (code: string) => string;
  newLink: string;
};

const CONTACT = (c: Resolved) => (c.whatsapp ? `${c.who} (WhatsApp ${c.whatsapp})` : c.who);

const ENTRIES: Record<SetupTaskCode, Entry> = {
  PERMISSIONS_MISSING: {
    title: 'El cliente no aceptó todos los permisos de Meta',
    instruction: (c) =>
      `Escríbele a ${CONTACT(c)} y pídele que vuelva a conectar aceptando TODOS los permisos que pide Facebook. Genera un enlace nuevo (${c.newLink}) y envíaselo por WhatsApp.`,
  },
  PAGE_NOT_ADMIN: {
    title: 'El cliente no es administrador de su página de Facebook',
    instruction: (c) =>
      `${CONTACT(c)} necesita ser administrador con control total de la página ${c.page}. Pídele que se asigne ese rol (o que se lo dé quien administra la página) y luego envíale un enlace nuevo (${c.newLink}).`,
  },
  PAGE_UNPUBLISHED: {
    title: 'La página de Facebook del cliente no está publicada',
    instruction: (c) =>
      `Pídele a ${CONTACT(c)} que publique su página ${c.page} desde Facebook. Cuando lo haga, ${c.retryCall}.`,
  },
  IG_NOT_PROFESSIONAL: {
    title: 'El Instagram del cliente no es una cuenta profesional',
    instruction: (c) =>
      `Pídele a ${CONTACT(c)} que pase su Instagram a cuenta profesional (Business o Creator) y que la vincule a su página de Facebook ${c.page}. Cuando lo confirme, ${c.retryCall}.`,
  },
  WA_NOT_LINKED: {
    title: 'La página del cliente no tiene WhatsApp vinculado',
    instruction: (c) =>
      `La página ${c.page} de ${c.who} no tiene un número de WhatsApp vinculado y el cliente eligió WhatsApp como destino. Vincula su número de WhatsApp Business a esa página (desde la configuración de la página en Meta Business Suite; el menú exacto puede variar). Luego ${c.retryCall}.`,
  },
  WA_VERIFY_MANUAL: {
    title: 'Verificar a mano el WhatsApp vinculado de la página',
    instruction: (c) =>
      `Meta no nos permite comprobar por API si la página ${c.page} de ${c.who} tiene WhatsApp vinculado. Revísalo en Meta Business Suite. Si NO está vinculado, vincúlalo primero. Cuando esté vinculado, ${c.retryWith('WA_VERIFY_MANUAL')}.`,
  },
  AD_ACCOUNT_CREATION_FAILED: {
    title: 'Meta no dejó crear la cuenta publicitaria',
    instruction: (c) =>
      `Meta rechazó crear la cuenta publicitaria de ${c.who}${c.detail ? ` (${c.detail})` : ''}. Causas probables: se alcanzó el tope de cuentas del portafolio de Fluvia o falta un dato obligatorio. Revisa cuántas cuentas hay en el portafolio (Business Settings) y, si se llegó al tope, avisa a Mauricio y a Angela. Cuando se resuelva, ${c.retryCall}.`,
  },
  AD_ACCOUNT_CONFLICT: {
    title: 'Ya existe una cuenta publicitaria del cliente en otra moneda',
    instruction: (c) =>
      `Ya hay una cuenta publicitaria de ${c.who} llamada FLV_${c.clientId} que no está en COP, y la moneda no se puede cambiar. Ciérrala o renómbrala en Business Settings del portafolio de Fluvia y luego ${c.retryCall}.`,
  },
  PAGE_ASSIGN_MANUAL: {
    title: 'Dar acceso a la página del cliente manualmente',
    instruction: (c) =>
      `Meta no nos dejó pedir acceso a la página ${c.page} por API. Desde el portafolio de Fluvia (Business Settings, sección de páginas; la ruta exacta puede variar) solicita acceso de anunciante a esa página, pídele a ${c.who} que lo apruebe y asígnale la página al usuario de sistema y a la cuenta ${c.adAccountId ?? '(pendiente)'}. Cuando esté hecho, ${c.retryWith('PAGE_ASSIGN_MANUAL')}.`,
  },
  PAGE_ASSIGN_PENDING_CLIENT: {
    title: 'El cliente debe aprobar el acceso a su página',
    instruction: (c) =>
      `Ya pedimos acceso de anunciante a la página ${c.page}, pero falta que ${CONTACT(c)} lo apruebe (en las notificaciones de Facebook o en su Business Manager). Pídeselo. Cuando lo apruebe, ${c.retryWith('PAGE_ASSIGN_PENDING_CLIENT')}.`,
  },
  PAGE_RESTRICTED: {
    title: 'La página del cliente tiene restricciones de Meta',
    instruction: (c) =>
      `Meta rechazó la validación de un anuncio con la página ${c.page} de ${c.who}${c.detail ? ` (${c.detail})` : ''}: parece tener restricciones o bloqueo por políticas. Revisa el estado de la página en Meta Business Support / Calidad de la cuenta. No se puede pautar hasta resolverlo. Si el cliente lo resuelve, ${c.retryCall}.`,
  },
  PAGE_RESTRICTION_UNVERIFIED: {
    title: 'Verificar a mano si la página tiene restricciones',
    instruction: (c) =>
      `No pudimos comprobar por API si la página ${c.page} de ${c.who} tiene restricciones${c.detail ? ` (${c.detail})` : ''}. Revisa su estado en Meta Business Support / Calidad de la cuenta. Si está limpia, ${c.retryWith('PAGE_RESTRICTION_UNVERIFIED')}.`,
  },
  AUTH_EXPIRED: {
    title: 'El permiso del cliente venció o fue revocado',
    instruction: (c) =>
      `El permiso que ${CONTACT(c)} dio a Fluvia en Meta venció o lo retiró. Genera un enlace nuevo (${c.newLink}) y envíaselo por WhatsApp para que vuelva a conectar.`,
  },
  RECONNECT_REQUIRED: {
    title: 'El cliente debe volver a conectar su Facebook',
    instruction: (c) =>
      `Falta la página o el permiso de ${CONTACT(c)} para seguir. Genera un enlace nuevo (${c.newLink}) y envíaselo por WhatsApp para que vuelva a conectar.`,
  },
  CONFIG_MISSING: {
    title: 'Falta configuración de Meta en el ambiente',
    instruction: (c) =>
      `No se puede crear la cuenta publicitaria de ${c.who} porque falta configuración${c.detail ? `: ${c.detail}` : ''}. Cárgala (variables en wrangler.toml o secretos con wrangler secret) en el ambiente que corresponda y luego ${c.retryCall}.`,
  },
  SETUP_FAILED_TECHNICAL: {
    title: 'Falló un paso técnico de la conexión con Meta',
    instruction: (c) =>
      `Un paso técnico de la conexión de ${c.who} falló${c.detail ? ` (${c.detail})` : ''} y se agotaron los reintentos. Revisa los logs del Worker con el request_id y luego ${c.retryCall}. Si se repite, avisa a desarrollo.`,
  },
  ENQUEUE_FAILED: {
    title: 'No se pudo encolar el procesamiento de la conexión',
    instruction: (c) =>
      `La conexión de ${c.who} quedó guardada pero no se pudo encolar su procesamiento. ${c.retryCall[0]?.toUpperCase()}${c.retryCall.slice(1)}.`,
  },
};

function resolve(context: TaskContext): Resolved {
  const retryPath = `/meta/connections/${context.clientId}/process`;
  return {
    ...context,
    who: context.clientName ?? `el cliente ${context.clientId}`,
    page: context.pageId ?? '(sin página)',
    retryCall: `vuelve a correr el proceso con POST ${retryPath}`,
    retryWith: (code) =>
      `vuelve a correr el proceso con POST ${retryPath} y el cuerpo {"acknowledged":["${code}"]}`,
    newLink: 'POST /meta/connections/link con el clientId',
  };
}

export function buildTask(code: SetupTaskCode, context: TaskContext): TaskDraft {
  const entry = ENTRIES[code];
  const resolved = resolve(context);
  return {
    type: `meta.setup.${code}`,
    title: entry.title,
    payload: {
      code,
      instruction: entry.instruction(resolved),
      clientId: context.clientId,
      clientName: context.clientName ?? null,
      pageId: context.pageId ?? null,
      igId: context.igId ?? null,
      adAccountId: context.adAccountId ?? null,
      detail: context.detail ?? null,
      retry: { method: 'POST', path: `/meta/connections/${context.clientId}/process` },
    },
  };
}
