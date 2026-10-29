import { describe, expect, it } from 'vitest';
import { cardsection } from '../src/games/cardsection';
import { soundmate } from '../src/games/soundmate';
import { vault } from '../src/games/vault';
import { containsProfanity } from '../src/pack/filter';
import { makeCtx } from './helpers';

/** 내부 구조 점검에서 찾은 문제들의 재현 테스트 */
describe('점검: 카드섹션 자리', () => {
  it('다른 사람이 앉은 자리는 가져갈 수 없다 (나간 사람 자리는 가능)', () => {
    const ctx = makeCtx({ players: 3, settings: { seatRows: 2, seatCols: 2 } });
    const s = cardsection.init(ctx);
    cardsection.start(s, ctx);
    cardsection.input(s, ctx, 'p1', { type: 'seat', row: 0, col: 0 }, ctx.now);
    cardsection.input(s, ctx, 'p2', { type: 'seat', row: 0, col: 0 }, ctx.now);
    expect(s.seats.p2).toBeUndefined();
    ctx.players.find((p) => p.id === 'p1')!.connected = false;
    cardsection.input(s, ctx, 'p2', { type: 'seat', row: 0, col: 0 }, ctx.now);
    expect(s.seats.p2).toEqual({ row: 0, col: 0 });
    expect(cardsection.hostView(s, ctx).seats).toHaveLength(1);
  });

  it('격자가 인원보다 작으면 모두 앉을 수 있게 넓힌다', () => {
    const ctx = makeCtx({ players: 60, settings: { seatRows: 6, seatCols: 8 } });
    const s = cardsection.init(ctx);
    expect(s.rows * s.cols).toBeGreaterThanOrEqual(60);
    expect(s.rows).toBeGreaterThanOrEqual(6);
    expect(s.cols).toBeGreaterThanOrEqual(8);
    const big = cardsection.init(makeCtx({ players: 150, settings: { seatRows: 2, seatCols: 2 } }));
    expect(big.rows * big.cols).toBeGreaterThanOrEqual(150);
    expect(big.rows).toBeLessThanOrEqual(12);
    expect(big.cols).toBeLessThanOrEqual(16);
  });
});

describe('점검: 소리 짝꿍 지표', () => {
  it('같은 사람을 여러 번 잘못 찍어도 헛걸음은 한 번만 센다', () => {
    const ctx = makeCtx({ players: 8 });
    const s = soundmate.init(ctx);
    soundmate.start(s, ctx);
    const [a, b] = s.teams;
    const me = a!.memberIds[0]!;
    for (let i = 0; i < 5; i++) {
      soundmate.input(s, ctx, me, { type: 'link', code: s.codes[b!.memberIds[0]!] }, ctx.now);
    }
    expect(s.wrong).toHaveLength(1);
    expect(soundmate.playerView(s, ctx, me).feedback?.kind).toBe('wrong');
  });
});

describe('점검: 금고 재접속', () => {
  it('금고 도중 다시 들어온 팀원도 할 일(검산)을 받는다', () => {
    const ctx = makeCtx({ players: 3 });
    const s = vault.init(ctx);
    const member = s.teams[0]!.memberIds[0]!;
    ctx.players.find((p) => p.id === member)!.connected = false;
    vault.start(s, ctx);
    const ts = s.perTeam[s.teams[0]!.id]!;
    expect(ts.roles[member]).toBeUndefined();
    ctx.players.find((p) => p.id === member)!.connected = true;
    vault.tick(s, ctx);
    expect(ts.roles[member]).toEqual(['checksum']);
    expect(vault.playerView(s, ctx, member).checksum).toBe(ts.puzzle.checksum);
  });
});

describe('점검: 금칙어 오탐', () => {
  it('일상 표현은 막지 않는다', () => {
    expect(containsProfanity('불이 꺼져요')).toBe(false);
    expect(containsProfanity('화면이 꺼져도 우린 하나')).toBe(false);
    expect(containsProfanity('ㅅ ㅂ')).toBe(true);
  });
});
