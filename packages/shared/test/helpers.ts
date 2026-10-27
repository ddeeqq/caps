import {
  DEFAULT_SETTINGS,
  type GameCtx,
  type GamePlayer,
  type GameSummary,
  type RoomSettings,
} from '../src/games/types';
import { resolvePack, type ResolvePackInput } from '../src/pack/resolve';
import { createRng } from '../src/util/rng';
import type { TeamInfo } from '../src/util/teams';

export interface TestCtx extends GameCtx {
  advance(ms: number): void;
}

export function makePlayers(n: number): GamePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `참가자${i + 1}`,
    color: '#ffffff',
    connected: true,
    teamId: null,
  }));
}

export function makeCtx(
  opts: {
    players?: number | GamePlayer[];
    now?: number;
    settings?: Partial<RoomSettings>;
    teams?: TeamInfo[] | null;
    pack?: ResolvePackInput;
    history?: GameSummary[];
    seed?: number;
  } = {},
): TestCtx {
  const players =
    typeof opts.players === 'number' || opts.players === undefined
      ? makePlayers(opts.players ?? 6)
      : opts.players;
  const ctx: TestCtx = {
    now: opts.now ?? 1_000_000,
    players,
    teams: opts.teams ?? null,
    pack: resolvePack(opts.pack ?? { preset: 'friends' }),
    rng: createRng(opts.seed ?? 42),
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    history: opts.history ?? [],
    advance(ms: number) {
      this.now += ms;
    },
  };
  return ctx;
}
