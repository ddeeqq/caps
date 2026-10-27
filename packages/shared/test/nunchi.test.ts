import { describe, expect, it } from 'vitest';
import { nunchi, type NunchiState } from '../src/games/nunchi';
import { makeCtx, type TestCtx } from './helpers';

function setup(players = 4, rounds = 2): { ctx: TestCtx; s: NunchiState } {
  const ctx = makeCtx({ players, settings: { nunchiRounds: rounds } });
  const s = nunchi.init(ctx);
  nunchi.start(s, ctx);
  return { ctx, s };
}

function open(ctx: TestCtx, s: NunchiState): number {
  ctx.now = s.openAt;
  nunchi.tick(s, ctx);
  expect(s.stage).toBe('open');
  return s.openAt;
}

const SETTLE = 300 + 150 + 1; // 충돌 창 + 지연 여유

describe('디지털 눈치게임', () => {
  it('0.3초 안에 겹쳐 누르면 겹친 사람 모두 벌칙', () => {
    const { ctx, s } = setup();
    const T = open(ctx, s);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 1000);
    nunchi.input(s, ctx, 'p2', { type: 'tap' }, T + 1200);
    ctx.now = T + 1000 + SETTLE;
    nunchi.tick(s, ctx);
    expect(s.stage).toBe('roundEnd');
    expect(s.outcome?.kind).toBe('collision');
    expect(s.outcome?.losers.sort()).toEqual(['p1', 'p2']);
    expect(s.outcome?.number).toBe(1);
    expect(s.penalties).toEqual({ p1: 1, p2: 1 });
    expect(s.closestCall?.spreadMs).toBe(200);
  });

  it('충돌 창 밖이면 차례로 숫자를 가져가고, 마지막 한 명이 벌칙', () => {
    const { ctx, s } = setup(4);
    const T = open(ctx, s);
    for (const [i, id] of ['p1', 'p2', 'p3'].entries()) {
      const at = T + 500 + i * 1000;
      ctx.now = at;
      nunchi.input(s, ctx, id, { type: 'tap' }, at);
      ctx.now = at + SETTLE;
      nunchi.tick(s, ctx);
    }
    expect(s.pressed).toEqual({ p1: 1, p2: 2, p3: 3 });
    expect(s.stage).toBe('roundEnd');
    expect(s.outcome).toMatchObject({ kind: 'last', losers: ['p4'], number: 4 });
  });

  it('도착 순서가 아니라 보정된 탭 시각으로 판정한다', () => {
    const { ctx, s } = setup();
    const T = open(ctx, s);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 1000);
    ctx.now = T + 1200;
    nunchi.tick(s, ctx); // 아직 확정 전 (지연 여유 대기)
    expect(s.stage).toBe('open');
    // 느린 폰의 탭이 늦게 도착했지만 실제로는 250ms 뒤에 눌렀다
    nunchi.input(s, ctx, 'p2', { type: 'tap' }, T + 1250);
    ctx.now = T + 1000 + SETTLE;
    nunchi.tick(s, ctx);
    expect(s.outcome?.kind).toBe('collision');
  });

  it('충돌 창 경계 바깥은 별개의 숫자로 처리', () => {
    const { ctx, s } = setup(5);
    const T = open(ctx, s);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 1000);
    nunchi.input(s, ctx, 'p2', { type: 'tap' }, T + 1301);
    ctx.now = T + 1301 + SETTLE;
    nunchi.tick(s, ctx);
    expect(s.pressed).toEqual({ p1: 1, p2: 2 });
    expect(s.stage).toBe('open');
  });

  it('한참 아무도 안 누르면 남은 사람 모두 벌칙', () => {
    const { ctx, s } = setup(3);
    const T = open(ctx, s);
    ctx.now = T + 15_001;
    nunchi.tick(s, ctx);
    expect(s.outcome?.kind).toBe('idle');
    expect(s.outcome?.losers.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('부정 출발과 중복 탭은 무시', () => {
    const { ctx, s } = setup();
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, s.openAt - 500);
    expect(s.buffer).toHaveLength(0);
    const T = open(ctx, s);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 100);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 150);
    expect(s.buffer).toHaveLength(1);
  });

  it('정해진 라운드가 끝나면 게임 종료, 탈락 없이 매 라운드 다시 참여', () => {
    const { ctx, s } = setup(3, 2);
    let T = open(ctx, s);
    ctx.now = T + 15_001;
    nunchi.tick(s, ctx);
    ctx.now = s.roundEndAt;
    nunchi.tick(s, ctx);
    expect(s.round).toBe(2);
    expect(s.stage).toBe('countdown');
    expect(s.participants).toHaveLength(3);
    T = open(ctx, s);
    ctx.now = T + 15_001;
    nunchi.tick(s, ctx);
    ctx.now = s.roundEndAt;
    nunchi.tick(s, ctx);
    expect(nunchi.finished(s, ctx)).toBe(true);
    const summary = nunchi.summary(s, ctx);
    expect(summary.metrics.rounds).toBe(2);
  });

  it('참가자 화면은 내 숫자와 벌칙 여부를 보여준다', () => {
    const { ctx, s } = setup(3);
    const T = open(ctx, s);
    nunchi.input(s, ctx, 'p1', { type: 'tap' }, T + 100);
    let v = nunchi.playerView(s, ctx, 'p1');
    expect(v.pending).toBe(true);
    expect(v.canTap).toBe(false);
    ctx.now = T + 100 + SETTLE;
    nunchi.tick(s, ctx);
    v = nunchi.playerView(s, ctx, 'p1');
    expect(v.myNumber).toBe(1);
    nunchi.input(s, ctx, 'p2', { type: 'tap' }, ctx.now);
    ctx.now += SETTLE;
    nunchi.tick(s, ctx);
    const loser = nunchi.playerView(s, ctx, 'p3');
    expect(loser.outcome?.youLost).toBe(true);
    expect(loser.outcome?.penalty).toBeTruthy();
    const host = nunchi.hostView(s, ctx);
    expect(host.outcome?.losers[0]?.nickname).toBe('참가자3');
  });
});
