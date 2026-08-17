// Rutas REST de la API. El resto de la lógica de juego (matchmaking, rondas) va por WebSocket
// (ver sockets.js): la API REST solo cubre lo que no necesita tiempo real: registro de jugador,
// consulta del leaderboard y las sondas de salud.
const express = require("express");
const config = require("./config");
const db = require("./db");
const auth = require("./auth");
const redisClient = require("./redisClient");

const router = express.Router();

// Sonda de salud, usada por el HEALTHCHECK de Docker (ver Dockerfile) y por el alumnado con
// `curl http://localhost/api/health` para comprobar que el backend responde.
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    env: config.nodeEnv,
    instancia: config.instanceId,
  });
});

// Registra (o recupera, si ya existe ese nombre) un jugador y devuelve su token de sesión.
router.post("/players", async (req, res) => {
  const nombre = (req.body && req.body.nombre ? String(req.body.nombre) : "").trim();

  if (!nombre) {
    return res.status(400).json({ error: "El campo 'nombre' es obligatorio" });
  }
  if (nombre.length < 2 || nombre.length > 24) {
    return res.status(400).json({ error: "El nombre debe tener entre 2 y 24 caracteres" });
  }

  try {
    const player = await db.getOrCreatePlayer(nombre);
    const token = auth.signPlayerToken(player);
    res.status(201).json({ id: player.id, nombre: player.nombre, token });
  } catch (err) {
    console.error("[routes] error al registrar jugador:", err.message);
    res.status(500).json({ error: "No se ha podido registrar el jugador (¿está la base de datos disponible?)" });
  }
});

// Top N del leaderboard global. Se lee primero de Redis (rápido, en vivo); si Redis está vacío
// (p.ej. recién desplegado, o justo tras un `docker compose restart redis` que reinicia el
// sorted set en memoria), se recurre al histórico persistido en Postgres.
router.get("/leaderboard", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  try {
    const size = await redisClient.leaderboardSize();
    if (size > 0) {
      const top = await redisClient.getTopLeaderboard(limit);
      return res.json({ origen: "redis", jugadores: top });
    }
  } catch (err) {
    console.warn("[routes] Redis no disponible para el leaderboard, usando fallback de Postgres:", err.message);
  }

  try {
    const top = await db.getLeaderboardFallback(limit);
    res.json({ origen: "postgres", jugadores: top });
  } catch (err) {
    console.error("[routes] error al leer el leaderboard de Postgres:", err.message);
    res.status(500).json({ error: "No se ha podido calcular el leaderboard" });
  }
});

module.exports = router;
