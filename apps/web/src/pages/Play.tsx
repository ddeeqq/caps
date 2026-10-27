import { GAME_META, LIMITS } from '@caps/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Caption, ComfortScale, NewPeopleScale, ReactionBar, Spinner, Wordmark } from '../components/ui';
import { PlayerIntro, PlayerResult } from '../games/common';
import { PLAYER_VIEWS } from '../games';
import { api } from '../lib/api';
import { useClientSnapshot, useRoomClient, type RoomClient } from '../lib/roomClient';
import { Link, navigate } from '../lib/router';
import { unlockAudio } from '../lib/sound';
import { keys, local } from '../lib/storage';

export function Play({ code }: { code?: string }) {
  if (!code) return <JoinCode />;
  return <PlayRoom code={code.toUpperCase()} />;
}

function JoinCode() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.room(code);
      if (!r.exists) setError('그런 방이 없어요. 큰 화면의 코드를 다시 확인해 주세요');
      else navigate(`/play/${code}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <main className="phone-page">
      <header className="phone-page__head">
        <Wordmark size="sm" />
      </header>
      <form className="stack panel" onSubmit={submit}>
        <h1>방 코드를 입력하세요</h1>
        <input
          className="input input--code"
          value={code}
          maxLength={4}
          autoFocus
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
          aria-label="방 코드"
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={code.length !== 4}>
          입장하기
        </button>
      </form>
    </main>
  );
}

type JoinError = { code: string; message: string };

function PlayRoom({ code }: { code: string }) {
  const client = useRoomClient();
  const snap = useClientSnapshot(client);
  const [stage, setStage] = useState<'name' | 'joining' | 'in' | 'error'>(() =>
    local.get(keys.player(code)) ? 'joining' : 'name',
  );
  const [nickname, setNickname] = useState(() => local.get(keys.nickname) ?? '');
  const [error, setError] = useState<JoinError | null>(null);

  const join = useCallback(
    async (opts: { token?: string | null; nickname?: string }) => {
      const res = await client.call('player:join', {
        code,
        ...(opts.token ? { token: opts.token } : {}),
        ...(opts.nickname ? { nickname: opts.nickname } : {}),
      });
      if (res.ok) {
        local.set(keys.player(code), res.token);
        setStage('in');
        setError(null);
        return;
      }
      setError({ code: res.error, message: res.message });
      if (res.error === 'NICKNAME_BLOCKED') setStage('name');
      else {
        local.remove(keys.player(code));
        setStage('error');
      }
    },
    [client, code],
  );

  // 연결(재연결)될 때마다 저장된 토큰으로 같은 사람으로 다시 들어간다
  useEffect(() => {
    client.setAuth(() => {
      const token = local.get(keys.player(code));
      if (token) void join({ token });
    });
    return () => client.setAuth(null);
  }, [client, code, join]);

  // 첫 탭에 오디오를 풀어 둔다 (브라우저 정책)
  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  if (snap.kicked) {
    return (
      <main className="phone-page center-page">
        <h1>진행자가 이 방에서 내보냈어요</h1>
        <Link to="/" className="btn">
          처음으로
        </Link>
      </main>
    );
  }

  if (stage === 'error') {
    return (
      <main className="phone-page center-page">
        <Wordmark size="sm" />
        <h1>입장할 수 없어요</h1>
        <p>{error?.message}</p>
        <Link to="/" className="btn btn--sun">
          다른 방 코드 넣기
        </Link>
      </main>
    );
  }

  if (stage === 'name') {
    return (
      <main className="phone-page join-page">
        <header className="phone-page__head">
          <Wordmark size="sm" />
          <span className="join-page__code">방 {code}</span>
        </header>
        <form
          className="stack panel"
          onSubmit={(e) => {
            e.preventDefault();
            const name = nickname.trim();
            if (name) local.set(keys.nickname, name);
            setStage('joining');
            void join({ nickname: name });
          }}
        >
          <Caption as="h1" tone="sun" className="join-page__title">
            어서 와요!
          </Caption>
          <label className="field">
            <span className="field__label">닉네임</span>
            <span className="field__hint">비워 두면 '졸린 망고' 같은 이름을 지어 드려요</span>
            <input
              className="input"
              maxLength={LIMITS.nickname}
              value={nickname}
              placeholder="예: 지훈"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          {error && <p className="error-text">{error.message}</p>}
          <button className="btn btn--primary btn--block">입장하기</button>
          <p className="muted">게임 중에 소리가 나요. 무음 모드를 꺼 주세요</p>
        </form>
      </main>
    );
  }

  const room = snap.room;
  if (stage === 'joining' || !room || !room.you) {
    return (
      <main className="phone-page center-page">
        <Spinner label="방에 들어가는 중" />
      </main>
    );
  }
  return <PlayerShell client={client} />;
}

function PlayerShell({ client }: { client: RoomClient }) {
  const snap = useClientSnapshot(client);
  const room = snap.room!;
  const env = snap.view;
  const you = room.you!;
  const Game = room.phase === 'playing' && env ? PLAYER_VIEWS[env.gameId] : null;
  const showReactions = room.phase === 'lobby' || room.phase === 'intro' || room.phase === 'result';
  const fullBleed = room.phase === 'playing' && env?.gameId === 'cardsection';

  return (
    <div className={`phone ${fullBleed ? 'phone--bleed' : ''}`} data-phase={room.phase}>
      {!snap.connected && <div className="banner">연결이 끊겼어요. 다시 연결하는 중…</div>}
      {room.paused && room.phase !== 'finished' && <div className="banner banner--calm">잠깐 멈췄어요</div>}
      {!fullBleed && (
        <header className="phone__top">
          <span className="phone__me">
            <span className="dot" style={{ background: you.color }} />
            {you.nickname}
          </span>
          <span className="phone__game">
            {room.gameId && room.phase !== 'lobby' ? GAME_META[room.gameId].title : `방 ${room.code}`}
          </span>
        </header>
      )}
      <main className="phone__main">
        {room.phase === 'lobby' && <PlayerLobby client={client} />}
        {room.phase === 'intro' && env && <PlayerIntro gameId={env.gameId} />}
        {Game && env && <Game view={env.view} client={client} room={room} />}
        {room.phase === 'result' && <PlayerResult summary={env?.summary ?? null} />}
        {room.phase === 'finished' && <EndSurvey client={client} />}
      </main>
      {showReactions && (
        <footer className="phone__bottom">
          <ReactionBar client={client} />
        </footer>
      )}
    </div>
  );
}

function PlayerLobby({ client }: { client: RoomClient }) {
  const snap = useClientSnapshot(client);
  const room = snap.room!;
  const [comfort, setComfort] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(room.you?.nickname ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="p-lobby">
      <Caption as="h1" tone="sun" className="p-lobby__title">
        곧 시작해요
      </Caption>
      <p className="p-lobby__sub">
        지금 {room.playerCount}명이 모였어요. 진행자가 시작하면 이 화면이 바뀌어요
      </p>
      <div className="panel stack">
        <h2>지금 분위기는 어때요?</h2>
        <ComfortScale
          value={comfort}
          onChange={(v) => {
            setComfort(v);
            client.socket.emit('player:survey', { phase: 'lobby', comfort: v });
          }}
        />
        <p className="muted">익명으로 모여서, 끝나고 얼마나 편해졌는지 비교해요</p>
      </div>
      {renaming ? (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await client.call('player:rename', name);
            if (res.ok) {
              setRenaming(false);
              setError(null);
              local.set(keys.nickname, res.nickname);
            } else setError(res.message);
          }}
        >
          <input
            className="input"
            value={name}
            maxLength={LIMITS.nickname}
            onChange={(e) => setName(e.target.value)}
            aria-label="새 닉네임"
          />
          <button className="btn btn--small">바꾸기</button>
        </form>
      ) : (
        <button type="button" className="btn btn--quiet" onClick={() => setRenaming(true)}>
          닉네임 바꾸기
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

function EndSurvey({ client }: { client: RoomClient }) {
  const [comfort, setComfort] = useState<number | null>(null);
  const [people, setPeople] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <section className="p-end">
        <Caption as="h1" tone="mint" className="p-end__title">
          고마워요!
        </Caption>
        <p>오늘 처음 말을 튼 사람에게 한마디 더 걸어 보세요.</p>
        <Link to="/" className="btn">
          처음으로
        </Link>
      </section>
    );
  }
  return (
    <section className="p-end">
      <Caption as="h1" tone="sun" className="p-end__title">
        마지막 질문 두 개
      </Caption>
      <div className="panel stack">
        <h2>오늘 처음 말해본 사람은?</h2>
        <NewPeopleScale value={people} onChange={setPeople} />
      </div>
      <div className="panel stack">
        <h2>지금 분위기는 어때요?</h2>
        <ComfortScale value={comfort} onChange={setComfort} />
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={comfort === null || people === null}
        onClick={() => {
          client.socket.emit('player:survey', {
            phase: 'end',
            comfort: comfort ?? undefined,
            newPeople: people ?? undefined,
          });
          setSent(true);
        }}
      >
        보내기
      </button>
    </section>
  );
}
