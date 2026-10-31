import { z } from "zod";

export const sendMessageSchema = z.object({
  channelId: z.string().min(1, "channelId é obrigatório"),
  content: z
    .string()
    .min(1, "Conteúdo é obrigatório")
    .max(2000, "Conteúdo deve ter no máximo 2000 caracteres"),
  clientMessageId: z.string().min(1, "clientMessageId é obrigatório"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Corpo do POST /channels/:id/messages — mesma validação do socket, channelId vem da URL. */
export const postMessageBodySchema = z.object({
  content: z
    .string()
    .min(1, "Conteúdo é obrigatório")
    .max(2000, "Conteúdo deve ter no máximo 2000 caracteres"),
  clientMessageId: z.string().min(1, "clientMessageId é obrigatório"),
});

export type PostMessageBody = z.infer<typeof postMessageBodySchema>;

export const joinChannelSchema = z.object({
  channelId: z.string().min(1, "channelId é obrigatório"),
});

export const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createGuildSchema = z.object({
  name: z.string().min(2, "Nome deve ter no mínimo 2 caracteres").max(50),
  description: z.string().max(500).optional(),
});

export type CreateGuildInput = z.infer<typeof createGuildSchema>;

export const createChannelSchema = z.object({
  guildId: z.string().min(1, "guildId é obrigatório"),
  name: z.string().min(2, "Nome deve ter no mínimo 2 caracteres").max(50),
  topic: z.string().max(500).optional(),
  type: z.string().default("TEXT"),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const addMemberSchema = z.object({
  userId: z.string().min(1, "userId é obrigatório"),
  role: z.string().default("MEMBER"),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const createInviteSchema = z.object({
  expiresInHours: z.coerce.number().int().positive().default(168),
  maxUses: z.coerce.number().int().positive().optional(),
});

/** WebRTC signaling: entrada na room de call por guild+canal. */
export const callJoinSchema = z.object({
  guildId: z.string().min(1, "guildId é obrigatório"),
  channelId: z.string().min(1, "channelId é obrigatório"),
  userId: z.string().min(1, "userId é obrigatório"),
});

export type CallJoinInput = z.infer<typeof callJoinSchema>;

/** SDP/ICE relay entre peers: offer/answer/candidate. */
export const callSignalSchema = z.object({
  from: z.string().min(1, "from é obrigatório"),
  to: z.string().min(1, "to é obrigatório"),
  type: z.string().min(1, "type é obrigatório"),
  data: z.unknown().optional(),
});

export type CallSignalInput = z.infer<typeof callSignalSchema>;

export const callLeaveSchema = z.object({
  room: z.string().min(1, "room é obrigatório"),
});

export type CallLeaveInput = z.infer<typeof callLeaveSchema>;

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
