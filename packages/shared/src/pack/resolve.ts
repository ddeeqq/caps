import { createRng } from '../util/rng';
import {
  COMMON_QUESTIONS,
  DEFAULT_VAULT_SYMBOLS,
  KEYWORD_PROMPTS,
  PERSON_COMPARE_PROMPTS,
  PERSON_TASTE_PROMPT,
  PRESETS,
} from './presets';
import { distinctPairs, fillTemplate } from './templates';
import type { BalanceQuestion, PackContent, PackOptions, PresetId } from './types';

/** 게임이 실제로 쓰는 팩: 기본값을 채우고 템플릿으로 질문과 기호를 만든 결과 */
export interface ResolvedPack {
  name: string;
  code: string | null;
  preset: PresetId;
  options: PackOptions;
  content: PackContent;
  /** 커스텀 → 템플릿 생성 → 프리셋 기본 순서의 밸런스 질문 */
  balancePool: BalanceQuestion[];
  /** 금고 기호 후보 (최소 12개) */
  vaultSymbols: string[];
}

export interface ResolvePackInput {
  name?: string;
  code?: string | null;
  preset: PresetId;
  content?: Partial<PackContent>;
  options?: Partial<PackOptions>;
}

const MIN_VAULT_SYMBOLS = 12;

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function questionKey(q: BalanceQuestion): string {
  return `${q.prompt}|${q.a}|${q.b}`;
}

export function resolvePack(input: ResolvePackInput, seed = 7): ResolvedPack {
  const preset = PRESETS[input.preset];
  const rng = createRng(seed);
  const names = uniq(input.content?.names ?? []);
  const keywords = uniq(input.content?.keywords ?? []);
  const options: PackOptions = {
    personCompare: input.options?.personCompare ?? preset.personCompare,
  };
  const content: PackContent = {
    names,
    keywords,
    balanceQuestions: input.content?.balanceQuestions ?? [],
    teamNames: uniq(input.content?.teamNames ?? []),
    finaleText: input.content?.finaleText?.trim() || preset.finaleText,
    penalties: input.content?.penalties?.length ? uniq(input.content.penalties) : preset.penalties,
  };

  // 템플릿 질문들을 종류별로 만든 뒤 번갈아 섞는다 (한 종류만 몰리지 않게)
  const keywordQs: BalanceQuestion[] = distinctPairs(keywords, 6, rng).map(([a, b]) => ({
    prompt: rng.pick(KEYWORD_PROMPTS),
    a,
    b,
  }));
  const namesInQuestions = preset.namesUsage === 'all';
  const compareQs: BalanceQuestion[] =
    namesInQuestions && options.personCompare && names.length >= 2
      ? rng.sample(PERSON_COMPARE_PROMPTS, 4).map((prompt) => {
          const [a, b] = rng.sample(names, 2) as [string, string];
          return { prompt, a, b };
        })
      : [];
  const tasteQs: BalanceQuestion[] =
    namesInQuestions && names.length >= 1
      ? rng.sample(names, 3).map((name) => {
          const base = rng.pick(COMMON_QUESTIONS);
          return { prompt: fillTemplate(PERSON_TASTE_PROMPT, { name }), a: base.a, b: base.b };
        })
      : [];
  const generated: BalanceQuestion[] = [];
  const maxLen = Math.max(keywordQs.length, compareQs.length, tasteQs.length);
  for (let i = 0; i < maxLen; i++) {
    for (const list of [keywordQs, compareQs, tasteQs]) {
      const item = list[i];
      if (item) generated.push(item);
    }
  }

  const pool: BalanceQuestion[] = [];
  const seen = new Set<string>();
  for (const q of [...content.balanceQuestions, ...generated, ...rng.shuffle(preset.questions)]) {
    const key = questionKey(q);
    if (seen.has(key) || !q.a || !q.b || q.a === q.b) continue;
    seen.add(key);
    pool.push({ prompt: q.prompt || '하나만 고른다면?', a: q.a, b: q.b });
  }

  const symbolSource = uniq([...(preset.namesUsage === 'none' ? [] : names), ...keywords]);
  const vaultSymbols = [...symbolSource];
  for (const fallback of DEFAULT_VAULT_SYMBOLS) {
    if (vaultSymbols.length >= MIN_VAULT_SYMBOLS) break;
    if (!vaultSymbols.includes(fallback)) vaultSymbols.push(fallback);
  }

  return {
    name: input.name?.trim() || `${preset.label} 기본 팩`,
    code: input.code ?? null,
    preset: input.preset,
    options,
    content,
    balancePool: pool,
    vaultSymbols,
  };
}
