import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientToServerEvents, ServerToClientEvents } from '@caps/shared';
import { io, type Socket } from 'socket.io-client';
import { createCapsServer, type CapsServer } from '../src/app';
import { JsonStorage } from '../src/storage';
import { createLogger } from '../src/util';

export interface TestServer {
  url: string;
  server: CapsServer;
  storage: JsonStorage;
  dir: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'caps-test-'));
  const storage = new JsonStorage(dir);
  await storage.init();
  const server = createCapsServer({ storage, log: createLogger('warn'), tickMs: 50 });
  const port = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    server,
    storage,
    dir,
    async close() {
      await server.close();
      await new Promise<void>((r) => server.httpServer.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export async function connect(url: string): Promise<TestSocket> {
  const socket: TestSocket = io(url, { path: '/socket.io', transports: ['websocket'], forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

/** ack가 있는 이벤트를 Promise로 */
export function call<E extends keyof ClientToServerEvents>(
  socket: TestSocket,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<Parameters<Extract<Parameters<ClientToServerEvents[E]>[1], (...args: never[]) => unknown>>[0]> {
  return new Promise((resolve) => {
    (socket.emit as (...args: unknown[]) => void)(event, payload, resolve);
  });
}

/** 조건을 만족하는 다음 이벤트를 기다린다 */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: E,
  predicate: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<Parameters<ServerToClientEvents[E]>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`${String(event)} 이벤트를 기다리다 시간 초과`));
    }, timeoutMs);
    const handler = (...args: Parameters<ServerToClientEvents[E]>) => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(args);
    };
    socket.on(event, handler as never);
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch 응답 본문 (테스트에서는 형식을 느슨하게 다룬다) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function body(res: Response | Promise<Response>): Promise<any> {
  return (await res).json();
}
