# Arena Royale

Proyecto práctico del módulo **Despliegue de Aplicaciones Web** (2º CFGS DAW).

Plataforma de videojuego multijugador ligero: los jugadores se registran por nombre, entran en
una cola de **matchmaking**, se emparejan de dos en dos y juegan una partida rápida por rondas
("Reflex Tap": pulsar un botón lo más rápido posible durante `ROUND_DURATION_MS` milisegundos).
El resultado se persiste en PostgreSQL y actualiza un **leaderboard global en tiempo real**
respaldado por Redis, que se retransmite a todos los clientes conectados por WebSocket.

Este proyecto no es un ejercicio de programación: es un **laboratorio de despliegue guiado**. El
código ya está completo y funciona; el trabajo del alumnado consiste en desplegarlo con Docker
Compose, experimentar con cambios de configuración y diagnosticar errores intencionados.

**Empieza por [`documentacion/Guia_Despliegue_y_Ejercicios_Videojuego.docx`](./documentacion)**
si lo que quieres es desplegar la aplicación y hacer los ejercicios ya mismo.

## Arquitectura

```
                         ┌───────────────────────────┐
   navegador  ───────▶   │   nginx (puerto 8080)     │
                         │   - sirve frontend/        │
                         │   - proxy /api/            │
                         │   - proxy /socket.io/      │
                         └─────────────┬───────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │   backend (Node 22)        │
                         │   Express + Socket.IO      │
                         │   - matchmaking            │
                         │   - lógica de rondas        │
                         │   - JWT, /metrics           │
                         └──────┬───────────────┬──────┘
                                │               │
                   ┌────────────┘               └────────────┐
                   ▼                                          ▼
        ┌─────────────────────┐                   ┌─────────────────────┐
        │  redis (7-alpine)    │                   │  db (postgres:16)    │
        │  - cola matchmaking  │                   │  - players           │
        │  - leaderboard:global│                   │  - matches            │
        │  - pub/sub eventos   │                   │  - match_scores       │
        └─────────────────────┘                   └─────────────────────┘
```

Flujo de datos: un jugador entra en la **cola de matchmaking** (lista en Redis) → cuando hay
2 jugadores en cola, el backend crea una **partida** en Postgres y arranca una ronda → cada clic
del jugador se cuenta en Redis → al terminar la ronda, el resultado se **persiste** en
`match_scores` y se suma al **leaderboard** (sorted set en Redis) → el nuevo leaderboard se
retransmite por WebSocket a todos los clientes conectados.

## Servicios y puertos

| Servicio | Imagen / base       | Rol                                             | Puerto publicado |
|----------|----------------------|--------------------------------------------------|------------------|
| `db`     | `postgres:16-alpine`| Persistencia de jugadores, partidas y puntuaciones | (interno) 5432   |
| `redis`  | `redis:7-alpine`    | Cola de matchmaking, leaderboard en vivo, pub/sub | (interno) 6379   |
| `backend`| Node 22 (`node:22-alpine`) | API REST + WebSocket (Express + Socket.IO)   | (interno) 3000   |
| `nginx`  | `nginx:1.27-alpine` | Frontend estático + proxy inverso                | `HTTP_PORT` (8080) |

## Arranque rápido

```bash
cp .env.example .env      # y ajusta JWT_SECRET
docker compose up -d --build
docker compose ps
```

Abre `http://localhost:8080/`, elige un nombre de jugador y pulsa "Buscar partida" (necesitas dos
pestañas/navegadores distintos para emparejar).

## Estructura del repositorio

```
PROYECTO_VIDEOJUEGO/
├── backend/            API REST + Socket.IO + matchmaking + rondas (Node.js)
│   ├── src/             server.js, app.js, config.js, db.js, redisClient.js, auth.js,
│   │                     routes.js, sockets.js, matchmaking.js, metrics.js
│   └── sql/init.sql     Esquema de la base de datos (players, matches, match_scores)
├── frontend/            Login, sala de espera, minijuego y leaderboard (HTML/CSS/JS)
├── nginx/                Imagen Nginx a medida (estático + proxy inverso)
├── documentacion/        Guía de despliegue y ejercicios (Word)
├── docker-compose.yml
├── .env.example
└── README.md
```

## Desarrollo local del backend (sin Docker)

```bash
cd backend
npm install
cp .env.example .env      # ajusta PGHOST/REDIS_HOST a localhost si tienes Postgres/Redis locales
npm run dev
```
