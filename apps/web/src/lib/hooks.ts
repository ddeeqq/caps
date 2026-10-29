import { useEffect, useRef, useState } from 'react';
import { sfx, type Sfx } from './sound';

/**
 * 값이 바뀌는 순간 효과음을 낸다 (첫 렌더는 조용히). 큰 화면의 방송 효과음에 쓴다.
 * pick이 null을 돌려주면 그 변화에는 소리를 내지 않는다.
 */
export function useSoundCue<T>(value: T, pick: (prev: T, next: T) => Sfx | null): void {
  const prev = useRef(value);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    const sound = pickRef.current(prev.current, value);
    prev.current = value;
    if (sound) sfx(sound);
  }, [value]);
}

/**
 * target(게임 시계 ms)까지 3, 2, 1 삐 소리와 출발 소리를 낸다. target이 null이면 조용히.
 * 화면 표시(100ms 간격)와 별개로 30ms마다 확인해 박자가 밀리지 않게 한다.
 */
export function useCountdownBeeps(
  target: number | null,
  now: () => number,
  opts: { go?: Sfx | null } = {},
): void {
  const nowRef = useRef(now);
  nowRef.current = now;
  const go = opts.go === undefined ? 'go' : opts.go;
  useEffect(() => {
    if (target === null) return;
    let last = Math.ceil((target - nowRef.current()) / 1000);
    if (last <= 0) return;
    const id = window.setInterval(() => {
      const left = Math.ceil((target - nowRef.current()) / 1000);
      if (left === last) return;
      last = left;
      if (left >= 1 && left <= 3) sfx('count');
      else if (left <= 0) {
        if (go) sfx(go);
        window.clearInterval(id);
      }
    }, 30);
    return () => window.clearInterval(id);
  }, [target, go]);
}

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
