import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * 서버 시각 (ms, epoch 기준, 단조 증가).
 * 시스템 시계가 바뀌어도 거꾸로 가지 않도록 performance 타이머를 쓴다.
 */
export function serverNow(): number {
  return performance.timeOrigin + performance.now();
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O 제외 (1, 0과 헷갈림)
const PACK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newRoomCode = (): string => randomString(ROOM_ALPHABET, 4);
export const newPackCode = (): string => randomString(PACK_ALPHABET, 6);
export const newPin = (): string => String(randomInt(10_000)).padStart(4, '0');
export const newToken = (bytes = 18): string => randomBytes(bytes).toString('base64url');
export const newId = (): string => randomBytes(6).toString('base64url');

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 초당 n회 같은 간단한 속도 제한 */
export class RateLimiter {
  private hits: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  allow(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level: Level = (process.env.LOG_LEVEL as Level) || 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl: Level, msg: string, extra?: unknown) => {
    if (LEVELS[lvl] < min) return;
    const line = `[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}`;
    if (lvl === 'error' || lvl === 'warn') console.error(line, extra ?? '');
    else console.log(line, extra ?? '');
  };
  return {
    debug: (m: string, e?: unknown) => write('debug', m, e),
    info: (m: string, e?: unknown) => write('info', m, e),
    warn: (m: string, e?: unknown) => write('warn', m, e),
    error: (m: string, e?: unknown) => write('error', m, e),
  };
}
export type Logger = ReturnType<typeof createLogger>;
