# Presença de usuários: plano de implementação no backend

## Situação atual

- `User.status` existe no Prisma, com default `OFFLINE`, mas nenhum fluxo grava o campo.
- `GET /channels/:id/members` devolve `userId`, `role`, `displayName` e `username`. Não devolve presença.
- O socket autentica por JWT e sessão, mas não registra conexão por usuário.
- O frontend já lê `status` quando ele existe. Sem o campo, ele agrupa por papel (Dono, Administrador, Membro) e não inventa bolinha verde.
- A contagem de membros do convite foi corrigida em paralelo. Presença não depende dela.

## Contrato proposto

### REST

`GET /channels/:id/members` passa a devolver:

```json
{
  "members": [
    {
      "userId": "uuid",
      "role": "OWNER",
      "displayName": "Aline",
      "username": "aline",
      "status": "ONLINE",
      "lastSeenAt": "2026-11-15T18:04:00.000Z"
    }
  ]
}
```

Valores de `status`: `ONLINE`, `IDLE`, `DO_NOT_DISTURB`, `OFFLINE`.
`lastSeenAt` é nulo para quem nunca conectou e para quem escolheu ficar invisível.

### Socket

Evento servidor para cliente:

```json
{
  "event": "presence:update",
  "payload": {
    "userId": "uuid",
    "status": "ONLINE",
    "lastSeenAt": "2026-11-15T18:04:00.000Z"
  }
}
```

Evento cliente para servidor:

```json
{ "event": "presence:set", "payload": { "status": "IDLE" } }
```

`presence:set` aceita `ONLINE`, `IDLE` e `DO_NOT_DISTURB`. `OFFLINE` por esse canal significa ficar invisível e precisa de decisão de produto.

### Rooms

- `guild:{guildId}`: o socket entra em todas as guilds do usuário no connect.
- `user:{userId}`: permite sincronizar várias abas e múltiplos dispositivos.
- `channel:{channelId}` continua como está para mensagens e digitação.

Presença não deve ser emitida em room global. O broadcast vai para as guilds em comum entre quem mudou e quem recebe.

## Fonte da verdade

Duas camadas:

1. **Preferência persistida** em `User.status`: o que a pessoa escolheu (online, ausente, não perturbe, invisível).
2. **Presença em tempo real** em Redis: quantidade de sockets abertos e status efetivo, com TTL.

Regra de composição:

- Sem socket aberto: `OFFLINE` e `lastSeenAt` preenchido.
- Com socket aberto e preferência `OFFLINE` (invisível): `OFFLINE` para os outros.
- Com socket aberto e preferência `IDLE` ou `DO_NOT_DISTURB`: devolve a preferência.
- Com socket aberto e preferência `ONLINE`: devolve `ONLINE`.

`IDLE` por inatividade é efêmero e não sobrescreve a preferência. `DO_NOT_DISTURB` é escolha explícita e persiste.

## Implementação

### 1. Migration

Adicionar `lastSeenAt DateTime?` em `User`. Não é preciso mexer em `status`, que já é string.

```prisma
model User {
  // campos atuais
  lastSeenAt DateTime?
}
```

### 2. Serviço de presença

Criar `src/app/realtime/presence.service.ts` com:

- `connect(userId, socketId)`: incrementa o contador no Redis (`INCR presence:sockets:{userId}`), define TTL de 90 segundos, marca `ONLINE` se for o primeiro socket e devolve o status efetivo.
- `disconnect(userId, socketId)`: decrementa, e se chegar a zero agenda `OFFLINE` com carência de 30 segundos (job ou TTL com timestamp).
- `setStatus(userId, status)`: valida o enum, grava a preferência no banco e recalcula o efetivo.
- `getStatuses(userIds)`: leitura em lote para a listagem REST.
- `heartbeat(userId)`: renova o TTL a cada 30 segundos enquanto o socket estiver vivo.

Sem Redis configurado, usar um `Map` em memória com a mesma interface. O projeto já usa Redis para o adapter do Socket.IO, então o caminho normal é Redis.

### 3. Conexão e desconexão

Em `socket.ts`, depois da autenticação:

1. Buscar as guilds do usuário (`guild.ownerId` ou `channelMember`).
2. Entrar em `guild:{id}` para cada guild.
3. Entrar em `user:{userId}`.
4. Chamar `presence.connect`.
5. Emitir `presence:update` para as guilds do usuário, exceto para o próprio socket.
6. No `disconnect`, chamar `presence.disconnect` e emitir a atualização depois da carência.

A carência evita piscar offline durante refresh, troca de rede ou reconexão do Socket.IO.

### 4. Listagem de membros

Em `listChannelMembers`, incluir `status` do usuário e `lastSeenAt`, e substituir o status pela composição do serviço de presença:

```ts
const statuses = await presence.getStatuses(rows.map((row) => row.userId))
```

Manter `role` como está. O frontend usa `role` para o texto secundário e `status` para a bolinha e o agrupamento.

### 5. Evento `presence:set`

Validar com Zod (`presenceSetSchema`), chamar `presence.setStatus` e emitir `presence:update` para as guilds do usuário. Responder com ack `{ ok: true, status }` para o cliente saber que a preferência foi aceita.

### 6. Inatividade

Duas opções:

- **Cliente**: depois de 5 minutos sem teclado, mouse ou foco, envia `presence:set IDLE`. Ao voltar, envia `ONLINE`. É mais simples e não gasta cron.
- **Servidor**: cron a cada minuto marcando `IDLE` para quem não envia heartbeat de atividade.

Recomendo a opção do cliente para o MVP. O servidor só precisa aceitar o evento. O cron fica para quando houver métrica de uso.

## Testes

- Conectar marca `ONLINE` e emite para as guilds certas, sem emitir para quem não compartilha guild.
- Duas abas: fechar uma mantém `ONLINE`; fechar as duas agenda `OFFLINE`.
- Reconexão dentro da carência não emite `OFFLINE`.
- `presence:set DO_NOT_DISTURB` persiste e sobrevive a reconexão.
- Preferência `OFFLINE` (invisível) não vaza presença para ninguém.
- `GET /channels/:id/members` devolve status efetivo para online, ausente, não perturbe e offline.
- Usuário sem socket aparece `OFFLINE` com `lastSeenAt`.
- Falha do Redis cai no mapa em memória sem derrubar o socket.
- Token inválido continua sem conectar e sem emitir presença.

## Ordem de entrega

1. Migration de `lastSeenAt`.
2. Serviço de presença com Redis e fallback em memória.
3. Integração no `socket.ts` (connect, disconnect, `presence:set`, heartbeat).
4. `listChannelMembers` com status efetivo.
5. Testes de unidade e de socket.
6. Ajuste do frontend se o contrato final divergir do que já está implementado.

Estimativa: 1 a 2 dias de backend, incluindo testes. O frontend não precisa de mudança para começar a mostrar presença, porque já lê `status` e agrupa por presença quando o campo existe.

## Fora de escopo

- Atividade rica (jogo, música, "assistindo").
- Presença por canal.
- Status customizado em texto.
- Privacidade por servidor (esconder presença só em uma guild).
