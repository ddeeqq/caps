import { cardsection } from './cardsection';
import { liar } from './liar';
import { minority } from './minority';
import { nunchi } from './nunchi';
import { soundmate } from './soundmate';
import { tiltrace } from './tiltrace';
import type { GameId, GameMeta, GameModule } from './types';
import { vault } from './vault';
import { wavelength } from './wavelength';

export const GAMES: Record<GameId, GameModule> = {
  nunchi,
  soundmate,
  vault,
  cardsection,
  minority,
  tiltrace,
  liar,
  wavelength,
};

export const GAME_META: Record<GameId, GameMeta> = Object.fromEntries(
  Object.entries(GAMES).map(([id, mod]) => [id, mod.meta]),
) as Record<GameId, GameMeta>;

export function gameMeta(id: GameId): GameMeta {
  return GAME_META[id];
}
