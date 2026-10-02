import type { Db } from '@fluvia/db';
import { createApp } from './app';
import type { Bindings } from './env';

export const testEnv = { APP_VERSION: '1.2.3' } as Bindings;

export const fakeDb = (impl: Partial<Record<'execute' | 'insert', unknown>> = {}) =>
  impl as unknown as Db;

export const appWithDb = (db: Db) => createApp({ getDb: () => db });
