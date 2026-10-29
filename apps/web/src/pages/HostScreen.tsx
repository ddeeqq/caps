import { GAME_META, type RoomState } from '@caps/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Caption, QRImage, ReactionLayer, Spinner, Stickers, Wordmark } from '../components/ui';
import { FinalReport, HostIntro, HostResult } from '../games/common';
import { HOST_VIEWS, STAGE_TONE } from '../games';
import { enterFullscreen } from '../lib/device';
import { useSoundCue } from '../lib/hooks';
import { audioReady, isMuted, setMuted, unlockAudio } from '../lib/sound';
import { useClientSnapshot, useRoomClient, type RoomClient } from '../lib/roomClient';
import { Link } from '../lib/router';
import { keys, local } from '../lib/storage';
import { hostActions, runAction, type ConfirmFn, type HostAction } from './hostActions';

function joinUrlFor(room: RoomState): string {
  return `${window.location.origin}${room.joinPath}`;
}

function Lobby({ room }: { room: RoomState }) {
  const players = room.players ?? [];
  const url = joinUrlFor(room);
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return (
    <section className="lobby">
      <div className="lobby__join">
        <p className="lobby__lead">폰 카메라로 찍으면 바로 입장</p>
        <QRImage text={url} label="입장용 QR 코드" className="qr--lobby" />
        <p className="lobby__url">
          {window.location.host}
          {room.joinPath.replace(room.code, '')}
          <b>{room.code}</b>
        </p>
        {isLocal && (
          <p className="lobby__warn">
            지금 주소는 이 컴퓨터에서만 열려요. 폰으로 들어오려면 같은 와이파이에서 컴퓨터 IP 주소로 열어
            주세요
          </p>
        )}
      </div>
      <div className="lobby__people">
        <div className="lobby__count">
          <Caption className="lobby__num">{room.playerCount}</Caption>
          <span>명 입장</span>
          {room.botCount > 0 && <span className="lobby__bots">봇 {room.botCount}명 포함</span>}
        </div>
        {players.length === 0 ? (
          <p className="lobby__empty">첫 번째로 들어올 사람을 기다리는 중이에요</p>
        ) : (
          <Stickers players={players} />
        )}
        <div className="lobby__flow">
          <h2>오늘의 순서</h2>
          <ol>
            {room.flow.map((id) => (
              <li key={id}>{GAME_META[id].title}</li>
            ))}
          </ol>
        </div>
        {room.survey && room.survey.lobby.count > 0 && (
          <p className="lobby__mood">
            지금 분위기 {room.survey.lobby.avg} / 5 ({room.survey.lobby.count}명 응답)
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * 큰 화면의 방송 효과음: 새 게임 소개 징글, 결과 팡파레, 대기실 입장 톡.
 * 브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막으므로, 첫 클릭·키 입력에 오디오를 연다.
 */
function StageSounds({ room }: { room: RoomState }) {
  useEffect(() => {
    const unlock = () => {
      if (!isMuted()) void unlockAudio();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  useSoundCue(`${room.phase}:${room.index}`, (_a, b) => {
    if (b.startsWith('intro:')) return 'jingle';
    if (b.startsWith('result:') || b.startsWith('finished:')) return 'fanfare';
    return null;
  });
  useSoundCue(room.phase === 'lobby' ? room.playerCount : -1, (a, b) => (a >= 0 && b > a ? 'pop' : null));
  return null;
}

function Dock({ client, room, pin }: { client: RoomClient; room: RoomState; pin: string | null }) {
  const snap = useClientSnapshot(client);
  const { primary, extra } = hostActions(room, snap.view);
  const [visible, setVisible] = useState(true);
  const [showRemote, setShowRemote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef(0);
  const [soundOn, setSoundOn] = useState(() => !isMuted() && audioReady());
  const toggleSound = async () => {
    if (soundOn) {
      setMuted(true);
      setSoundOn(false);
    } else {
      setMuted(false);
      setSoundOn(await unlockAudio());
    }
  };
  // 첫 클릭으로 오디오가 열리면 버튼 표시도 맞춘다
  useEffect(() => {
    const id = window.setInterval(() => setSoundOn(!isMuted() && audioReady()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const wake = () => {
      setVisible(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), 4_000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, []);

  // 확인 창은 화면 안에 띄운다 (브라우저 기본 확인 창은 전체 화면을 풀어 버린다)
  const [ask, setAsk] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm: ConfirmFn = (message) => new Promise((resolve) => setAsk({ message, resolve }));
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };
  const run = async (a: HostAction) => setError(await runAction(client, a, confirm));

  // 발표용 단축키: Space·Enter·→ 다음, P 일시정지, F 전체 화면, M 효과음 (확인 창이 떠 있으면 Enter 예, Esc 아니요)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (ask) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          answer(true);
        } else if (e.key === 'Escape') answer(false);
        return;
      }
      if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') && primary) {
        e.preventDefault();
        void run(primary);
      } else if (e.key.toLowerCase() === 'p' && room.phase !== 'lobby' && room.phase !== 'finished') {
        void client.command({ type: room.paused ? 'resume' : 'pause' });
      } else if (e.key.toLowerCase() === 'f') {
        void enterFullscreen();
      } else if (e.key.toLowerCase() === 'm') {
        void toggleSound();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`dock ${visible || showRemote || ask ? '' : 'is-hidden'}`}>
      {ask &&
        createPortal(
          <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
            <div className="confirm__box">
              <p id="confirm-msg" className="confirm__msg">
                {ask.message}
              </p>
              <div className="confirm__row">
                <button type="button" className="btn" onClick={() => answer(false)}>
                  아니요
                </button>
                <button type="button" className="btn btn--primary" autoFocus onClick={() => answer(true)}>
                  네, 진행할게요
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {error && <p className="dock__error">{error}</p>}
      {showRemote && pin && (
        <div className="dock__remote">
          <QRImage
            text={`${window.location.origin}/remote/${room.code}`}
            label="리모컨 QR"
            className="qr--small"
          />
          <div>
            <p>
              리모컨 PIN <b>{pin}</b>
            </p>
            <p className="muted">진행자 폰으로 찍고 PIN을 넣으면 폰으로 진행할 수 있어요</p>
          </div>
        </div>
      )}
      <div className="dock__row">
        {extra.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`btn btn--small ${a.tone === 'sun' ? 'btn--sun' : ''}`}
            onClick={() => void run(a)}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--small"
          onClick={() => setShowRemote((s) => !s)}
          aria-expanded={showRemote}
        >
          리모컨
        </button>
        <button type="button" className="btn btn--small" onClick={() => void enterFullscreen()}>
          전체 화면
        </button>
        <button
          type="button"
          className={`btn btn--small ${soundOn ? '' : 'btn--sun'}`}
          onClick={() => void toggleSound()}
          aria-pressed={soundOn}
        >
          {soundOn ? '효과음 끄기' : '효과음 켜기'}
        </button>
        {primary && (
          <button type="button" className="btn btn--primary" onClick={() => void run(primary)}>
            {primary.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function HostScreen({ code }: { code: string }) {
  const client = useRoomClient();
  const snap = useClientSnapshot(client);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get('t');
    if (fromHash) {
      local.set(keys.host(code), fromHash);
      window.history.replaceState(null, '', window.location.pathname);
    }
    const token = local.get(keys.host(code));
    if (!token) {
      setAuthError('이 브라우저에는 이 방의 진행자 정보가 없어요');
      return;
    }
    client.setAuth(() => {
      void client.call('host:attach', { code, hostToken: token, role: 'screen' }).then((res) => {
        if (res.ok) {
          setAuthError(null);
          setPin(res.hostPin);
        } else setAuthError(res.message);
      });
    });
    return () => client.setAuth(null);
  }, [client, code]);

  const room = snap.room;
  const env = snap.view;

  if (authError) {
    return (
      <main className="center-page">
        <Wordmark />
        <h1>진행자 화면을 열 수 없어요</h1>
        <p>{authError}. 방을 만든 브라우저에서 열거나, 폰 리모컨으로 진행해 주세요.</p>
        <div className="row">
          <Link to="/host/new" className="btn btn--sun">
            새 방 만들기
          </Link>
          <Link to={`/remote/${code}`} className="btn">
            리모컨으로 진행
          </Link>
        </div>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="center-page">
        <Spinner label="방에 연결하는 중" />
      </main>
    );
  }

  const tone =
    (room.phase === 'playing' || room.phase === 'intro') && env
      ? room.phase === 'playing'
        ? STAGE_TONE[env.gameId]
        : 'sun'
      : 'sun';
  const HostView = env && room.phase === 'playing' ? HOST_VIEWS[env.gameId] : null;
  const nextGame = room.flow[room.index + 1] ?? null;

  return (
    <div className="screen" data-tone={tone}>
      <header className="screen__bar">
        <Wordmark size="sm" />
        <span className="screen__code">
          방 코드 <b>{room.code}</b>
        </span>
        <span className="screen__people">{room.playerCount}명</span>
        {room.gameId && room.phase !== 'lobby' && room.phase !== 'finished' && (
          <span className="screen__game">{GAME_META[room.gameId].title}</span>
        )}
        {room.paused && <span className="screen__paused">일시정지</span>}
        {!snap.connected && <span className="screen__offline">다시 연결하는 중</span>}
      </header>
      <main className="screen__stage">
        {room.phase === 'lobby' && <Lobby room={room} />}
        {room.phase === 'intro' && env && (
          <HostIntro
            gameId={env.gameId}
            index={room.index}
            total={room.flow.length}
            playerCount={room.playerCount}
          />
        )}
        {room.phase === 'playing' && HostView && env && (
          <HostView view={env.view} client={client} room={room} />
        )}
        {room.phase === 'result' && env && <HostResult summary={env.summary} nextGame={nextGame} />}
        {room.phase === 'finished' && room.report && <FinalReport report={room.report} live />}
      </main>
      {room.paused && (
        <div className="pause-cover" aria-live="polite">
          {room.pauseReason === 'restart' ? (
            <div className="pause-cover__restart">
              <Caption tone="sun">이어서 할 준비 중</Caption>
              <p>
                서버가 다시 켜져서 멈춘 자리에서 기다리고 있어요. 참가자 폰은 저절로 돌아와요 (지금{' '}
                {room.playerCount - room.botCount}명)
              </p>
              <p>모두 돌아오면 다시 진행을 눌러 주세요</p>
            </div>
          ) : (
            <Caption tone="sun">잠깐 멈춤</Caption>
          )}
        </div>
      )}
      <StageSounds room={room} />
      <Dock client={client} room={room} pin={pin} />
      <ReactionLayer client={client} lane={room.phase === 'lobby' ? [48, 94] : undefined} />
    </div>
  );
}
