import {
  containsProfanity,
  hashSeed,
  resolvePack,
  type HostCreatePayload,
  type Pack,
  type PackContentInput,
  type PackInput,
  type ResolvedPack,
} from '@caps/shared';
import type { Storage } from './storage';

/** 팩 입력에서 금칙어가 들어간 항목의 위치를 돌려준다 */
export function findProfanity(input: Pick<PackInput, 'name' | 'content'>): string[] {
  const bad: string[] = [];
  const check = (path: string, value: string) => {
    if (containsProfanity(value)) bad.push(path);
  };
  check('name', input.name);
  const c = input.content;
  c.names.forEach((v, i) => check(`content.names.${i}`, v));
  c.keywords.forEach((v, i) => check(`content.keywords.${i}`, v));
  c.teamNames.forEach((v, i) => check(`content.teamNames.${i}`, v));
  c.penalties.forEach((v, i) => check(`content.penalties.${i}`, v));
  c.balanceQuestions.forEach((q, i) => check(`content.balanceQuestions.${i}`, `${q.prompt} ${q.a} ${q.b}`));
  check('content.finaleText', c.finaleText);
  return bad;
}

/** 방을 만들 때 쓸 팩: 저장된 팩 코드가 있으면 그걸, 없으면 빠른 입력 내용을 쓴다 */
export async function packForRoom(
  payload: HostCreatePayload,
  storage: Storage,
  seed: number = Date.now(),
): Promise<ResolvedPack | 'PACK_NOT_FOUND'> {
  if (payload.packCode) {
    const pack: Pack | null = await storage.getPack(payload.packCode.trim().toUpperCase());
    if (!pack) return 'PACK_NOT_FOUND';
    return resolvePack(
      { name: pack.name, code: pack.code, preset: pack.preset, content: pack.content, options: pack.options },
      hashSeed(pack.code, seed),
    );
  }
  const inline = payload.inlinePack ?? {};
  const keep = (xs: string[] | undefined) => (xs ?? []).filter((x) => !containsProfanity(x));
  return resolvePack(
    {
      name: payload.packName,
      code: null,
      preset: payload.preset,
      content: {
        names: keep(inline.names),
        keywords: keep(inline.keywords),
        teamNames: keep(inline.teamNames),
        penalties: keep(inline.penalties),
        finaleText: inline.finaleText && !containsProfanity(inline.finaleText) ? inline.finaleText : '',
        balanceQuestions: (inline.balanceQuestions ?? [])
          .map((q) => ({ prompt: q.prompt || '하나만 고른다면?', a: q.a, b: q.b }))
          .filter((q) => !containsProfanity(`${q.prompt} ${q.a} ${q.b}`)),
      },
      options: payload.personCompare === undefined ? {} : { personCompare: payload.personCompare },
    },
    seed,
  );
}
