import type { GameId } from '@caps/shared';
import { AutoHost, Bot, BotHub, FAST_SETTINGS } from '@caps/tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './helpers';

/**
 * 봇들이 실제 소켓으로 게임 전체를 끝까지 플레이하는 통합 테스트.
 * 자동 호스트가 진행 버튼을 누르고, 봇들은 "말로 정보를 나누는" 대신 공유 메모를 쓴다.
 */
let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

async function playThrough(flow: GameId[], botCount: number) {
  const host = new AutoHost({
    url: t.url,
    create: {
      preset: 'friends',
      flow,
      packName: '통합 테스트',
      inlinePack: { names: ['지훈', '민수', '수빈'], keywords: ['단골집', '제주도', '노래방'], finaleText: '테스트 끝' },
      settings: FAST_SETTINGS,
    },
    waitForPlayers: botCount,
    introMs: 600,
    resultMs: 600,
    seatMs: 4_000,
  });
  await host.create();
  host.run();
  const hub = new BotHub();
  const bots: Bot[] = [];
  for (let i = 0; i < botCount; i++) {
    const bot = new Bot({ url: t.url, code: host.code, hub, speed: 0.4, chatty: true });
    await bot.join();
    bots.push(bot);
  }
  try {
    const final = await host.untilFinished(200_000);
    return { final, host, bots };
  } finally {
    for (const b of bots) b.stop();
    host.stop();
  }
}

describe('봇 전체 플레이', () => {
  it('눈치게임 → 소리 짝꿍 → 금고 따기 → 카드섹션 (설계서 기본 순서)', async () => {
    const { final, bots } = await playThrough(['nunchi', 'soundmate', 'vault', 'cardsection'], 8);
    const report = final.report!;
    expect(report.games.map((g) => g.gameId)).toEqual(['nunchi', 'soundmate', 'vault', 'cardsection']);
    const [nunchi, soundmate, vault, cards] = report.games;
    expect(nunchi!.metrics.rounds).toBe(2);
    // 소리 짝꿍: 팀이 만들어지고, 대부분 스스로 모였다
    expect(soundmate!.teams).toHaveLength(2);
    expect(soundmate!.metrics.links).toBeGreaterThanOrEqual(4);
    // 금고: 봇이 공유 메모로 정보를 합쳐서 연다
    expect(vault!.metrics.safes).toBe(4);
    expect(vault!.metrics.solved).toBeGreaterThanOrEqual(2);
    expect(vault!.ranking).toHaveLength(2);
    // 카드섹션: 대부분 자리를 잡았다
    expect(cards!.metrics.seated).toBeGreaterThanOrEqual(6);
    expect(report.peakPlayers).toBe(8);
    expect(report.retention).toBe(100);
    expect(report.metrics.faceToFace).toBeGreaterThanOrEqual(report.metrics.links);
    expect(bots.every((b) => b.received > 10)).toBe(true);
  });

  it('추가 게임: 소수결 서바이벌 → 군중 조종 레이스', async () => {
    const { final } = await playThrough(['minority', 'tiltrace'], 7);
    const report = final.report!;
    expect(report.games.map((g) => g.gameId)).toEqual(['minority', 'tiltrace']);
    const [minority, race] = report.games;
    expect(minority!.metrics.rounds).toBeGreaterThanOrEqual(1);
    expect(race!.ranking!.length).toBeGreaterThanOrEqual(2);
  });
});
