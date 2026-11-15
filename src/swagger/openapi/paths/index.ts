export const authPaths = {
  "/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Criar uma nova conta de usuário",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "username", "displayName", "password"],
              properties: {
                email: { type: "string", format: "email", example: "user@elysium.gg" },
                username: { type: "string", example: "elysium_dev" },
                displayName: { type: "string", example: "Elysium Dev" },
                password: { type: "string", format: "password", example: "12345678" },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Conta criada com sucesso",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ApiResponse",
              },
            },
          },
        },
        400: { description: "Erro de validação nos campos informados" },
        409: { description: "E-mail ou username já em uso" },
      },
    },
  },
  "/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Autenticar usuário e iniciar sessão",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email", example: "user@elysium.gg" },
                password: { type: "string", format: "password", example: "12345678" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Login realizado com sucesso",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ApiResponse",
              },
            },
          },
        },
        400: { description: "Erro de validação" },
        401: { description: "Credenciais inválidas" },
      },
    },
  },
  "/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Encerrar sessão atual do usuário",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: "Logout realizado com sucesso" },
        401: { description: "Não autorizado" },
      },
    },
  },
  "/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Obter perfil do usuário autenticado",
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: "Dados do usuário autenticado",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ApiResponse",
              },
            },
          },
        },
        401: { description: "Não autorizado" },
      },
    },
  },
  "/auth/password/forgot": {
    post: {
      tags: ["Auth"],
      summary: "Solicitar código OTP de recuperação de senha",
      description:
        "Sempre responde 200 com a mesma mensagem, exista ou não a conta (anti-enumeração). " +
        "Rate limit: 3 pedidos por e-mail e 10 por IP a cada 15 minutos, com cooldown entre envios.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email"],
              properties: {
                email: { type: "string", format: "email", example: "user@elysium.gg" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Solicitação recebida (resposta genérica)" },
        400: { description: "Erro de validação" },
        429: { description: "Muitas solicitações (header Retry-After)" },
      },
    },
  },
  "/auth/password/verify-code": {
    post: {
      tags: ["Auth"],
      summary: "Validar o código OTP antes de definir a nova senha",
      description:
        "Passo opcional de UX: confirma o código sem consumi-lo. Cada tentativa errada conta para o limite de 5 por código.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "code"],
              properties: {
                email: { type: "string", format: "email", example: "user@elysium.gg" },
                code: { type: "string", example: "123456" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Código válido" },
        400: { description: "Código inválido ou expirado" },
        429: { description: "Muitas tentativas" },
      },
    },
  },
  "/auth/password/reset": {
    post: {
      tags: ["Auth"],
      summary: "Redefinir a senha com o código OTP",
      description:
        "Consome o código, troca a senha e revoga todas as sessões ativas do usuário.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "code", "newPassword"],
              properties: {
                email: { type: "string", format: "email", example: "user@elysium.gg" },
                code: { type: "string", example: "123456" },
                newPassword: { type: "string", format: "password", example: "novaSenha123" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Senha redefinida com sucesso" },
        400: { description: "Código inválido/expirado ou senha fraca" },
        429: { description: "Muitas tentativas" },
      },
    },
  },
};

export const profilePaths = {
  "/profile/{id}": {
    get: {
      tags: ["Profile"],
      summary: "Obter perfil público por ID ou username",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "ID ou username do usuário",
        },
      ],
      responses: {
        200: { description: "Perfil encontrado com sucesso" },
        404: { description: "Usuário não encontrado" },
      },
    },
  },
  "/profile/me": {
    patch: {
      tags: ["Profile"],
      summary: "Atualizar próprio perfil",
      security: [{ bearerAuth: [] }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                displayName: { type: "string", example: "Novo Nome" },
                bio: { type: "string", example: "Bio personalizada no Elysium" },
                avatarUrl: { type: "string", format: "uri", example: "https://example.com/avatar.png" },
                status: {
                  type: "string",
                  enum: ["ONLINE", "OFFLINE", "IDLE", "DO_NOT_DISTURB"],
                  example: "ONLINE",
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Perfil atualizado com sucesso" },
        400: { description: "Erro de validação" },
        401: { description: "Não autorizado" },
      },
    },
  },
};

export const paths = {
  ...authPaths,
  ...profilePaths,
};
