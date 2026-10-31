import { Router, type Request, type Response, type NextFunction } from "express";
import { ApiResponseFactory } from "../@types/api/response.factory";
import { getIceServers } from "../realtime/call.service";

export const rtcRoutes = Router();

/**
 * GET /rtc/ice — configuração ICE (STUN/TURN) para o cliente WebRTC.
 * Público por design: não guarda segredo no servidor; as credenciais TURN
 * são entregues ao cliente para o handshake ICE. TURN só aparece se
 * TURN_URL estiver configurado no env.
 */
rtcRoutes.get("/ice", (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res
      .status(200)
      .json(
        ApiResponseFactory.success(
          { iceServers: getIceServers() },
          "Configuração ICE"
        )
      );
  } catch (err) {
    next(err);
  }
});
