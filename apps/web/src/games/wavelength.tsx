import type { Spectrum, WaveHostView, WaveMate, WavePlayerView } from '@caps/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Caption, TimerBar } from '../components/ui';
import { secondsLeft, useCountdownBeeps, useSoundCue, useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

const POINT_TEXT: Record<number, string> = { 4: '정중앙!', 3: '아깝다!', 2: '근처!', 0: '빗나감' };

/**
 * 눈금 막대. 0(왼쪽) ~ 100(오른쪽).
 * target이 있으면 점수 구역(±4 / ±10 / ±17)을 그리고, needle은 팀 답, marks는 팀원 바늘.
 */
function Dial({
  spectrum,
  target,
  needle,
  marks = [],
  mine,
  onChange,
  size = 'md',
}: {
  spectrum: Spectrum;
  target?: number | null;
  needle?: number | null;
  marks?: Array<{ v: number; color: string; label: string }>;
  mine?: number | null;
  onChange?: (v: number) => void;
  size?: 'md' | 'lg';
}) {
  const band = (half: number) =>
    target === null || target === undefined
      ? undefined
      : ({
          left: `${Math.max(0, target - half)}%`,
          width: `${Math.min(100, target + half) - Math.max(0, target - half)}%`,
        } as CSSProperties);
  return (
    <div className={`dial dial--${size}`}>
      <div className="dial__ends">
        <span>{spectrum.left}</span>
        <span>{spectrum.right}</span>
      </div>
      <div className="dial__track">
        {target !== null && target !== undefined && (
          <>
            <span className="dial__band dial__band--2" style={band(17)} />
            <span className="dial__band dial__band--3" style={band(10)} />
            <span className="dial__band dial__band--4" style={band(4)} />
          </>
        )}
        {marks.map((m) => (
          <span
            key={m.label}
            className="dial__mark"
            style={{ left: `${m.v}%`, background: m.color } as CSSProperties}
            title={m.label}
          />
        ))}
        {needle !== null && needle !== undefined && (
          <span className="dial__needle" style={{ left: `${needle}%` }} aria-hidden="true" />
        )}
        {onChange && (
          <input
            type="range"
            className="dial__input"
            min={0}
            max={100}
            step={1}
            value={mine ?? 50}
            data-unset={mine === null || mine === undefined ? '1' : undefined}
            aria-label={`${spectrum.left}에서 ${spectrum.right} 사이 어디쯤?`}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
      </div>
    </div>
  );
}

export function WaveHost({ view, client, room }: GameProps<WaveHostView>) {
  useTicker(250);
  const now = client.gameNow();
  const shown = view.stage === 'reveal' || view.stage === 'done';
  useCountdownBeeps(view.stage === 'guess' ? view.deadline : null, () => client.gameNow(), { go: null });
  useSoundCue(`${view.round}:${view.stage}`, (_a, b) => (b.endsWith(':reveal') ? 'drumroll' : null));
  const best = shown ? Math.max(...view.tables.map((t) => t.points ?? 0)) : 0;
  useSoundCue(shown ? best : -1, (_a, b) => (b === 4 ? 'fanfare' : b > 0 ? 'win' : null));
  const ranked = [...view.tables].sort((a, b) => b.total - a.total);
  return (
    <section className="wave-host">
      <header className="wave-host__head">
        <p>
          {view.round} / {view.rounds} 라운드
        </p>
        {view.stage === 'guess' && (
          <p>
            남은 시간 <b>{secondsLeft(view.deadline, now)}</b>초
          </p>
        )}
      </header>
      {shown ? (
        <p className="wave-host__spectrum">
          {view.spectrum.left} <span aria-hidden="true">↔</span> {view.spectrum.right}
        </p>
      ) : (
        <Dial spectrum={view.spectrum} size="lg" />
      )}
      <p className="wave-host__how">
        {view.stage === 'guess'
          ? '출제자는 이 사이 어디쯤을 가리킬 무언가를 한마디로! 팀은 바늘을 모아요'
          : shown
            ? '정답 공개'
            : ''}
      </p>
      <ul className="wave-host__tables">
        {view.tables.map((t) => (
          <li key={t.name} className="wave-row" style={{ '--c': t.color } as CSSProperties}>
            <div className="wave-row__name">
              <span className="dot" style={{ background: t.color }} />
              <strong>{t.name}</strong>
              <span className="muted">출제자 {t.psychicName}</span>
            </div>
            {shown ? (
              <div className="wave-row__result">
                <Dial spectrum={view.spectrum} target={t.target} needle={t.needle} />
                <Caption
                  tone={t.points === 4 ? 'sun' : t.points ? 'mint' : 'coral'}
                  className="wave-row__pts"
                >
                  {t.points ? `+${t.points}` : '0'}
                </Caption>
              </div>
            ) : (
              <p className="wave-row__state">
                확정 {t.locked} / {t.guessers}
              </p>
            )}
            <span className="wave-row__total">{t.total}점</span>
          </li>
        ))}
      </ul>
      {view.stage === 'guess' && (
        <TimerBar
          from={view.deadline - room.settings.waveSeconds * 1000}
          to={view.deadline}
          now={now}
          tone="soda"
        />
      )}
      {shown && ranked.length > 1 && (
        <aside className="scoreboard">
          <h2>팀 순위</h2>
          <ol>
            {ranked.map((t) => (
              <li key={t.name} style={{ '--c': t.color } as CSSProperties}>
                <span>{t.name}</span>
                <b>{t.total}</b>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </section>
  );
}

export function WavePlayer({ view, client }: GameProps<WavePlayerView>) {
  useTicker(250);
  const now = client.gameNow();
  // 바늘은 손가락을 따라 바로 움직이고, 서버에는 0.12초마다 한 번만 보낸다
  const [local, setLocal] = useState<number | null>(view.myGuess);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const roundKey = `${view.round}`;
  useEffect(() => {
    setLocal(null);
  }, [roundKey]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const send = (v: number) => {
    setLocal(v);
    pending.current = v;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (pending.current !== null) client.input({ type: 'dial', v: pending.current });
    }, 120);
  };

  const shownKey = useRef('');
  useEffect(() => {
    const k = `${view.round}:${view.stage}`;
    if (shownKey.current === k) return;
    shownKey.current = k;
    if (view.stage === 'reveal' && view.result) {
      if (view.result.points >= 3) sfx('win');
      else if (view.result.points > 0) sfx('ok');
      else sfx('fail');
      buzz(view.result.points ? 30 : [60, 40, 60]);
    }
  }, [view.round, view.stage, view.result]);

  const style = { '--c': view.tableColor } as CSSProperties;
  const marks = (mates: WaveMate[]) =>
    mates.filter((m) => m.v !== null).map((m) => ({ v: m.v!, color: m.color, label: m.nickname }));
  const tag = (
    <p className="wave-player__table">
      <span className="dot" style={{ background: view.tableColor }} />
      {view.tableName} · {view.round}/{view.rounds} 라운드 · {view.total}점
    </p>
  );

  if (!view.seated) {
    return (
      <section className="wave-player">
        <Caption tone="sun">잠깐 구경</Caption>
        <p>다음 라운드부터 팀에 들어가요.</p>
      </section>
    );
  }

  if ((view.stage === 'reveal' || view.stage === 'done') && view.result) {
    const pts = view.result.points;
    return (
      <section className="wave-player" style={style}>
        {tag}
        <Caption tone={pts === 4 ? 'sun' : pts ? 'mint' : 'coral'} className="wave-player__title">
          {POINT_TEXT[pts] ?? ''} {pts ? `+${pts}점` : ''}
        </Caption>
        <Dial spectrum={view.spectrum} target={view.target} needle={view.result.needle} />
        <p className="muted">
          목표와 {view.result.distance}칸 차이 · 지금 우리 팀 {view.rank}등
        </p>
      </section>
    );
  }

  if (view.isPsychic) {
    return (
      <section className="wave-player" style={style}>
        {tag}
        <Caption tone="sun" className="wave-player__title">
          내가 출제자
        </Caption>
        <Dial spectrum={view.spectrum} target={view.target} needle={view.needle} marks={marks(view.mates)} />
        <p className="wave-player__say">
          가운데 진한 칸을 가리킬 <b>무언가</b>를 한마디로 말해 주세요.
          <br />
          <span className="muted">숫자, 손짓, 표정 힌트는 반칙!</span>
        </p>
        <p className="muted">
          팀원 확정 {view.lockedCount} / {view.guessers} · <b>{secondsLeft(view.deadline, now)}초</b>
        </p>
      </section>
    );
  }

  const mine = local ?? view.myGuess;
  return (
    <section className="wave-player" style={style}>
      {tag}
      <p className="wave-player__stage">
        {view.psychicName}님의 한마디를 듣고 바늘을 옮기세요 <b>{secondsLeft(view.deadline, now)}초</b>
      </p>
      <Dial
        spectrum={view.spectrum}
        needle={view.needle}
        marks={marks(view.mates)}
        mine={mine}
        onChange={send}
        size="lg"
      />
      <p className="muted">
        {mine === null ? '막대를 눌러 바늘을 놓으세요. ' : ''}팀원 바늘의 평균(검은 바늘)이 팀의 답이에요
      </p>
      <button
        type="button"
        className={`btn btn--block ${view.locked ? '' : 'btn--primary'}`}
        disabled={mine === null || view.locked}
        onClick={() => {
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = null;
          if (pending.current !== null) client.input({ type: 'dial', v: pending.current });
          pending.current = null;
          client.input({ type: 'lock' });
          sfx('ok');
          buzz(20);
        }}
      >
        {view.locked ? `확정! 기다리는 중 (${view.lockedCount}/${view.guessers})` : '이걸로 확정'}
      </button>
    </section>
  );
}
