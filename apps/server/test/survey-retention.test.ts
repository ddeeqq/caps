import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, resolvePack, type SessionReport } from '@caps/shared';
import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room/Room';
import { JsonStorage } from '../src/storage';
import { needsSsl, PgStorage, type Queryable } from '../src/storage/pgStorage';

const report = (id: string): SessionReport =>
  ({
    id,
    roomCode: 'ABCD',
    packName: 'p',
    packCode: null,
    preset: 'work',
    startedAt: new Date().toISOString(),
    endedAt: null,
    peakPlayers: 1,
    bots: 0,
    activeAtEnd: 1,
    retention: 100,
    flow: ['nunchi'],
    games: [],
    survey: {
      lobby: { count: 0, avg: null },
      end: { count: 0, avg: null, newPeople: [0, 0, 0, 0] },
    },
    metrics: { faceToFace: 0, links: 0, wrongLinks: 0, reactions: 0, vaultSuccessRate: -1 },
  }) as SessionReport;

describe('한 줄 소감', () => {
  it('다듬고, 금칙어는 버리고, 사람 것만 이름 없이 리포트에 담는다', () => {
    const room = new Room({
      code: 'TEST',
      pack: resolvePack({ preset: 'work' }),
      flow: ['nunchi'],
      settings: DEFAULT_SETTINGS,
    });
    const [a, b, c] = ['가', '나', '다'].map((n) => room.addPlayer(n));
    room.survey(a!, { phase: 'end', comfort: 4, comment: '   옆 사람   이름을 알았어요  ' });
    room.survey(b!, { phase: 'end', comment: '씨 발' });
    room.survey(c!, { phase: 'end', comment: 'x'.repeat(150) });
    const quotes = room.report().quotes!;
    expect(quotes).toHaveLength(2);
    expect(quotes).toContain('옆 사람 이름을 알았어요');
    expect(quotes.every((q) => q.length <= 60)).toBe(true);
    expect(JSON.stringify(room.report())).not.toContain('"가"'); // 소감에 닉네임이 붙지 않는다
    // 비우면 지운다
    room.survey(a!, { phase: 'end', comment: '' });
    expect(room.report().quotes).toHaveLength(1);
  });
});

describe('리포트 보관 기한', () => {
  it('JSON 저장소: 오래된 파일만 지운다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'caps-prune-'));
    try {
      const s = new JsonStorage(dir);
      await s.init();
      await s.saveSession(report('old'));
      await s.saveSession(report('new'));
      const longAgo = new Date(Date.now() - 40 * 86_400_000);
      await utimes(path.join(dir, 'sessions', 'old.json'), longAgo, longAgo);
      expect(await s.pruneSessions(Date.now() - 30 * 86_400_000)).toBe(1);
      expect(await s.getSession('old')).toBeNull();
      expect(await s.getSession('new')).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('PostgreSQL 저장소: 기준 시각 이전에 갱신된 행을 지운다', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const s = new PgStorage(new Pool() as unknown as Queryable);
    await s.init();
    await s.saveSession(report('a'));
    expect(await s.pruneSessions(Date.now() - 86_400_000)).toBe(0);
    expect(await s.pruneSessions(Date.now() + 1_000)).toBe(1);
    expect(await s.getSession('a')).toBeNull();
  });
});

describe('PostgreSQL 연결 주소', () => {
  it('외부 주소에만 TLS를 켠다', () => {
    expect(needsSsl('postgresql://u:p@dpg-abc-a/db', undefined)).toBe(false);
    expect(needsSsl('postgresql://u:p@dpg-abc-a.singapore-postgres.render.com/db', undefined)).toBe(true);
    expect(needsSsl('postgres://u:p@localhost:5432/db?sslmode=require', undefined)).toBe(true);
    expect(needsSsl('postgresql://u:p@dpg-abc-a.singapore-postgres.render.com/db', '0')).toBe(false);
  });
});

describe('소감 숨기기', () => {
  it('진행자가 숨긴 소감은 리포트에서 빠지고, 저장본에도 남는다', () => {
    const room = new Room({
      code: 'HIDE',
      pack: resolvePack({ preset: 'work' }),
      flow: ['nunchi'],
      settings: DEFAULT_SETTINGS,
    });
    const [a, b] = ['가', '나'].map((n) => room.addPlayer(n));
    room.survey(a!, { phase: 'end', comment: '좋았어요' });
    room.survey(b!, { phase: 'end', comment: '그냥 그랬어요' });
    expect(room.command({ type: 'hideQuote', text: '그냥 그랬어요' })).toBeNull();
    expect(room.report().quotes).toEqual(['좋았어요']);
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(room.toSnapshot())));
    expect(restored.report().quotes).toEqual(['좋았어요']);
  });
});
