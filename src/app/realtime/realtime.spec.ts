import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../database/prisma", () => ({
  prisma: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    channel: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    channelMember: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    invite: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    guild: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: vi.fn(), sign: vi.fn() },
}));

import jwt from "jsonwebtoken";
import { prisma } from "../database/prisma";
import { verifySocketToken, registerSocketHandlers } from "./socket";
import {
  sendChannelMessage,
  listChannelMessages,
  listChannelMembers,
  listGuildsForUser,
  createChannel,
  addChannelMember,
  createInvite,
  getInviteInfo,
  acceptInvite,
  InviteExpiredError,
} from "./realtime.service";
import { postMessageBodySchema } from "./realtime.schema";
import {
  createCallRoom,
  roomForCall,
  storeLastSignal,
  getLastSignal,
  getIceServers,
} from "./call.service";
import { env } from "../config";
import { UnauthorizedError } from "../@types/errors/unauthorized-error";
import { ForbiddenError } from "../@types/errors/forbidden-error";
import { NotFoundError } from "../@types/errors/not-found-error";

const TOKEN = "valid.jwt.token";
const baseSession = {
  id: "sess-1",
  userId: "user-1",
  token: TOKEN,
  expiresAt: new Date(Date.now() + 3600_000),
};

function mockVerify(payload: unknown) {
  vi.mocked(jwt.verify).mockReturnValue(payload as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifySocketToken (auth igual auth-middleware)", () => {
  it("aceita Bearer + sessão válida com binding token/sub", async () => {
    mockVerify({ sub: "user-1", sessionId: "sess-1" });
    vi.mocked(prisma.session.findUnique).mockResolvedValue(baseSession as any);
    const auth = await verifySocketToken(`Bearer ${TOKEN}`);
    expect(auth).toEqual({ userId: "user-1", sessionId: "sess-1" });
  });

  it("aceita token puro sem prefixo Bearer", async () => {
    mockVerify({ sub: "user-1", sessionId: "sess-1" });
    vi.mocked(prisma.session.findUnique).mockResolvedValue(baseSession as any);
    const auth = await verifySocketToken(TOKEN);
    expect(auth.userId).toBe("user-1");
  });

  it("rejeita sem token", async () => {
    await expect(verifySocketToken(null)).rejects.toThrow(UnauthorizedError);
  });

  it("rejeita JWT inválido", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error("bad");
    });
    await expect(verifySocketToken(TOKEN)).rejects.toThrow(UnauthorizedError);
  });

  it("rejeita quando token difere do gravado na sessão", async () => {
    mockVerify({ sub: "user-1", sessionId: "sess-1" });
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      ...baseSession,
      token: "outro-token",
    } as any);
    await expect(verifySocketToken(TOKEN)).rejects.toThrow(UnauthorizedError);
  });

  it("rejeita quando sub difere do dono da sessão", async () => {
    mockVerify({ sub: "user-2", sessionId: "sess-1" });
    vi.mocked(prisma.session.findUnique).mockResolvedValue(baseSession as any);
    await expect(verifySocketToken(TOKEN)).rejects.toThrow(UnauthorizedError);
  });
});

