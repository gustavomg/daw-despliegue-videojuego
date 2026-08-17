# Imagen Nginx a medida: sirve el frontend estático de Arena Royale Y actúa de proxy inverso
# hacia el backend (mismo origen para el navegador -> sin problemas de CORS ni de mezclar
# puertos en el frontend).
FROM nginx:1.27-alpine

COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://localhost:80/ >/dev/null || exit 1
