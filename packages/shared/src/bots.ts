/**
 * 봇의 "머리". 화면 상태(playerView)를 보고 사람이 할 법한 행동을 고른다.
 *
 * 같은 머리를 두 곳에서 쓴다.
 *  - tools의 소켓 봇: 진짜 폰처럼 소켓으로 들어와 부하 테스트·통합 테스트를 한다.
 *  - 서버의 가상 참가자: 진행자가 대기실에서 "봇 채우기"를 누르면 서버 안에서 바로 논다.
 *    (혼자 시연하거나 인원이 모자랄 때)
 *
 * 봇끼리는 BotHub로 "말로 나누는 정보"(같은 소리의 코드, 금고 조각)를 흉내 낸다.
 * 사람은 허브에 정보를 올리지 않으므로 봇이 사람의 정보를 엿보는 일은 없다.
 */
import type { CardsectionPlayerView } from './games/cardsection';
import type { LiarPlayerView } from './games/liar';
import type { MinorityPlayerView } from './games/minority';
import type { NunchiPlayerView } from './games/nunchi';
import type { SoundmatePlayerView } from './games/soundmate';
import type { TiltracePlayerView } from './games/tiltrace';
import { applyRule, VAULT_LEVELS, type VaultPlayerView, type VaultRule } from './games/vault';
import type { WavePlayerView } from './games/wavelength';
import { REACTION_KINDS, type ReactionKind, type RoomPhase, type ViewEnvelope } from './protocol';
import type { SurveyAnswer } from './schemas';

export type BotAction =
  | { type: 'input'; input: unknown }
  | { type: 'survey'; answer: SurveyAnswer }
  | { type: 'react'; kind: ReactionKind };

/** 같은 방 봇들이 공유하는 메모 ("나 염소 소리야, 코드는 1234" 같은 대화의 대용) */
export class BotHub {
  private sounds = new Map<string, Map<string, string>>();
  private vault = new Map<
    string,
    { order?: string[]; table?: Array<{ symbol: string; digit: number }>; rule?: string }
  >();

  registerSound(key: string, playerId: string, code: string): void {
    if (!code) return;
    let m = this.sounds.get(key);
    if (!m) this.sounds.set(key, (m = new Map()));
    m.set(playerId, code);
  }

  sameSound(key: string, me: string): string[] {
    return [...(this.sounds.get(key) ?? new Map<string, string>()).entries()]
      .filter(([id]) => id !== me)
      .map(([, c]) => c);
  }

  otherSounds(key: string): string[] {
    return [...this.sounds.entries()].filter(([k]) => k !== key).flatMap(([, m]) => [...m.values()]);
  }

  vaultInfo(key: string) {
    let v = this.vault.get(key);
    if (!v) this.vault.set(key, (v = {}));
    return v;
  }

  /** 파장 맞추기: 봇 출제자가 "말로 한 힌트" 대신 목표 지점을 남긴다 */
  private hints = new Map<string, number>();

  setHint(key: string, value: number): void {
    this.hints.set(key, value);
  }

  hint(key: string): number | undefined {
    return this.hints.get(key);
  }

  /** 게임이 바뀌면 지난 게임의 메모를 지운다 */
  reset(): void {
    this.sounds.clear();
    this.vault.clear();
    this.hints.clear();
  }
}

export function parseRule(text: string | null | undefined): VaultRule | null {
  if (!text) return null;
  const pos = /(\d+)번째/.exec(text);
  if (text.includes('1을 더해서') && pos) return { kind: 'plus', pos: Number(pos[1]) - 1, text };
  if (text.includes('9에서')) return { kind: 'nineMinus', pos: -1, text };
  if (text.includes('바꿔서')) return { kind: 'swap', text };
  if (text.includes('거꾸로')) return { kind: 'reverse', text };
  return null;
}

export function solveVault(
  order: string[],
  table: Array<{ symbol: string; digit: number }>,
  ruleText?: string,
): string {
  const raw = order.map((sym) => table.find((e) => e.symbol === sym)?.digit ?? 0);
  const rule = parseRule(ruleText);
  if (rule?.kind === 'nineMinus') rule.pos = raw.length - 1;
  return applyRule(raw, rule).join('');
}

export interface BotBrainOptions {
  hub?: BotHub;
  /** 반응 속도 배율 (작을수록 빠름) */
  speed?: number;
  /** 가끔 틀리게 행동 (오답 연결, 틀린 비밀번호) */
  mistakes?: boolean;
  /** 가끔 리액션을 보냄 */
  chatty?: boolean;
  /** 입장·종료 설문에 답함 (서버의 가상 참가자는 효과 측정을 흐리지 않도록 끈다) */
  surveys?: boolean;
  random?: () => number;
  /** 지연 계산용 실제 시각 (ms) */
  clock?: () => number;
}

export interface BotSituation {
  phase: RoomPhase;
  paused: boolean;
  view: ViewEnvelope | null;
  /** 게임 시계 (ms) */
  gameNow: number;
}

