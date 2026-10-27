import type { RoomState } from '@caps/shared';
import type { RoomClient } from '../lib/roomClient';

export interface GameProps<V> {
  view: V;
  client: RoomClient;
  room: RoomState;
}
