import { prisma } from "../database/prisma";
import { ForbiddenError } from "../@types/errors/forbidden-error";
import { NotFoundError } from "../@types/errors/not-found-error";
import { env } from "../config";

/** Contrato mínimo de socket necessário para criar/entrar na room de call. */
export interface CallRoomSocket {
  join: (room: string) => Promise<void> | void;
}

export interface CallRoomIdentity {
  room: string;
  guildId: string;
  channelId: string;
}

/** Room de chamada por guild+canal: `call:{guildId}:{channelId}`. */
export function roomForCall(guildId: string, channelId: string): string {
  return `call:${guildId}:${channelId}`;
}

/**
 * Valida que a guild existe, que o canal pertence a ela e que o usuário é
 * ChannelMember do canal. Lança NotFoundError/ForbiddenError.
 */
export async function assertCallParticipant(
  guildId: string,
  channelId: string,
  userId: string
) {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) {
    throw new NotFoundError("Servidor não encontrado");
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, guildId: true },
  });
  if (!channel || channel.guildId !== guildId) {
    throw new NotFoundError("Canal não encontrado");
  }

  const member = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  });
  if (!member) {
    throw new ForbiddenError("Sem acesso a este canal");
  }

  return member;
}

/**
 * Cria/entra na room de call após validar guild/canal/membership.
 * O `socket.join` é feito aqui para o handler ficar só com parse + ack.
 */
export async function createCallRoom(input: {
  guildId: string;
  channelId: string;
  userId: string;
  socket: CallRoomSocket;
}): Promise<CallRoomIdentity> {
  await assertCallParticipant(input.guildId, input.channelId, input.userId);

  const room = roomForCall(input.guildId, input.channelId);
  await input.socket.join(room);

  return { room, guildId: input.guildId, channelId: input.channelId };
}

export interface CallSignal {
  from: string;
  to: string;
  type: string;
  data?: unknown;
}

/** Último sinal trocado por par (from -> to), para retomada/replay. */
const lastSignals = new Map<string, CallSignal>();

function signalKey(from: string, to: string): string {
  return `${from}:${to}`;
}

export function storeLastSignal(signal: CallSignal): void {
  lastSignals.set(signalKey(signal.from, signal.to), signal);
}

export function getLastSignal(from: string, to: string): CallSignal | null {
  return lastSignals.get(signalKey(from, to)) ?? null;
}

/** Remove sinais em que o usuário participa (chamado no call:leave). */
export function clearCallSignals(userId: string): void {
  for (const key of [...lastSignals.keys()]) {
    const [from, to] = key.split(":");
    if (from === userId || to === userId) {
      lastSignals.delete(key);
    }
  }
}

export interface IceServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}

/**
 * STUN padrão (stun:stun.l.google.com:19302) configurável por STUN_URL.
 * TURN fica pronto por env (TURN_URL + credenciais), mas não é usado agora.
 */
export function getIceServers(): IceServerConfig[] {
  const iceServers: IceServerConfig[] = [{ urls: env.STUN_URL }];

  if (env.TURN_URL) {
    iceServers.push({
      urls: env.TURN_URL,
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }

  return iceServers;
}
