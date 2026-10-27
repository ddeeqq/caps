import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { body, startTestServer, type TestServer } from './helpers';

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

const json = (payload: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

describe('HTTP API', () => {
  it('상태 확인과 프리셋 목록', async () => {
    const health = await body(fetch(`${t.url}/api/health`));
    expect(health).toMatchObject({ ok: true, storage: 'json' });
    const presets = await body(fetch(`${t.url}/api/presets`));
    expect(presets.presets.map((p: { id: string }) => p.id)).toEqual(['friends', 'work', 'class']);
    expect(Object.keys(presets.games)).toContain('vault');
    expect(presets.defaultFlow).toEqual(['nunchi', 'soundmate', 'vault', 'cardsection']);
  });

  it('팩을 만들고, 공유 코드로 읽고, 편집 키로만 고칠 수 있다', async () => {
    const input = {
      name: '3팀 회식',
      preset: 'friends',
      content: { names: ['지훈', '민수'], keywords: ['단골집'], finaleText: '3팀 화이팅' },
    };
    const created = await fetch(`${t.url}/api/packs`, json(input));
    expect(created.status).toBe(201);
    const { pack, editKey } = await body(created);
    expect(pack.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(editKey).toBeTruthy();
    expect(pack.content.names).toEqual(['지훈', '민수']);

    const got = await body(fetch(`${t.url}/api/packs/${pack.code.toLowerCase()}`));
    expect(got.pack.name).toBe('3팀 회식');

    const update = { ...input, name: '3팀 회식 2차' };
    const denied = await fetch(`${t.url}/api/packs/${pack.code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-edit-key': 'wrong-key' },
      body: JSON.stringify(update),
    });
    expect(denied.status).toBe(403);
    const ok = await fetch(`${t.url}/api/packs/${pack.code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-edit-key': editKey },
      body: JSON.stringify(update),
    });
    expect(ok.status).toBe(200);
    expect((await body(ok)).pack.name).toBe('3팀 회식 2차');

    expect((await fetch(`${t.url}/api/packs/ZZZZZZ`)).status).toBe(404);
  });

  it('금칙어가 들어간 팩은 거절한다', async () => {
    const res = await fetch(`${t.url}/api/packs`, json({ name: '팩', preset: 'work', content: { keywords: ['시 발'] } }));
    expect(res.status).toBe(400);
    expect((await body(res)).fields).toEqual(['content.keywords.0']);
  });

  it('형식이 틀리면 400', async () => {
    const res = await fetch(`${t.url}/api/packs`, json({ name: '', preset: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('미리보기는 템플릿으로 만든 질문과 금고 기호를 보여준다', async () => {
    const res = await fetch(
      `${t.url}/api/packs/preview`,
      json({ preset: 'friends', content: { names: ['지훈', '민수', '수빈'], keywords: ['단골집', '제주도'] } }),
    );
    const preview = await body(res);
    expect(preview.balancePool.length).toBeGreaterThan(5);
    expect(preview.vaultSymbols).toEqual(expect.arrayContaining(['지훈', '단골집']));
  });

  it('없는 방, 없는 API', async () => {
    expect(await body(fetch(`${t.url}/api/rooms/QQQQ`))).toEqual({ exists: false });
    expect((await fetch(`${t.url}/api/nope`)).status).toBe(404);
  });
});
