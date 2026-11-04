import { describe, expect, it } from 'vitest';
import { tableTeams } from '../src/games/common';
import { liar, type LiarState } from '../src/games/liar';
import { wavelength, wavePoints } from '../src/games/wavelength';
import { LIAR_CATEGORIES } from '../src/games/words';
import type { GamePlayer } from '../src/games/types';
import { makeCtx, makePlayers, type TestCtx } from './helpers';

function startLiar(ctx: TestCtx): LiarState {
  const s = liar.init(ctx);
  liar.start(s, ctx);
  return s;
}

describe('테이블 팀', () => {
  it('3명보다 작은 팀은 다른 팀에 합친다', () => {
    const ctx = makeCtx({ players: 5 }); // 기본 나누기는 3, 2
    const teams = tableTeams(ctx, 3);
    expect(teams).toHaveLength(1);
    expect(teams[0]!.memberIds).toHaveLength(5);
  });

  it('사람과 봇은 되도록 따로 둔다', () => {
    const players: GamePlayer[] = [
      ...makePlayers(4),
      ...makePlayers(4).map((p) => ({ ...p, id: `b${p.id}`, bot: true })),
    ];
    const teams = tableTeams(makeCtx({ players }), 3);
    for (const t of teams) {
      const bots = t.memberIds.filter((id) => id.startsWith('b')).length;
      expect(bots === 0 || bots === t.memberIds.length).toBe(true);
    }
  });
});

