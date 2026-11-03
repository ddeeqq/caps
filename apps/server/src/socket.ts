import {
  DEFAULT_SETTINGS,
  errorAck,
  hostCommandSchema,
  hostCreateSchema,
  playerJoinSchema,
  REACTION_KINDS,
  surveySchema,
  type ClientToServerEvents,
  type ReactionKind,
  type ServerToClientEvents,
} from '@caps/shared';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { packForRoom } from './packs';
import type { Room } from './room/Room';
import type { RoomManager } from './room/RoomManager';
import type { Storage } from './storage';
import { RateLimiter, safeEqual, serverNow, type Logger } from './util';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

const attachSchema = z.object({
  code: z.string().trim().toUpperCase().length(4),
  hostToken: z.string().min(8).max(80),
  role: z.enum(['screen', 'remote']),
});
const remoteLoginSchema = z.object({
  code: z.string().trim().toUpperCase().length(4),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4}$/),
});
const inputSchema = z.object({ input: z.unknown(), at: z.number().optional() });

/** 서버 한 대가 동시에 들고 있을 방 수 상한 (방 만들기 남용으로 메모리가 차는 것을 막는다) */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);

/** ack 콜백이 없거나 잘못 와도 서버가 죽지 않게 */
function replier<T>(ack: unknown): (res: T) => void {
  return typeof ack === 'function' ? (ack as (res: T) => void) : () => undefined;
}

