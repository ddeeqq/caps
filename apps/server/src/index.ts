import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCapsServer } from './app';
import { createStorage } from './storage';
import { createLogger } from './util';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger();

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(here, '../data'));
// src/ 와 dist/ 둘 다 apps/server 아래라서 같은 상대 경로로 apps/web/dist 를 찾는다
const webDist = path.resolve(process.env.WEB_DIST ?? path.join(here, '../../web/dist'));

async function main() {
  const storage = await createStorage({ databaseUrl: process.env.DATABASE_URL, dataDir });
  log.info(`저장소: ${storage.kind === 'postgres' ? 'PostgreSQL' : `JSON 파일 (${dataDir})`}`);
  const server = createCapsServer({
    storage,
    webDist,
    log,
    allowCors: process.env.NODE_ENV !== 'production',
  });
  await server.restoreRooms();
  const actualPort = await server.listen(port, host);
  log.info(`말문 서버 실행 중 → http://localhost:${actualPort}`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`${signal} 받음, 세션 기록 저장 후 종료합니다`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('서버 시작 실패', err);
  process.exit(1);
});
