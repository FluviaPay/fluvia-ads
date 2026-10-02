type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, message, ...fields }));
}
