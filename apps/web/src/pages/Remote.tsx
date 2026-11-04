import { GAME_META, hostScript, type RoomState, type ViewEnvelope } from '@caps/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Spinner, Wordmark } from '../components/ui';
import { useClientSnapshot, useRoomClient } from '../lib/roomClient';
import { EndNav } from '../components/EndNav';
import { useFollowRematch } from '../lib/rematch';
import { Link } from '../lib/router';
import { keys, local } from '../lib/storage';
import { hostActions, runAction, type HostAction } from './hostActions';

const PHASE_TEXT = {
  lobby: '대기실',
  intro: '게임 소개',
  playing: '게임 중',
  result: '결과',
  finished: '끝',
} as const;

/**
 * 진행 멘트 카드: 지금 단계에서 소리 내어 읽을 말과 진행자만 보는 팁.
 * 처음 진행하는 사람도 리모컨만 보고 진행할 수 있게 한다. 접어 두면 기억한다.
 */
function ScriptCard({ room, env }: { room: RoomState; env: ViewEnvelope | null }) {
  const [hidden, setHidden] = useState(() => local.get(keys.scriptHidden) === '1');
  const stage =
    env && room.phase === 'playing' ? ((env.view as { stage?: string } | null)?.stage ?? null) : null;
  const script = hostScript({
    phase: room.phase,
    gameId: room.gameId,
    stage,
    last: room.index + 1 >= room.flow.length,
    paused: room.paused,
  });
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    local.set(keys.scriptHidden, next ? '1' : '0');
  };
  if (script.say.length === 0 && !script.tip) return null;
  return (
    <section className="script" aria-label="진행 멘트">
      <header className="script__head">
        <h2>이렇게 말해 보세요</h2>
        <button
          type="button"
          className="btn btn--small btn--quiet"
          onClick={toggle}
          aria-expanded={!hidden}
          aria-controls="script-body"
        >
          {hidden ? '펼치기' : '접기'}
        </button>
      </header>
      {!hidden && (
        <div id="script-body" className="script__body">
          {script.say.map((line) => (
            <p key={line} className="script__say">
              {line}
            </p>
          ))}
          {script.tip && <p className="script__tip">{script.tip}</p>}
        </div>
      )}
    </section>
  );
}

/** 진행자가 폰으로 큰 화면을 조종하는 리모컨 */
export function Remote({ code: initialCode }: { code?: string }) {
  const client = useRoomClient();
  const snap = useClientSnapshot(client);
  const [code, setCode] = useState((initialCode ?? '').toUpperCase());
  const [pin, setPin] = useState('');
  const [token, setToken] = useState<string | null>(() =>
    initialCode ? local.get(keys.host(initialCode.toUpperCase())) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !code) return;
    client.setAuth(() => {
      void client.call('host:attach', { code, hostToken: token, role: 'remote' }).then((res) => {
        if (!res.ok) {
          setError(res.message);
          setToken(null);
          local.remove(keys.host(code));
        }
      });
    });
    return () => client.setAuth(null);
  }, [client, code, token]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await client.call('host:remote-login', { code, pin });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    local.set(keys.host(code), res.hostToken);
    setToken(res.hostToken);
  };

  const room = snap.room;
  useFollowRematch(room, 'remote');
  if (!token) {
    return (
      <main className="phone-page">
        <header className="phone-page__head">
          <Link to="/" aria-label="처음으로">
            <Wordmark size="sm" />
          </Link>
          <h1>리모컨 연결</h1>
        </header>
        <form className="stack panel" onSubmit={login}>
          <p className="muted">큰 화면 아래의 리모컨 버튼을 누르면 PIN이 보여요</p>
          <label className="field">
            <span className="field__label">방 코드</span>
            <input
              className="input input--code"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
            />
          </label>
          <label className="field">
            <span className="field__label">리모컨 PIN</span>
            <input
              className="input input--code"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button
            className="btn btn--primary btn--block"
            disabled={busy || code.length !== 4 || pin.length !== 4}
          >
            연결하기
          </button>
        </form>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="phone-page">
        <Spinner label="방에 연결하는 중" />
      </main>
    );
  }

  const { primary, extra } = hostActions(room, snap.view);
  const run = async (a: HostAction) => setError(await runAction(client, a));
  const players = room.players ?? [];

  return (
    <main className="phone-page remote">
      <header className="remote__head">
        <span>
          방 <b>{room.code}</b>
        </span>
        <span>{room.playerCount}명</span>
        <span className={snap.connected ? '' : 'error-text'}>{snap.connected ? '연결됨' : '연결 끊김'}</span>
      </header>
      <section className="remote__now">
        <p className="muted">{PHASE_TEXT[room.phase]}</p>
        <h1>
          {room.gameId ? GAME_META[room.gameId].title : room.phase === 'finished' ? '세션 끝' : '시작 전'}
        </h1>
        {room.phase !== 'lobby' && room.phase !== 'finished' && (
          <p className="muted">
            게임 {room.index + 1} / {room.flow.length}
            {room.paused ? ', 일시정지 중' : ''}
          </p>
        )}
        {room.pauseReason === 'restart' && (
          <p className="banner banner--calm remote__notice">
            서버가 다시 켜져서 멈춘 자리에서 기다리는 중이에요. 참가자가 돌아오면 다시 진행을 눌러 주세요
          </p>
        )}
      </section>
      <ScriptCard room={room} env={snap.view} />
      {room.phase === 'finished' && (room.report?.quotes?.length ?? 0) > 0 && (
        <section className="remote__quotes" aria-label="한 줄 소감">
          <h2>한 줄 소감 (큰 화면에 보이는 중)</h2>
          <p className="muted">부적절한 소감은 숨기면 큰 화면과 리포트에서 빠져요</p>
          <ul>
            {room.report!.quotes!.map((q) => (
              <li key={q}>
                <span>{q}</span>
                <button
                  type="button"
                  className="btn btn--small btn--quiet"
                  onClick={() => void client.command({ type: 'hideQuote', text: q })}
                >
                  숨기기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {room.phase === 'finished' && <EndNav room={room} client={client} kind="remote" />}
      {primary && (
        <button
          type="button"
          className="btn btn--primary btn--block remote__primary"
          onClick={() => void run(primary)}
        >
          {primary.label}
        </button>
      )}
      <div className="remote__grid">
        {extra.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`btn ${a.tone === 'sun' ? 'btn--sun' : ''}`}
            onClick={() => void run(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      <section className="remote__players">
        <h2>참가자 {players.length}명</h2>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              <span className="dot" style={{ background: p.color }} />
              <span className={p.connected ? '' : 'muted'}>{p.nickname}</span>
              <button
                type="button"
                className="btn btn--small btn--quiet"
                onClick={() => {
                  if (window.confirm(`${p.nickname}님을 내보낼까요?`))
                    void client.command({ type: 'kick', playerId: p.id });
                }}
              >
                내보내기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