export function registerSocketHandlers(io: IO, manager: RoomManager, storage: Storage, log: Logger): void {
  const detach = (socketId: string) => {
    const binding = manager.unbind(socketId);
    if (!binding) return;
    manager.get(binding.code)?.detachSocket(socketId);
  };

  const attachHost = (socket: Sock, room: Room, role: 'screen' | 'remote') => {
    detach(socket.id);
    if (role === 'screen') room.hostSockets.add(socket.id);
    else room.remoteSockets.add(socket.id);
    manager.bind(socket.id, { code: room.code, role });
    room.touch();
  };

  const playerOf = (socket: Sock) => {
    const b = manager.binding(socket.id);
    if (!b || b.role !== 'player' || !b.playerId) return null;
    const room = manager.get(b.code);
    const rec = room?.players.get(b.playerId);
    return room && rec ? { room, rec } : null;
  };

  io.on('connection', (socket) => {
    const createLimiter = new RateLimiter(5, 60_000);
    const pinLimiter = new RateLimiter(5, 60_000);

    socket.on('clock:ping', (_t0, ack) => {
      if (typeof ack === 'function') ack(serverNow());
    });

    socket.on('host:create', async (payload, ack) => {
      const reply = replier<Parameters<Parameters<ClientToServerEvents['host:create']>[1]>[0]>(ack);
      try {
        if (!createLimiter.allow()) return reply(errorAck('TOO_MANY_TRIES'));
        if (manager.rooms.size >= MAX_ROOMS) return reply(errorAck('SERVER_BUSY'));
        const parsed = hostCreateSchema.safeParse(payload);
        if (!parsed.success) return reply(errorAck('BAD_REQUEST'));
        const pack = await packForRoom(parsed.data, storage);
        if (pack === 'PACK_NOT_FOUND') return reply(errorAck('PACK_NOT_FOUND'));
        const room = manager.createRoom({
          pack,
          flow: parsed.data.flow,
          settings: { ...DEFAULT_SETTINGS, ...parsed.data.settings },
        });
        attachHost(socket, room, 'screen');
        reply({ ok: true, code: room.code, hostToken: room.hostToken, hostPin: room.hostPin });
      } catch (err) {
        log.error('host:create 실패', err);
        reply(errorAck('BAD_REQUEST'));
      }
    });

    socket.on('host:attach', (payload, ack) => {
      const reply = replier<Parameters<Parameters<ClientToServerEvents['host:attach']>[1]>[0]>(ack);
      const parsed = attachSchema.safeParse(payload);
      if (!parsed.success) return reply(errorAck('BAD_REQUEST'));
      const room = manager.get(parsed.data.code);
      if (!room) return reply(errorAck('ROOM_NOT_FOUND'));
      if (!safeEqual(parsed.data.hostToken, room.hostToken)) return reply(errorAck('NOT_HOST'));
      attachHost(socket, room, parsed.data.role);
      reply({ ok: true, hostPin: room.hostPin });
    });

    socket.on('host:remote-login', (payload, ack) => {
      const reply = replier<Parameters<Parameters<ClientToServerEvents['host:remote-login']>[1]>[0]>(ack);
      if (!pinLimiter.allow()) return reply(errorAck('TOO_MANY_TRIES'));
      const parsed = remoteLoginSchema.safeParse(payload);
      if (!parsed.success) return reply(errorAck('BAD_REQUEST'));
      const room = manager.get(parsed.data.code);
      if (!room) return reply(errorAck('ROOM_NOT_FOUND'));
      if (room.pinLocked()) return reply(errorAck('TOO_MANY_TRIES'));
      if (!safeEqual(parsed.data.pin, room.hostPin)) {
        room.recordPinFailure();
        log.warn(`리모컨 PIN 오류 ${room.code}`);
        return reply(errorAck('BAD_PIN'));
      }
      attachHost(socket, room, 'remote');
      reply({ ok: true, hostToken: room.hostToken });
    });

    socket.on('host:command', (cmd, ack) => {
      const reply = replier<{ ok: true } | ReturnType<typeof errorAck>>(ack);
      const b = manager.binding(socket.id);
      if (!b || b.role === 'player') return reply(errorAck('NOT_HOST'));
      const room = manager.get(b.code);
      if (!room) return reply(errorAck('ROOM_NOT_FOUND'));
      const parsed = hostCommandSchema.safeParse(cmd);
      if (!parsed.success) return reply(errorAck('BAD_REQUEST'));
      if (parsed.data.type === 'kick') {
        return reply(manager.kick(room, parsed.data.playerId) ? { ok: true } : errorAck('BAD_REQUEST'));
      }
      const before = room.phase;
      const err = room.command(parsed.data);
      if (err) return reply(errorAck(err));
      if (before !== 'finished' && room.phase === 'finished') manager.scheduleReport(room);
      // 끝난 뒤 소감을 숨기면 저장된 리포트에서도 빠지게 다시 저장한다
      else if (parsed.data.type === 'hideQuote' && room.phase === 'finished') manager.scheduleReport(room);
      log.debug(`명령 ${room.code} ${parsed.data.type} → ${room.phase}`);
      reply({ ok: true });
    });

    socket.on('player:join', (payload, ack) => {
      const reply = replier<Parameters<Parameters<ClientToServerEvents['player:join']>[1]>[0]>(ack);
      const parsed = playerJoinSchema.safeParse(payload);
      if (!parsed.success) return reply(errorAck('BAD_REQUEST'));
      const room = manager.get(parsed.data.code);
      if (!room) return reply(errorAck('ROOM_NOT_FOUND'));
      const token = parsed.data.token;
      let rec = token ? room.playerByToken(token) : undefined;
      detach(socket.id);
      if (!rec) {
        if (token && room.kickedTokens.has(token)) return reply(errorAck('KICKED'));
        if (room.phase === 'finished') return reply(errorAck('ROOM_CLOSED'));
        if (!room.hasCapacity()) return reply(errorAck('ROOM_FULL'));
        const nickname = room.normalizeNickname(parsed.data.nickname);
        if (nickname === 'NICKNAME_BLOCKED') return reply(errorAck('NICKNAME_BLOCKED'));
        rec = room.addPlayer(nickname);
      } else if (rec.socketId && rec.socketId !== socket.id) {
        // 같은 사람이 새 탭·새로고침으로 다시 들어옴 → 예전 연결을 정리하고 이어받는다
        const old = rec.socketId;
        manager.unbind(old);
        io.sockets.sockets.get(old)?.disconnect(true);
      }
      room.attachPlayer(rec, socket.id);
      manager.bind(socket.id, { code: room.code, role: 'player', playerId: rec.id });
      reply({ ok: true, playerId: rec.id, token: rec.token, nickname: rec.nickname });
    });

    socket.on('player:rename', (nickname, ack) => {
      const reply = replier<Parameters<Parameters<ClientToServerEvents['player:rename']>[1]>[0]>(ack);
      const me = playerOf(socket);
      if (!me) return reply(errorAck('ROOM_NOT_FOUND'));
      if (typeof nickname !== 'string') return reply(errorAck('BAD_REQUEST'));
      const result = me.room.rename(me.rec, nickname);
      if (result === 'NICKNAME_BLOCKED') return reply(errorAck('NICKNAME_BLOCKED'));
      reply({ ok: true, nickname: result as string });
    });

    socket.on('player:input', (payload) => {
      const me = playerOf(socket);
      if (!me) return;
      const parsed = inputSchema.safeParse(payload);
      if (!parsed.success) return;
      me.room.input(me.rec.id, parsed.data.input, parsed.data.at);
    });

    socket.on('player:react', (kind) => {
      const me = playerOf(socket);
      if (!me || !REACTION_KINDS.includes(kind as ReactionKind)) return;
      if (!me.rec.reactLimiter.allow()) return;
      me.room.reactions += 1;
      manager.emitReaction(me.room, { kind, color: me.rec.color, nickname: me.rec.nickname });
    });

    socket.on('player:survey', (answer) => {
      const me = playerOf(socket);
      if (!me) return;
      const parsed = surveySchema.safeParse(answer);
      if (!parsed.success) return;
      me.room.survey(me.rec, parsed.data);
      if (me.room.phase === 'finished') manager.scheduleReport(me.room);
    });

    socket.on('disconnect', () => detach(socket.id));
  });
}
