// Acceso a PostgreSQL: jugadores, partidas y puntuaciones (persistencia definitiva).
// Redis (ver redisClient.js) guarda el estado "en vivo" (cola de matchmaking, leaderboard
// cacheado); Postgres es la fuente de verdad duradera, usada también como fallback del
// leaderboard si Redis estuviera vacío (p.ej. tras un `docker compose restart redis`).
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const config = require("./config");

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", (err) => {
      // Un error asíncrono en una conexión ociosa del pool no debe tumbar el proceso,
      // pero sí queremos verlo en los logs (útil para el ejercicio de PGPASSWORD incorrecto).
      console.error("[db] error inesperado en el pool de Postgres:", err.message);
    });
  }
  return pool;
}

async function initSchema() {
  const sqlPath = path.join(__dirname, "..", "sql", "init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const p = getPool();
  await p.query(sql);
  console.log("[db] esquema verificado/creado correctamente (backend/sql/init.sql).");
}

// Crea el jugador si no existe (por nombre) o devuelve el existente. El nombre es único.
async function getOrCreatePlayer(nombre) {
  const p = getPool();
  const { rows } = await p.query(
    `INSERT INTO players (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id, nombre, creado_en`,
    [nombre]
  );
  return rows[0];
}

async function insertMatch(modo) {
  const p = getPool();
  const { rows } = await p.query(
    `INSERT INTO matches (modo) VALUES ($1) RETURNING id, iniciado_en`,
    [modo]
  );
  return rows[0];
}

async function finalizeMatch(matchId) {
  const p = getPool();
  await p.query(`UPDATE matches SET finalizado_en = now() WHERE id = $1`, [matchId]);
}

async function insertMatchScore(matchId, playerId, puntos, ganador) {
  const p = getPool();
  await p.query(
    `INSERT INTO match_scores (match_id, player_id, puntos, ganador) VALUES ($1, $2, $3, $4)
     ON CONFLICT (match_id, player_id) DO UPDATE SET puntos = EXCLUDED.puntos, ganador = EXCLUDED.ganador`,
    [matchId, playerId, puntos, ganador]
  );
}

// Fallback del leaderboard cuando Redis no tiene datos (p.ej. justo tras un despliegue nuevo
// o si el sorted set `leaderboard:global` se vació). Se agrega la puntuación histórica.
async function getLeaderboardFallback(limit = 10) {
  const p = getPool();
  const { rows } = await p.query(
    `SELECT p.nombre AS nombre, COALESCE(SUM(ms.puntos), 0) AS puntos
     FROM players p
     LEFT JOIN match_scores ms ON ms.player_id = p.id
     GROUP BY p.id, p.nombre
     HAVING COALESCE(SUM(ms.puntos), 0) > 0
     ORDER BY puntos DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ nombre: r.nombre, puntos: Number(r.puntos) }));
}

module.exports = {
  getPool,
  initSchema,
  getOrCreatePlayer,
  insertMatch,
  finalizeMatch,
  insertMatchScore,
  getLeaderboardFallback,
};
