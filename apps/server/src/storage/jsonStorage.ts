import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pack, PackInput, SessionReport } from '@caps/shared';
import { safeEqual } from '../util';
import { toPack, type Storage } from './types';

interface PackRecord {
  pack: Pack;
  editKeyHash: string;
}

/** 설치 없이 바로 쓰는 파일 저장소. 쓰기는 임시 파일 → rename 으로 원자적으로 한다. */
export class JsonStorage implements Storage {
  readonly kind = 'json' as const;
  private packs = new Map<string, PackRecord>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private get packsFile(): string {
    return path.join(this.dir, 'packs.json');
  }

  private sessionFile(id: string): string {
    return path.join(this.dir, 'sessions', `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.dir, 'sessions'), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.packsFile, 'utf8')) as Record<string, PackRecord>;
      this.packs = new Map(Object.entries(raw));
    } catch {
      this.packs = new Map();
    }
  }

  private async atomicWrite(file: string, data: unknown): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  private persistPacks(): Promise<void> {
    const snapshot = Object.fromEntries(this.packs);
    this.queue = this.queue.then(() => this.atomicWrite(this.packsFile, snapshot)).catch(() => undefined);
    return this.queue;
  }

  async createPack(code: string, input: PackInput, editKeyHash: string): Promise<Pack> {
    const now = new Date().toISOString();
    const pack = toPack(code, input, now, now);
    this.packs.set(code, { pack, editKeyHash });
    await this.persistPacks();
    return pack;
  }

  async getPack(code: string): Promise<Pack | null> {
    return this.packs.get(code)?.pack ?? null;
  }

  async updatePack(code: string, input: PackInput, editKeyHash: string): Promise<Pack | null | 'forbidden'> {
    const rec = this.packs.get(code);
    if (!rec) return null;
    if (!safeEqual(rec.editKeyHash, editKeyHash)) return 'forbidden';
    const pack = toPack(code, input, rec.pack.createdAt, new Date().toISOString());
    this.packs.set(code, { pack, editKeyHash: rec.editKeyHash });
    await this.persistPacks();
    return pack;
  }

  async saveSession(report: SessionReport): Promise<void> {
    const file = this.sessionFile(report.id);
    this.queue = this.queue.then(() => this.atomicWrite(file, report)).catch(() => undefined);
    await this.queue;
  }

  async getSession(id: string): Promise<SessionReport | null> {
    try {
      return JSON.parse(await readFile(this.sessionFile(id), 'utf8')) as SessionReport;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
