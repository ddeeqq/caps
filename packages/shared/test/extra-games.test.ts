import { describe, expect, it } from 'vitest';
import { minority } from '../src/games/minority';
import { tiltrace } from '../src/games/tiltrace';
import { makeCtx } from './helpers';

describe('소수결 서바이벌', () => {
  function toVote(ctx: ReturnType<typeof makeCtx>, s: ReturnType<typeof minority.init>) {
    ctx.now = s.deadline;
    minority.tick(s, ctx); // talk → vote
    expect(s.stage).toBe('vote');
  }

  it('다수 쪽과 투표 안 한 사람이 탈락한다', () => {
    const ctx = makeCtx({ players: 6 });
    const s = minority.init(ctx);
    minority.start(s, ctx);
    for (const id of ['p1', 'p2', 'p3']) minority.input(s, ctx, id, { type: 'vote', choice: 'a' }, ctx.now);
    toVote(ctx, s);
    for (const id of ['p4', 'p5']) minority.input(s, ctx, id, { type: 'vote', choice: 'b' }, ctx.now);
    ctx.now = s.deadline;
    minority.tick(s, ctx);
    expect(s.stage).toBe('reveal');
    expect(s.lastReveal).toMatchObject({ countA: 3, countB: 2, minority: 'b', tie: false });
    expect(s.alive).toMatchObject({ p1: false, p2: false, p3: false, p4: true, p5: true, p6: false });
    // 생존 2명 이하 → 종료
    ctx.now = s.deadline;
    minority.tick(s, ctx);
    expect(minority.finished(s, ctx)).toBe(true);
    expect(minority.summary(s, ctx).headline).toContain('최후의 소수');
  });

  it('동점이거나 모두 같은 선택이면 무효', () => {
    const ctx = makeCtx({ players: 4 });
    const s = minority.init(ctx);
    minority.start(s, ctx);
    for (const id of ['p1', 'p2', 'p3', 'p4'])
      minority.input(s, ctx, id, { type: 'vote', choice: 'a' }, ctx.now);
    toVote(ctx, s);
    ctx.now = s.deadline;
    minority.tick(s, ctx);
    expect(s.lastReveal?.tie).toBe(true);
    expect(Object.values(s.alive).every(Boolean)).toBe(true);
  });

  it('탈락자는 예언자가 되어 소수 쪽을 맞히면 점수', () => {
    const ctx = makeCtx({ players: 7, settings: { minorityRounds: 3 } });
    const s = minority.init(ctx);
    minority.start(s, ctx);
    for (const id of ['p1', 'p2', 'p3', 'p4'])
      minority.input(s, ctx, id, { type: 'vote', choice: 'a' }, ctx.now);
    for (const id of ['p5', 'p6', 'p7']) minority.input(s, ctx, id, { type: 'vote', choice: 'b' }, ctx.now);
    toVote(ctx, s);
    ctx.now = s.deadline;
    minority.tick(s, ctx); // a 4명 탈락
    ctx.now = s.deadline;
    minority.tick(s, ctx); // 다음 라운드
    expect(s.round).toBe(2);
    minority.input(s, ctx, 'p1', { type: 'predict', choice: 'b' }, ctx.now);
    minority.input(s, ctx, 'p1', { type: 'vote', choice: 'a' }, ctx.now); // 탈락자는 투표 불가
    expect(s.votes.p1).toBeUndefined();
    minority.input(s, ctx, 'p5', { type: 'vote', choice: 'a' }, ctx.now);
    minority.input(s, ctx, 'p6', { type: 'vote', choice: 'a' }, ctx.now);
    minority.input(s, ctx, 'p7', { type: 'vote', choice: 'b' }, ctx.now);
    toVote(ctx, s);
    ctx.now = s.deadline;
    minority.tick(s, ctx);
    expect(s.lastReveal?.minority).toBe('b');
    expect(s.points.p1).toBe(1);
    expect(minority.playerView(s, ctx, 'p1').reveal?.predictionCorrect).toBe(true);
  });
});

describe('군중 조종 레이스', () => {
  it('팀원 기울기 평균으로 배가 움직이고, 바위에 부딪히면 느려진다', () => {
    const ctx = makeCtx({ players: 4, settings: { tiltraceLength: 6 } });
    const s = tiltrace.init(ctx);
    expect(s.teams).toHaveLength(2);
    s.rocks = [{ y: 1, x: 0, r: 0.22 }];
    tiltrace.start(s, ctx);
    ctx.now = s.startAt;
    tiltrace.tick(s, ctx);
    expect(s.stage).toBe('race');
    const [t1, t2] = s.teams;
    // 1팀은 오른쪽으로 기울여 바위를 피하고, 2팀은 가만히 있어 부딪힌다
    for (let i = 0; i < 400 && s.stage === 'race'; i++) {
      ctx.now += 50;
      for (const id of t1!.memberIds) tiltrace.input(s, ctx, id, { type: 'tilt', v: 0.6 }, ctx.now);
      tiltrace.tick(s, ctx);
    }
    expect(s.boats[t1!.id]!.hits).toBe(0);
    expect(s.boats[t1!.id]!.x).toBeGreaterThan(0.3);
    expect(s.boats[t2!.id]!.hits).toBe(1);
    expect(tiltrace.finished(s, ctx)).toBe(true);
    const summary = tiltrace.summary(s, ctx);
    expect(summary.ranking?.[0]).toBe(t1!.id);
  });

  it('오래된 기울기 값은 평균에서 빠진다', () => {
    const ctx = makeCtx({ players: 2 });
    const s = tiltrace.init(ctx);
    tiltrace.start(s, ctx);
    ctx.now = s.startAt;
    tiltrace.tick(s, ctx);
    const team = s.teams[0]!;
    tiltrace.input(s, ctx, team.memberIds[0]!, { type: 'tilt', v: 1 }, ctx.now);
    ctx.now += 2_000;
    tiltrace.tick(s, ctx);
    expect(s.boats[team.id]!.avg).toBe(0);
  });
});
