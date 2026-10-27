import type { Pack, PackInput, SessionReport } from '@caps/shared';
import { safeEqual } from '../util';
import { toPack, type Storage } from './types';

/** pg.Pool과 같은 모양이면 무엇이든 (테스트에서는 pg-mem) */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  end?(): Promise<void>;
}

interface PackRow {
  code: string;
  name: string;
  preset: Pack['preset'];
  content: Pack['content'] | string;
  options: Pack['options'] | string;
  edit_key_hash: string;
  created_at: string | Date;
  updated_at: string | Date;
}

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class PgStorage implements Storage {
  readonly kind = 'postgres' as const;
  constructor(private readonly db: Queryable) {}

  async init(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS packs (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        preset TEXT NOT NULL,
        content JSONB NOT NULL,
        options JSONB NOT NULL,
        edit_key_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        report JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`);
  }

  private rowToPack(row: PackRow): Pack {
    return {
      code: row.code,
      name: row.name,
      preset: row.preset,
      content: json(row.content),
      options: json(row.options),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async createPack(code: string, input: PackInput, editKeyHash: string): Promise<Pack> {
    const now = new Date().toISOString();
    const pack = toPack(code, input, now, now);
    await this.db.query(
      `INSERT INTO packs (code, name, preset, content, options, edit_key_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, pack.name, pack.preset, JSON.stringify(pack.content), JSON.stringify(pack.options), editKeyHash, now, now],
    );
    return pack;
  }

  async getPack(code: string): Promise<Pack | null> {
    const { rows } = await this.db.query<PackRow>(`SELECT * FROM packs WHERE code = $1`, [code]);
    const row = rows[0];
    return row ? this.rowToPack(row) : null;
  }

  async updatePack(code: string, input: PackInput, editKeyHash: string): Promise<Pack | null | 'forbidden'> {
    const { rows } = await this.db.query<PackRow>(`SELECT * FROM packs WHERE code = $1`, [code]);
    const row = rows[0];
    if (!row) return null;
    if (!safeEqual(row.edit_key_hash, editKeyHash)) return 'forbidden';
    const now = new Date().toISOString();
    const pack = toPack(code, input, iso(row.created_at), now);
    await this.db.query(
      `UPDATE packs SET name = $2, preset = $3, content = $4, options = $5, updated_at = $6 WHERE code = $1`,
      [code, pack.name, pack.preset, JSON.stringify(pack.content), JSON.stringify(pack.options), now],
    );
    return pack;
  }

  async saveSession(report: SessionReport): Promise<void> {
    const now = new Date().toISOString();
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM sessions WHERE id = $1`, [report.id]);
    if (rows.length > 0) {
      await this.db.query(`UPDATE sessions SET report = $2, updated_at = $3 WHERE id = $1`, [
        report.id,
        JSON.stringify(report),
        now,
      ]);
    } else {
      await this.db.query(`INSERT INTO sessions (id, room_code, report, updated_at) VALUES ($1, $2, $3, $4)`, [
        report.id,
        report.roomCode,
        JSON.stringify(report),
        now,
      ]);
    }
  }

  async getSession(id: string): Promise<SessionReport | null> {
    const { rows } = await this.db.query<{ report: SessionReport | string }>(
      `SELECT report FROM sessions WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? json(row.report) : null;
  }

  async close(): Promise<void> {
    await this.db.end?.();
  }
}

export async function createPgStorage(url: string): Promise<PgStorage> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return new PgStorage(pool as unknown as Queryable);
}