describe('라이어 게임', () => {
  it('테이블마다 라이어 한 명, 테이블마다 다른 제시어, 라이어는 제시어를 못 본다', () => {
    const ctx = makeCtx({ players: 12 });
    const s = startLiar(ctx);
    expect(s.tables.length).toBe(3);
    expect(new Set(s.tables.map((t) => t.word)).size).toBe(3);
    for (const t of s.tables) {
      expect(t.liarId).not.toBeNull();
      expect(t.options).toContain(t.word);
      expect(t.options).toHaveLength(8);
      expect(t.starterId).not.toBe(t.liarId);
      const liarView = liar.playerView(s, ctx, t.liarId!);
      expect(liarView.isLiar).toBe(true);
      expect(liarView.word).toBeNull();
      expect(JSON.stringify(liarView)).not.toContain(t.word);
      const citizen = t.memberIds.find((id) => id !== t.liarId)!;
      expect(liar.playerView(s, ctx, citizen).word).toBe(t.word);
    }
    // 큰 화면에도 공개 전에는 제시어와 라이어가 안 나온다
    const hv = JSON.stringify(liar.hostView(s, ctx));
    for (const t of s.tables) expect(hv).not.toContain(`"${t.word}"`);
  });

  it('첫 라운드는 모임 종류 카테고리, 키워드가 8개 넘으면 모임 키워드', () => {
    const work = startLiar(makeCtx({ players: 4, pack: { preset: 'work' } }));
    expect(work.category).toBe('회사 생활');
    const kw = 'ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ'.split(' ').map((c) => `${c}키워드`);
    const mine = startLiar(makeCtx({ players: 4, pack: { preset: 'friends', content: { keywords: kw } } }));
    expect(mine.category).toBe('우리 모임 키워드');
    expect(kw).toContain(mine.tables[0]!.word);
  });

  it('잡힌 라이어가 제시어를 못 맞히면 시민 승리, 맞히면 역전승', () => {
    const ctx = makeCtx({ players: 4, settings: { liarRounds: 2 } });
    const s = startLiar(ctx);
    const t = s.tables[0]!;
    const liarId = t.liarId!;
    ctx.now = s.deadline;
    liar.tick(s, ctx); // word → talk
    for (const id of t.memberIds) liar.input(s, ctx, id, { type: 'ready' }, ctx.now);
    expect(s.stage).toBe('vote'); // 모두 "다 말했어요" → 바로 투표
    for (const id of t.memberIds) {
      const target = id === liarId ? t.memberIds.find((x) => x !== liarId)! : liarId;
      liar.input(s, ctx, id, { type: 'vote', target }, ctx.now);
    }
    expect(s.stage).toBe('guess');
    const wrong = t.options.find((w) => w !== t.word)!;
    liar.input(
      s,
      ctx,
      t.memberIds.find((x) => x !== liarId)!,
      { type: 'guess', word: wrong },
      ctx.now,
    );
    expect(s.stage).toBe('guess'); // 라이어만 맞힐 수 있다
    liar.input(s, ctx, liarId, { type: 'guess', word: wrong }, ctx.now);
    expect(s.stage).toBe('reveal');
    expect(t.outcome).toBe('caught');
    const citizen = t.memberIds.find((x) => x !== liarId)!;
    expect(liar.playerView(s, ctx, citizen).result).toMatchObject({ outcome: 'caught', youWon: true });
    expect(s.points[citizen]).toBe(1);

    // 2라운드: 다른 사람이 라이어, 이번엔 제시어를 맞힌다
    ctx.now = s.deadline;
    liar.tick(s, ctx);
    expect(s.round).toBe(2);
    const t2 = s.tables[0]!;
    expect(t2.liarId).not.toBe(liarId);
    liar.hostAction!(s, ctx, 'skip-talk');
    const before = s.points[t2.liarId!] ?? 0;
    for (const id of t2.memberIds) {
      const target = id === t2.liarId ? t2.memberIds.find((x) => x !== t2.liarId)! : t2.liarId!;
      liar.input(s, ctx, id, { type: 'vote', target }, ctx.now);
    }
    liar.input(s, ctx, t2.liarId!, { type: 'guess', word: t2.word }, ctx.now);
    expect(t2.outcome).toBe('stolen');
    expect(s.points[t2.liarId!]).toBe(before + 2);
    ctx.now = s.deadline;
    liar.tick(s, ctx);
    expect(liar.finished(s, ctx)).toBe(true);
    const sum = liar.summary(s, ctx);
    expect(sum.metrics).toMatchObject({ caught: 1, stolen: 1, escaped: 0 });
    expect(sum.teams?.[0]?.memberIds).toHaveLength(4);
  });

  it('동점이면 지목 실패, 라이어 도망 (3점)', () => {
    const ctx = makeCtx({ players: 4 });
    const s = startLiar(ctx);
    const t = s.tables[0]!;
    liar.hostAction!(s, ctx, 'skip-talk');
    const [a, b, c, d] = t.memberIds as [string, string, string, string];
    liar.input(s, ctx, a, { type: 'vote', target: b }, ctx.now);
    liar.input(s, ctx, b, { type: 'vote', target: a }, ctx.now);
    liar.input(s, ctx, c, { type: 'vote', target: d }, ctx.now);
    liar.input(s, ctx, d, { type: 'vote', target: c }, ctx.now);
    expect(s.stage).toBe('reveal');
    expect(t.outcome).toBe('escaped');
    expect(s.points[t.liarId!]).toBe(3);
  });

  it('자기 자신이나 다른 테이블 사람은 지목할 수 없다', () => {
    const ctx = makeCtx({ players: 8 });
    const s = startLiar(ctx);
    liar.hostAction!(s, ctx, 'skip-talk');
    const [t1, t2] = s.tables as [LiarState['tables'][0], LiarState['tables'][0]];
    const me = t1.memberIds[0]!;
    liar.input(s, ctx, me, { type: 'vote', target: me }, ctx.now);
    liar.input(s, ctx, me, { type: 'vote', target: t2.memberIds[0] }, ctx.now);
    expect(t1.votes[me]).toBeUndefined();
  });

  it('늦게 온 사람은 가장 작은 테이블의 시민이 된다', () => {
    const ctx = makeCtx({ players: 7 });
    const s = startLiar(ctx);
    ctx.players.push({ id: 'late', nickname: '늦게', color: '#000', connected: true, teamId: null });
    liar.playerJoined!(s, ctx, 'late');
    const v = liar.playerView(s, ctx, 'late');
    expect(v.seated).toBe(true);
    expect(v.isLiar).toBe(false);
    expect(v.word).not.toBeNull();
  });

  it('기본 카테고리는 보기 8개를 만들 만큼 단어가 있다', () => {
    for (const c of LIAR_CATEGORIES) expect(new Set(c.words).size).toBeGreaterThanOrEqual(8);
  });
});

