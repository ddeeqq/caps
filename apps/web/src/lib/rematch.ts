import type { RoomState } from '@caps/shared';
import { useEffect, useRef } from 'react';
import { navigate } from './router';
import { keys, local } from './storage';

/**
 * "한 판 더": 서버가 같은 구성으로 새 방을 열면 끝난 방의 상태에 새 코드(rematch)가 실린다.
 * 진행자 토큰은 그대로 이어지므로, 이 기기의 토큰을 새 코드로 복사하고 옮겨 간다.
 */
export function goRematch(from: string, to: string, kind: 'host' | 'remote'): void {
  const token = local.get(keys.host(from));
  if (token) local.set(keys.host(to), token);
  navigate(`/${kind}/${to}`);
}

/** 참가자: 새 방에 저장된 닉네임으로 바로 들어가도록 표시해 두고 옮겨 간다 */
export function joinRematch(to: string): void {
  local.set(keys.autoJoin(to), '1');
  navigate(`/play/${to}`);
}

/**
 * 이 화면을 보는 중에 "한 판 더"가 눌리면 (이 기기든 다른 진행자 기기든) 새 방으로 따라간다.
 * 이미 새 방이 열린 뒤에 옛 방 화면을 연 경우에는 저절로 옮기지 않는다 (버튼으로 간다).
 */
export function useFollowRematch(room: RoomState | null, kind: 'host' | 'remote'): void {
  const seen = useRef<string | null | undefined>(undefined);
  const next = room?.rematch ?? null;
  const code = room?.code ?? null;
  useEffect(() => {
    if (!code) return;
    if (seen.current === undefined) {
      seen.current = next;
      return;
    }
    if (next && next !== seen.current) {
      seen.current = next;
      goRematch(code, next, kind);
    }
  }, [code, next, kind]);
}
