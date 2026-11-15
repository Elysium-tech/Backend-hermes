import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../database/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    session: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed_password"),
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn().mockReturnValue("mocked_jwt_token"),
  },
}));

import { prisma } from "../../../database/prisma";
import { registerUseCase } from "./register.use-case";
import { ConflictError } from "../../../@types/errors/conflict-error";

describe("registerUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const input = {
    email: "test@elysium.gg",
    username: "elysium_user",
    displayName: "Elysium User",
    password: "securePassword123",
  };

  it("should create user and session successfully and return token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-123",
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      passwordHash: "hashed_password",
      avatarUrl: null,
      bio: null,
      status: "ONLINE",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    vi.mocked(prisma.session.create).mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      token: "",
      userAgent: "vitest",
      ipAddress: "127.0.0.1",
      expiresAt: new Date(),
      createdAt: new Date(),
    } as any);

    vi.mocked(prisma.session.update).mockResolvedValue({} as any);

    const result = await registerUseCase(input, "vitest", "127.0.0.1");

    expect(result.user.id).toBe("user-123");
    expect(result.user.email).toBe(input.email);
    expect(result.token).toBe("mocked_jwt_token");
    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(prisma.session.create).toHaveBeenCalledOnce();
  });

  it("should throw ConflictError if email is already in use", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "existing-id" } as any);

    await expect(registerUseCase(input)).rejects.toThrow(ConflictError);
  });

  it("should throw ConflictError if username is already in use", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-id" } as any);

    await expect(registerUseCase(input)).rejects.toThrow(ConflictError);
  });
});
