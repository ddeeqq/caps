import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FLOW,
  DEFAULT_SETTINGS,
  GAME_META,
  packInputSchema,
  PRESETS,
  resolvePack,
} from '@caps/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { findProfanity } from './packs';
import type { RoomManager } from './room/RoomManager';
import type { Storage } from './storage';
import { newPackCode, newToken, sha256, type Logger } from './util';

const previewSchema = packInputSchema.extend({
  name: z.string().trim().max(30).optional().default('미리보기'),
});

const issues = (err: z.ZodError) => err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

export function createHttpApp(opts: {
  storage: Storage;
  manager: RoomManager;
  log: Logger;
  webDist?: string | null;
  startedAt?: number;
  /** 세션 리포트 보관 일수 (0 = 무기한). 리포트 화면에 안내한다 */
  retentionDays?: number;
}) {
  const { storage, manager, log } = opts;
  const startedAt = opts.startedAt ?? Date.now();
  const app = express();
  app.disable('x-powered-by');
  // 기본 보안 헤더. 카메라(QR 스캔)와 모션 센서(레이스)는 같은 출처에서만 허용한다
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=(), geolocation=()',
    );
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: manager.rooms.size,
      players: manager.playerCount(),
      storage: storage.kind,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      tickMs: Math.round(manager.stats.lastTickMs * 100) / 100,
    });
  });

  app.get('/api/presets', (_req, res) => {
    res.json({
      presets: Object.values(PRESETS).map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        personCompare: p.personCompare,
        namesUsage: p.namesUsage,
        finaleText: p.finaleText,
        penalties: p.penalties,
      })),
      games: GAME_META,
      defaultFlow: DEFAULT_FLOW,
      defaultSettings: DEFAULT_SETTINGS,
    });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const room = manager.get(String(req.params.code));
    if (!room) return res.json({ exists: false });
    res.json({
      exists: true,
      phase: room.phase,
      packName: room.pack.name,
      playerCount: room.connectedPlayers().length,
    });
  });

  app.post('/api/packs', async (req, res, next) => {
    try {
      const parsed = packInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'BAD_REQUEST', message: '입력을 확인해 주세요', issues: issues(parsed.error) });
      }
      const bad = findProfanity(parsed.data);
      if (bad.length) {
        return res
          .status(400)
          .json({ error: 'PROFANITY', message: '사용할 수 없는 표현이 있어요', fields: bad });
      }
      let code = newPackCode();
      for (let i = 0; i < 20 && (await storage.getPack(code)); i++) code = newPackCode();
      const editKey = newToken(18);
      const pack = await storage.createPack(code, parsed.data, sha256(editKey));
      log.info(`팩 생성 ${code} (${pack.name})`);
      res.status(201).json({ pack, editKey });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/packs/:code', async (req, res, next) => {
    try {
      const pack = await storage.getPack(String(req.params.code).toUpperCase());
      if (!pack)
        return res.status(404).json({ error: 'PACK_NOT_FOUND', message: '그 팩 코드를 찾을 수 없어요' });
      res.json({ pack });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/packs/:code', async (req, res, next) => {
    try {
      const key = req.header('x-edit-key');
      if (!key) return res.status(403).json({ error: 'FORBIDDEN', message: '편집 키가 필요해요' });
      const parsed = packInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'BAD_REQUEST', message: '입력을 확인해 주세요', issues: issues(parsed.error) });
      }
      const bad = findProfanity(parsed.data);
      if (bad.length) {
        return res
          .status(400)
          .json({ error: 'PROFANITY', message: '사용할 수 없는 표현이 있어요', fields: bad });
      }
      const result = await storage.updatePack(
        String(req.params.code).toUpperCase(),
        parsed.data,
        sha256(key),
      );
      if (result === null)
        return res.status(404).json({ error: 'PACK_NOT_FOUND', message: '그 팩 코드를 찾을 수 없어요' });
      if (result === 'forbidden')
        return res.status(403).json({ error: 'FORBIDDEN', message: '편집 키가 맞지 않아요' });
      res.json({ pack: result });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/packs/preview', (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'BAD_REQUEST', message: '입력을 확인해 주세요', issues: issues(parsed.error) });
    }
    const resolved = resolvePack({
      name: parsed.data.name,
      preset: parsed.data.preset,
      content: parsed.data.content,
      options:
        parsed.data.options.personCompare === undefined
          ? {}
          : { personCompare: parsed.data.options.personCompare },
    });
    res.json({
      balancePool: resolved.balancePool.slice(0, 12),
      balanceCount: resolved.balancePool.length,
      vaultSymbols: resolved.vaultSymbols,
      finaleText: resolved.content.finaleText,
      penalties: resolved.content.penalties,
      options: resolved.options,
    });
  });

  app.get('/api/sessions/:id', async (req, res, next) => {
    try {
      const report = await storage.getSession(String(req.params.id));
      if (!report)
        return res
          .status(404)
          .json({ error: 'NOT_FOUND', message: '기록이 없거나 보관 기간이 지나 지워졌어요' });
      res.json({ report, retentionDays: opts.retentionDays ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: '없는 API예요' });
  });

  // 빌드된 웹 앱 (프로덕션). 개발 중에는 Vite 개발 서버가 대신한다.
  const webDist = opts.webDist;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1h',
        // 파일 이름에 내용 해시가 붙은 빌드 결과물은 바뀌지 않으니 오래 캐시한다
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    const indexHtml = readFileSync(path.join(webDist, 'index.html'), 'utf8');
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(renderIndex(indexHtml, req, manager));
    });
    log.info(`웹 앱 제공: ${webDist}`);
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error('HTTP 오류', err);
    res.status(500).json({ error: 'INTERNAL', message: '서버 오류가 났어요' });
  });

  return app;
}

const escapeHtml = (t: string): string =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * index.html의 링크 미리보기 자리(__ORIGIN__, __PATH__, __TITLE__)를 채운다.
 * 카카오톡 미리보기는 절대 주소의 이미지가 필요하다. 호스트 헤더는 모양을 검사해서 쓴다.
 * 방 입장 링크(/play/ABCD)는 "방 ABCD에 들어와요"로 보여 준다.
 */
export function renderIndex(html: string, req: Request, manager: RoomManager): string {
  const fwd = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim();
  const proto = fwd === 'https' || fwd === 'http' ? fwd : req.protocol;
  const host = String(req.headers.host ?? '');
  const origin = /^[\w.-]+(:\d+)?$/.test(host) ? `${proto}://${host}` : '';
  let title = '말문 — 말문이 트이는 20분';
  const m = /^\/play\/([a-z]{4})\/?$/i.exec(req.path);
  if (m) {
    const room = manager.get(m[1]!);
    title =
      room && room.phase !== 'finished'
        ? `말문 방 ${room.code}에 들어와요 (${room.pack.name})`
        : '말문 방에 들어와요';
  }
  const pathOnly = /^[\w\-/.]*$/.test(req.path) ? req.path : '/';
  return html
    .replaceAll('__ORIGIN__', escapeHtml(origin))
    .replaceAll('__PATH__', escapeHtml(pathOnly))
    .replaceAll('__TITLE__', escapeHtml(title));
}
