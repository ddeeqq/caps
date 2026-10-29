import { SHOW_SEGMENTS, showFrame, type CardsectionHostView, type CardsectionPlayerView } from '@caps/shared';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Caption } from '../components/ui';
import { keepScreenOn } from '../lib/device';
import { useAnimationFrame, useCountdownBeeps, useTicker } from '../lib/hooks';
import { buzz, sfx } from '../lib/sound';
import type { GameProps } from './types';

export function CardsectionHost({ view, client }: GameProps<CardsectionHostView>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const seatMap = useMemo(() => {
    const m = new Map<string, (typeof view.seats)[number]>();
    for (const s of view.seats) m.set(`${s.row}:${s.col}`, s);
    return m;
  }, [view.seats]);
  const show = view.stage === 'show' ? view.show : null;
  // 폰들의 3·2·1 깜빡임(연출 첫 3초)에 맞춰 큰 화면이 삐 소리를 낸다
  useCountdownBeeps(show ? show.startAt + (3_000 * show.durationMs) / 40_000 : null, () => client.gameNow());

  // 큰 화면 시뮬레이터: 폰과 똑같은 프레임 함수로 그린다
  useAnimationFrame(() => {
    const grid = gridRef.current;
    if (!show || !grid) return;
    const t = client.gameNow() - show.startAt;
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const row = Number(el.dataset.row);
      const col = Number(el.dataset.col);
      const seat = seatMap.get(`${row}:${col}`);
      const f = showFrame(show, { row, col, teamRank: seat?.teamRank ?? null }, t);
      el.style.background = f.bg;
      el.style.color = f.fg;
      el.style.opacity = seat ? '1' : '0.28';
      el.textContent = f.text;
    }
    if (progressRef.current) {
      const p = Math.max(0, Math.min(1, t / show.durationMs));
      progressRef.current.style.width = `${p * 100}%`;
    }
  }, !!show);

  const cells = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      const seat = seatMap.get(`${r}:${c}`);
      cells.push(
        <div
          key={`${r}:${c}`}
          className={`cs-cell ${seat && !show ? 'is-taken' : ''}`}
          data-row={r}
          data-col={c}
          style={seat && !show ? ({ '--c': seat.color } as CSSProperties) : undefined}
          title={seat?.nickname}
        >
          {!show && seat ? seat.nickname : ''}
        </div>,
      );
    }
  }

  return (
    <section className="cs-host">
      <header className="cs-host__head">
        {show ? (
          <p className="cs-host__label">불을 끄고, 폰을 머리 위로!</p>
        ) : (
          <>
            <Caption tone="sun" className="cs-host__title">
              자리를 눌러 주세요
            </Caption>
            <p className="cs-host__label">
              {view.seatedCount} / {view.playerCount}명이 자리를 잡았어요. 다 모이면 연출 시작!
            </p>
          </>
        )}
      </header>
      <p className="cs-host__front">앞 (큰 화면 쪽)</p>
      <div
        className={`cs-grid ${show ? 'is-show' : ''}`}
        ref={gridRef}
        style={
          {
            gridTemplateColumns: `repeat(${view.cols}, 1fr)`,
            '--rows': view.rows,
            '--cols': view.cols,
          } as CSSProperties
        }
      >
        {cells}
      </div>
      {show && (
        <div className="cs-host__timeline">
          <div className="cs-host__segments">
            {SHOW_SEGMENTS.map((s) => (
              <span key={s.id} style={{ flexGrow: s.to - s.from }}>
                {s.label}
              </span>
            ))}
          </div>
          <div className="cs-host__track">
            <div className="cs-host__fill" ref={progressRef} />
          </div>
        </div>
      )}
    </section>
  );
}

export function CardsectionPlayer({ view, client }: GameProps<CardsectionPlayerView>) {
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const show = view.stage === 'show' || view.stage === 'done' ? view.show : null;
  useTicker(500, view.stage === 'seat');

  useEffect(() => {
    void keepScreenOn();
  }, []);

  useAnimationFrame(() => {
    const el = stageRef.current;
    if (!show || !el) return;
    const t = client.gameNow() - show.startAt;
    const f = showFrame(
      show,
      { row: view.mySeat?.row ?? null, col: view.mySeat?.col ?? null, teamRank: view.teamRank },
      t,
    );
    el.style.background = f.bg;
    el.style.color = f.fg;
    if (textRef.current) {
      textRef.current.textContent = f.text;
      textRef.current.className = `cs-stage__text ${f.small ? 'is-small' : ''}`;
    }
    if (noteRef.current) {
      noteRef.current.textContent =
        t < 0
          ? `${Math.ceil(-t / 1000)}초 뒤 시작! 폰을 머리 위로`
          : t > show.durationMs
            ? '고마워요! 박수!'
            : '';
    }
  }, !!show);

  useEffect(() => {
    if (show) buzz(80);
  }, [show]);

  if (show) {
    return (
      <div className="cs-stage" ref={stageRef} aria-live="off">
        <span className="cs-stage__text" ref={textRef} />
        <p className="cs-stage__note" ref={noteRef} />
      </div>
    );
  }

  const taken = new Set(view.taken.map(([r, c]) => `${r}:${c}`));
  const cells = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      const mine = view.mySeat?.row === r && view.mySeat?.col === c;
      const other = taken.has(`${r}:${c}`);
      cells.push(
        <button
          key={`${r}:${c}`}
          type="button"
          className={`seat ${mine ? 'is-mine' : ''} ${other ? 'is-taken' : ''}`}
          aria-label={`${r + 1}번째 줄 ${c + 1}번째 자리${mine ? ' (내 자리)' : other ? ' (다른 사람)' : ''}`}
          disabled={other}
          onClick={() => {
            client.input({ type: 'seat', row: r, col: c });
            sfx('tap');
          }}
        />,
      );
    }
  }
  return (
    <section className="seat-pick">
      <h2>지금 내 자리를 눌러 주세요</h2>
      <p className="muted">격자는 방을 위에서 본 모습이에요. 위쪽이 큰 화면 쪽이고, 흰 칸이 빈 자리예요</p>
      <p className="seat-pick__front">큰 화면</p>
      <div
        className="seat-grid"
        style={
          {
            gridTemplateColumns: `repeat(${view.cols}, 1fr)`,
            '--cols': view.cols,
            '--rows': view.rows,
          } as CSSProperties
        }
      >
        {cells}
      </div>
      <p className="seat-pick__state">
        {view.mySeat
          ? `${view.mySeat.row + 1}번째 줄, ${view.mySeat.col + 1}번째 자리 선택됨`
          : '아직 자리를 고르지 않았어요'}
      </p>
      <p className="muted">화면 밝기를 최대로 올려 주세요. 연출은 진행자가 시작해요</p>
    </section>
  );
}
