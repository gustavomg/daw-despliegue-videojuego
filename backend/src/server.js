// Punto de entrada del backend de Arena Royale.
// Ensambla la app Express (app.js) + Socket.IO (sockets.js) + el bucle de matchmaking
// (matchmaking.js), inicializa el esquema de Postgres y arranca el servidor HTTP.
const http = require("http");
const { Server } = require("socket.io");

const config = require("./config");
const db = require("./db");
const { createApp } = require("./app");
const { setupSockets } = require("./sockets");
const matchmaking = require("./matchmaking");

async function main() {
  const app = createApp();

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });
  setupSockets(io);

  await db.initSchema();

  matchmaking.startMatchmakerLoop();

  server.listen(config.port, () => {
    console.log(
      `[server] Arena Royale backend escuchando en el puerto ${config.port} ` +
        `(entorno: ${config.nodeEnv}, instancia: ${config.instanceId})`
    );
  });

  const shutdown = async (signal) => {
    console.log(`[server] recibida señal ${signal}, cerrando ordenadamente...`);
    matchmaking.stopMatchmakerLoop();
    server.close(() => process.exit(0));
    // Salvaguarda: si algo se queda colgado, forzamos la salida a los 5 s.
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[server] error fatal en el arranque:", err);
  process.exit(1);
});
