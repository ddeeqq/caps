import type { GameId } from '@caps/shared';
import type { ComponentType } from 'react';
import { CardsectionHost, CardsectionPlayer } from './cardsection';
import { MinorityHost, MinorityPlayer } from './minority';
import { NunchiHost, NunchiPlayer } from './nunchi';
import { SoundmateHost, SoundmatePlayer } from './soundmate';
import { TiltraceHost, TiltracePlayer } from './tiltrace';
import type { GameProps } from './types';
import { VaultHost, VaultPlayer } from './vault';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGame = ComponentType<GameProps<any>>;

export const HOST_VIEWS: Record<GameId, AnyGame> = {
  nunchi: NunchiHost,
  soundmate: SoundmateHost,
  vault: VaultHost,
  cardsection: CardsectionHost,
  minority: MinorityHost,
  tiltrace: TiltraceHost,
};

export const PLAYER_VIEWS: Record<GameId, AnyGame> = {
  nunchi: NunchiPlayer,
  soundmate: SoundmatePlayer,
  vault: VaultPlayer,
  cardsection: CardsectionPlayer,
  minority: MinorityPlayer,
  tiltrace: TiltracePlayer,
};

/** 게임마다 큰 화면 무대 색을 바꿔 단계가 바뀐 걸 바로 느끼게 한다 */
export const STAGE_TONE: Record<GameId, 'sun' | 'night' | 'water' | 'paper' | 'gum'> = {
  nunchi: 'sun',
  soundmate: 'paper',
  vault: 'night',
  cardsection: 'night',
  minority: 'gum',
  tiltrace: 'water',
};
