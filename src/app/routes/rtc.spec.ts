import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { rtcRoutes } from "./rtc.routes";
import { env } from "../config";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/rtc", rtcRoutes);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Não foi possível obter a porta do servidor de teste");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

describe("GET /rtc/ice", () => {
  interface IceResponse {
    success: boolean;
    body: {
      iceServers: Array<{
        urls: string;
        username?: string;
        credential?: string;
      }>;
    };
  }

  it("retorna STUN default e não inclui TURN sem TURN_URL", async () => {
    const res = await fetch(`${baseUrl}/rtc/ice`);
    const payload = (await res.json()) as IceResponse;

    expect(res.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.body.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });

  it("inclui TURN quando TURN_URL/TURN_USERNAME/TURN_CREDENTIAL estão setados", async () => {
    const previous = {
      TURN_URL: env.TURN_URL,
      TURN_USERNAME: env.TURN_USERNAME,
      TURN_CREDENTIAL: env.TURN_CREDENTIAL,
    };
    env.TURN_URL = "turn:turn.example.com:3478";
    env.TURN_USERNAME = "hermes";
    env.TURN_CREDENTIAL = "super-secret";

    try {
      const res = await fetch(`${baseUrl}/rtc/ice`);
      const payload = (await res.json()) as IceResponse;

      expect(res.status).toBe(200);
      expect(payload.body.iceServers).toEqual([
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:turn.example.com:3478",
          username: "hermes",
          credential: "super-secret",
        },
      ]);
    } finally {
      env.TURN_URL = previous.TURN_URL;
      env.TURN_USERNAME = previous.TURN_USERNAME;
      env.TURN_CREDENTIAL = previous.TURN_CREDENTIAL;
    }
  });
});
