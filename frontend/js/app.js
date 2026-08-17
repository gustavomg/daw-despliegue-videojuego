// Lógica principal del frontend: cambio de pantallas, conexión WebSocket y minijuego "Reflex Tap".
(() => {
  const screens = {
    login: document.getElementById("screen-login"),
    lobby: document.getElementById("screen-lobby"),
    game: document.getElementById("screen-game"),
    result: document.getElementById("screen-result"),
  };
  const leaderboardPanel = document.getElementById("leaderboard-panel");
  const jugadorActualEl = document.getElementById("jugador-actual");
  const instanciaBadge = document.getElementById("instancia-badge");

  let socket = null;
  let currentMatchId = null;
  let misClics = 0;
  let timerInterval = null;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("hidden", key !== name);
    });
  }

  // ---------- Login ----------
  document.getElementById("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById("nombre").value.trim();
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";

    try {
      const data = await Api.registerPlayer(nombre);
      jugadorActualEl.textContent = `Jugando como ${data.nombre}`;
      leaderboardPanel.classList.remove("hidden");
      await cargarLeaderboardInicial();
      conectarSocket();
      showScreen("lobby");
    } catch (err) {
      errorEl.textContent = err.message || "No se ha podido registrar el jugador";
    }
  });

  // Si ya hay sesión de este navegador (misma pestaña), saltamos directos al lobby.
  const sesionPrevia = Api.getPlayer();
  if (sesionPrevia && Api.getToken()) {
    jugadorActualEl.textContent = `Jugando como ${sesionPrevia.nombre}`;
    leaderboardPanel.classList.remove("hidden");
    cargarLeaderboardInicial();
    conectarSocket();
    showScreen("lobby");
  }

  // ---------- Conexión WebSocket ----------
  function conectarSocket() {
    if (socket) return;
    socket = io({ auth: { token: Api.getToken() } });

    socket.on("connect_error", (err) => {
      document.getElementById("lobby-estado").textContent =
        "No se ha podido conectar por WebSocket: " + err.message;
    });

    socket.on("bienvenida", ({ instancia }) => {
      instanciaBadge.textContent = `instancia: ${instancia}`;
    });

    socket.on("queue_joined", ({ mensaje }) => {
      document.getElementById("lobby-estado").textContent = mensaje;
    });

    socket.on("match_found", ({ matchId, oponente, roundDurationMs, startedAt }) => {
      currentMatchId = matchId;
      misClics = 0;
      document.getElementById("oponente-nombre").textContent = oponente;
      document.getElementById("mis-clics").textContent = "0";
      document.getElementById("game-estado").textContent = "¡Ronda en marcha!";
      const btn = document.getElementById("btn-tap");
      btn.disabled = false;
      showScreen("game");
      iniciarBarraTiempo(roundDurationMs, startedAt);
    });

    socket.on("tap_ack", ({ total }) => {
      misClics = total;
      document.getElementById("mis-clics").textContent = String(total);
    });

    socket.on("match_end", ({ resultados }) => {
      pararBarraTiempo();
      mostrarResultado(resultados);
      showScreen("result");
    });

    socket.on("leaderboard_update", ({ jugadores }) => {
      pintarLeaderboard(jugadores, "en vivo");
    });

    socket.on("error_juego", ({ mensaje }) => {
      document.getElementById("game-estado").textContent = "⚠ " + mensaje;
      document.getElementById("lobby-estado").textContent = "⚠ " + mensaje;
    });
  }

  // ---------- Lobby ----------
  document.getElementById("btn-buscar-partida").addEventListener("click", () => {
    if (!socket) return;
    document.getElementById("lobby-estado").textContent = "Entrando en la cola...";
    socket.emit("join_queue");
  });

  // ---------- Partida ----------
  document.getElementById("btn-tap").addEventListener("click", () => {
    if (!socket || !currentMatchId) return;
    socket.emit("tap", { matchId: currentMatchId });
  });

  function iniciarBarraTiempo(roundDurationMs, startedAt) {
    const barra = document.getElementById("timer-bar");
    barra.style.width = "100%";
    pararBarraTiempo();
    timerInterval = setInterval(() => {
      const transcurrido = Date.now() - startedAt;
      const restante = Math.max(0, roundDurationMs - transcurrido);
      const porcentaje = (restante / roundDurationMs) * 100;
      barra.style.width = porcentaje + "%";
      if (restante <= 0) {
        document.getElementById("btn-tap").disabled = true;
        document.getElementById("game-estado").textContent = "Tiempo agotado, calculando resultado...";
        pararBarraTiempo();
      }
    }, 100);
  }

  function pararBarraTiempo() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function mostrarResultado(resultados) {
    const jugadorActual = Api.getPlayer();
    const hayGanador = resultados.some((r) => r.ganador);
    const yoGane = resultados.find((r) => jugadorActual && r.playerId === jugadorActual.id && r.ganador);

    document.getElementById("resultado-titulo").textContent = !hayGanador
      ? "Empate"
      : yoGane
      ? "¡Has ganado! 🎉"
      : "Resultado de la partida";

    const tbody = document.querySelector("#tabla-resultado tbody");
    tbody.innerHTML = "";
    resultados
      .slice()
      .sort((a, b) => b.taps - a.taps)
      .forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${r.nombre}${r.ganador ? " 🏆" : ""}</td><td>${r.taps}</td><td>${r.puntos}</td>`;
        tbody.appendChild(tr);
      });
  }

  document.getElementById("btn-volver-lobby").addEventListener("click", () => {
    currentMatchId = null;
    document.getElementById("lobby-estado").textContent = 'Pulsa "Buscar partida" cuando quieras jugar.';
    showScreen("lobby");
  });

  // ---------- Leaderboard ----------
  async function cargarLeaderboardInicial() {
    try {
      const data = await Api.getLeaderboard(10);
      pintarLeaderboard(data.jugadores, data.origen);
    } catch (err) {
      console.error("No se ha podido cargar el leaderboard inicial:", err.message);
    }
  }

  function pintarLeaderboard(jugadores, origen) {
    const tbody = document.querySelector("#tabla-leaderboard tbody");
    tbody.innerHTML = "";
    jugadores.forEach((j, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${j.nombre}</td><td>${j.puntos}</td>`;
      tbody.appendChild(tr);
    });
    document.getElementById("leaderboard-origen").textContent = `Fuente: ${origen}`;
  }
})();
