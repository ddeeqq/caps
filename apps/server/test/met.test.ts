import { DEFAULT_SETTINGS, resolvePack, type GameSummary } from '@caps/shared';
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room/Room';

const summary = (gameId: GameSummary['gameId'], teams: string[][]): GameSummary => ({
  gameId,
  title: gameId,
  headline: '',
  highlights: [],
  metrics: {},
  teams: teams.map((memberIds, i) => ({ id: `t${i}`, name: `팀${i}`, color: '#fff', memberIds })),
});

describe('오늘 같은 팀이었던 사람', () => {
  it('끝난 뒤에만, 봇과 나간 사람은 빼고, 함께한 게임 수 순서로', () => {
    const room = new Room({
      code: 'TEST',
      pack: resolvePack({ preset: 'work' }),
      flow: ['soundmate', 'vault'],
      settings: DEFAULT_SETTINGS,
    });
    const [a, b, c, d] = ['가람', '나래', '다온', '라온'].map((n) => room.addPlayer(n));
    room.addBots(1);
    const bot = [...room.players.values()].find((p) => p.bot)!;
    room.summaries.push(summary('soundmate', [[a!.id, b!.id, c!.id, bot.id], [d!.id]]));
    room.summaries.push(
      summary('vault', [
        [a!.id, b!.id],
        [c!.id, d!.id, bot.id],
      ]),
    );
    room.kick(c!.id);

    expect(room.roomState('player', a!.id).you?.met).toBeUndefined(); // 진행 중에는 보내지 않는다
    room.finishSession();
    expect(room.roomState('player', a!.id).you?.met).toEqual([
      { nickname: '나래', color: b!.color, games: 2 },
    ]);
    expect(room.metFor(d!.id)).toEqual([]); // 다온은 나갔고 봇은 사람이 아니다
  });
});
