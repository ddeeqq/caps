import { useEffect, useRef, useState } from 'react';

/** intervalMs마다 다시 그린다 (카운트다운 표시용) */
export function useTicker(intervalMs = 100, active = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return tick;
}

/** 매 프레임 콜백 (카드섹션, 레이스 화면) */
export function useAnimationFrame(callback: (timeMs: number) => void, active = true): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = window.requestAnimationFrame(loop);
    };
    id = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(id);
  }, [active]);
}

export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** 마지막으로 바뀐 뒤 ms가 지나면 false로 돌아오는 플래그 (토스트, 강조 표시) */
export function useFlash<T>(value: T, ms = 1500): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return on;
}
