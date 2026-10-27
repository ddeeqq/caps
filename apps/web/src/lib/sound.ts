/**
 * 절차적 사운드 (Web Audio). 녹음 파일 없이 오실레이터로 동물 소리와 효과음을 합성한다.
 * 저작권 걱정이 없고, 번들이 가볍고, 팀마다 확실히 구분되는 소리를 만든다.
 * 브라우저는 사용자의 탭 이후에만 소리를 낼 수 있어서 unlockAudio()를 버튼 핸들러에서 부른다.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { a: AudioContext; out: GainNode } | null {
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return { a: ctx, out: master as GainNode };
}

export async function unlockAudio(): Promise<boolean> {
  const au = audio();
  if (!au) return false;
  try {
    if (au.a.state === 'suspended') await au.a.resume();
    // iOS는 무음 버퍼를 한 번 재생해야 오디오가 풀린다
    const buf = au.a.createBuffer(1, 1, 22_050);
    const src = au.a.createBufferSource();
    src.buffer = buf;
    src.connect(au.out);
    src.start(0);
  } catch {
    return false;
  }
  return au.a.state === 'running';
}

export function audioReady(): boolean {
  return ctx?.state === 'running';
}

interface ToneOpts {
  type: OscillatorType;
  f0: number;
  f1?: number;
  t: number;
  dur: number;
  peak?: number;
  attack?: number;
  release?: number;
  vibHz?: number;
  vibDepth?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

function tone(a: AudioContext, out: AudioNode, o: ToneOpts): void {
  const { type, f0, f1 = f0, t, dur, peak = 0.3, attack = 0.015, release = 0.08 } = o;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (o.vibHz) {
    const lfo = a.createOscillator();
    const depth = a.createGain();
    lfo.frequency.value = o.vibHz;
    depth.gain.value = o.vibDepth ?? 10;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + release + 0.05);
  }
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + Math.max(attack, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
  let node: AudioNode = osc;
  if (o.filter) {
    const f = a.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.value = o.filter.freq;
    f.Q.value = o.filter.q ?? 1;
    osc.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + release + 0.05);
}

function noise(a: AudioContext, out: AudioNode, t: number, dur: number, freq: number, peak = 0.3): void {
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

type Voice = (a: AudioContext, out: AudioNode, t: number) => number;

/** 동물 목소리. 반환값 = 길이(초) */
const VOICES: Record<string, Voice> = {
  goat: (a, out, t) => {
    tone(a, out, {
      type: 'sawtooth',
      f0: 520,
      f1: 430,
      t,
      dur: 0.7,
      peak: 0.22,
      vibHz: 28,
      vibDepth: 38,
      filter: { type: 'bandpass', freq: 1300, q: 1.1 },
    });
    return 0.8;
  },
  chicken: (a, out, t) => {
    const notes: Array<[number, number, number]> = [
      [620, 620, 0.08],
      [760, 760, 0.08],
      [900, 900, 0.08],
    ];
    let at = t;
    for (const [f0, f1, d] of notes) {
      tone(a, out, {
        type: 'square',
        f0,
        f1,
        t: at,
        dur: d,
        peak: 0.16,
        release: 0.03,
        filter: { type: 'lowpass', freq: 3000 },
      });
      at += d + 0.035;
    }
    tone(a, out, {
      type: 'square',
      f0: 1180,
      f1: 980,
      t: at,
      dur: 0.45,
      peak: 0.16,
      vibHz: 9,
      vibDepth: 35,
      filter: { type: 'lowpass', freq: 3200 },
    });
    return at - t + 0.55;
  },
  duck: (a, out, t) => {
    for (const k of [0, 0.22]) {
      tone(a, out, {
        type: 'sawtooth',
        f0: 390,
        f1: 290,
        t: t + k,
        dur: 0.13,
        peak: 0.36,
        release: 0.05,
        filter: { type: 'bandpass', freq: 1100, q: 6 },
      });
    }
    return 0.45;
  },
  frog: (a, out, t) => {
    for (const group of [0, 0.36]) {
      for (let k = 0; k < 5; k++) {
        tone(a, out, {
          type: 'square',
          f0: 165,
          f1: 140,
          t: t + group + k * 0.045,
          dur: 0.026,
          peak: 0.32,
          attack: 0.004,
          release: 0.02,
          filter: { type: 'lowpass', freq: 900 },
        });
      }
    }
    return 0.65;
  },
  cat: (a, out, t) => {
    tone(a, out, {
      type: 'triangle',
      f0: 470,
      f1: 830,
      t,
      dur: 0.26,
      peak: 0.3,
      vibHz: 6,
      vibDepth: 12,
      filter: { type: 'bandpass', freq: 1500, q: 1.8 },
    });
    tone(a, out, {
      type: 'triangle',
      f0: 830,
      f1: 540,
      t: t + 0.26,
      dur: 0.36,
      peak: 0.3,
      attack: 0.005,
      vibHz: 6,
      vibDepth: 12,
      filter: { type: 'bandpass', freq: 1400, q: 1.8 },
    });
    return 0.75;
  },
  cow: (a, out, t) => {
    tone(a, out, {
      type: 'sawtooth',
      f0: 150,
      f1: 112,
      t,
      dur: 0.95,
      peak: 0.34,
      attack: 0.08,
      vibHz: 4,
      vibDepth: 4,
      filter: { type: 'lowpass', freq: 700, q: 3 },
    });
    return 1.05;
  },
  dog: (a, out, t) => {
    for (const k of [0, 0.24]) {
      noise(a, out, t + k, 0.07, 1000, 0.25);
      tone(a, out, {
        type: 'square',
        f0: 360,
        f1: 210,
        t: t + k,
        dur: 0.1,
        peak: 0.24,
        release: 0.04,
        filter: { type: 'lowpass', freq: 1800 },
      });
    }
    return 0.42;
  },
  owl: (a, out, t) => {
    tone(a, out, { type: 'sine', f0: 410, f1: 350, t, dur: 0.3, peak: 0.42, attack: 0.06 });
    tone(a, out, { type: 'sine', f0: 390, f1: 330, t: t + 0.44, dur: 0.34, peak: 0.42, attack: 0.06 });
    return 0.85;
  },
};

