import {
  estimateOffset,
  type ClientToServerEvents,
  type ClockEstimate,
  type ClockSample,
  type ServerToClientEvents,
} from '@caps/shared';
import type { Socket } from 'socket.io-client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RECENT_MS = 90_000;

/**
 * 폰 시계를 서버 시계에 맞춘다 (설계서의 시간 동기화 엔진).
 * 입장 직후 핑 10회, 이후 10초마다 3회. 왕복이 짧은 측정 3개의 중앙값을 오프셋으로 쓴다.
 * 시각은 Date.now() 대신 performance.now()(단조 시계)로 잰다.
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private estimate: ClockEstimate | null = null;
  private timer: number | null = null;
  private bursting = false;
  private listening = false;
  private listeners = new Set<() => void>();

  constructor(private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>) {
    this.start();
  }

  /** 화면 복귀 감지를 켠다. stop() 뒤에 다시 연결할 때도 부른다 (StrictMode 이중 마운트 대비) */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** 지금의 서버 시각 (ms). 동기화 전에는 기기 시계로 대신한다 */
  now(): number {
    if (this.estimate) return performance.now() + this.estimate.offset;
    return Date.now();
  }

  get stats(): ClockEstimate | null {
    return this.estimate;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private ping(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve();
      const t0 = performance.now();
      const timeout = window.setTimeout(resolve, 3_000);
      this.socket.emit('clock:ping', t0, (ts) => {
        window.clearTimeout(timeout);
        const t1 = performance.now();
        this.samples.push({ t0, ts, t1 });
        if (this.samples.length > 40) this.samples.shift();
        const recent = this.samples.filter((s) => t1 - s.t1 < RECENT_MS);
        this.estimate = estimateOffset(recent.length >= 3 ? recent : this.samples, 3);
        for (const fn of this.listeners) fn();
        resolve();
      });
    });
  }

  /** 입장 직후·재접속·화면 복귀 때 몰아서 잰다 */
  async burst(count = 10, gapMs = 100): Promise<void> {
    if (this.bursting) return;
    this.bursting = true;
    try {
      for (let i = 0; i < count; i++) {
        await this.ping();
        await sleep(gapMs);
      }
    } finally {
      this.bursting = false;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(async () => {
      for (let i = 0; i < 3; i++) {
        await this.ping();
        await sleep(80);
      }
    }, 10_000);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.burst(5, 80);
  };

  /** 주기 측정과 화면 복귀 감지를 멈춘다 (페이지를 떠날 때 타이머가 남지 않게) */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.listening = false;
    document.removeEventListener('visibilitychange', this.onVisible);
  }
}
