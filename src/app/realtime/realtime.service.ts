import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../database/prisma";
import { ApiError } from "../@types/api/api-error";
import { ForbiddenError } from "../@types/errors/forbidden-error";
import { NotFoundError } from "../@types/errors/not-found-error";
import type {
  AddMemberInput,
  CreateChannelInput,
  CreateGuildInput,
} from "./realtime.schema";

export interface AuthContext {
  userId: string;
}

export function toMessageDTO(message: {
  id: string;
  channelId: string;
  authorId: string;
  clientMessageId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author?: { displayName: string; username: string } | null;
}) {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    clientMessageId: message.clientMessageId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    authorDisplayName: message.author?.displayName ?? null,
    authorUsername: message.author?.username ?? null,
  };
}

export type MessageDTO = ReturnType<typeof toMessageDTO>;

export async function assertChannelMembership(
  channelId: string,
  userId: string
) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true },
  });
  if (!channel) {
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

export async function sendChannelMessage(input: {
  channelId: string;
  authorId: string;
  content: string;
  clientMessageId: string;
}): Promise<{ message: MessageDTO; deduplicated: boolean }> {
  await assertChannelMembership(input.channelId, input.authorId);

  try {
    const created = await prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId: input.authorId,
        content: input.content,
        clientMessageId: input.clientMessageId,
      },
      include: {
        author: { select: { displayName: true, username: true } },
      },
    });
    return { message: toMessageDTO(created), deduplicated: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.message.findUnique({
        where: { clientMessageId: input.clientMessageId },
        include: {
          author: { select: { displayName: true, username: true } },
        },
      });
      if (existing) {
        return { message: toMessageDTO(existing), deduplicated: true };
      }
    }
    throw err;
  }
}