/** 소리 짝꿍: variant 1은 같은 소리를 빠르게 두 번 */
export function playAnimal(soundId: string, variant = 0): void {
  const au = audio();
  if (!au) return;
  const voice = VOICES[soundId] ?? VOICES.goat!;
  const t = au.a.currentTime + 0.01;
  const dur = voice(au.a, au.out, t);
  if (variant === 1) voice(au.a, au.out, t + dur * 0.8);
}

export type Sfx = 'tap' | 'ok' | 'fail' | 'tick' | 'boom' | 'win' | 'pop';

export function sfx(kind: Sfx): void {
  const au = audio();
  if (!au || au.a.state !== 'running') return;
  const { a, out } = au;
  const t = a.currentTime + 0.005;
  switch (kind) {
    case 'tap':
      tone(a, out, { type: 'sine', f0: 880, t, dur: 0.04, peak: 0.25, release: 0.04 });
      break;
    case 'pop':
      tone(a, out, { type: 'sine', f0: 600, f1: 1200, t, dur: 0.06, peak: 0.2, release: 0.04 });
      break;
    case 'ok':
      tone(a, out, { type: 'triangle', f0: 660, t, dur: 0.09, peak: 0.3 });
      tone(a, out, { type: 'triangle', f0: 990, t: t + 0.1, dur: 0.14, peak: 0.3 });
      break;
    case 'fail':
      tone(a, out, {
        type: 'sawtooth',
        f0: 240,
        f1: 130,
        t,
        dur: 0.32,
        peak: 0.25,
        filter: { type: 'lowpass', freq: 900 },
      });
      break;
    case 'tick':
      tone(a, out, { type: 'square', f0: 1250, t, dur: 0.025, peak: 0.12, release: 0.02 });
      break;
    case 'boom':
      noise(a, out, t, 0.45, 300, 0.5);
      tone(a, out, { type: 'sine', f0: 110, f1: 40, t, dur: 0.4, peak: 0.6 });
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(a, out, { type: 'triangle', f0: f, t: t + i * 0.09, dur: 0.12, peak: 0.28 }),
      );
      break;
  }
}

/** 진동 (안드로이드만 지원, 아이폰은 조용히 무시) */
export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* noop */
  }
}
