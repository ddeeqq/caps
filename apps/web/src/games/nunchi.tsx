import type { NunchiHostView, NunchiPlayerView } from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Caption } from '../components/ui';
import { useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

const OUTCOME_TITLE = {
  collision: '충돌!',
  last: '끝까지 눈치만 봤다!',
  idle: '아무도 안 눌렀다!',
  empty: '사람이 모자라요',
} as const;

type Tap = NonNullable<NunchiHostView['outcome']>['taps'][number];

/** 0~300ms 눈금 위에 누른 순간을 찍는다. 가까이 붙은 이름표는 층을 올려 겹치지 않게 한다 */
function CollisionTrack({ taps, windowMs }: { taps: Tap[]; windowMs: number }) {
  const MIN_GAP = 16; // 이름표 사이 최소 간격 (%)
  const lastAt: number[] = [];
  const placed = taps.map((t) => {
    const pct = Math.min(100, (t.dt / Math.max(1, windowMs)) * 100);
    let lift = lastAt.findIndex((p) => pct - p >= MIN_GAP);
    if (lift === -1) lift = lastAt.length < 4 ? lastAt.length : 0;
    lastAt[lift] = pct;
    return { ...t, pct, lift };
  });
  const levels = Math.max(...placed.map((p) => p.lift)) + 1;
  return (
    <div className="collision__track" style={{ '--levels': levels } as CSSProperties}>
      {placed.map((t, i) => (
        <span
          key={`${t.nickname}-${i}`}
          className="collision__dot"
          style={{ left: `${t.pct}%`, '--c': t.color, '--i': i, '--lift': t.lift } as CSSProperties}
        >
          <span className="collision__label">
            <b>{t.nickname}</b>
            <i>+{t.dt}ms</i>
          </span>
        </span>
      ))}
    </div>
  );
}

export function NunchiHost({ view, client }: GameProps<NunchiHostView>) {
  useTicker(100, view.stage === 'countdown');
  const now = client.gameNow();
  const outcome = view.outcome;

  let body;
  if (view.stage === 'countdown' && now < view.openAt) {
    body = (
      <div className="nunchi-host__center">
        <Caption tone="sun" className="nunchi-host__count">
          {Math.max(1, Math.ceil((view.openAt - now) / 1000))}
        </Caption>
        <p className="nunchi-host__hint">버튼이 열리면 아무나 1부터!</p>
      </div>
    );
  } else if (view.stage === 'roundEnd' && outcome) {
    body = (
      <div className="nunchi-host__center">
        <Caption tone={outcome.kind === 'collision' ? 'coral' : 'sun'} className="nunchi-host__outcome">
          {OUTCOME_TITLE[outcome.kind]}
        </Caption>
        {outcome.kind === 'collision' && outcome.taps.length >= 2 && (
          <div className="collision">
            <p className="collision__gap">
              {outcome.spreadMs !== null && outcome.spreadMs < 1
                ? '완전히 동시에'
                : `${outcome.spreadMs}ms 차이`}
            </p>
            <CollisionTrack taps={outcome.taps} windowMs={outcome.windowMs} />
            <p className="collision__scale">
              <span>0</span>
              <span>{outcome.windowMs}ms</span>
            </p>
          </div>
        )}
        <ul className="nunchi-host__losers">
          {outcome.losers.map((l) => (
            <li key={l.nickname} style={{ '--c': l.color } as CSSProperties}>
              <strong>{l.nickname}</strong>
              {l.penalty && <span>{l.penalty}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="nunchi-host__center">
        <p className="nunchi-host__label">다음 숫자</p>
        <Caption className="nunchi-host__number">{view.nextNumber}</Caption>
        <ol className="nunchi-host__claims">
          {view.recentClaims.map((c) => (
            <li key={c.number} style={{ '--c': c.color } as CSSProperties}>
              <b>{c.number}</b> {c.nickname}
            </li>
          ))}
        </ol>
        <p className="nunchi-host__progress">
          {view.claimedCount} / {view.participantCount}명 외침
        </p>
      </div>
    );
  }

  return (
    <section className="nunchi-host">
      <p className="nunchi-host__round">
        {view.round} / {view.totalRounds} 라운드
      </p>
      {body}
      {view.scoreboard.length > 0 && (
        <aside className="scoreboard">
          <h2>벌칙 순위</h2>
          <ol>
            {view.scoreboard.map((s) => (
              <li key={s.nickname} style={{ '--c': s.color } as CSSProperties}>
                <span>{s.nickname}</span>
                <b>{s.count}</b>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </section>
  );
}

export function NunchiPlayer({ view, client }: GameProps<NunchiPlayerView>) {
  useTicker(100, view.stage === 'countdown');
  const now = client.gameNow();
  const [tappedRound, setTappedRound] = useState<number | null>(null);
  const announced = useRef<number>(0);
  const open = view.stage === 'open' || (view.stage === 'countdown' && now >= view.openAt);
  const pressed = view.myNumber !== null || view.pending || tappedRound === view.round;

  useEffect(() => {
    if (view.stage !== 'roundEnd' || !view.outcome || announced.current === view.round) return;
    announced.current = view.round;
    if (view.outcome.youLost) {
      sfx('fail');
      buzz([80, 60, 80]);
    } else {
      sfx('ok');
    }
  }, [view.stage, view.outcome, view.round]);

  if (view.stage === 'roundEnd' && view.outcome) {
    const o = view.outcome;
    return o.youLost ? (
      <section className="verdict verdict--lost">
        <Caption tone="coral" className="verdict__title">
          벌칙!
        </Caption>
        <p className="verdict__why">
          {o.kind === 'collision'
            ? `${o.number}번을 같이 눌렀어요${o.spreadMs !== null ? ` (${o.spreadMs}ms 차이)` : ''}`
            : '끝까지 못 눌렀어요'}
        </p>
        {o.penalty && <p className="verdict__penalty">{o.penalty}</p>}
        <p className="verdict__count">누적 벌칙 {view.myPenalties}회</p>
      </section>
    ) : (
      <section className="verdict verdict--safe">
        <Caption tone="mint" className="verdict__title">
          살았다!
        </Caption>
        <p className="verdict__why">벌칙: {o.loserNames.join(', ') || '없음'}</p>
      </section>
    );
  }

  if (!view.isParticipant) {
    return (
      <section className="verdict">
        <p className="verdict__why">다음 라운드부터 함께해요</p>
      </section>
    );
  }

  const onTap = () => {
    if (!open || pressed || !view.canTap) return;
    setTappedRound(view.round);
    client.input({ type: 'tap' });
    sfx('tap');
    buzz(25);
  };

  return (
    <section className="nunchi-player">
      <p className="nunchi-player__round">
        {view.round} / {view.totalRounds} 라운드
      </p>
      <button
        type="button"
        className={`big-tap ${open ? 'is-open' : ''} ${pressed ? 'is-done' : ''}`}
        onPointerDown={onTap}
        disabled={!open || pressed}
        aria-label={pressed ? '눌렀어요' : '누르기'}
      >
        {!open ? (
          <span className="caption caption--sun big-tap__count">
            {Math.max(1, Math.ceil((view.openAt - now) / 1000))}
          </span>
        ) : pressed ? (
          <span className="big-tap__done">{view.myNumber ? `${view.myNumber}번!` : '외쳤다!'}</span>
        ) : (
          <span className="caption big-tap__label">누르기!</span>
        )}
      </button>
      <p className="nunchi-player__hint">
        {!open
          ? '곧 열려요. 눈치 준비!'
          : pressed
            ? '이제 다른 사람들을 지켜보세요'
            : `다음은 ${view.nextNumber}번. 겹치면 벌칙!`}
      </p>
    </section>
  );
}
