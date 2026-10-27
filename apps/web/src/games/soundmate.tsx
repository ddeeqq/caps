import type { SoundmateHostView, SoundmatePlayerView } from '@caps/shared';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Caption, QRImage, Sheet, TimerBar, Toast } from '../components/ui';
import { secondsLeft, useTicker } from '../lib/hooks';
import { startScanner, type Scanner } from '../lib/qr';
import { buzz, playAnimal, sfx, unlockAudio } from '../lib/sound';
import type { GameProps } from './types';

const QR_PREFIX = 'MALMUN:';

export function SoundmateHost({ view, client }: GameProps<SoundmateHostView>) {
  useTicker(500);
  const now = client.gameNow();
  const complete = view.teams.filter((t) => t.complete).length;
  return (
    <section className="sm-host">
      <header className="sm-host__head">
        <div>
          <p className="sm-host__label">
            {view.stage === 'search'
              ? '같은 소리를 찾는 중'
              : view.stage === 'mission'
                ? '팀 미션 중'
                : '모두 모였어요'}
          </p>
          <p className="sm-host__count">
            {complete} / {view.teams.length}팀 완성
          </p>
        </div>
        {view.stage === 'search' && (
          <p className="sm-host__time">{secondsLeft(view.searchDeadline, now)}초</p>
        )}
        <dl className="sm-host__stats">
          <div>
            <dt>연결</dt>
            <dd>{view.links}</dd>
          </div>
          <div>
            <dt>헛걸음</dt>
            <dd>{view.wrong}</dd>
          </div>
        </dl>
      </header>
      <ul className="sm-host__teams">
        {view.teams.map((t) => (
          <li
            key={t.id}
            className={`team-card ${t.complete ? 'is-complete' : ''}`}
            style={{ '--c': t.color } as CSSProperties}
          >
            <span className="team-card__icon" aria-hidden="true">
              {t.icon}
            </span>
            <div className="team-card__body">
              <p className="team-card__name">{t.complete ? t.name : '???'}</p>
              <p className="team-card__dots" aria-label={`${t.found}/${t.size}명 연결`}>
                {Array.from({ length: t.size }, (_, i) => (
                  <i key={i} className={i < t.found ? 'on' : ''} />
                ))}
              </p>
              {t.complete && (
                <p className="team-card__meta">
                  {t.forced ? '시간 종료로 합류' : `${t.rank}등, ${t.seconds}초`}
                </p>
              )}
              {t.complete &&
                (t.mission.decided === null ? (
                  <div className="team-card__mission">
                    <p>{t.mission.prompt}</p>
                    <p className="team-card__tally">
                      {t.mission.a} <b>{t.mission.votesA}</b> : <b>{t.mission.votesB}</b> {t.mission.b}
                    </p>
                  </div>
                ) : (
                  <p className="team-card__mission">
                    {t.mission.decided === 'split'
                      ? '의견이 갈렸어요'
                      : `우리 팀은 ${t.mission.decided === 'a' ? t.mission.a : t.mission.b}!`}
                  </p>
                ))}
            </div>
          </li>
        ))}
      </ul>
      <ul className="ticker" aria-live="polite">
        {view.events
          .slice()
          .reverse()
          .map((e) => (
            <li key={`${e.at}-${e.text}`}>{e.text}</li>
          ))}
      </ul>
    </section>
  );
}

function ScannerSheet({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let scanner: Scanner | null = null;
    let done = false;
    let closed = false;
    const video = videoRef.current;
    if (!video) return;
    void startScanner(
      video,
      (text) => {
        if (done) return;
        const digits = text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
        if (!/\d{4}/.test(digits)) return;
        done = true;
        onCode(digits);
      },
      setError,
    ).then((s) => {
      scanner = s;
      // 카메라가 켜지기 전에 시트를 닫았으면 바로 끈다 (카메라가 켜진 채 남지 않게)
      if (done || closed) s.stop();
    });
    return () => {
      closed = true;
      scanner?.stop();
    };
  }, [onCode]);
  return (
    <Sheet title="QR 스캔" onClose={onClose}>
      <div className="scanner">
        <video ref={videoRef} className="scanner__video" playsInline muted />
        <div className="scanner__frame" aria-hidden="true" />
      </div>
      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <p className="muted">상대 폰의 QR을 네모 안에 맞춰 주세요</p>
      )}
    </Sheet>
  );
}