describe('파장 맞추기', () => {
  it('점수는 거리로 정한다', () => {
    expect([0, 4, 5, 10, 11, 17, 18, 60].map(wavePoints)).toEqual([4, 4, 3, 3, 2, 2, 0, 0]);
  });

  it('출제자만 목표를 보고, 팀원 바늘의 평균이 답이 된다', () => {
    const ctx = makeCtx({
      players: 4,
      settings: { waveRounds: 2 },
      teams: [{ id: 't1', name: '한팀', color: '#f00', memberIds: ['p1', 'p2', 'p3', 'p4'] }],
    });
    const s = wavelength.init(ctx);
    wavelength.start(s, ctx);
    const t = s.tables[0]!;
    const psychic = t.psychicId;
    const guessers = t.memberIds.filter((id) => id !== psychic);
    expect(wavelength.playerView(s, ctx, psychic).target).toBe(t.target);
    expect(wavelength.playerView(s, ctx, guessers[0]!).target).toBeNull();
    expect(wavelength.hostView(s, ctx).tables[0]!.target).toBeNull();
    // 출제자는 바늘을 못 움직인다
    wavelength.input(s, ctx, psychic, { type: 'dial', v: 10 }, ctx.now);
    expect(t.guesses[psychic]).toBeUndefined();
    const aim = t.target;
    wavelength.input(s, ctx, guessers[0]!, { type: 'dial', v: aim - 6 }, ctx.now);
    wavelength.input(s, ctx, guessers[1]!, { type: 'dial', v: aim + 6 }, ctx.now);
    wavelength.input(s, ctx, guessers[2]!, { type: 'dial', v: aim }, ctx.now);
    expect(wavelength.playerView(s, ctx, guessers[0]!).needle).toBe(aim);
    for (const id of guessers) wavelength.input(s, ctx, id, { type: 'lock' }, ctx.now);
    expect(s.stage).toBe('reveal'); // 모두 확정 → 바로 공개
    expect(t.result).toMatchObject({ needle: aim, distance: 0, points: 4 });
    // 다음 라운드는 출제자가 바뀐다
    ctx.now = s.deadline;
    wavelength.tick(s, ctx);
    expect(s.round).toBe(2);
    expect(t.psychicId).not.toBe(psychic);
    // 아무도 안 움직이면 가운데(50)로 친다
    ctx.now = s.deadline;
    wavelength.tick(s, ctx);
    expect(t.result?.needle).toBe(50);
    ctx.now = s.deadline;
    wavelength.tick(s, ctx);
    expect(wavelength.finished(s, ctx)).toBe(true);
    expect(wavelength.summary(s, ctx).metrics.bullseyes).toBeGreaterThanOrEqual(1);
  });

  it('바늘을 움직이면 확정이 풀린다', () => {
    const ctx = makeCtx({ players: 3 });
    const s = wavelength.init(ctx);
    wavelength.start(s, ctx);
    const t = s.tables[0]!;
    const g = t.memberIds.find((id) => id !== t.psychicId)!;
    wavelength.input(s, ctx, g, { type: 'lock' }, ctx.now);
    expect(t.locked[g]).toBeUndefined(); // 움직이기 전엔 확정 불가
    wavelength.input(s, ctx, g, { type: 'dial', v: 140 }, ctx.now);
    expect(t.guesses[g]).toBe(100);
    wavelength.input(s, ctx, g, { type: 'lock' }, ctx.now);
    expect(t.locked[g]).toBe(true);
    wavelength.input(s, ctx, g, { type: 'dial', v: 30 }, ctx.now);
    expect(t.locked[g]).toBe(false);
  });
});
