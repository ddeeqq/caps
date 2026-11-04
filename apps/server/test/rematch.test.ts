import { DEFAULT_SETTINGS, resolvePack } from '@caps/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Room } from '../src/room/Room';
import { call, connect, nextEvent, startTestServer, type TestServer } from './helpers';

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

describe('한 판 더', () => {
  it('끝난 방에서만, 같은 구성·같은 진행자 토큰으로 새 방을 한 번만 연다', async () => {
    const host = await connect(t.url);
    const created = await call(host, 'host:create', {
      preset: 'work',
      flow: ['liar', 'wavelength'],
      packName: '한 판 더',
      settings: { liarRounds: 3 },
    });
    if (!created.ok) throw new Error('방 생성 실패');
    const player = await connect(t.url);
    const joined = await call(player, 'player:join', { code: created.code, nickname: '가나' });
    expect(joined.ok).toBe(true);
    await call(host, 'host:command', { type: 'addBots', count: 3 });

    // 아직 진행 중이면 거절
    expect((await call(host, 'host:command', { type: 'rematch' })).ok).toBe(false);
    await call(host, 'host:command', { type: 'end' });
    const waitPlayer = nextEvent(player, 'room', (s) => !!s.rematch);
    expect((await call(host, 'host:command', { type: 'rematch' })).ok).toBe(true);
    const [state] = await waitPlayer;
    const nextCode = state.rematch!;
    expect(nextCode).toMatch(/^[A-Z]{4}$/);
    expect(nextCode).not.toBe(created.code);
    // 두 번 눌러도 같은 방
    await call(host, 'host:command', { type: 'rematch' });
    const old = t.server.manager.get(created.code)!;
    expect(old.rematchCode).toBe(nextCode);
    const next = t.server.manager.get(nextCode)!;
    expect(next.flow).toEqual(['liar', 'wavelength']);
    expect(next.settings.liarRounds).toBe(3);
    expect(next.pack.preset).toBe('work');
    expect(next.botCount()).toBe(3);
    expect(next.phase).toBe('lobby');

    // 진행자 기기는 같은 토큰으로 새 방에 바로 붙는다
    const attached = await call(host, 'host:attach', {
      code: nextCode,
      hostToken: created.hostToken,
      role: 'screen',
    });
    expect(attached.ok).toBe(true);
    // 참가자는 새 방에 같은 이름으로 들어간다
    const again = await call(player, 'player:join', { code: nextCode, nickname: '가나' });
    expect(again.ok && again.nickname).toBe('가나');
    host.disconnect();
    player.disconnect();
  });

  it('새 방 코드는 저장본에도 남는다', () => {
    const room = new Room({
      code: 'OLDR',
      pack: resolvePack({ preset: 'friends' }),
      flow: ['nunchi'],
      settings: DEFAULT_SETTINGS,
    });
    room.rematchCode = 'NEWR';
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(room.toSnapshot())));
    expect(restored.rematchCode).toBe('NEWR');
    expect(restored.roomState('player', undefined).rematch).toBe('NEWR');
  });
});
