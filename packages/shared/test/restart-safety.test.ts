import { describe, expect, it } from 'vitest';
import { BotBrain, BotHub } from '../src/bots';
import { GAMES } from '../src/games';
import { GAME_IDS, type GameId, type GameSummary } from '../src/games/types';
import type { CardsectionHostView } from '../src/games/cardsection';
import { createRng } from '../src/util/rng';
import { makeCtx } from './helpers';

/**
 * 서버 재시작 복구는 게임 상태를 JSON으로 저장했다가 되살린다.
 * 게임 전부를 봇 8명으로 가상 시계 위에서 끝까지 돌리면서, 매 순간 상태를 JSON으로 왕복시켜도
 * (= 아무 때나 서버가 꺼졌다 켜져도) 왕복하지 않은 판과 결과가 똑같은지 확인한다.
 */
const FAST = {
  nunchiRounds: 2,
  soundmateSeconds: 25,
  missionSeconds: 6,
  vaultSafes: 2,
  seatRows: 2,
  seatCols: 5,
  cardsectionMs: 4_000,
  minorityRounds: 2,
  minorityTalkSeconds: 3,
  minorityVoteSeconds: 3,
  tiltraceLength: 6,
  liarRounds: 2,
  liarTalkSeconds: 12,
  waveRounds: 2,
  waveSeconds: 12,
};

const STEP_MS = 50;
const MAX_VIRTUAL_MS = 10 * 60_000;

function play(gameId: GameId, roundtrip: boolean): { summary: GameSummary; state: unknown; steps: number } {
  const ctx = makeCtx({ players: 8, settings: FAST, seed: 7 });
  const module = GAMES[gameId];
  const hub = new BotHub();
  const brains = ctx.players.map((p, i) => {
    const rng = createRng(100 + i);
    return new BotBrain(p.id, { hub, surveys: false, random: () => rng.next(), clock: () => ctx.now });
  });
  let state: unknown = module.init(ctx);
  const save = () => {
    if (!roundtrip) return;
    const copy: unknown = JSON.parse(JSON.stringify(state));
    // Set·Map·Infinity·NaN 처럼 JSON에서 모양이 바뀌는 값이 있으면 여기서 걸린다
    expect(copy).toEqual(state);
    state = copy;
  };
  save();
  ctx.advance(500); // 소개 화면
  module.start(state, ctx);
  save();
  const startedAt = ctx.now;
  let seatSince: number | null = null;
  let steps = 0;
  while (!module.finished(state, ctx)) {
    if (ctx.now - startedAt > MAX_VIRTUAL_MS) throw new Error(`${gameId}: 가상 10분 안에 끝나지 않음`);
    for (const [i, p] of ctx.players.entries()) {
      const view = {
        gameId,
        index: 0,
        phase: 'playing' as const,
        view: module.playerView(state, ctx, p.id),
        summary: null,
      };
      for (const action of brains[i]!.think({ phase: 'playing', paused: false, view, gameNow: ctx.now })) {
        if (action.type === 'input') module.input(state, ctx, p.id, action.input, ctx.now);
      }
    }
    module.tick(state, ctx);
    // 카드섹션은 진행자가 "연출 시작"을 눌러야 넘어간다 (AutoHost와 같은 규칙)
    if (gameId === 'cardsection') {
      const hv = module.hostView(state, ctx) as CardsectionHostView;
      if (hv.stage === 'seat') {
        seatSince ??= ctx.now;
        if (ctx.now - seatSince >= 3_000 || hv.seatedCount >= hv.playerCount) {
          module.hostAction?.(state, ctx, 'start-show');
        }
      }
    }
    save();
    ctx.advance(STEP_MS);
    steps += 1;
  }
  return { summary: module.summary(state, ctx), state, steps };
}

describe('재시작 안전성: 게임 상태는 언제 저장해도 그대로 되살아난다', () => {
  for (const id of GAME_IDS) {
    it(`${GAMES[id].meta.title}`, () => {
      const plain = play(id, false);
      const restored = play(id, true);
      expect(plain.steps).toBeGreaterThan(10);
      expect(restored.steps).toBe(plain.steps);
      expect(restored.summary).toEqual(plain.summary);
      expect(restored.state).toEqual(JSON.parse(JSON.stringify(plain.state)));
    });
  }
});
