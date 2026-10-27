import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, ServerToClientEvents } from '@caps/shared';
import { Server } from 'socket.io';
import { createHttpApp } from './http';
import { RoomManager } from './room/RoomManager';
import { registerSocketHandlers } from './socket';
import type { Storage } from './storage';
import { createLogger, type Logger } from './util';

export interface CapsServer {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createCapsServer(opts: {
  storage: Storage;
  webDist?: string | null;
  log?: Logger;
  tickMs?: number;
  allowCors?: boolean;
}): CapsServer {
  const log = opts.log ?? createLogger();
  const httpServer = createHttpServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: '/socket.io',
    // 폰이 잠들었을 때 빨리 알아채도록 기본값보다 짧게
    pingInterval: 10_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 64 * 1024,
    ...(opts.allowCors ? { cors: { origin: true } } : {}),
  });
  const manager = new RoomManager(io, opts.storage, log);
  const app = createHttpApp({ storage: opts.storage, manager, log, webDist: opts.webDist ?? null });
  httpServer.on('request', app);
  registerSocketHandlers(io, manager, opts.storage, log);
  manager.start(opts.tickMs ?? 50);

  return {
    httpServer,
    io,
    manager,
    listen(port, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    async close() {
      await manager.stop();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await opts.storage.close();
    },
  };
}
