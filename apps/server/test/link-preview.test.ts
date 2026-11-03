import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { renderIndex } from '../src/http';
import type { RoomManager } from '../src/room/RoomManager';

const html =
  '<meta property="og:title" content="__TITLE__" /><meta property="og:image" content="__ORIGIN__/og.png" /><meta property="og:url" content="__ORIGIN____PATH__" />';
const req = (path: string, host = 'malmun.onrender.com', proto = 'https') =>
  ({ path, protocol: 'http', headers: { host, 'x-forwarded-proto': proto } }) as unknown as Request;
const manager = {
  get: (code: string) =>
    code.toUpperCase() === 'ABCD'
      ? { code: 'ABCD', phase: 'lobby', pack: { name: '<신입생 OT>' } }
      : undefined,
} as unknown as RoomManager;

describe('링크 미리보기', () => {
  it('절대 주소와 방 이름을 채우고, 이상한 값은 걸러낸다', () => {
    const out = renderIndex(html, req('/play/abcd'), manager);
    expect(out).toContain('content="https://malmun.onrender.com/og.png"');
    expect(out).toContain('content="https://malmun.onrender.com/play/abcd"');
    expect(out).toContain('말문 방 ABCD에 들어와요 (&lt;신입생 OT&gt;)');
    const evil = renderIndex(html, req('/', 'x"><script>', 'https'), manager);
    expect(evil).not.toContain('<script>');
    expect(renderIndex(html, req('/play/ZZZZ'), manager)).toContain('말문 방에 들어와요');
  });
});
