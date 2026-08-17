// Lógica de emparejamiento (matchmaking) y ciclo de vida de una partida.
// No depende directamente de Socket.IO: solo lee/escribe en Redis y Postgres, y publica
// eventos por Redis pub/sub (ver redisClient.js). Es sockets.js quien traduce esos eventos en
// mensajes WebSocket a los jugadores conectados a ESTA instancia del backend.
const config = require("./config");
const db = require("./db");
const redisClient = require("./redisClient");
const metrics = require("./metrics");

// Partidas que ESTA instancia ha creado y de las que es responsable de cerrar la ronda cuando
// termine el tiempo. Solo la instancia que crea la partida programa su cierre: así, aunque los
// dos jugadores estén conectados a réplicas distintas de `backend`, la ronda se cierra una
// única vez (evita condiciones de carrera al escalar backend con --scale).
const misPartidas = new Map(); // matchId -> { players, roundDurationMs, timer }

async function enqueuePlayer(entry) {
  await redisClient.pushToQueue(entry);
  console.log(`[matchmaking] jugador en cola: ${entry.nombre} (instancia ${entry.instanceId})`);
}

let loopHandle = null;

function startMatchmakerLoop() {
  if (loopHandle) return;
  loopHandle = setInterval(() => {
    tick().catch((err) => console.error("[matchmaking] error en el ciclo de emparejamiento:", err.message));
  }, config.matchmakerIntervalMs);
  console.log(`[matchmaking] bucle de emparejamiento activo cada ${config.matchmakerIntervalMs} ms`);
}

function stopMatchmakerLoop() {
  if (loopHandle) clearInterval(loopHandle);
  loopHandle = null;
  // Cancela también los cierres de ronda pendientes de esta instancia.
  for (const partida of misPartidas.values()) {
    if (partida.timer) clearTimeout(partida.timer);
  }
}

async function tick() {
  let popped;
  try {
    popped = await redisClient.popFromQueue(2);
  } catch (err) {
    console.error("[matchmaking] no se ha podido leer la cola de Redis:", err.message);
    return;
  }

  if (popped.length === 0) return;

  if (popped.length === 1) {
    // No hay pareja todavía: se devuelve a la cabeza de la cola para no perder el turno.
    await redisClient.requeueFront(popped[0]);
    return;
  }

  await crearPartida(popped);
}

async function crearPartida(players) {
  // ROUND_DURATION_MS se lee AQUÍ, al crear la partida, y no se guarda en caché al arrancar el
  // proceso (ver config.getRoundDurationMs). Esto permite el ejercicio "cambia la variable en
  // .env y reinicia el contenedor sin --build": la siguiente partida que se cree ya usa el
  // nuevo valor, sin tocar código ni reconstruir la imagen.
  const roundDurationMs = config.getRoundDurationMs();

  let match;
  try {
    match = await db.insertMatch("reflex");
  } catch (err) {
    console.error("[matchmaking] no se ha podido crear la partida en Postgres:", err.message);
    // No perdemos a los jugadores: se devuelven a la cola para reintentarlo en el próximo tick.
    for (const p of players) await redisClient.pushToQueue(p);
    return;
  }

  const startedAt = Date.now();
  metrics.incPartidasActivas();
  misPartidas.set(match.id, { players, roundDurationMs });

  await redisClient.publishEvent("match_found", {
    matchId: match.id,
    players: players.map((p) => ({ id: p.playerId, nombre: p.nombre })),
    roundDurationMs,
    startedAt,
  });

  console.log(
    `[matchmaking] partida #${match.id} creada: ${players.map((p) => p.nombre).join(" vs ")} ` +
      `(ronda de ${roundDurationMs} ms)`
  );

  const timer = setTimeout(() => {
    finalizarPartida(match.id).catch((err) =>
      console.error(`[matchmaking] error al finalizar la partida #${match.id}:`, err.message)
    );
  }, roundDurationMs);

  misPartidas.get(match.id).timer = timer;
}

async function finalizarPartida(matchId) {
  const partida = misPartidas.get(matchId);
  if (!partida) return; // ya finalizada, o no es responsabilidad de esta instancia
  misPartidas.delete(matchId);
  metrics.decPartidasActivas();

  const { players } = partida;

  const resultados = [];
  for (const p of players) {
    let taps = 0;
    try {
      taps = await redisClient.getTaps(matchId, p.playerId);
    } catch (err) {
      console.error(`[matchmaking] no se han podido leer los clics de ${p.nombre}:`, err.message);
    }
    resultados.push({ playerId: p.playerId, nombre: p.nombre, taps });
  }

  const maxTaps = Math.max(...resultados.map((r) => r.taps));
  const empatados = resultados.filter((r) => r.taps === maxTaps).length;
  const hayGanador = maxTaps > 0 && empatados === 1;

  for (const r of resultados) {
    r.ganador = hayGanador && r.taps === maxTaps;
    r.puntos = r.taps + (r.ganador ? 5 : 0);
  }

  try {
    await db.finalizeMatch(matchId);
    for (const r of resultados) {
      await db.insertMatchScore(matchId, r.playerId, r.puntos, r.ganador);
      await redisClient.incrementScore(r.nombre, r.puntos);
    }
  } catch (err) {
    console.error(`[matchmaking] error al persistir el resultado de la partida #${matchId}:`, err.message);
  }

  try {
    await redisClient.clearTaps(matchId, players.map((p) => p.playerId));
  } catch (err) {
    // No es crítico: las claves de taps caducan solas (TTL de seguridad, ver redisClient.js).
  }

  await redisClient.publishEvent("match_end", { matchId, resultados });

  console.log(
    `[matchmaking] partida #${matchId} finalizada: ${resultados
      .map((r) => `${r.nombre}=${r.taps} clics (${r.puntos} pts)`)
      .join(", ")}`
  );
}

module.exports = { enqueuePlayer, startMatchmakerLoop, stopMatchmakerLoop };
