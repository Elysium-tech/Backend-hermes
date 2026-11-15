import { prisma } from "../../../database/prisma";
import { NotFoundError } from "../../../@types/errors/not-found-error";
import { presence } from "../../../realtime/presence.service";
import { UpdateProfileInput } from "./update-profile.schema";

export async function updateProfileUseCase(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("Usuário não encontrado");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.bio !== undefined && { bio: input.bio }),
      ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
      ...(input.status !== undefined && { status: input.status }),
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (input.status !== undefined) {
    await presence.applyStatus(userId, updated.status);
  }

  return updated;
}
