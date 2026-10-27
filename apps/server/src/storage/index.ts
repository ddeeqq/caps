import { JsonStorage } from './jsonStorage';
import { createPgStorage } from './pgStorage';
import type { Storage } from './types';

export type { Storage } from './types';
export { JsonStorage } from './jsonStorage';
export { PgStorage } from './pgStorage';

export async function createStorage(opts: { databaseUrl?: string; dataDir: string }): Promise<Storage> {
  const storage = opts.databaseUrl ? await createPgStorage(opts.databaseUrl) : new JsonStorage(opts.dataDir);
  await storage.init();
  return storage;
}
