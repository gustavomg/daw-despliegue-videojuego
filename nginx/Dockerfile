# Imagen Nginx a medida: sirve el frontend estático de Arena Royale Y actúa de proxy inverso
# hacia el backend (mismo origen para el navegador -> sin problemas de CORS ni de mezclar
# puertos en el frontend).
FROM nginx:1.27-alpine

COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/

# Comprobación de salud. Se usa 127.0.0.1 y NO "localhost" a propósito: dentro del contenedor
# "localhost" puede resolverse primero a ::1 (IPv6), y como nginx escucha con "listen 80;" (solo
# IPv4), el wget de BusyBox fallaría sin reintentar. El contenedor aparecería como "unhealthy"
# aunque estuviese sirviendo peticiones con total normalidad.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:80/ >/dev/null || exit 1
