// Capa de acceso a Redis. Redis cumple tres papeles distintos en Arena Royale (ver README):
//
//   1) Cola de matchmaking: lista `arena:queue:waiting` (RPUSH/LPOP) con los jugadores que
//      esperan partida. Se usa LPOP con "count" (atómico en Redis) para que, aunque haya varias
//      réplicas de `backend` comprobando la cola a la vez, nunca dos réplicas emparejen al mismo
//      jugador dos veces.
//   2) Leaderboard en vivo: sorted set `leaderboard:global` (ZINCRBY / ZREVRANGE).
//   3) Pub/Sub: canal `arena:events` para que TODAS las instancias de `backend` se enteren de
//      eventos de partida (match_found, match_end), aunque los dos jugadores de una partida estén
//      conectados por WebSocket a réplicas distintas (esto es justo lo que puede pasar si nginx
//      no usa sesiones "sticky" al escalar `backend` con --scale, ver ejercicio de la guía).
//
// Se usan dos conexiones ioredis: una para comandos normales y otra dedicada a suscripción,
// porque en modo "subscribe" una conexión Redis no puede ejecutar otros comandos.
const Redis = require("ioredis");
const config = require("./config");

const QUEUE_KEY = "arena:queue:waiting";
const LEADERBOARD_KEY = "leaderboard:global";
const EVENTS_CHANNEL = "arena:events";

function createConnection() {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    // Reintenta la conexión indefinidamente con backoff, en vez de tirar el proceso: así el
    // ejercicio "parar redis en caliente" se puede observar en los logs (reconexión) en lugar
    // de tumbar el backend entero.
    retryStrategy: (times) => Math.min(times * 500, 5000),
    maxRetriesPerRequest: 3,
  });
}

const client = createConnection();
const subscriber = createConnection();

client.on("error", (err) => console.error("[redis] error en conexión de comandos:", err.message));
subscriber.on("error", (err) => console.error("[redis] error en conexión de suscripción:", err.message));
client.on("connect", () => console.log("[redis] conectado (comandos)"));
subscriber.on("connect", () => console.log("[redis] conectado (pub/sub)"));

// --- Cola de matchmaking ---
async function pushToQueue(entry) {
  await client.rpush(QUEUE_KEY, JSON.stringify(entry));
}

// Extrae hasta `count` jugadores de la cola de forma atómica. Devuelve un array (puede tener
// 0, 1 o `count` elementos ya parseados desde JSON).
async function popFromQueue(count = 2) {
  const raw = await client.lpop(QUEUE_KEY, count);
  if (!raw) return [];
  return raw.map((s) => JSON.parse(s));
}

async function queueLength() {
  return client.llen(QUEUE_KEY);
}

// Devuelve un jugador a la CABEZA de la cola (cuando se ha extraído en solitario y no había
// pareja disponible todavía, para no perder su turno frente a los que llegaron después).
async function requeueFront(entry) {
  await client.lpush(QUEUE_KEY, JSON.stringify(entry));
}

// --- Contadores de "taps" (clics) durante una ronda en curso ---
function tapsKey(matchId, playerId) {
  return `arena:match:${matchId}:taps:${playerId}`;
}

async function incrTaps(matchId, playerId) {
  const key = tapsKey(matchId, playerId);
  const value = await client.incr(key);
  // Caducidad de seguridad: si por lo que sea nunca se limpia (p.ej. el backend se cae a
  // mitad de ronda), la clave desaparece sola pasado un rato en vez de acumularse para siempre.
  await client.expire(key, 300);
  return value;
}

async function getTaps(matchId, playerId) {
  const value = await client.get(tapsKey(matchId, playerId));
  return value ? parseInt(value, 10) : 0;
}

async function clearTaps(matchId, playerIds) {
  const keys = playerIds.map((id) => tapsKey(matchId, id));
  if (keys.length) await client.del(...keys);
}

// --- Leaderboard en vivo ---
async function incrementScore(nombre, puntos) {
  await client.zincrby(LEADERBOARD_KEY, puntos, nombre);
}

// Devuelve el top N como array [{ nombre, puntos }], ordenado de mayor a menor puntuación.
async function getTopLeaderboard(limit = 10) {
  const raw = await client.zrevrange(LEADERBOARD_KEY, 0, limit - 1, "WITHSCORES");
  const result = [];
  for (let i = 0; i < raw.length; i += 2) {
    result.push({ nombre: raw[i], puntos: Number(raw[i + 1]) });
  }
  return result;
}

async function leaderboardSize() {
  return client.zcard(LEADERBOARD_KEY);
}

// --- Pub/Sub entre réplicas del backend ---
async function publishEvent(type, payload) {
  await client.publish(EVENTS_CHANNEL, JSON.stringify({ type, payload }));
}

// callback recibe (type, payload)
function onEvent(callback) {
  subscriber.subscribe(EVENTS_CHANNEL, (err) => {
    if (err) console.error("[redis] no se pudo suscribir al canal de eventos:", err.message);
  });
  subscriber.on("message", (channel, message) => {
    if (channel !== EVENTS_CHANNEL) return;
    try {
      const { type, payload } = JSON.parse(message);
      callback(type, payload);
    } catch (err) {
      console.error("[redis] mensaje de pub/sub no válido:", err.message);
    }
  });
}

module.exports = {
  client,
  pushToQueue,
  popFromQueue,
  queueLength,
  requeueFront,
  incrTaps,
  getTaps,
  clearTaps,
  incrementScore,
  getTopLeaderboard,
  leaderboardSize,
  publishEvent,
  onEvent,
};
