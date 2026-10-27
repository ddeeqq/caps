import { describe, expect, it } from 'vitest';
import { soundmate } from '../src/games/soundmate';
import { makeCtx } from './helpers';

function setup() {
  const ctx = makeCtx({ players: 8, settings: { soundmateSeconds: 60, missionSeconds: 10 } });
  const s = soundmate.init(ctx);
  soundmate.start(s, ctx);
  return { ctx, s };
}

describe('소리 짝꿍', () => {
  it('3~4인 팀으로 나누고 팀마다 다른 소리와 고유 코드를 준다', () => {
    const { s } = setup();
    expect(s.teams).toHaveLength(2);
    expect(s.teams.map((t) => t.memberIds.length)).toEqual([4, 4]);
    expect(new Set(s.teams.map((t) => t.soundId)).size).toBe(2);
    const codes = Object.values(s.codes);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((c) => /^\d{4}$/.test(c))).toBe(true);
  });

  it('다른 팀 코드를 찍으면 헛걸음으로 기록하고 상대 소리를 알려준다', () => {
    const { ctx, s } = setup();
    const [a, b] = s.teams;
    const me = a!.memberIds[0]!;
    soundmate.input(s, ctx, me, { type: 'link', code: s.codes[b!.memberIds[0]!] }, ctx.now);
    expect(s.wrong).toHaveLength(1);
    expect(soundmate.playerView(s, ctx, me).feedback?.kind).toBe('wrong');
    expect(soundmate.playerView(s, ctx, me).feedback?.text).toContain('땡!');
  });

  it('팀원 아무나 한 명과 이어지면 연결되고, 다 이어지면 팀 완성 + 미션 시작', () => {
    const { ctx, s } = setup();
    const team = s.teams[0]!;
    const [m0, m1, m2, m3] = team.memberIds as [string, string, string, string];
    expect(soundmate.playerView(s, ctx, m1).teammates).toBeNull();
    soundmate.input(s, ctx, m1, { type: 'link', code: `MALMUN:${s.codes[m0]}` }, ctx.now);
    soundmate.input(s, ctx, m2, { type: 'link', code: s.codes[m1] }, ctx.now);
    expect(team.completeAt).toBeNull();
    expect(soundmate.playerView(s, ctx, m0).groupSize).toBe(3);
    ctx.advance(5_000);
    soundmate.input(s, ctx, m3, { type: 'link', code: s.codes[m2] }, ctx.now);
    expect(team.completeAt).not.toBeNull();
    expect(team.rank).toBe(1);
    const v = soundmate.playerView(s, ctx, m0);
    expect(v.teamComplete).toBe(true);
    expect(v.teammates).toHaveLength(3);
    expect(v.mission?.prompt).toBeTruthy();
    // 같은 사람을 또 찍으면 이미 연결됨
    soundmate.input(s, ctx, m0, { type: 'link', code: s.codes[m3] }, ctx.now);
    expect(soundmate.playerView(s, ctx, m0).feedback?.kind).toBe('already');
  });

  it('만장일치가 되면 미션 확정, 시간이 끝나면 못 모인 팀도 합류', () => {
    const { ctx, s } = setup();
    const [a, b] = s.teams as [(typeof s.teams)[0], (typeof s.teams)[0]];
    const [m0, ...rest] = a.memberIds;
    for (const m of rest) soundmate.input(s, ctx, m, { type: 'link', code: s.codes[m0!] }, ctx.now);
    for (const m of a.memberIds) soundmate.input(s, ctx, m, { type: 'vote', choice: 'b' }, ctx.now);
    expect(a.mission.decided).toBe('b');

    ctx.now = s.searchDeadline;
    soundmate.tick(s, ctx);
    expect(b.forced).toBe(true);
    expect(s.stage).toBe('mission');
    soundmate.input(s, ctx, b.memberIds[0]!, { type: 'vote', choice: 'a' }, ctx.now);
    ctx.advance(20_001);
    soundmate.tick(s, ctx);
    expect(b.mission.decided).toBe('a');
    expect(soundmate.finished(s, ctx)).toBe(true);

    const summary = soundmate.summary(s, ctx);
    expect(summary.teams).toHaveLength(2);
    expect(summary.ranking?.[0]).toBe(a.id);
    expect(summary.metrics.forcedTeams).toBe(1);
  });

  it('도중에 들어온 사람은 가장 작은 팀에 배정된다', () => {
    const ctx = makeCtx({ players: 7 });
    const s = soundmate.init(ctx);
    ctx.players.push({ id: 'late', nickname: '늦은 사과', color: '#fff', connected: true, teamId: null });
    soundmate.playerJoined?.(s, ctx, 'late');
    expect(s.teams.map((t) => t.memberIds.length).sort()).toEqual([4, 4]);
    expect(s.codes.late).toMatch(/^\d{4}$/);
  });
});
