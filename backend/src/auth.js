// Autenticación muy simple basada en JWT: cada jugador se identifica solo por nombre (no hay
// contraseña, no es el objetivo didáctico de este proyecto). Al registrarse recibe un token que
// debe enviar tanto en las peticiones REST protegidas como en el handshake del WebSocket.
const jwt = require("jsonwebtoken");
const config = require("./config");

function signPlayerToken(player) {
  return jwt.sign({ sub: player.id, nombre: player.nombre }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
}

// Middleware Express: exige cabecera Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Token inválido o caducado" });
  }
  req.player = payload;
  next();
}

// Middleware Socket.IO: exige auth.token en el handshake del cliente.
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = token && verifyToken(token);
  if (!payload) {
    return next(new Error("No autorizado: token de jugador ausente o inválido"));
  }
  socket.player = { id: payload.sub, nombre: payload.nombre };
  next();
}

module.exports = { signPlayerToken, verifyToken, requireAuth, socketAuthMiddleware };