export function SoundmatePlayer({ view, client, room }: GameProps<SoundmatePlayerView>) {
  useTicker(1000);
  const [showText, setShowText] = useState(false);
  const [sheet, setSheet] = useState<'mine' | 'scan' | null>(null);
  const [manual, setManual] = useState('');
  const fb = view.feedback;

  useEffect(() => {
    if (!fb) return;
    if (fb.kind === 'ok') {
      sfx('ok');
      buzz(60);
    } else if (fb.kind === 'wrong') {
      sfx('fail');
      buzz([40, 40, 40]);
    }
  }, [fb?.at, fb?.kind]);

  useEffect(() => {
    if (view.teamComplete) {
      sfx('win');
      buzz([60, 40, 120]);
      setSheet(null);
    }
  }, [view.teamComplete]);

  // 스캐너가 다시 시작되지 않도록 콜백을 고정한다
  const link = useCallback(
    (code: string) => {
      const digits = code.replace(/\D/g, '');
      if (digits.length < 4) return;
      client.input({ type: 'link', code: digits });
      setManual('');
      setSheet(null);
    },
    [client],
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  if (view.teamComplete) {
    const m = view.mission;
    return (
      <section className="team-done" style={{ '--c': view.teamColor ?? '#ffd93b' } as CSSProperties}>
        <p className="team-done__icon" aria-hidden="true">
          {view.teamIcon}
        </p>
        <Caption className="team-done__name">{view.teamName} 완성!</Caption>
        {view.rank && <p className="team-done__rank">{view.rank}번째로 모였어요</p>}
        {view.teammates && view.teammates.length > 0 && (
          <p className="team-done__mates">{view.teammates.join(', ')}</p>
        )}
        {m && (
          <div className="mission">
            <p className="mission__label">팀 미션: 의견을 하나로 모으세요</p>
            <p className="mission__prompt">{m.prompt}</p>
            {m.decided ? (
              <p className="mission__decided">
                {m.decided === 'split'
                  ? '의견이 갈렸어요. 이유를 서로 물어보세요!'
                  : `우리 팀은 ${m.decided === 'a' ? m.a : m.b}!`}
              </p>
            ) : (
              <div className="mission__choices">
                {(['a', 'b'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`choice ${m.myVote === k ? 'is-on' : ''}`}
                    onClick={() => {
                      client.input({ type: 'vote', choice: k });
                      sfx('tap');
                    }}
                  >
                    <span className="choice__text">{k === 'a' ? m.a : m.b}</span>
                    <span className="choice__count">{k === 'a' ? m.votesA : m.votesB}명</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="sm-player">
      <p className="sm-player__progress">
        <b>{view.groupSize}</b> / {view.teamSize}명 연결됨
      </p>
      <button
        type="button"
        className="sound-btn"
        onPointerDown={() => {
          void unlockAudio().then(() => playAnimal(view.soundId, view.variant));
          buzz(20);
        }}
      >
        <span className="caption sound-btn__label">소리 내기</span>
        <span className="sound-btn__sub">누를 때마다 내 소리가 나요</span>
      </button>
      {showText ? (
        <Caption tone="sun" className="sm-player__text">
          {view.soundText}
        </Caption>
      ) : (
        <button type="button" className="btn btn--quiet" onClick={() => setShowText(true)}>
          소리가 안 나요
        </button>
      )}
      <div className="sm-player__actions">
        <button type="button" className="btn btn--sun" onClick={() => setSheet('mine')}>
          내 QR 보여주기
        </button>
        <button type="button" className="btn btn--soda" onClick={() => setSheet('scan')}>
          QR 스캔하기
        </button>
      </div>
      <form
        className="sm-player__manual"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          link(manual);
        }}
      >
        <input
          className="input"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          placeholder="상대의 숫자 4자리"
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
          aria-label="상대 코드"
        />
        <button type="submit" className="btn" disabled={manual.length < 4}>
          연결
        </button>
      </form>
      <TimerBar
        from={view.searchDeadline - room.settings.soundmateSeconds * 1000}
        to={view.searchDeadline}
        now={client.gameNow()}
        tone="soda"
      />
      {fb && (
        <Toast tone={fb.kind === 'ok' ? 'ok' : fb.kind === 'wrong' ? 'bad' : undefined}>{fb.text}</Toast>
      )}
      {sheet === 'mine' && (
        <Sheet title="내 QR" onClose={closeSheet}>
          <QRImage text={`${QR_PREFIX}${view.myCode}`} label="내 연결 QR" className="qr--sheet" />
          <p className="code-big">{view.myCode}</p>
          <p className="muted">상대가 스캔하거나 숫자를 입력하면 연결돼요</p>
        </Sheet>
      )}
      {sheet === 'scan' && <ScannerSheet onCode={link} onClose={closeSheet} />}
    </section>
  );
}
