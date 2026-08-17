// Configuración centralizada leída de variables de entorno (patrón 12-factor: config en el entorno).
// IMPORTANTE (ejercicio de diagnóstico): si JWT_SECRET no está definido, el proceso NO arranca.
// Esto es intencionado: preferimos un fallo rápido y explícito en el arranque a un backend que
// funciona "a medias" firmando tokens con un secreto por defecto inseguro.
require("dotenv").config();

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === "") {
  console.error("========================================================================");
  console.error("[config] ERROR FATAL: la variable de entorno JWT_SECRET no está definida.");
  console.error("[config] El backend la necesita para firmar y verificar los tokens de");
  console.error("[config] sesión de los jugadores (ver POST /api/players). Sin ella, no hay");
  console.error("[config] forma segura de autenticar las conexiones WebSocket.");
  console.error("[config] Solución: define JWT_SECRET en tu fichero .env (raíz del proyecto)");
  console.error("[config] y vuelve a arrancar los contenedores, p.ej.:");
  console.error("[config]   JWT_SECRET=un-secreto-largo-y-aleatorio");
  console.error("========================================================================");
  process.exit(1);
}

module.exports = {
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",

  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",

  // Duración de cada ronda de juego. OJO: esta función se llama de nuevo en cada partida
  // nueva (ver matchmaking.js) en lugar de leer una única vez el valor al arrancar. Así, el
  // ejercicio "cambia ROUND_DURATION_MS en .env y reinicia el contenedor sin rebuild" funciona:
  // basta con `docker compose up -d` (sin --build) para que las partidas siguientes usen el
  // nuevo valor, sin necesidad de tocar el código ni reconstruir la imagen.
  getRoundDurationMs() {
    return toInt(process.env.ROUND_DURATION_MS, 8000);
  },

  // Intervalo con el que cada instancia del backend comprueba la cola de matchmaking en Redis.
  matchmakerIntervalMs: toInt(process.env.MATCHMAKER_INTERVAL_MS, 1500),

  // Base de datos PostgreSQL
  db: {
    host: process.env.PGHOST || "localhost",
    port: toInt(process.env.PGPORT, 5432),
    user: process.env.PGUSER || "arena",
    password: process.env.PGPASSWORD || "arena",
    database: process.env.PGDATABASE || "arena_royale",
  },

  // Redis (cola de matchmaking, leaderboard en vivo y pub/sub entre réplicas del backend)
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: toInt(process.env.REDIS_PORT, 6379),
  },

  // Identificador de esta instancia del backend (útil en logs y métricas cuando se escala
  // `backend` a varias réplicas con `docker compose up -d --scale backend=2`).
  instanceId: process.env.HOSTNAME || `local-${process.pid}`,
};
