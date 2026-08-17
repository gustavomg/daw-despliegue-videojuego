-- Script de inicialización del esquema de Arena Royale.
-- Se ejecuta al arrancar el backend (ver src/db.js -> initSchema()), usando "CREATE TABLE IF
-- NOT EXISTS" para que sea seguro ejecutarlo varias veces (idempotente): cada vez que el
-- contenedor `backend` arranca, vuelve a lanzar este script y no falla aunque las tablas ya
-- existan de un arranque anterior (el volumen `db_data` persiste los datos entre reinicios).

-- Jugadores registrados (un jugador se crea/reutiliza al hacer login por nombre).
CREATE TABLE IF NOT EXISTS players (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partidas jugadas (una fila por partida de matchmaking, independientemente del resultado).
CREATE TABLE IF NOT EXISTS matches (
  id            SERIAL PRIMARY KEY,
  iniciado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_en TIMESTAMPTZ,
  modo          TEXT NOT NULL DEFAULT 'reflex'
);

-- Puntuación de cada jugador en cada partida (relación N a N entre matches y players).
CREATE TABLE IF NOT EXISTS match_scores (
  match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  puntos      INTEGER NOT NULL DEFAULT 0,
  ganador     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_scores_player ON match_scores (player_id);
