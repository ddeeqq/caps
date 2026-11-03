import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pack, PackInput, SessionReport } from '@caps/shared';
import { isRoomSnapshot, type RoomSnapshot } from '../room/snapshot';
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

  private get roomsFile(): string {
    return path.join(this.dir, 'rooms.json');
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

  /**
   * 쓰기를 줄 세운다. 실패는 그 쓰기를 요청한 쪽에 그대로 알리고(조용히 삼키지 않음),
   * 줄은 계속 이어지게 한다.
   */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private persistPacks(): Promise<void> {
    const snapshot = Object.fromEntries(this.packs);
    return this.enqueue(() => this.atomicWrite(this.packsFile, snapshot));
  }

  async createPack(code: string, input: PackInput, editKeyHash: string): Promise<Pack> {
    const now = new Date().toISOString();
    const pack = toPack(code, input, now, now);
    this.packs.set(code, { pack, editKeyHash });
    try {
      await this.persistPacks();
    } catch (err) {
      this.packs.delete(code); // 디스크에 못 썼으면 메모리에도 남기지 않는다
      throw err;
    }
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
    try {
      await this.persistPacks();
    } catch (err) {
      this.packs.set(code, rec); // 되돌린다
      throw err;
    }
    return pack;
  }

  async saveSession(report: SessionReport): Promise<void> {
    const file = this.sessionFile(report.id);
    await this.enqueue(() => this.atomicWrite(file, report));
  }

  async getSession(id: string): Promise<SessionReport | null> {
    try {
      return JSON.parse(await readFile(this.sessionFile(id), 'utf8')) as SessionReport;
    } catch {
      return null;
    }
  }

  async pruneSessions(before: number): Promise<number> {
    const dir = path.join(this.dir, 'sessions');
    let removed = 0;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      try {
        if ((await stat(file)).mtimeMs < before) {
          await unlink(file);
          removed += 1;
        }
      } catch {
        /* 다른 쪽에서 이미 지웠으면 넘어간다 */
      }
    }
    return removed;
  }

  async saveRoomSnapshots(snapshots: RoomSnapshot[]): Promise<void> {
    await this.enqueue(() => this.atomicWrite(this.roomsFile, snapshots));
  }

  async loadRoomSnapshots(): Promise<RoomSnapshot[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.roomsFile, 'utf8'));
      return Array.isArray(raw) ? raw.filter(isRoomSnapshot) : [];
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
