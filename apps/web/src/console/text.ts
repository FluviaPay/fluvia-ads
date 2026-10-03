import { ApiError, type Task, type TaskStatus } from './api';

/** Texts for the team: Colombian Spanish, say what happened and what to do. */
export function errorText(error: unknown): string {
  // The person closed or cancelled the browser's passkey prompt.
  if (error instanceof Error && ['NotAllowedError', 'AbortError'].includes(error.name)) {
    return 'Cancelaste la verificación o se acabó el tiempo. Inténtalo de nuevo.';
  }
  if (error instanceof Error && error.name === 'InvalidStateError') {
    return 'Este dispositivo ya está registrado en tu cuenta.';
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'Revisa lo que escribiste e inténtalo de nuevo.';
      case 401:
        return 'No pudimos verificarte. Revisa el código o la passkey e inténtalo de nuevo.';
      case 403:
        return 'No tienes permiso para hacer esto. Si administras personas, registra primero una passkey.';
      case 409:
        return 'No se pudo completar: el estado ya cambió (o es tu último método de ingreso). Actualiza la lista.';
      case 429:
        return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
      case 503:
        return 'El ingreso aún no está configurado. Avisa a quien administra la plataforma.';
    }
  }
  return 'No pudimos conectar con el servidor. Inténtalo de nuevo.';
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Resuelta',
  dismissed: 'Descartada',
};

/** Groups of 4 so the secret is easy to type into an authenticator app. */
export const formatSecret = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * What the team sees of a task's payload: the instruction first, then the other plain values.
 * Only strings, numbers and booleans are shown (as text, never as HTML).
 */
export function payloadLines(payload: Task['payload']): { label: string; value: string }[] {
  if (!payload) return [];
  const lines = Object.entries(payload)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .map(([label, value]) => ({ label, value: String(value) }));
  return lines.sort(
    (a, b) => Number(b.label === 'instruction') - Number(a.label === 'instruction'),
  );
}

/** Whether this browser can create and use passkeys (false while rendering on the server). */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

/** A readable default for the device name, from the browser's own description. */
export function suggestDeviceName(userAgent: string): string {
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iPhone o iPad'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Mi dispositivo';
  return os;
}
