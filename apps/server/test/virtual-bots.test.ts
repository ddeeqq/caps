import type { SoundmatePlayerView } from '@caps/shared';
import { AutoHost, Bot, BotHub, FAST_SETTINGS } from '@caps/tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, connect, startTestServer, type TestServer } from './helpers';

/**
 * 진행자가 대기실에서 "봇 넣기"를 누르면 서버 안의 가상 참가자가 게임을 함께 한다.
 * 사람(여기서는 소켓 봇 1명)은 봇과 섞이지 않은 팀에 들어가고, 지표에는 사람만 센다.
 */
let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

describe('가상 참가자 (봇 채우기)', () => {
  it('사람 1명 + 봇 8명으로 게임 6종을 끝까지 하고, 팀은 사람과 봇을 섞지 않는다', async () => {
    const host = new AutoHost({
      url: t.url,
      create: {
        preset: 'friends',
        flow: ['nunchi', 'soundmate', 'vault', 'cardsection', 'minority', 'tiltrace'],
        settings: FAST_SETTINGS,
      },
      waitForPlayers: 9,
      introMs: 500,
      resultMs: 500,
      seatMs: 3_000,
    });
    await host.create();
    const added = await host.command({ type: 'addBots', count: 8 });
    expect(added.ok).toBe(true);

    const human = new Bot({ url: t.url, code: host.code, hub: new BotHub(), speed: 0.4 });
    await human.join();
    let humanTeam: SoundmatePlayerView | null = null;
    const watch = setInterval(() => {
      const env = human.view;
      if (env?.gameId === 'soundmate' && env.phase === 'playing') humanTeam = env.view as SoundmatePlayerView;
    }, 50);
    host.run();
    try {
      const final = await host.untilFinished(200_000);
      const report = final.report!;
      expect(report.games.map((g) => g.gameId)).toEqual([
        'nunchi',
        'soundmate',
        'vault',
        'cardsection',
        'minority',
        'tiltrace',
      ]);
      // 사람 혼자인 팀: 봇과 섞이지 않았다
      expect(humanTeam).not.toBeNull();
      expect(humanTeam!.teamSize).toBe(1);
      const teams = report.games[1]!.teams!;
      const humanOnly = teams.filter((tm) => tm.memberIds.includes(human.playerId));
      expect(humanOnly).toHaveLength(1);
      expect(humanOnly[0]!.memberIds).toEqual([human.playerId]);
      // 봇끼리도 금고를 연다 (서버 안의 공유 메모)
      expect(report.games[2]!.metrics.solved).toBeGreaterThanOrEqual(2);
      // 지표: 사람만 센다
      expect(report.peakPlayers).toBe(1);
      expect(report.bots).toBe(8);
      expect(report.survey.lobby.count).toBeLessThanOrEqual(1);
      expect(final.botCount).toBe(8);
    } finally {
      clearInterval(watch);
      human.stop();
      host.stop();
    }
  });

  it('봇 빼기, 끝난 방에는 넣을 수 없음, 진행자만 가능', async () => {
    const hostSock = await connect(t.url);
    const created = await call(hostSock, 'host:create', { preset: 'work', flow: ['nunchi'] });
    if (!created.ok) throw new Error(created.message);
    const player = await connect(t.url);
    await call(player, 'player:join', { code: created.code });
    const denied = await call(player, 'host:command', { type: 'addBots', count: 3 });
    expect(denied.ok).toBe(false);
    expect((await call(hostSock, 'host:command', { type: 'addBots', count: 3 })).ok).toBe(true);
    const room = t.server.manager.get(created.code)!;
    expect(room.botCount()).toBe(3);
    expect(room.connectedPlayers()).toHaveLength(4);
    expect((await call(hostSock, 'host:command', { type: 'clearBots' })).ok).toBe(true);
    expect(room.botCount()).toBe(0);
    await call(hostSock, 'host:command', { type: 'end' });
    const late = await call(hostSock, 'host:command', { type: 'addBots', count: 1 });
    expect(late.ok).toBe(false);
    hostSock.disconnect();
    player.disconnect();
  });
});
