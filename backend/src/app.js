// Construye la app de Express de forma aislada (sin arrancar el puerto, la BD, Redis ni el
// matchmaking), para poder importarla también desde pruebas si se añaden en el futuro.
const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const metrics = require("./metrics");

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", routes);

  // Métricas en texto plano estilo Prometheus (ver metrics.js).
  app.get("/metrics", async (req, res) => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.end(await metrics.renderPrometheusText());
  });

  return app;
}

module.exports = { createApp };