/** 봇 한 명의 머리. think()를 0.1초마다 부르면 할 행동 목록을 돌려준다 */
export class BotBrain {
  private memo = new Map<string, number>();
  private counters = { link: 0, tilt: 0 };
  private tilt = 0;
  private readonly speed: number;
  private readonly random: () => number;
  private readonly clock: () => number;

  constructor(
    readonly playerId: string,
    private readonly opts: BotBrainOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    this.random = opts.random ?? Math.random;
    this.clock = opts.clock ?? Date.now;
  }

  /** key마다 한 번 무작위 지연을 정하고, 그 시각이 지나면 true */
  private ready(key: string, minMs: number, maxMs: number): boolean {
    const now = this.clock();
    let at = this.memo.get(key);
    if (at === undefined) {
      at = now + (minMs + this.random() * (maxMs - minMs)) * this.speed;
      this.memo.set(key, at);
    }
    return now >= at;
  }

  private done(key: string, retryAfterMs = Infinity): void {
    this.memo.set(key, retryAfterMs === Infinity ? Infinity : this.clock() + retryAfterMs);
  }

  think(s: BotSituation): BotAction[] {
    const out: BotAction[] = [];
    if (this.opts.surveys !== false) {
      if (s.phase === 'lobby' && !this.memo.has('survey-lobby')) {
        this.memo.set('survey-lobby', 1);
        if (this.random() < 0.8)
          out.push({
            type: 'survey',
            answer: { phase: 'lobby', comfort: 2 + Math.floor(this.random() * 3) },
          });
      }
      if (s.phase === 'finished' && !this.memo.has('survey-end')) {
        this.memo.set('survey-end', 1);
        out.push({
          type: 'survey',
          answer: {
            phase: 'end',
            comfort: 3 + Math.floor(this.random() * 3),
            newPeople: 1 + Math.floor(this.random() * 3),
          },
        });
      }
    }
    if (this.opts.chatty && this.random() < 0.01) {
      out.push({ type: 'react', kind: REACTION_KINDS[Math.floor(this.random() * REACTION_KINDS.length)]! });
    }
    const env = s.view;
    if (!env || env.phase !== 'playing' || s.paused || !env.view) return out;
    const input = this.play(env, s.gameNow);
    if (input !== null) out.push({ type: 'input', input });
    return out;
  }

  private play(env: ViewEnvelope, gameNow: number): unknown | null {
    switch (env.gameId) {
      case 'nunchi':
        return this.nunchi(env.view as NunchiPlayerView, gameNow);
      case 'soundmate':
        return this.soundmate(env.view as SoundmatePlayerView);
      case 'vault':
        return this.vault(env.view as VaultPlayerView, gameNow);
      case 'cardsection':
        return this.cardsection(env.view as CardsectionPlayerView);
      case 'minority':
        return this.minority(env.view as MinorityPlayerView);
      case 'tiltrace':
        return this.tiltrace(env.view as TiltracePlayerView);
      case 'liar':
        return this.liar(env.view as LiarPlayerView);
      case 'wavelength':
        return this.wavelength(env.view as WavePlayerView);
    }
  }

  private nunchi(v: NunchiPlayerView, gameNow: number): unknown | null {
    if (!v.canTap || (v.stage !== 'open' && v.stage !== 'countdown')) return null;
    const key = `nunchi:${v.round}`;
    let plan = this.memo.get(key);
    if (plan === undefined) {
      plan = v.openAt + (250 + this.random() * 5000) * this.speed;
      this.memo.set(key, plan);
    }
    if (gameNow >= plan) {
      this.memo.set(key, Infinity);
      return { type: 'tap' };
    }
    return null;
  }

  private soundmate(v: SoundmatePlayerView): unknown | null {
    const hub = this.opts.hub;
    if (!hub) return null;
    const soundKey = `${v.soundId}:${v.variant}`;
    hub.registerSound(soundKey, this.playerId, v.myCode);
    if (v.stage === 'search' && !v.teamComplete) {
      const key = `sm-link:${this.counters.link}`;
      if (this.ready(key, 700, 2600)) {
        this.counters.link += 1;
        const wrong = this.opts.mistakes !== false && this.random() < 0.15;
        const pool = wrong ? hub.otherSounds(soundKey) : hub.sameSound(soundKey, this.playerId);
        const code = pool[Math.floor(this.random() * pool.length)];
        if (code) return { type: 'link', code };
      }
    }
    const m = v.mission;
    if (m && m.decided === null) {
      if (m.myVote === null && this.ready(`sm-vote:${v.teamName}`, 400, 2000)) {
        return { type: 'vote', choice: this.random() < 0.75 ? 'a' : 'b' };
      }
      if (m.myVote) {
        const other = m.myVote === 'a' ? 'b' : 'a';
        const mine = m.myVote === 'a' ? m.votesA : m.votesB;
        const theirs = other === 'a' ? m.votesA : m.votesB;
        const key = `sm-switch:${v.teamName}:${m.votesA}:${m.votesB}`;
        if (theirs > mine && this.ready(key, 800, 2000)) {
          this.done(key);
          return { type: 'vote', choice: other };
        }
      }
    }
    return null;
  }

