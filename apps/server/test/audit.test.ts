import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MAX_PLAYERS_PER_ROOM, resolvePack, DEFAULT_SETTINGS } from '@caps/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Room } from '../src/room/Room';
import { JsonStorage } from '../src/storage';
import { call, connect, startTestServer, type TestServer, type TestSocket } from './helpers';

/** 내부 구조 점검에서 찾은 서버 문제들의 재현 테스트 */
let t: TestServer;
const sockets: TestSocket[] = [];
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await t.close();
});

async function open(): Promise<TestSocket> {
  const s = await connect(t.url);
  sockets.push(s);
  return s;
}

describe('점검: 리모컨 PIN', () => {
  it('소켓을 바꿔 가며 찍어도 방 단위로 잠긴다', async () => {
    const host = await open();
    const created = await call(host, 'host:create', { preset: 'friends', flow: ['nunchi'] });
    if (!created.ok) throw new Error(created.message);
    const wrongPin = created.hostPin === '0000' ? '1111' : '0000';
    // 연결당 제한(분당 5회)을 피하려고 소켓 3개로 나눠 10번 틀린다
    for (let i = 0; i < 10; i++) {
      const s = i % 5 === 0 ? await open() : sockets[sockets.length - 1]!;
      const res = await call(s, 'host:remote-login', { code: created.code, pin: wrongPin });
      expect(res.ok).toBe(false);
    }
    const fresh = await open();
    const blocked = await call(fresh, 'host:remote-login', { code: created.code, pin: created.hostPin });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe('TOO_MANY_TRIES');
  });
});

describe('점검: 방 정원', () => {
  it('정원은 지금 접속한 사람 수로 센다', () => {
    const room = new Room({
      code: 'TEST',
      pack: resolvePack({ preset: 'friends' }),
      flow: ['nunchi'],
      settings: DEFAULT_SETTINGS,
    });
    const recs = Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, i) => {
      const rec = room.addPlayer(`p${i}`);
      room.attachPlayer(rec, `s${i}`);
      return rec;
    });
    expect(room.hasCapacity()).toBe(false);
    room.detachSocket('s0');
    expect(room.hasCapacity()).toBe(true);
    expect(recs).toHaveLength(MAX_PLAYERS_PER_ROOM);
  });
});

describe('점검: JSON 저장소', () => {
  it('디스크에 못 쓰면 팩 저장이 실패로 알려지고, 메모리에도 남지 않는다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'caps-audit-'));
    const storage = new JsonStorage(dir);
    await storage.init();
    await mkdir(path.join(dir, 'packs.json')); // 파일 자리에 폴더 → rename 실패
    const input = {
      name: '실패 팩',
      preset: 'friends' as const,
      content: {
        names: [],
        keywords: [],
        balanceQuestions: [],
        teamNames: [],
        finaleText: '',
        penalties: [],
      },
      options: {},
    };
    await expect(storage.createPack('ABCDEF', input, 'hash')).rejects.toThrow();
    expect(await storage.getPack('ABCDEF')).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('점검: HTTP 헤더', () => {
  it('보안 헤더를 붙인다', async () => {
    const res = await fetch(`${t.url}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toContain('camera=(self)');
  });
});
