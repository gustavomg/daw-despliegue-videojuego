// Configuración de Socket.IO: autenticación, eventos de matchmaking/partida y retransmisión de
// los eventos publicados por Redis pub/sub a los jugadores conectados a ESTA instancia.
//
// Eventos que emite el cliente -> servidor:
//   join_queue          el jugador quiere entrar en la cola de matchmaking
//   tap                 el jugador ha pulsado el botón durante una ronda activa { matchId }
//
// Eventos que emite el servidor -> cliente:
//   queue_joined        confirmación de que se ha entrado en la cola
//   match_found         se ha encontrado rival, empieza la partida { matchId, oponente, roundDurationMs, startedAt }
//   tap_ack             confirmación de un clic registrado { matchId, total }
//   match_end           resultado final de la partida { matchId, resultados }
//   leaderboard_update  nuevo top del ranking global { jugadores }
//   error_juego         algo ha ido mal (p.ej. Redis caído) { mensaje }
const config = require("./config");
const auth = require("./auth");
const redisClient = require("./redisClient");
const matchmaking = require("./matchmaking");
const metrics = require("./metrics");

// Jugadores conectados a ESTA instancia del backend: playerId -> Set<socket.id>.
// Necesario porque, al escalar `backend` a varias réplicas, cada una solo "ve" una parte de
// los jugadores conectados; los eventos de partida llegan a todas por Redis pub/sub y cada una
// reenvía solo a los suyos.
const localPlayers = new Map();

function registerLocal(playerId, socketId) {
  if (!localPlayers.has(playerId)) localPlayers.set(playerId, new Set());
  localPlayers.get(playerId).add(socketId);
}

function unregisterLocal(playerId, socketId) {
  const set = localPlayers.get(playerId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) localPlayers.delete(playerId);
}

function setupSockets(io) {
  io.use(auth.socketAuthMiddleware);

  io.on("connection", (socket) => {
    const { id: playerId, nombre } = socket.player;
    registerLocal(playerId, socket.id);
    metrics.setJugadoresConectados(io.engine.clientsCount);
    console.log(`[sockets] jugador conectado: ${nombre} (${socket.id}) en instancia ${config.instanceId}`);

    socket.emit("bienvenida", { instancia: config.instanceId });

    socket.on("join_queue", async () => {
      try {
        await matchmaking.enqueuePlayer({
          playerId,
          nombre,
          socketId: socket.id,
          instanceId: config.instanceId,
        });
        socket.emit("queue_joined", { mensaje: "En cola, buscando rival..." });
      } catch (err) {
        console.error("[sockets] error al entrar en la cola de matchmaking:", err.message);
        socket.emit("error_juego", { mensaje: "No se ha podido entrar en la cola (¿Redis caído?)" });
      }
    });

    socket.on("tap", async (data) => {
      const matchId = data && data.matchId;
      if (!matchId) return;
      try {
        const total = await redisClient.incrTaps(matchId, playerId);
        socket.emit("tap_ack", { matchId, total });
      } catch (err) {
        // Ejercicio de diagnóstico: si Redis está caído en mitad de una ronda, el jugador debe
        // enterarse (en vez de que sus clics se pierdan en silencio).
        socket.emit("error_juego", { mensaje: "No se ha podido registrar el clic (¿Redis caído?)" });
      }
    });

    socket.on("disconnect", () => {
      unregisterLocal(playerId, socket.id);
      metrics.setJugadoresConectados(io.engine.clientsCount);
      console.log(`[sockets] jugador desconectado: ${nombre} (${socket.id})`);
    });
  });

  // Eventos de partida publicados por CUALQUIER instancia del backend (incluida esta misma) a
  // través de Redis pub/sub. Cada instancia reenvía por WebSocket únicamente a los sockets que
  // tiene conectados localmente.
  redisClient.onEvent(async (type, payload) => {
    if (type === "match_found") {
      for (const p of payload.players) {
        const sockets = localPlayers.get(p.id);
        if (!sockets) continue;
        const oponente = payload.players.find((x) => x.id !== p.id);
        for (const socketId of sockets) {
          io.to(socketId).emit("match_found", {
            matchId: payload.matchId,
            oponente: oponente ? oponente.nombre : "?",
            roundDurationMs: payload.roundDurationMs,
            startedAt: payload.startedAt,
          });
        }
      }
    }

    if (type === "match_end") {
      for (const r of payload.resultados) {
        const sockets = localPlayers.get(r.playerId);
        if (!sockets) continue;
        for (const socketId of sockets) {
          io.to(socketId).emit("match_end", { matchId: payload.matchId, resultados: payload.resultados });
        }
      }

      // El leaderboard se refresca para TODOS los clientes conectados a esta instancia, no
      // solo para los que acaban de jugar: así se ve "en vivo" desde cualquier pantalla.
      try {
        const top = await redisClient.getTopLeaderboard(10);
        io.emit("leaderboard_update", { jugadores: top });
      } catch (err) {
        console.error("[sockets] no se ha podido refrescar el leaderboard:", err.message);
      }
    }
  });
}

module.exports = { setupSockets };
