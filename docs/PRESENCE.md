# Presença de usuários

## Status

Implementado em 15/11/2026:

- Migration `20261115182748_presence` com `User.lastSeenAt` e default de `status` em `ONLINE`.
- Serviço de presença em `src/app/realtime/presence.service.ts`.
- Integração no socket: rooms por guild, `presence:set`, desconexão e carência de 30 segundos.
- `GET /channels/:id/members` devolve `status` e `lastSeenAt`.
- `PATCH /profile/me` propaga mudança de status para os sockets conectados.
- Frontend lê o status, agrupa por presença e escuta `presence:update`.
- 90 testes passando, incluindo 9 novos de presença.

O armazenamento em tempo real é em memória. Redis para múltiplas instâncias fica como próximo passo, descrito no fim deste documento.

## Contrato

### REST

`GET /channels/:id/members` devolve:

```json
{
  "members": [
    {
      "userId": "uuid",
      "role": "OWNER",
      "displayName": "Aline",
      "username": "aline",
      "status": "ONLINE",
      "lastSeenAt": null
    }
  ]
}
```

Valores de `status`: `ONLINE`, `IDLE`, `DO_NOT_DISTURB`, `OFFLINE`.

`lastSeenAt` é nulo para quem está online e para quem escolheu ficar invisível. Para offline comum, é o instante da última desconexão.

### Socket

Servidor para cliente:

```json
{
  "event": "presence:update",
  "payload": {
    "userId": "uuid",
    "status": "ONLINE",
    "lastSeenAt": null
  }
}
```

Cliente para servidor:

```json
{ "event": "presence:set", "payload": { "status": "IDLE" } }
```

`presence:set` aceita `ONLINE`, `IDLE`, `DO_NOT_DISTURB` e `OFFLINE`. Neste último caso, a pessoa continua conectada, mas aparece offline para os outros.

O ack devolve `{ ok: true, status, lastSeenAt }` ou `{ ok: false, error }`.

### Rooms

- `guild:{guildId}`: o socket entra em todas as guilds do usuário no connect.
- `channel:{channelId}` continua como está para mensagens e digitação.

O broadcast de presença vai apenas para as guilds do usuário. Não existe evento global.

## Fonte da verdade

Duas camadas:

1. **Preferência persistida** em `User.status`: `ONLINE`, `IDLE`, `DO_NOT_DISTURB` ou `OFFLINE` (invisível).
2. **Conexões abertas** em memória: conjunto de sockets por usuário.

Regra de composição:

- Preferência `OFFLINE`: aparece `OFFLINE` e `lastSeenAt` fica nulo, mesmo conectado.
- Sem socket aberto: aparece `OFFLINE` e `lastSeenAt` preenchido.
- Com socket aberto e preferência `ONLINE`, `IDLE` ou `DO_NOT_DISTURB`: aparece com a preferência.
- Última desconexão: a presença anterior é mantida por 30 segundos. Se ninguém reconectar, vira `OFFLINE` e o evento é emitido.

A carência evita piscar offline durante refresh, troca de rede ou reconexão do Socket.IO.

## O que foi implementado

### Migration

```prisma
model User {
  status     String    @default("ONLINE")
  lastSeenAt DateTime?
}
```

O default `ONLINE` evita que contas novas nasçam invisíveis. Contas antigas mantêm o valor gravado.

### Serviço

`PresenceService` oferece:

- `connect(userId, socketId, guildIds)`: adiciona o socket, lê a preferência e emite o status efetivo.
- `disconnect(userId, socketId)`: remove o socket, grava `lastSeenAt` quando é o último e agenda o `OFFLINE`.
- `setStatus(userId, status)`: grava a preferência e emite. Usado pelo evento `presence:set`.
- `applyStatus(userId, status)`: atualiza a memória sem regravar, usado pelo perfil depois do `PATCH`.
- `resolve(userId, preference, lastSeenAt)`: compõe o status efetivo para a listagem REST.

O mapa em memória guarda sockets, status, `lastSeenAt`, guilds e o timer de carência. `reset()` existe para os testes.

### Socket

No connect:

1. Busca as guilds do usuário por propriedade ou membership.
2. Entra em `guild:{id}`.
3. Chama `presence.connect`.
4. Registra `disconnect` e `presence:set`.

O listener configurado em `createRealtimeServer` emite `presence:update` para as guilds do usuário. O próprio socket também recebe, o que mantém várias abas sincronizadas.

### Listagem de membros

`listChannelMembers` inclui `status` e `lastSeenAt` do usuário e aplica `presence.resolve`. O campo `role` continua no contrato para o texto secundário.

### Perfil

Quando `PATCH /profile/me` altera `status`, o caso de uso chama `presence.applyStatus`. Quem está na lista de membros vê a mudança sem recarregar.

### Frontend

- `onChatPresence` escuta `presence:update` no socket existente.
- O store de membros guarda uma lista plana e recalcula os grupos por presença.
- Sem status, o agrupamento continua por papel. Com status, a ordem é Disponível, Ausente, Não perturbe, Offline.

## Testes

Coberto em `presence.spec.ts` e `realtime.spec.ts`:

- Normalização de status desconhecido para `OFFLINE`.
- Conexão com `ONLINE`, `IDLE` e `DO_NOT_DISTURB`.
- Preferência `OFFLINE` invisível mesmo conectada, sem vazar `lastSeenAt`.
- Duas abas: fechar uma mantém a presença.
- Última desconexão mantém presença por 30 segundos e depois vira `OFFLINE`.
- Reconexão dentro da carência cancela o `OFFLINE`.
- `setStatus` persiste e emite.
- `applyStatus` atualiza sem gravar.
- Usuário sem socket resolve `OFFLINE` com `lastSeenAt` do banco.
- Listagem REST inclui status efetivo e `lastSeenAt`.

## Próximos passos

1. **Redis**: trocar o mapa em memória por um store com TTL por usuário (`presence:sockets:{userId}`). O adapter do Socket.IO já está preparado, mas presença ainda não é compartilhada entre instâncias.
2. **Heartbeat ou inatividade**: cliente envia `IDLE` após alguns minutos sem interação e `ONLINE` ao voltar.
3. **Privacidade por guild**: permitir esconder presença em um servidor específico.
4. **Teste de múltiplas instâncias** com Redis real.

## Fora de escopo

- Atividade rica (jogo, música, "assistindo").
- Presença por canal.
- Status customizado em texto.
