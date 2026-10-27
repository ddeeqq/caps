import {
  ROLE_LABELS,
  VAULT_LEVELS,
  type VaultHostView,
  type VaultPlayerView,
  type VaultRole,
} from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Caption, TimerBar } from '../components/ui';
import { secondsLeft, useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

const STATUS_TEXT = { active: '푸는 중', solved: '열렸다!', failed: '시간 초과', finished: '끝' } as const;

export function VaultHost({ view, client }: GameProps<VaultHostView>) {
  useTicker(250);
  const now = client.gameNow();
  const ranked = [...view.teams].sort((a, b) => b.solved - a.solved || a.totalMs - b.totalMs);
  return (
    <section className="vault-host">
      <header className="vault-host__head">
        <Caption tone="sun" className="vault-host__title">
          금고 따기
        </Caption>
        <p className="vault-host__sub">화면을 보여주지 말고, 말로 설명하세요</p>
      </header>
      <ul className="vault-host__teams">
        {view.teams.map((t) => {
          const level = VAULT_LEVELS[Math.min(t.safeIndex, VAULT_LEVELS.length - 1)];
          const locked = now < t.lockedUntil;
          return (
            <li key={t.id} className={`vault-row is-${t.status}`} style={{ '--c': t.color } as CSSProperties}>
              <div className="vault-row__name">
                <span className="dot" style={{ background: t.color }} />
                <strong>{t.name}</strong>
                <span className="muted">{t.members}명</span>
              </div>
              <div className="vault-row__safes" aria-label={`금고 ${t.solved}개 열림`}>
                {Array.from({ length: view.safes }, (_, i) => {
                  const r = t.results.find((x) => x.safe === i);
                  const state = r
                    ? r.solved
                      ? 'open'
                      : 'fail'
                    : i === t.safeIndex && t.status === 'active'
                      ? 'now'
                      : 'wait';
                  return <span key={i} className={`safe safe--${state}`} aria-hidden="true" />;
                })}
              </div>
              <div className="vault-row__time">
                {t.status === 'active' ? (
                  <>
                    <TimerBar from={t.deadline - (level?.seconds ?? 60) * 1000} to={t.deadline} now={now} />
                    <span className="vault-row__state">
                      {locked
                        ? `틀림! ${secondsLeft(t.lockedUntil, now)}초 잠김`
                        : `${secondsLeft(t.deadline, now)}초`}
                    </span>
                  </>
                ) : (
                  <span className="vault-row__state">{STATUS_TEXT[t.status]}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <footer className="vault-host__foot">
        <p className="vault-host__lead">
          지금 1등: <strong>{ranked[0]?.name ?? '-'}</strong> ({ranked[0]?.solved ?? 0}개)
        </p>
        <ul className="ticker">
          {view.events
            .slice()
            .reverse()
            .map((e) => (
              <li key={`${e.at}-${e.text}`}>{e.text}</li>
            ))}
        </ul>
      </footer>
    </section>
  );
}

function Keypad({
  digits,
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  digits: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const press = (d: string) => {
    if (disabled || value.length >= digits) return;
    onChange(value + d);
    sfx('tick');
  };
  return (
    <div className="keypad-wrap">
      <div className="slots" aria-label={`입력한 숫자 ${value || '없음'}`}>
        {Array.from({ length: digits }, (_, i) => (
          <span key={i} className={`slot ${value[i] !== undefined ? 'is-filled' : ''}`}>
            {value[i] ?? ''}
          </span>
        ))}
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={disabled}
          aria-label="지우기"
        >
          ⌫
        </button>
        <button type="button" onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button
          type="button"
          className="keypad__open"
          onClick={onSubmit}
          disabled={disabled || value.length !== digits}
        >
          열기
        </button>
      </div>
    </div>
  );
}

/** 꾹 누르는 동안만 보이는 정보 카드 */
function PeekCard({ children, label }: { children: ReactNode; label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className={`peek ${shown ? 'is-shown' : ''}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setShown(true);
        buzz(10);
      }}
      onPointerUp={() => setShown(false)}
      onPointerCancel={() => setShown(false)}
      onLostPointerCapture={() => setShown(false)}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      tabIndex={0}
      aria-label={`${label}: 누르고 있는 동안 보여요`}
      onKeyDown={(e) => e.key === ' ' && setShown(true)}
      onKeyUp={() => setShown(false)}
    >
      {shown ? (
        <div className="peek__content">{children}</div>
      ) : (
        <p className="peek__cover">꾹 누르고 있으면 보여요</p>
      )}
    </div>
  );
}

export function VaultPlayer({ view, client }: GameProps<VaultPlayerView>) {
  useTicker(250);
  const now = client.gameNow();
  const [code, setCode] = useState('');
  const lastStatus = useRef(view.status);
  useEffect(() => setCode(''), [view.safeIndex, view.attempts]);
  useEffect(() => {
    if (lastStatus.current !== view.status) {
      if (view.status === 'solved') {
        sfx('win');
        buzz([50, 30, 120]);
      } else if (view.status === 'failed') sfx('fail');
      lastStatus.current = view.status;
    }
  }, [view.status]);
  useEffect(() => {
    if (view.attempts > 0) {
      sfx('fail');
      buzz([60, 40, 60]);
    }
  }, [view.attempts]);

  const level = VAULT_LEVELS[Math.min(view.safeIndex, VAULT_LEVELS.length - 1)];
  const roles = view.roles;
  const has = (r: VaultRole) => roles.includes(r);

  if (view.status === 'finished' || view.status === 'none') {
    return (
      <section className="verdict">
        <Caption tone="sun" className="verdict__title">
          금고 끝!
        </Caption>
        <p className="verdict__why">우리 팀이 연 금고 {view.solved}개. 큰 화면에서 순위를 확인하세요</p>
      </section>
    );
  }
  if (view.status === 'solved' || view.status === 'failed') {
    return (
      <section className={`verdict ${view.status === 'solved' ? 'verdict--safe' : 'verdict--lost'}`}>
        <Caption tone={view.status === 'solved' ? 'mint' : 'coral'} className="verdict__title">
          {view.status === 'solved' ? '열렸다!' : '시간 초과'}
        </Caption>
        <p className="verdict__why">정답은 {view.reveal}</p>
        <p className="muted">
          {view.safeIndex + 1 < view.safes ? '곧 다음 금고, 역할이 바뀌어요' : '마지막 금고였어요'}
        </p>
      </section>
    );
  }

  const locked = now < view.lockedUntil;
  return (
    <section className="vault-player" style={{ '--c': view.teamColor } as CSSProperties}>
      <header className="vault-player__head">
        <span className="vault-player__team">
          <span className="dot" style={{ background: view.teamColor }} />
          {view.teamName}
        </span>
        <span>
          금고 {view.safeIndex + 1} / {view.safes}
        </span>
        <span className="vault-player__time">{secondsLeft(view.deadline, now)}초</span>
      </header>
      <TimerBar from={view.deadline - (level?.seconds ?? 60) * 1000} to={view.deadline} now={now} />
      <p className="vault-player__roles">
        {roles.map((r) => (
          <span key={r} className="role-chip">
            {ROLE_LABELS[r]}
          </span>
        ))}
      </p>

      {(has('order') || has('decode') || has('rule') || has('checksum')) && (
        <PeekCard label="내 정보">
          {has('order') && view.order && (
            <div className="peek__block">
              <p className="peek__title">이 순서대로</p>
              <ol className="seq">
                {view.order.map((s, i) => (
                  <li key={`${s}-${i}`}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {has('decode') && view.table && (
            <div className="peek__block">
              <p className="peek__title">기호 → 숫자</p>
              <ul className="table">
                {view.table.map((e) => (
                  <li key={e.symbol}>
                    <span>{e.symbol}</span>
                    <b>{e.digit}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {has('rule') && view.rule && (
            <div className="peek__block">
              <p className="peek__title">규칙 카드</p>
              <p className="peek__rule">{view.rule}</p>
            </div>
          )}
          {has('checksum') && view.checksum !== null && (
            <div className="peek__block">
              <p className="peek__title">검산</p>
              <p className="peek__rule">정답 숫자를 모두 더하면 {view.checksum}</p>
            </div>
          )}
        </PeekCard>
      )}

      {has('input') && (
        <>
          <Keypad
            digits={view.digits}
            value={code}
            onChange={setCode}
            disabled={locked}
            onSubmit={() => {
              client.input({ type: 'submit', code });
              sfx('tap');
            }}
          />
          {locked && <p className="error-text">틀렸어요. {secondsLeft(view.lockedUntil, now)}초 뒤에 다시</p>}
          {!locked && view.lastWrong && <p className="muted">{view.lastWrong}은(는) 아니었어요</p>}
        </>
      )}

      <ul className="roster">
        {view.roster.map((m) => (
          <li key={m.nickname} className={m.me ? 'is-me' : ''}>
            <span>{m.me ? '나' : m.nickname}</span>
            <span className="muted">{m.roles.map((r) => ROLE_LABELS[r]).join(', ') || '응원'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
