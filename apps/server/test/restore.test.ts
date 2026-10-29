import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCapsServer, type CapsServer } from '../src/app';
import { JsonStorage } from '../src/storage';
import { createLogger } from '../src/util';
import { call, connect, nextEvent, sleep } from './helpers';

/** 서버가 재시작돼도 방이 일시정지 상태로 되살아나고, 사람들은 토큰으로 같은 사람으로 돌아온다 */
async function boot(dir: string): Promise<{ server: CapsServer; url: string }> {
  const storage = new JsonStorage(dir);
  await storage.init();
  const server = createCapsServer({ storage, log: createLogger('warn'), tickMs: 50 });
  await server.restoreRooms();
  const port = await server.listen(0, '127.0.0.1');
  return { server, url: `http://127.0.0.1:${port}` };
}

async function shutdown(server: CapsServer): Promise<void> {
  await server.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}

describe('서버 재시작 복구', () => {
  it('게임 도중 껐다 켜도 같은 방, 같은 사람, 일시정지 상태로 이어진다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'caps-restore-'));
    const a = await boot(dir);
    const host = await connect(a.url);
    const created = await call(host, 'host:create', {
      preset: 'friends',
      flow: ['minority'],
      settings: { minorityTalkSeconds: 30 },
    });
    if (!created.ok) throw new Error(created.message);
    const players = await Promise.all([connect(a.url), connect(a.url), connect(a.url)]);
    const joined = [];
    for (const [i, p] of players.entries()) {
      const res = await call(p, 'player:join', { code: created.code, nickname: `복구${i}` });
      if (!res.ok) throw new Error(res.message);
      joined.push(res);
    }
    await call(host, 'host:command', { type: 'start' });
    await call(host, 'host:command', { type: 'next' });
    expect(a.server.manager.get(created.code)!.phase).toBe('playing');
    await call(host, 'host:command', { type: 'addBots', count: 2 });
    for (const s of [host, ...players]) s.disconnect();
    await shutdown(a.server);

    const b = await boot(dir);
    try {
      const room = b.server.manager.get(created.code);
      expect(room).toBeDefined();
      expect(room!.phase).toBe('playing');
      expect(room!.paused).toBe(true);
      expect(room!.roomState('screen').pauseReason).toBe('restart');
      expect(room!.botCount()).toBe(2);
      // 같은 토큰으로 다시 들어오면 같은 사람
      const back = await connect(b.url);
      const again = await call(back, 'player:join', { code: created.code, token: joined[0]!.token });
      expect(again.ok && again.playerId).toBe(joined[0]!.playerId);
      expect(again.ok && again.nickname).toBe('복구0');
      // 진행자도 같은 토큰으로 붙어서 이어서 진행
      const host2 = await connect(b.url);
      const attach = await call(host2, 'host:attach', {
        code: created.code,
        hostToken: created.hostToken,
        role: 'screen',
      });
      expect(attach.ok).toBe(true);
      const resumed = nextEvent(host2, 'room', (r) => !r.paused);
      await call(host2, 'host:command', { type: 'resume' });
      await resumed;
      await sleep(100);
      expect(room!.paused).toBe(false);
      expect(room!.roomState('screen').pauseReason).toBeNull();
      back.disconnect();
      host2.disconnect();
    } finally {
      await shutdown(b.server);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('한가한 서버는 저장본을 다시 쓰지 않고, 게임 중이면 계속 쓴다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'caps-idle-'));
    const inner = new JsonStorage(dir);
    await inner.init();
    let writes = 0;
    const storage = Object.assign(Object.create(inner) as JsonStorage, {
      saveRoomSnapshots: async (snaps: Parameters<JsonStorage['saveRoomSnapshots']>[0]) => {
        writes += 1;
        await inner.saveRoomSnapshots(snaps);
      },
    });
    const server = createCapsServer({ storage, log: createLogger('warn'), tickMs: 50, snapshots: false });
    const port = await server.listen(0, '127.0.0.1');
    try {
      const m = server.manager;
      await m.saveSnapshots();
      await m.saveSnapshots();
      expect(writes).toBe(1); // 방이 없어도 한 번은 비운다, 그다음은 건너뛴다
      const host = await connect(`http://127.0.0.1:${port}`);
      const created = await call(host, 'host:create', { preset: 'work', flow: ['nunchi'] });
      if (!created.ok) throw new Error(created.message);
      await m.saveSnapshots();
      await m.saveSnapshots();
      expect(writes).toBe(2); // 대기실: 바뀐 것이 없으면 그대로
      await call(host, 'host:command', { type: 'addBots', count: 3 });
      await m.saveSnapshots();
      expect(writes).toBe(3);
      await call(host, 'host:command', { type: 'start' });
      await m.saveSnapshots();
      await m.saveSnapshots();
      expect(writes).toBe(5); // 게임 시계가 흐르면 매번 쓴다
      await call(host, 'host:command', { type: 'pause' });
      await m.saveSnapshots();
      await m.saveSnapshots();
      expect(writes).toBe(6); // 멈추면 다시 조용해진다
      // 동시에 불려도 겹쳐 쓰지 않는다
      await call(host, 'host:command', { type: 'resume' });
      await Promise.all([m.saveSnapshots(), m.saveSnapshots(), m.saveSnapshots(true)]);
      expect(writes).toBe(8);
      host.disconnect();
    } finally {
      await shutdown(server);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