describe("sendChannelMessage (idempotência)", () => {
  const now = new Date();
  const row = {
    id: "msg-1",
    channelId: "ch-1",
    authorId: "user-1",
    clientMessageId: "client-1",
    content: "hello",
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("cria mensagem e retorna deduplicated=false", async () => {
    vi.mocked(prisma.message.create).mockResolvedValue(row as any);
    const res = await sendChannelMessage({
      channelId: "ch-1",
      authorId: "user-1",
      content: "hello",
      clientMessageId: "client-1",
    });
    expect(res.deduplicated).toBe(false);
    expect(res.message.id).toBe("msg-1");
  });

  it("P2002 (clientMessageId duplicado) retorna existente com deduplicated=true", async () => {
    vi.mocked(prisma.message.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    vi.mocked(prisma.message.findUnique).mockResolvedValue(row as any);
    const res = await sendChannelMessage({
      channelId: "ch-1",
      authorId: "user-1",
      content: "hello",
      clientMessageId: "client-1",
    });
    expect(res.deduplicated).toBe(true);
    expect(res.message.clientMessageId).toBe("client-1");
  });

  it("bloqueia quem não é membro", async () => {
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    await expect(
      sendChannelMessage({
        channelId: "ch-1",
        authorId: "user-1",
        content: "hello",
        clientMessageId: "client-1",
      })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listChannelMessages (histórico)", () => {
  beforeEach(() => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("bloqueia histórico sem membership", async () => {
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    await expect(
      listChannelMessages({ channelId: "ch-1", userId: "user-1" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("retorna página em ordem cronológica com nextCursor quando há mais", async () => {
    const mk = (id: string, iso: string) => ({
      id,
      channelId: "ch-1",
      authorId: "user-1",
      clientMessageId: `c-${id}`,
      content: id,
      createdAt: new Date(iso),
      updatedAt: new Date(iso),
    });
    // findMany retorna desc; com take limit+1 simulamos 3 linhas p/ limit=2.
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      mk("m3", "2026-10-10T12:03:00Z"),
      mk("m2", "2026-10-10T12:02:00Z"),
      mk("m1", "2026-10-10T12:01:00Z"),
    ] as any);
    const res = await listChannelMessages({
      channelId: "ch-1",
      userId: "user-1",
      limit: 2,
    });
    expect(res.messages.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(res.nextCursor).toBe("m2");
  });
});

describe("guild/channel admin (owner)", () => {
  it("createChannel exige owner da guild", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue({
      id: "g-1",
      ownerId: "owner-1",
    } as any);
    await expect(
      createChannel("intruso", { guildId: "g-1", name: "chat", type: "TEXT" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("addChannelMember exige owner da guild", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({
      id: "ch-1",
      guild: { ownerId: "owner-1" },
    } as any);
    await expect(
      addChannelMember("intruso", "ch-1", { userId: "user-2", role: "MEMBER" })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listGuildsForUser (GET /guilds)", () => {
  it("lista guilds onde user é owner ou membro, ordenado por criação", async () => {
    const rows = [
      { id: "g-1", name: "Arcadium", ownerId: "user-1", channels: [] },
      { id: "g-2", name: "PixelForge", ownerId: "owner-9", channels: [] },
    ];
    vi.mocked(prisma.guild.findMany).mockResolvedValue(rows as any);
    const res = await listGuildsForUser("user-1");
    expect(res).toHaveLength(2);
    expect(prisma.guild.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { ownerId: "user-1" },
            { channels: { some: { members: { some: { userId: "user-1" } } } } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    );
  });
});

describe("postMessageBodySchema (POST /channels/:id/messages)", () => {
  it("aceita corpo válido (mesmas regras do socket)", () => {
    const parsed = postMessageBodySchema.safeParse({
      content: "hello",
      clientMessageId: "client-1",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita conteúdo vazio", () => {
    const parsed = postMessageBodySchema.safeParse({
      content: "",
      clientMessageId: "client-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita conteúdo > 2000 caracteres", () => {
    const parsed = postMessageBodySchema.safeParse({
      content: "x".repeat(2001),
      clientMessageId: "client-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita sem clientMessageId (idempotência obrigatória)", () => {
    const parsed = postMessageBodySchema.safeParse({ content: "hello" });
    expect(parsed.success).toBe(false);
  });

  it("POST reusa sendChannelMessage: duplicado retorna deduplicated=true", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
    const now = new Date();
    const row = {
      id: "msg-1",
      channelId: "ch-1",
      authorId: "user-1",
      clientMessageId: "client-1",
      content: "hello",
      createdAt: now,
      updatedAt: now,
    };
    vi.mocked(prisma.message.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    vi.mocked(prisma.message.findUnique).mockResolvedValue(row as any);
    const body = postMessageBodySchema.parse({
      content: "hello",
      clientMessageId: "client-1",
    });
    // channelId viria de req.params.id na rota:
    const res = await sendChannelMessage({
      channelId: "ch-1",
      authorId: "user-1",
      ...body,
    });
    expect(res.deduplicated).toBe(true);
    expect(res.message.id).toBe("msg-1");
  });
});
describe("registerSocketHandlers (channel:join)", () => {  it("join com membership chama socket.join e ack ok", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
    const handlers: Record<string, Function> = {};
    const socket: any = {
      data: { user: { id: "user-1" } },
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn(),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
    };
    registerSocketHandlers({} as any, socket);
    const ack = vi.fn();
    await handlers["channel:join"]({ channelId: "ch-1" }, ack);
    expect(socket.join).toHaveBeenCalledWith("channel:ch-1");
    expect(ack).toHaveBeenCalledWith({ ok: true, channelId: "ch-1" });
  });

  it("join sem membership responde ack ok:false", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    const handlers: Record<string, Function> = {};
    const socket: any = {
      data: { user: { id: "user-1" } },
      join: vi.fn(),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
    };
    registerSocketHandlers({} as any, socket);
    const ack = vi.fn();
    await handlers["channel:join"]({ channelId: "ch-1" }, ack);
    expect(socket.join).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });
});

describe("message:send ack com clientMessageId", () => {
  function capture() {
    const handlers: Record<string, Function> = {};
    const emit = vi.fn();
    const socket: any = {
      data: { user: { id: "user-1" } },
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit }),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
    };
    const io: any = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) };
    registerSocketHandlers(io, socket);
    return { handlers, socket, io, emit };
  }

  const rowWithAuthor = {
    id: "msg-1",
    channelId: "ch-1",
    authorId: "user-1",
    clientMessageId: "client-1",
    content: "hello",
    createdAt: new Date("2026-10-10T12:00:00Z"),
    updatedAt: new Date("2026-10-10T12:00:00Z"),
    author: { displayName: "Elysium Dev", username: "elysium_dev" },
  };

  beforeEach(() => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("sucesso: ack {ok:true,message,deduplicated,clientMessageId}", async () => {
    vi.mocked(prisma.message.create).mockResolvedValue(rowWithAuthor as any);
    const { handlers } = capture();
    const ack = vi.fn();
    await handlers["message:send"](
      { channelId: "ch-1", content: "hello", clientMessageId: "client-1" },
      ack
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        deduplicated: false,
        clientMessageId: "client-1",
      })
    );
    expect(ack.mock.calls[0][0].message.id).toBe("msg-1");
  });

  it("erro de validação: ack {ok:false,error,clientMessageId}", async () => {
    const { handlers } = capture();
    const ack = vi.fn();
    await handlers["message:send"](
      { channelId: "ch-1", content: "", clientMessageId: "client-9" },
      ack
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, clientMessageId: "client-9" })
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("erro de serviço (sem membership): ack carrega clientMessageId", async () => {
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    const { handlers } = capture();
    const ack = vi.fn();
    await handlers["message:send"](
      { channelId: "ch-1", content: "hello", clientMessageId: "client-7" },
      ack
    );
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, clientMessageId: "client-7" })
    );
  });
});

describe("MessageDTO com autor", () => {
  beforeEach(() => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("sendChannelMessage preenche authorDisplayName/authorUsername", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    vi.mocked(prisma.message.create).mockResolvedValue({
      id: "msg-1",
      channelId: "ch-1",
      authorId: "user-1",
      clientMessageId: "client-1",
      content: "hello",
      createdAt: now,
      updatedAt: now,
      author: { displayName: "Elysium Dev", username: "elysium_dev" },
    } as any);
    const res = await sendChannelMessage({
      channelId: "ch-1",
      authorId: "user-1",
      content: "hello",
      clientMessageId: "client-1",
    });
    expect(res.message.authorDisplayName).toBe("Elysium Dev");
    expect(res.message.authorUsername).toBe("elysium_dev");
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { author: { select: { displayName: true, username: true } } },
      })
    );
  });

  it("listChannelMessages preenche autor de cada mensagem", async () => {
    const mk = (id: string) => ({
      id,
      channelId: "ch-1",
      authorId: "user-1",
      clientMessageId: `c-${id}`,
      content: id,
      createdAt: new Date("2026-10-10T12:00:00Z"),
      updatedAt: new Date("2026-10-10T12:00:00Z"),
      author: { displayName: "Elysium Dev", username: "elysium_dev" },
    });
    vi.mocked(prisma.message.findMany).mockResolvedValue([mk("m1")] as any);
    const res = await listChannelMessages({ channelId: "ch-1", userId: "user-1" });
    expect(res.messages[0].authorDisplayName).toBe("Elysium Dev");
    expect(res.messages[0].authorUsername).toBe("elysium_dev");
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { author: { select: { displayName: true, username: true } } },
      })
    );
  });
});

describe("listChannelMembers (GET /channels/:id/members)", () => {
  beforeEach(() => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("lista com autor (include user + order role/username)", async () => {
    vi.mocked(prisma.channelMember.findMany).mockResolvedValue([
      {
        userId: "user-1",
        role: "OWNER",
        user: { displayName: "Elysium Dev", username: "elysium_dev" },
      },
      {
        userId: "user-2",
        role: "MEMBER",
        user: { displayName: "Ada", username: "ada" },
      },
    ] as any);
    const res = await listChannelMembers("ch-1", "user-1");
    expect(res.members).toEqual([
      { userId: "user-1", role: "OWNER", displayName: "Elysium Dev", username: "elysium_dev" },
      { userId: "user-2", role: "MEMBER", displayName: "Ada", username: "ada" },
    ]);
    expect(prisma.channelMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: "ch-1" },
        include: { user: { select: { displayName: true, username: true } } },
        orderBy: [{ role: "asc" }, { user: { username: "asc" } }],
      })
    );
  });

  it("404 quando canal inexistente", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue(null);
    await expect(listChannelMembers("missing", "user-1")).rejects.toThrow(
      NotFoundError
    );
  });

  it("403 quando não-membro (via assert)", async () => {
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    await expect(listChannelMembers("ch-1", "intruso")).rejects.toThrow(
      ForbiddenError
    );
  });
});

describe("typing relay", () => {  function capture() {
    const handlers: Record<string, Function> = {};
    const emit = vi.fn();
    const socket: any = {
      data: { user: { id: "user-1" } },
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnValue({ emit }),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
    };
    registerSocketHandlers({} as any, socket);
    return { handlers, socket, emit };
  }

  it("membro: repassa typing aos outros sem persistir", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
    const { handlers, socket, emit } = capture();
    const ack = vi.fn();
    await handlers["typing"]({ channelId: "ch-1" }, ack);
    expect(socket.to).toHaveBeenCalledWith("channel:ch-1");
    expect(emit).toHaveBeenCalledWith(
      "typing",
      { channelId: "ch-1", user: "user-1" }
    );
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("não-membro: ack ok:false e nada é emitido", async () => {
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({ id: "ch-1" } as any);
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    const { handlers, emit } = capture();
    const ack = vi.fn();
    await handlers["typing"]({ channelId: "ch-1" }, ack);
    expect(emit).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });
});

describe("convites (Invite)", () => {
  const guild = { id: "g-1", ownerId: "owner-1", name: "Arcadium" };

  it("owner cria convite com token opaco e expiração padrão 168h", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guild as any);
    (vi.mocked(prisma.invite.create) as any).mockImplementation(
      async (args: any) => ({
        id: "inv-1",
        ...args.data,
      })
    );
    const before = Date.now();
    const invite = await createInvite("owner-1", "g-1", {});
    expect(invite.token).toMatch(/^[0-9a-f]{48}$/);
    expect(invite.guildId).toBe("g-1");
    expect(invite.createdById).toBe("owner-1");
    expect(invite.maxUses).toBeNull();
    const ttl = invite.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(167 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(168 * 3600_000 + 1000);
  });

  it("não-owner recebe 403 ao criar", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guild as any);
    await expect(createInvite("intruso", "g-1", {})).rejects.toThrow(
      ForbiddenError
    );
    expect(prisma.invite.create).not.toHaveBeenCalled();
  });

  it("info do convite é pública: guild + memberCount", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue({
      token: "tok",
      guildId: "g-1",
      guild: {
        id: "g-1",
        name: "Arcadium",
        description: "desc",
        iconUrl: null,
      },
    } as any);
    vi.mocked(prisma.channelMember.count).mockResolvedValue(7 as never);
    const info = await getInviteInfo("tok");
    expect(info).toEqual({
      id: "g-1",
      name: "Arcadium",
      description: "desc",
      iconUrl: null,
      memberCount: 7,
    });
  });

  it("accept adiciona em TODOS os canais e retorna guildId + firstChannelId", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      guildId: "g-1",
      expiresAt: new Date(Date.now() + 3600_000),
      maxUses: null,
      uses: 0,
    } as any);
    vi.mocked(prisma.channel.findMany).mockResolvedValue([
      { id: "ch-1" },
      { id: "ch-2" },
    ] as any);
    vi.mocked(prisma.channelMember.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.invite.update).mockResolvedValue({} as any);

    const res = await acceptInvite("user-9", "tok");
    expect(res).toEqual({ guildId: "g-1", firstChannelId: "ch-1" });
    expect(prisma.channelMember.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.channelMember.upsert).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: "ch-1", userId: "user-9" } },
      create: { channelId: "ch-1", userId: "user-9", role: "MEMBER" },
      update: {},
    });
    expect(prisma.invite.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { uses: { increment: 1 } },
    });
  });

  it("accept é idempotente: segundo accept não duplica (só upsert, sem create)", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      guildId: "g-1",
      expiresAt: new Date(Date.now() + 3600_000),
      maxUses: null,
      uses: 1,
    } as any);
    vi.mocked(prisma.channel.findMany).mockResolvedValue([
      { id: "ch-1" },
    ] as any);
    vi.mocked(prisma.channelMember.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.invite.update).mockResolvedValue({} as any);

    const first = await acceptInvite("user-9", "tok");
    const second = await acceptInvite("user-9", "tok");
    expect(first).toEqual(second);
    expect(prisma.channelMember.create).not.toHaveBeenCalled();
  });

  it("expirado retorna 410", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      guildId: "g-1",
      expiresAt: new Date(Date.now() - 1000),
      maxUses: null,
      uses: 0,
    } as any);
    const err = await acceptInvite("user-9", "tok").catch((e) => e);
    expect(err).toBeInstanceOf(InviteExpiredError);
    expect(err.statusCode).toBe(410);
  });

  it("token inválido retorna 404", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue(null);
    await expect(acceptInvite("user-9", "nope")).rejects.toThrow(NotFoundError);
  });

  it("usos esgotados retorna 410", async () => {
    vi.mocked(prisma.invite.findUnique).mockResolvedValue({
      id: "inv-1",
      token: "tok",
      guildId: "g-1",
      expiresAt: new Date(Date.now() + 3600_000),
      maxUses: 2,
      uses: 2,
    } as any);
    const err = await acceptInvite("user-9", "tok").catch((e) => e);
    expect(err).toBeInstanceOf(InviteExpiredError);
    expect(err.statusCode).toBe(410);
    expect(prisma.channelMember.upsert).not.toHaveBeenCalled();
  });
});

