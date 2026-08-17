// Pequeña capa de acceso a la API REST. Las rutas son relativas ("/api/...") porque en
// producción Nginx sirve este frontend estático Y hace de proxy inverso hacia el backend en el
// mismo origen (ver nginx/nginx.conf) -> no hay problemas de CORS ni hay que hardcodear
// hosts/puertos en el frontend.
const Api = (() => {
  const TOKEN_KEY = "arena_token";
  const PLAYER_KEY = "arena_player";

  function setSession(token, player) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  }
  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  function getPlayer() {
    const raw = sessionStorage.getItem(PLAYER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PLAYER_KEY);
  }

  // Registra (o recupera) un jugador por nombre y guarda el token de sesión devuelto.
  async function registerPlayer(nombre) {
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Error ${res.status}`);
    }
    setSession(data.token, { id: data.id, nombre: data.nombre });
    return data;
  }

  async function getLeaderboard(limit = 10) {
    const res = await fetch(`/api/leaderboard?limit=${limit}`);
    if (!res.ok) throw new Error(`Error ${res.status} al leer el leaderboard`);
    return res.json();
  }

  return { setSession, getToken, getPlayer, clearSession, registerPlayer, getLeaderboard };
})();
