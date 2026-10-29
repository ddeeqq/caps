import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { PgStorage, type Queryable } from '../src/storage/pgStorage';

describe('PostgreSQL 저장소 (pg-mem)', () => {
  it('팩 생성·조회·수정, 세션 저장·갱신', async () => {
    // pg-mem은 이미 있는 테이블의 IF NOT EXISTS 구문 일부를 읽지 않아 검사를 끈다 (실제 PostgreSQL은 문제없음)
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const storage = new PgStorage(new Pool() as unknown as Queryable);
    await storage.init();
    await storage.init(); // 두 번 불러도 안전

    const input = {
      name: '테스트 팩',
      preset: 'work' as const,
      content: {
        names: ['김 팀장'],
        keywords: ['스프린트'],
        balanceQuestions: [],
        teamNames: [],
        finaleText: '',
        penalties: [],
      },
      options: {},
    };
    const pack = await storage.createPack('ABC234', input, 'hash-1');
    expect(pack.options.personCompare).toBe(false);
    expect((await storage.getPack('ABC234'))?.content.keywords).toEqual(['스프린트']);
    expect(await storage.getPack('NOPE00')).toBeNull();
    expect(await storage.updatePack('ABC234', { ...input, name: '바뀐 팩' }, 'wrong')).toBe('forbidden');
    const updated = await storage.updatePack('ABC234', { ...input, name: '바뀐 팩' }, 'hash-1');
    expect(updated !== 'forbidden' && updated?.name).toBe('바뀐 팩');

    const report = {
      id: 'session-1',
      roomCode: 'ABCD',
      packName: 'p',
      packCode: null,
      preset: 'work' as const,
      startedAt: new Date().toISOString(),
      endedAt: null,
      peakPlayers: 3,
      bots: 0,
      activeAtEnd: 3,
      retention: 100,
      flow: ['nunchi' as const],
      games: [],
      survey: {
        lobby: { count: 0, avg: null },
        end: { count: 0, avg: null, newPeople: [0, 0, 0, 0] as [number, number, number, number] },
      },
      metrics: { faceToFace: 0, links: 0, wrongLinks: 0, reactions: 0, vaultSuccessRate: -1 },
    };
    await storage.saveSession(report);
    await storage.saveSession({ ...report, peakPlayers: 5 });
    expect((await storage.getSession('session-1'))?.peakPlayers).toBe(5);
    expect(await storage.getSession('none')).toBeNull();

    // 방 저장본: 처음엔 비어 있고, 덮어쓰면 마지막 것만 남는다. 모양이 다른 항목은 버린다
    expect(await storage.loadRoomSnapshots()).toEqual([]);
    const snap = { v: 1, code: 'ABCD', identity: { hostToken: 't' }, players: [], savedAt: 1 };
    await storage.saveRoomSnapshots([snap as never]);
    await storage.saveRoomSnapshots([{ ...snap, code: 'WXYZ' } as never, { nope: true } as never]);
    const loaded = await storage.loadRoomSnapshots();
    expect(loaded.map((r) => r.code)).toEqual(['WXYZ']);
  });
});