describe("call.service (WebRTC signaling)", () => {
  const guildRow = { id: "g-1", ownerId: "owner-1" };
  const channelRow = { id: "ch-1", guildId: "g-1" };
  const memberRow = { id: "m-1", channelId: "ch-1", userId: "user-1" };

  function mockParticipant() {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guildRow as any);
    vi.mocked(prisma.channel.findUnique).mockResolvedValue(
      channelRow as any
    );
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(
      memberRow as any
    );
  }

  it("roomForCall monta call:{guildId}:{channelId}", () => {
    expect(roomForCall("g-1", "ch-1")).toBe("call:g-1:ch-1");
  });

  it("createCallRoom valida membro e faz socket.join na room", async () => {
    mockParticipant();
    const socket = { join: vi.fn().mockResolvedValue(undefined) };
    const identity = await createCallRoom({
      guildId: "g-1",
      channelId: "ch-1",
      userId: "user-1",
      socket,
    });
    expect(socket.join).toHaveBeenCalledWith("call:g-1:ch-1");
    expect(identity).toEqual({
      room: "call:g-1:ch-1",
      guildId: "g-1",
      channelId: "ch-1",
    });
    expect(prisma.channelMember.findUnique).toHaveBeenCalledWith({
      where: { channelId_userId: { channelId: "ch-1", userId: "user-1" } },
    });
  });

  it("createCallRoom: guild inexistente -> NotFoundError", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(null);
    await expect(
      createCallRoom({
        guildId: "g-x",
        channelId: "ch-1",
        userId: "user-1",
        socket: { join: vi.fn() },
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("createCallRoom: canal de outra guild -> NotFoundError", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guildRow as any);
    vi.mocked(prisma.channel.findUnique).mockResolvedValue({
      id: "ch-1",
      guildId: "g-2",
    } as any);
    await expect(
      createCallRoom({
        guildId: "g-1",
        channelId: "ch-1",
        userId: "user-1",
        socket: { join: vi.fn() },
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("createCallRoom: sem ChannelMember -> ForbiddenError e não entra na room", async () => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guildRow as any);
    vi.mocked(prisma.channel.findUnique).mockResolvedValue(
      channelRow as any
    );
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    const socket = { join: vi.fn() };
    await expect(
      createCallRoom({
        guildId: "g-1",
        channelId: "ch-1",
        userId: "user-1",
        socket,
      })
    ).rejects.toThrow(ForbiddenError);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("lastSignal é armazenado por par (from -> to)", () => {
    expect(getLastSignal("user-10", "user-11")).toBeNull();
    const signal = {
      from: "user-10",
      to: "user-11",
      type: "offer",
      data: { sdp: "v=0" },
    };
    storeLastSignal(signal);
    expect(getLastSignal("user-10", "user-11")).toEqual(signal);
    // Par invertido é outro par (sentido do signaling importa).
    expect(getLastSignal("user-11", "user-10")).toBeNull();
  });

  it("getIceServers expõe STUN default via env.STUN_URL e não liga TURN sem URL", () => {
    expect(env.STUN_URL).toBe("stun:stun.l.google.com:19302");
    const servers = getIceServers();
    expect(servers[0]).toEqual({ urls: "stun:stun.l.google.com:19302" });
    expect(servers.every((s) => s.username === undefined)).toBe(true);
  });
});

describe("registerSocketHandlers (call:join/call:signal/call:leave)", () => {
  const guildRow = { id: "g-1", ownerId: "owner-1" };
  const channelRow = { id: "ch-1", guildId: "g-1" };

  function capture() {
    const handlers: Record<string, Function> = {};
    const emit = vi.fn();
    const socket: any = {
      data: { user: { id: "user-1" } },
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
      to: vi.fn().mockReturnValue({ emit }),
      on: (ev: string, fn: Function) => {
        handlers[ev] = fn;
      },
    };
    registerSocketHandlers({} as any, socket);
    return { handlers, socket, emit };
  }

  beforeEach(() => {
    vi.mocked(prisma.guild.findUnique).mockResolvedValue(guildRow as any);
    vi.mocked(prisma.channel.findUnique).mockResolvedValue(
      channelRow as any
    );
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue({
      id: "m-1",
    } as any);
  });

  it("call:join valida participante e entra em call:{guildId}:{channelId}", async () => {
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:join"](
      { guildId: "g-1", channelId: "ch-1", userId: "user-1" },
      ack
    );
    expect(socket.join).toHaveBeenCalledWith("call:g-1:ch-1");
    expect(ack).toHaveBeenCalledWith({
      ok: true,
      room: "call:g-1:ch-1",
      guildId: "g-1",
      channelId: "ch-1",
    });
    expect(socket.data.callRoom).toBe("call:g-1:ch-1");
  });

  it("call:join de não-membro responde ok:false e não entra na room", async () => {
    vi.mocked(prisma.channelMember.findUnique).mockResolvedValue(null);
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:join"](
      { guildId: "g-1", channelId: "ch-1", userId: "user-1" },
      ack
    );
    expect(socket.join).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });

  it("call:join rejeita userId diferente do usuário autenticado", async () => {
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:join"](
      { guildId: "g-1", channelId: "ch-1", userId: "user-2" },
      ack
    );
    expect(socket.join).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });

  it("call:join com payload inválido responde ok:false", async () => {
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:join"]({ guildId: "g-1" }, ack);
    expect(socket.join).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });

  it("call:signal repassa SDP/ICE para a room e guarda lastSignal do par", async () => {
    const { handlers, socket, emit } = capture();
    // call:join prévio define a room ativa do socket.
    await handlers["call:join"](
      { guildId: "g-1", channelId: "ch-1", userId: "user-1" },
      vi.fn()
    );
    const ack = vi.fn();
    const signal = {
      from: "user-1",
      to: "user-2",
      type: "offer",
      data: { sdp: "v=0" },
    };
    await handlers["call:signal"](signal, ack);
    expect(socket.to).toHaveBeenCalledWith("call:g-1:ch-1");
    expect(emit).toHaveBeenCalledWith("call:signal", signal);
    expect(getLastSignal("user-1", "user-2")).toEqual(signal);
    expect(ack).toHaveBeenCalledWith({
      ok: true,
      from: "user-1",
      to: "user-2",
      type: "offer",
    });
  });

  it("call:signal exige from = usuário autenticado", async () => {
    const { handlers, emit } = capture();
    await handlers["call:join"](
      { guildId: "g-1", channelId: "ch-1", userId: "user-1" },
      vi.fn()
    );
    const ack = vi.fn();
    await handlers["call:signal"](
      { from: "user-2", to: "user-1", type: "answer", data: {} },
      ack
    );
    expect(emit).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });

  it("call:signal sem call:join prévio responde ok:false", async () => {
    const { handlers, emit } = capture();
    const ack = vi.fn();
    await handlers["call:signal"](
      { from: "user-1", to: "user-2", type: "candidate", data: {} },
      ack
    );
    expect(emit).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });

  it("call:leave sai da room e responde ok", async () => {
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:leave"]({ room: "call:g-1:ch-1" }, ack);
    expect(socket.leave).toHaveBeenCalledWith("call:g-1:ch-1");
    expect(ack).toHaveBeenCalledWith({ ok: true, room: "call:g-1:ch-1" });
  });

  it("call:leave com payload inválido responde ok:false", async () => {
    const { handlers, socket } = capture();
    const ack = vi.fn();
    await handlers["call:leave"]({}, ack);
    expect(socket.leave).not.toHaveBeenCalled();
    expect(ack.mock.calls[0][0].ok).toBe(false);
  });
});
