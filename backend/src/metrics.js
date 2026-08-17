// Métricas en texto plano estilo Prometheus, expuestas en GET /metrics.
// No se usa la librería prom-client a propósito: el formato Prometheus es tan simple que basta
// con construir el texto a mano, y así queda más claro para el alumnado qué es exactamente lo
// que un exportador de métricas devuelve por debajo.
//
// IMPORTANTE: estas métricas son *por instancia* del proceso backend, no globales del clúster.
// Si se escala `backend` a varias réplicas (docker compose up -d --scale backend=2), cada
// réplica expone sus propios números en su propio /metrics: nginx solo reenvía la petición a
// la réplica que le toque atender en ese momento (ver ejercicios de la guía de despliegue).
const redisClient = require("./redisClient");

const state = {
  partidasActivas: 0, // partidas en curso orquestadas por ESTA instancia
  jugadoresConectados: 0, // sockets conectados a ESTA instancia
};

function incPartidasActivas() {
  state.partidasActivas += 1;
}

function decPartidasActivas() {
  state.partidasActivas = Math.max(0, state.partidasActivas - 1);
}

function setJugadoresConectados(n) {
  state.jugadoresConectados = n;
}

async function renderPrometheusText() {
  let colaEspera = 0;
  try {
    colaEspera = await redisClient.queueLength();
  } catch (err) {
    // Si Redis no responde, seguimos exponiendo las métricas locales igualmente.
    colaEspera = -1;
  }

  return [
    "# HELP arena_partidas_activas Número de partidas en curso gestionadas por esta instancia del backend",
    "# TYPE arena_partidas_activas gauge",
    `arena_partidas_activas ${state.partidasActivas}`,
    "",
    "# HELP arena_jugadores_conectados Número de jugadores con WebSocket activo en esta instancia",
    "# TYPE arena_jugadores_conectados gauge",
    `arena_jugadores_conectados ${state.jugadoresConectados}`,
    "",
    "# HELP arena_cola_espera Número de jugadores esperando emparejamiento en la cola global de Redis",
    "# TYPE arena_cola_espera gauge",
    `arena_cola_espera ${colaEspera}`,
    "",
  ].join("\n");
}

module.exports = { incPartidasActivas, decPartidasActivas, setJugadoresConectados, renderPrometheusText };
