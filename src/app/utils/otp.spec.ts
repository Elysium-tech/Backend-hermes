import { describe, it, expect, vi } from "vitest";

vi.mock("../config", () => ({
  env: {
    OTP_SECRET: "pepper-de-teste-1234567890",
    JWT_SECRET: "jwt-secret-de-teste-que-nao-importa",
  },
}));

import {
  generateOtpCode,
  hashOtpCode,
  normalizeOtpCode,
  verifyOtpCode,
} from "./otp";

describe("otp", () => {
  describe("generateOtpCode", () => {
    it("gera sempre 6 dígitos", () => {
      for (let i = 0; i < 500; i += 1) {
        expect(generateOtpCode()).toMatch(/^\d{6}$/);
      }
    });

    it("não repete de forma trivial (entropia real)", () => {
      const codes = new Set(Array.from({ length: 200 }, () => generateOtpCode()));
      expect(codes.size).toBeGreaterThan(190);
    });
  });

  describe("hashOtpCode", () => {
    it("é determinístico e não guarda o código em claro", () => {
      const code = "123456";
      const hash = hashOtpCode(code);

      expect(hash).toBe(hashOtpCode(code));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toContain(code);
    });

    it("produz hashes diferentes para códigos diferentes", () => {
      expect(hashOtpCode("123456")).not.toBe(hashOtpCode("654321"));
    });
  });

  describe("verifyOtpCode", () => {
    it("aceita o código correto", () => {
      const code = generateOtpCode();
      expect(verifyOtpCode(code, hashOtpCode(code))).toBe(true);
    });

    it("rejeita o código errado", () => {
      const hash = hashOtpCode("123456");
      expect(verifyOtpCode("123457", hash)).toBe(false);
    });

    it("rejeita entrada não numérica sem lançar", () => {
      const hash = hashOtpCode("123456");
      expect(verifyOtpCode("abcdef", hash)).toBe(false);
      expect(verifyOtpCode("", hash)).toBe(false);
    });

    it("rejeita hash corrompido sem lançar", () => {
      expect(verifyOtpCode("123456", "nao-e-hex")).toBe(false);
    });
  });

  describe("normalizeOtpCode", () => {
    it("remove separadores colados pelo usuário", () => {
      expect(normalizeOtpCode("123 456")).toBe("123456");
      expect(normalizeOtpCode("123-456")).toBe("123456");
      expect(normalizeOtpCode(" 123456 ")).toBe("123456");
    });
  });
});
