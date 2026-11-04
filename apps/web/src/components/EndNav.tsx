import type { RoomState } from '@caps/shared';
import { useState } from 'react';
import { goRematch } from '../lib/rematch';
import type { RoomClient } from '../lib/roomClient';
import { Link } from '../lib/router';

/**
 * 세션이 끝난 뒤 진행자가 갈 곳: 같은 사람들과 한 판 더 / 리포트 / 구성을 바꿔 새 방 / 처음으로.
 * 큰 화면(아래 띠)과 폰 리모컨(목록)에 같이 쓴다.
 */
export function EndNav({
  room,
  client,
  kind,
  className = '',
}: {
  room: RoomState;
  client: RoomClient;
  kind: 'host' | 'remote';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rematch = async () => {
    setBusy(true);
    const res = await client.command({ type: 'rematch' });
    setBusy(false);
    // 성공하면 방 상태에 새 코드가 실려 오고, 화면이 알아서 따라간다 (useFollowRematch)
    if (!res.ok) setError(res.message);
  };
  return (
    <nav className={`end-nav end-nav--${kind} ${className}`} aria-label="세션이 끝난 뒤">
      {room.rematch ? (
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => goRematch(room.code, room.rematch!, kind)}
        >
          새 판으로 가기 ({room.rematch})
        </button>
      ) : (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void rematch()}>
          {busy ? '새 방 여는 중…' : '같은 사람들과 한 판 더'}
        </button>
      )}
      {room.report && (
        <a className="btn" href={`/report/${room.report.id}`} target="_blank" rel="noopener">
          리포트 크게 보기
        </a>
      )}
      <Link to="/host/new" className="btn">
        게임 바꿔서 새 방
      </Link>
      <Link to="/" className="btn btn--quiet">
        처음으로
      </Link>
      {error && <p className="error-text">{error}</p>}
    </nav>
  );
}
