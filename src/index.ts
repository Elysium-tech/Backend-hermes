import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./app/config";
import { logger } from "./shared/logger";
import { errorMiddleware } from "./app/middlewares/error-middleware";
import { ApiResponseFactory } from "./app/@types/api/response.factory";
import { NotFoundError } from "./app/@types/errors/not-found-error";
import { authRoutes } from "./app/routes/auth.routes";
import { profileRoutes } from "./app/routes/profile.routes";
import { guildRoutes } from "./app/routes/guild.routes";
import { channelRoutes } from "./app/routes/channel.routes";
import { inviteRoutes } from "./app/routes/invite.routes";
import { rtcRoutes } from "./app/routes/rtc.routes";
import { createRealtimeServer } from "./app/realtime/socket";
import { setupSwagger } from "./swagger/openapi/swagger";

const app = express();
// req.ip confiável atrás de proxy (compose/nginx). Necessário p/ ipAddress da sessão.
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Documentation
setupSwagger(app);

// Public routes
app.use("/auth", authRoutes);

// Private routes
app.use("/profile", profileRoutes);
app.use("/guilds", guildRoutes);
app.use("/channels", channelRoutes);
app.use("/invites", inviteRoutes);
// Config ICE (STUN/TURN) para chamadas WebRTC — público, sem segredos de app.
app.use("/rtc", rtcRoutes);

// 404 no contrato ApiResponse (evita HTML padrão do Express fora do contrato)
app.use((_req, res) => {
  return res
    .status(404)
    .json(ApiResponseFactory.error(new NotFoundError("Rota não encontrada")));
});

app.use(errorMiddleware);

async function bootstrap() {
  const { httpServer } = createRealtimeServer(app);
  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Servidor iniciado (HTTP + Socket.IO)");
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "Falha ao inicializar servidor");
  process.exit(1);
});

process.on("SIGINT", () => {
  logger.info("Encerrando servidor");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Encerrando servidor");
  process.exit(0);
});