export async function listChannelMessages(input: {
  channelId: string;
  userId: string;
  cursor?: string;
  limit?: number;
}): Promise<{ messages: MessageDTO[]; nextCursor: string | null }> {
  await assertChannelMembership(input.channelId, input.userId);

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  let cursorCreatedAt: Date | undefined;
  if (input.cursor) {
    const cursorMsg = await prisma.message.findUnique({
      where: { id: input.cursor },
    });
    if (!cursorMsg || cursorMsg.channelId !== input.channelId) {
      throw new NotFoundError("Cursor inválido");
    }
    cursorCreatedAt = cursorMsg.createdAt;
  }

  const rows = await prisma.message.findMany({
    where: {
      channelId: input.channelId,
      ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: {
      author: { select: { displayName: true, username: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Retorna em ordem cronológica (mais antiga primeiro) para renderização.
  const ordered = [...page].reverse();

  return {
    messages: ordered.map(toMessageDTO),
    nextCursor: hasMore && ordered.length > 0 ? ordered[0].id : null,
  };
}

export async function listGuildsForUser(userId: string) {
  return prisma.guild.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { channels: { some: { members: { some: { userId } } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      iconUrl: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      channels: {
        select: { id: true, name: true, topic: true, type: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createGuild(
  ownerId: string,
  input: CreateGuildInput
) {
  const guild = await prisma.guild.create({
    data: {
      name: input.name,
      description: input.description,
      ownerId,
    },
  });
  const channel = await prisma.channel.create({
    data: {
      guildId: guild.id,
      name: "geral",
      topic: "Canal geral",
    },
  });
  await prisma.channelMember.create({
    data: { channelId: channel.id, userId: ownerId, role: "OWNER" },
  });
  return { guild, defaultChannel: channel };
}

export async function createChannel(
  requesterId: string,
  input: CreateChannelInput
) {
  const guild = await prisma.guild.findUnique({
    where: { id: input.guildId },
  });
  if (!guild) {
    throw new NotFoundError("Servidor não encontrado");
  }
  if (guild.ownerId !== requesterId) {
    throw new ForbiddenError("Apenas o dono pode criar canais");
  }
  const channel = await prisma.channel.create({
    data: {
      guildId: input.guildId,
      name: input.name,
      topic: input.topic,
      type: input.type,
    },
  });
  await prisma.channelMember.upsert({
    where: {
      channelId_userId: { channelId: channel.id, userId: requesterId },
    },
    create: { channelId: channel.id, userId: requesterId, role: "OWNER" },
    update: {},
  });
  return channel;
}

export async function addChannelMember(
  requesterId: string,
  channelId: string,
  input: AddMemberInput
) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { guild: true },
  });
  if (!channel) {
    throw new NotFoundError("Canal não encontrado");
  }
  if (channel.guild.ownerId !== requesterId) {
    throw new ForbiddenError("Apenas o dono pode adicionar membros");
  }
  return prisma.channelMember.upsert({
    where: {
      channelId_userId: { channelId, userId: input.userId },
    },
    create: { channelId, userId: input.userId, role: input.role },
    update: { role: input.role },
  });
}

export interface ChannelMemberDTO {
  userId: string;
  role: string;
  displayName: string;
  username: string;
}

export async function listChannelMembers(
  channelId: string,
  userId: string
): Promise<{ members: ChannelMemberDTO[] }> {
  await assertChannelMembership(channelId, userId);

  const rows = await prisma.channelMember.findMany({
    where: { channelId },
    include: {
      user: { select: { displayName: true, username: true } },
    },
    orderBy: [{ role: "asc" }, { user: { username: "asc" } }],
  });

  return {
    members: rows.map((m) => ({
      userId: m.userId,
      role: m.role,
      displayName: m.user?.displayName ?? "",
      username: m.user?.username ?? "",
    })),
  };
}

/** 410 Gone: convite expirado ou com usos esgotados. */
export class InviteExpiredError extends ApiError {
  constructor(message = "Convite expirado") {
    super(message, 410, "INVITE_EXPIRED");
  }
}

export async function createInvite(
  ownerId: string,
  guildId: string,
  input?: { expiresInHours?: number; maxUses?: number }
) {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) {
    throw new NotFoundError("Servidor não encontrado");
  }
  if (guild.ownerId !== ownerId) {
    throw new ForbiddenError("Apenas o dono pode criar convites");
  }
  const expiresInHours = input?.expiresInHours ?? 168;
  return prisma.invite.create({
    data: {
      token: randomBytes(24).toString("hex"),
      guildId,
      createdById: ownerId,
      expiresAt: new Date(Date.now() + expiresInHours * 3600_000),
      maxUses: input?.maxUses ?? null,
    },
  });
}

export async function getInviteInfo(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { guild: true },
  });
  if (!invite) {
    throw new NotFoundError("Convite não encontrado");
  }
  const members = await prisma.channelMember.groupBy({
    by: ["userId"],
    where: { channel: { guildId: invite.guildId } },
  });
  return {
    id: invite.guild.id,
    name: invite.guild.name,
    description: invite.guild.description,
    iconUrl: invite.guild.iconUrl,
    memberCount: members.length,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export async function acceptInvite(
  userId: string,
  token: string
): Promise<{ guildId: string; firstChannelId: string }> {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    throw new NotFoundError("Convite não encontrado");
  }
  if (invite.expiresAt < new Date()) {
    throw new InviteExpiredError("Convite expirado");
  }
  if (invite.maxUses != null && invite.uses >= invite.maxUses) {
    throw new InviteExpiredError("Convite esgotado");
  }

  const channels = await prisma.channel.findMany({
    where: { guildId: invite.guildId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (channels.length === 0) {
    throw new NotFoundError("Servidor sem canais");
  }

  // Idempotente: upsert com update vazio nunca duplica (@@unique channel+user).
  for (const ch of channels) {
    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId: ch.id, userId } },
      create: { channelId: ch.id, userId, role: "MEMBER" },
      update: {},
    });
  }
  await prisma.invite.update({
    where: { id: invite.id },
    data: { uses: { increment: 1 } },
  });

  return { guildId: invite.guildId, firstChannelId: channels[0].id };
}
