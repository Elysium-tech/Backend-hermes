# Calls (WebRTC) — Backlog de melhorias futuras

Entrega atual: áudio, vídeo e compartilhamento de tela funcionando via signaling
Socket.IO (`call:join` / `call:signal` / `call:leave`), ICE via `GET /rtc/ice`
(STUN padrão + TURN opcional por env). QA aprovou a entrega (80/80 testes backend,
builds backend/frontend verdes).

## Pendências não bloqueantes

1. **Broadcast de presença (`call:join` / `call:leave`)**
   O backend não emite `call:join`/`call:leave` para a room; a descoberta de
   participantes usa `announce`/`bye` via `call:signal`. Melhoria: emitir eventos
   de entrada/saída no servidor e expor lista de participantes.
   - `Frontend-hermes/src/features/calls/services/call.socket.ts`
   - `Frontend-hermes/src/features/calls/state/useCallStore.ts`

2. **Relay de `call:signal` por destinatário**
   Atualmente `call:signal` é entregue para a room inteira e o frontend filtra por
   `to`. Melhoria: entregar apenas ao socket do destinatário (`to`).
   - `Backend-hermes/src/app/realtime/socket.ts`
   - `Frontend-hermes/src/features/calls/state/useCallStore.ts`

3. **Replay de `lastSignal` para late joiner**
   `storeLastSignal`/`getLastSignal` existem, mas `getLastSignal` não é usado em
   runtime. Melhoria: reenviar o último sinal ao participante que entra atrasado.
   - `Backend-hermes/src/app/realtime/call.service.ts`

4. **Ack de `call:signal` no frontend**
   `sendSignal` não lê o callback de ack (`{ok, from, to, type}`); falhas de relay
   ficam silenciosas. Melhoria: tratar ack e marcar erro/retry.
   - `Frontend-hermes/src/features/calls/state/useCallStore.ts`

## Configuração de produção

- `STUN_URL` (default `stun:stun.l.google.com:19302`)
- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` (opcionais; sem eles, apenas STUN)
