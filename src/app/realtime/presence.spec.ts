import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../database/prisma";
import {
  normalizePresenceStatus,
  PresenceService,
  presence,
  type PresenceSnapshot,
} from "./presence.service";

function mockUser(status: string, lastSeenAt: Date | null = null) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    status,
    lastSeenAt,
  } as any);
}

describe("presence.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    presence.reset();
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);
  });

  it("normaliza status desconhecido para OFFLINE", () => {
    expect(normalizePresenceStatus("online")).toBe("ONLINE");
    expect(normalizePresenceStatus("DO_NOT_DISTURB")).toBe("DO_NOT_DISTURB");
    expect(normalizePresenceStatus("qualquer")).toBe("OFFLINE");
    expect(normalizePresenceStatus(null)).toBe("OFFLINE");
  });

  it("conectar com preferência ONLINE resolve ONLINE e emite para as guilds", async () => {
    mockUser("ONLINE");
    const changes: Array<{ userId: string; snapshot: PresenceSnapshot; guildIds: string[] }> = [];
    presence.configure((userId, snapshot, guildIds) => {
      changes.push({ userId, snapshot, guildIds });
    });

    const snapshot = await presence.connect("user-1", "socket-1", ["g-1"]);

    expect(snapshot).toEqual({ status: "ONLINE", lastSeenAt: null });
    expect(changes).toEqual([
      { userId: "user-1", snapshot: { status: "ONLINE", lastSeenAt: null }, guildIds: ["g-1"] },
    ]);
  });

  it("preferência DO_NOT_DISTURB sobrevive à conexão", async () => {
    mockUser("DO_NOT_DISTURB");
    const snapshot = await presence.connect("user-1", "socket-1", ["g-1"]);
    expect(snapshot.status).toBe("DO_NOT_DISTURB");
  });

  it("preferência OFFLINE fica invisível mesmo conectado e não expõe lastSeenAt", async () => {
    mockUser("OFFLINE", new Date("2026-11-15T10:00:00.000Z"));
    const snapshot = await presence.connect("user-1", "socket-1", ["g-1"]);
    expect(snapshot).toEqual({ status: "OFFLINE", lastSeenAt: null });
  });

  it("duas abas: fechar uma mantém presença e não grava lastSeenAt", async () => {
    mockUser("ONLINE");
    await presence.connect("user-1", "socket-1", ["g-1"]);
    await presence.connect("user-1", "socket-2", ["g-1"]);

    await presence.disconnect("user-1", "socket-1");

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(presence.resolve("user-1", "ONLINE", null).status).toBe("ONLINE");
  });

  it("última desconexão mantém presença na carência e vira OFFLINE depois de 30s", async () => {
    vi.useFakeTimers();
    mockUser("ONLINE");
    const changes: PresenceSnapshot[] = [];
    presence.configure((_userId, snapshot) => changes.push(snapshot));

    await presence.connect("user-1", "socket-1", ["g-1"]);
    changes.length = 0;

    await presence.disconnect("user-1", "socket-1");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastSeenAt: expect.any(Date) },
    });
    expect(presence.resolve("user-1", "ONLINE", null).status).toBe("ONLINE");
    expect(changes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(presence.resolve("user-1", "ONLINE", null).status).toBe("OFFLINE");
    expect(changes).toEqual([
      { status: "OFFLINE", lastSeenAt: expect.any(String) },
    ]);
  });

  it("reconectar dentro da carência cancela o OFFLINE", async () => {
    vi.useFakeTimers();
    mockUser("ONLINE");
    const changes: PresenceSnapshot[] = [];
    presence.configure((_userId, snapshot) => changes.push(snapshot));

    await presence.connect("user-1", "socket-1", ["g-1"]);
    await presence.disconnect("user-1", "socket-1");
    changes.length = 0;

    await vi.advanceTimersByTimeAsync(10_000);
    await presence.connect("user-1", "socket-2", ["g-1"]);
    changes.length = 0;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(changes).toHaveLength(0);
    expect(presence.resolve("user-1", "ONLINE", null).status).toBe("ONLINE");
  });

  it("setStatus persiste, emite e aceita OFFLINE", async () => {
    mockUser("ONLINE");
    const changes: PresenceSnapshot[] = [];
    presence.configure((_userId, snapshot) => changes.push(snapshot));
    await presence.connect("user-1", "socket-1", ["g-1"]);
    changes.length = 0;

    const snapshot = await presence.setStatus("user-1", "DO_NOT_DISTURB");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "DO_NOT_DISTURB" },
    });
    expect(snapshot).toEqual({ status: "DO_NOT_DISTURB", lastSeenAt: null });
    expect(changes).toEqual([
      { status: "DO_NOT_DISTURB", lastSeenAt: null },
    ]);
  });

  it("applyStatus atualiza em memória sem gravar no banco", async () => {
    mockUser("ONLINE");
    await presence.connect("user-1", "socket-1", ["g-1"]);
    vi.mocked(prisma.user.update).mockClear();

    await presence.applyStatus("user-1", "IDLE");

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(presence.resolve("user-1", "IDLE", null).status).toBe("IDLE");
  });

  it("usuário sem socket e sem entrada resolve OFFLINE com lastSeenAt do banco", () => {
    const service = new PresenceService();
    const seen = new Date("2026-11-15T10:00:00.000Z");
    expect(service.resolve("user-1", "ONLINE", seen)).toEqual({
      status: "OFFLINE",
      lastSeenAt: "2026-11-15T10:00:00.000Z",
    });
  });
});
