import { logger } from "../../shared/logger";
import { prisma } from "../database/prisma";
import type { PresenceStatus } from "./realtime.schema";

const OFFLINE_GRACE_MS = 30_000;

const PRESENCE_STATUSES = new Set<PresenceStatus>([
  "ONLINE",
  "IDLE",
  "DO_NOT_DISTURB",
  "OFFLINE",
]);

export interface PresenceSnapshot {
  status: PresenceStatus;
  lastSeenAt: string | null;
}

type ChangeListener = (
  userId: string,
  snapshot: PresenceSnapshot,
  guildIds: string[]
) => void;

interface PresenceEntry {
  sockets: Set<string>;
  status: PresenceStatus;
  lastSeenAt: string | null;
  guildIds: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function normalizePresenceStatus(value?: string | null): PresenceStatus {
  const normalized = (value ?? "").toUpperCase() as PresenceStatus;
  return PRESENCE_STATUSES.has(normalized) ? normalized : "OFFLINE";
}

export class PresenceService {
  private entries = new Map<string, PresenceEntry>();
  private listener: ChangeListener | null = null;

  configure(listener: ChangeListener | null) {
    this.listener = listener;
  }

  reset() {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
    this.listener = null;
  }

  resolve(
    userId: string,
    preference: string | null | undefined,
    lastSeenAt: Date | null | undefined
  ): PresenceSnapshot {
    const entry = this.entries.get(userId);
    const preferred = normalizePresenceStatus(preference);
    const hasSockets = (entry?.sockets.size ?? 0) > 0;
    const storedLastSeen = lastSeenAt?.toISOString() ?? null;

    if (preferred === "OFFLINE") {
      return { status: "OFFLINE", lastSeenAt: null };
    }

    if (hasSockets) {
      return { status: preferred, lastSeenAt: null };
    }

    if (entry && entry.status !== "OFFLINE") {
      return {
        status: entry.status,
        lastSeenAt: entry.lastSeenAt ?? storedLastSeen,
      };
    }

    return {
      status: "OFFLINE",
      lastSeenAt: entry?.lastSeenAt ?? storedLastSeen,
    };
  }

  async connect(
    userId: string,
    socketId: string,
    guildIds: string[]
  ): Promise<PresenceSnapshot> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, lastSeenAt: true },
    });
    const preference = normalizePresenceStatus(user?.status);
    const entry = this.entryFor(userId);

    entry.sockets.add(socketId);
    entry.status = preference;
    entry.guildIds = [...new Set([...entry.guildIds, ...guildIds])];
    entry.lastSeenAt =
      user?.lastSeenAt?.toISOString() ?? entry.lastSeenAt ?? null;
    this.clearTimer(entry);

    const snapshot = this.resolve(userId, preference, user?.lastSeenAt);
    this.emit(userId, snapshot, entry.guildIds);
    return snapshot;
  }

  async disconnect(userId: string, socketId: string): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry) return;

    entry.sockets.delete(socketId);
    if (entry.sockets.size > 0) return;

    const now = new Date();
    entry.lastSeenAt = now.toISOString();
    await prisma.user
      .update({ where: { id: userId }, data: { lastSeenAt: now } })
      .catch((err: unknown) => {
        logger.warn({ err, userId }, "Falha ao persistir lastSeenAt");
      });

    this.clearTimer(entry);
    entry.timer = setTimeout(() => {
      this.finalizeOffline(userId);
    }, OFFLINE_GRACE_MS);
    entry.timer.unref?.();
  }

  async setStatus(
    userId: string,
    status: PresenceStatus,
    options: { persist?: boolean } = {}
  ): Promise<PresenceSnapshot> {
    const normalized = normalizePresenceStatus(status);

    if (options.persist !== false) {
      await prisma.user.update({
        where: { id: userId },
        data: { status: normalized },
      });
    }

    const entry = this.entries.get(userId);
    if (entry) {
      entry.status = normalized;
      this.clearTimer(entry);
    }

    const snapshot: PresenceSnapshot =
      entry && entry.sockets.size > 0
        ? { status: normalized, lastSeenAt: null }
        : { status: "OFFLINE", lastSeenAt: entry?.lastSeenAt ?? null };

    this.emit(userId, snapshot, entry?.guildIds ?? []);
    return snapshot;
  }

  async applyStatus(
    userId: string,
    status: string
  ): Promise<PresenceSnapshot> {
    return this.setStatus(userId, normalizePresenceStatus(status), {
      persist: false,
    });
  }

  private finalizeOffline(userId: string): void {
    const entry = this.entries.get(userId);
    if (!entry || entry.sockets.size > 0) return;

    entry.status = "OFFLINE";
    entry.timer = null;
    this.emit(userId, { status: "OFFLINE", lastSeenAt: entry.lastSeenAt }, entry.guildIds);
  }

  private entryFor(userId: string): PresenceEntry {
    const existing = this.entries.get(userId);
    if (existing) return existing;
    const entry: PresenceEntry = {
      sockets: new Set(),
      status: "OFFLINE",
      lastSeenAt: null,
      guildIds: [],
      timer: null,
    };
    this.entries.set(userId, entry);
    return entry;
  }

  private clearTimer(entry: PresenceEntry) {
    if (!entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  private emit(
    userId: string,
    snapshot: PresenceSnapshot,
    guildIds: string[]
  ) {
    if (!this.listener || guildIds.length === 0) return;
    this.listener(userId, snapshot, guildIds);
  }
}

export const presence = new PresenceService();