  private vault(v: VaultPlayerView, gameNow: number): unknown | null {
    const hub = this.opts.hub;
    if (!hub || v.status !== 'active') return null;
    const key = `${v.teamName}#${v.safeIndex}`;
    const info = hub.vaultInfo(key);
    if (v.order) info.order = v.order;
    if (v.table) info.table = v.table;
    if (v.rule) info.rule = v.rule;
    if (!v.roles.includes('input')) return null;
    const level = VAULT_LEVELS[Math.min(v.level - 1, VAULT_LEVELS.length - 1)];
    if (!info.order || !info.table || (level?.rule && !info.rule)) return null;
    if (gameNow < v.lockedUntil) return null;
    const attemptKey = `vault:${key}:${v.attempts}`;
    if (!this.ready(attemptKey, 1200, 3500)) return null;
    this.done(attemptKey, 4_000);
    const answer = solveVault(info.order, info.table, info.rule);
    const wrongFirst = this.opts.mistakes !== false && v.attempts === 0 && this.random() < 0.25;
    const code = wrongFirst ? `${(Number(answer[0]) + 1) % 10}${answer.slice(1)}` : answer;
    return { type: 'submit', code };
  }

  private cardsection(v: CardsectionPlayerView): unknown | null {
    if (v.stage !== 'seat' || v.mySeat) return null;
    if (!this.ready('seat', 300, 2500)) return null;
    this.done('seat', 2_000);
    const taken = new Set(v.taken.map(([r, c]) => `${r}:${c}`));
    const free: Array<[number, number]> = [];
    for (let r = 0; r < v.rows; r++)
      for (let c = 0; c < v.cols; c++) if (!taken.has(`${r}:${c}`)) free.push([r, c]);
    const pick = free[Math.floor(this.random() * free.length)];
    return pick ? { type: 'seat', row: pick[0], col: pick[1] } : null;
  }

  private minority(v: MinorityPlayerView): unknown | null {
    if (v.stage !== 'talk' && v.stage !== 'vote') return null;
    const choice = this.random() < 0.5 ? 'a' : 'b';
    if (v.alive && !v.myVote && this.ready(`mv:${v.round}`, 200, 1800)) return { type: 'vote', choice };
    if (!v.alive && !v.myPrediction && this.ready(`mp:${v.round}`, 200, 1800))
      return { type: 'predict', choice };
    return null;
  }

  private tiltrace(v: TiltracePlayerView): unknown | null {
    if (v.stage !== 'race' && v.stage !== 'countdown') return null;
    const key = `tilt:${this.counters.tilt}`;
    if (!this.ready(key, 120, 220)) return null;
    this.counters.tilt += 1;
    this.tilt = Math.max(-1, Math.min(1, this.tilt * 0.8 + (this.random() - 0.5) * 0.8 - v.x * 0.3));
    return { type: 'tilt', v: Math.round(this.tilt * 100) / 100 };
  }

  private liar(v: LiarPlayerView): unknown | null {
    if (!v.seated) return null;
    const key = `liar:${v.round}`;
    if (v.stage === 'talk' && !v.ready && this.ready(`${key}:ready`, 3_000, 9_000)) {
      this.done(`${key}:ready`);
      return { type: 'ready' };
    }
    if (v.stage === 'vote' && !v.myVote && this.ready(`${key}:vote`, 800, 4_000)) {
      this.done(`${key}:vote`, 2_000);
      const others = v.order.filter((p) => p.id !== this.playerId);
      const pick = others[Math.floor(this.random() * others.length)];
      return pick ? { type: 'vote', target: pick.id } : null;
    }
    if (v.stage === 'guess' && v.options && !v.myGuess && this.ready(`${key}:guess`, 1_500, 5_000)) {
      this.done(`${key}:guess`, 2_000);
      return { type: 'guess', word: v.options[Math.floor(this.random() * v.options.length)] };
    }
    return null;
  }

  private wavelength(v: WavePlayerView): unknown | null {
    if (!v.seated || v.stage !== 'guess') return null;
    const hub = this.opts.hub;
    const key = `wave:${v.tableName}:${v.round}`;
    if (v.isPsychic) {
      if (v.target !== null) hub?.setHint(key, v.target);
      return null;
    }
    if (v.locked) return null;
    const hint = hub?.hint(key);
    if (v.myGuess === null) {
      if (hint === undefined || !this.ready(`${key}:dial`, 1_000, 4_000)) return null;
      const noise = (this.random() - 0.5) * (this.opts.mistakes === false ? 6 : 30);
      return { type: 'dial', v: Math.max(0, Math.min(100, Math.round(hint + noise))) };
    }
    if (this.ready(`${key}:lock`, 1_000, 3_000)) {
      this.done(`${key}:lock`, 2_000);
      return { type: 'lock' };
    }
    return null;
  }
}
