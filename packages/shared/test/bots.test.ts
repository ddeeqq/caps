import { describe, expect, it } from 'vitest';
import { BotBrain, BotHub, solveVault } from '../src/bots';
import { splitHumansAndBots, teamForNewcomer } from '../src/games/common';
import { soundmate } from '../src/games/soundmate';
import { createRng } from '../src/util/rng';
import { makeCtx, makePlayers } from './helpers';

function mixed(humans: number, bots: number) {
  const players = makePlayers(humans + bots).map((p, i) => ({ ...p, bot: i >= humans }));
  return players;
}

describe('사람과 봇 팀 나누기', () => {
  it('사람끼리, 봇끼리 따로 팀을 만든다', () => {
    const players = mixed(3, 6);
    const groups = splitHumansAndBots(players, createRng(1));
    const isBot = (id: string) => players.find((p) => p.id === id)!.bot;
    for (const g of groups) expect(new Set(g.map(isBot)).size).toBe(1);
    expect(groups.flat()).toHaveLength(9);
  });

  it('소리 짝꿍도 섞지 않고, 늦게 온 사람은 사람 팀으로 간다', () => {
    const ctx = makeCtx({ players: mixed(4, 8) });
    const s = soundmate.init(ctx);
    const isBot = (id: string) => ctx.players.find((p) => p.id === id)?.bot === true;
    for (const t of s.teams) expect(new Set(t.memberIds.map(isBot)).size).toBe(1);
    ctx.players.push({ id: 'late', nickname: '늦은 사람', color: '#fff', connected: true, teamId: null });
    const team = teamForNewcomer(s.teams, ctx, 'late')!;
    expect(team.memberIds.every((id) => !isBot(id))).toBe(true);
  });
});

describe('봇의 머리', () => {
  it('금고: 허브에 모인 조각으로 정답을 만든다', () => {
    expect(
      solveVault(
        ['별', '달'],
        [
          { symbol: '달', digit: 4 },
          { symbol: '별', digit: 7 },
        ],
      ),
    ).toBe('74');
    expect(
      solveVault(
        ['별', '달'],
        [
          { symbol: '달', digit: 4 },
          { symbol: '별', digit: 7 },
        ],
        '전체 순서를 거꾸로 입력해요',
      ),
    ).toBe('47');
  });

  it('눈치게임: 열린 뒤 무작위로 한 번만 누른다, 설문 끄기 옵션', () => {
    let now = 0;
    const brain = new BotBrain('p1', {
      hub: new BotHub(),
      surveys: false,
      random: () => 0,
      clock: () => now,
    });
    const view = {
      gameId: 'nunchi' as const,
      index: 0,
      phase: 'playing' as const,
      summary: null,
      view: { stage: 'open', round: 1, openAt: 1_000, canTap: true },
    };
    expect(brain.think({ phase: 'lobby', paused: false, view: null, gameNow: 0 })).toEqual([]);
    expect(brain.think({ phase: 'playing', paused: false, view, gameNow: 1_100 })).toEqual([]);
    const acts = brain.think({ phase: 'playing', paused: false, view, gameNow: 1_300 });
    expect(acts).toEqual([{ type: 'input', input: { type: 'tap' } }]);
    expect(brain.think({ phase: 'playing', paused: false, view, gameNow: 9_000 })).toEqual([]);
    now = 1;
  });
});
