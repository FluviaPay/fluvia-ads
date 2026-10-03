import { ApiError, type Task, type TaskStatus } from './api';

/** Texts for the team: Colombian Spanish, say what happened and what to do. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return 'Revisa lo que escribiste e inténtalo de nuevo.';
      case 401:
        return 'El código no es válido o ya venció. Pide uno nuevo si hace falta.';
      case 403:
        return 'No tienes permiso para hacer esto.';
      case 409:
        return 'Alguien más ya cambió esta tarea. Actualiza la lista.';
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
