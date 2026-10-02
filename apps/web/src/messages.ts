import type { ConnectReason, ConnectResult } from '@fluvia/shared';

export type ResultView = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  body: string;
  /** What the client has to fix, one sentence each. */
  items: string[];
  /** Offer the "try again" button (only possible when the API sent a fresh state). */
  canRetry: boolean;
};

/** Texts for the client: Colombian Spanish, no technical terms, always say what to do. */
export const REASON_TEXT: Record<ConnectReason, string> = {
  PERMISSIONS_MISSING:
    'Acepta todos los permisos que te pide Facebook. Sin ellos no podemos publicar tu pauta.',
  PAGE_NOT_ADMIN:
    'Necesitas ser administrador de tu página de Facebook con control total. Si no lo eres, pídele a quien la administra que te dé acceso.',
  PAGE_UNPUBLISHED:
    'Tu página de Facebook no está publicada. Publícala desde Facebook y vuelve a conectar.',
  NO_PAGE:
    'No encontramos ninguna página de Facebook. Cuando Facebook te lo pida, elige la página de tu negocio.',
  MULTIPLE_PAGES: 'Elegiste más de una página. Vuelve a conectar y elige solo la de tu negocio.',
};

export function resultView(result: ConnectResult): ResultView {
  const canRetry = Boolean(result.retryState);

  switch (result.status) {
    case 'ok':
      return {
        tone: 'success',
        title: '¡Listo, recibimos tu conexión!',
        body: 'Estamos revisando tu página de Facebook y tu Instagram. Te escribimos por WhatsApp apenas todo esté listo.',
        items: [],
        canRetry: false,
      };
    case 'needs_action':
      return {
        tone: 'warning',
        title: 'Necesitamos que ajustes un detalle',
        body: 'Para seguir con tu pauta, revisa esto y vuelve a conectar:',
        items: result.reasons.map((reason) => REASON_TEXT[reason]),
        canRetry,
      };
    case 'cancelled':
      return {
        tone: 'warning',
        title: 'Cancelaste la conexión',
        body: 'No pasa nada. Cuando quieras retomarla, toca el botón de abajo.',
        items: [],
        canRetry,
      };
    case 'invalid_state':
      return {
        tone: 'error',
        title: 'Este enlace ya no sirve',
        body: 'Venció o ya se usó. Pídenos uno nuevo por WhatsApp y seguimos.',
        items: [],
        canRetry: false,
      };
    case 'error':
      return {
        tone: 'error',
        title: 'Algo salió mal de nuestro lado',
        body: 'Ya avisamos al equipo. Puedes intentarlo de nuevo en unos minutos o escribirnos por WhatsApp.',
        items: [],
        canRetry,
      };
  }
}
