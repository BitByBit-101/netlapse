# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines env vars at BUILD time, not run time — there is no server-side
# config to change later. Empty by default means every request goes to a
# relative /api/... path, which is what the nginx stage below proxies. Override
# with --build-arg VITE_API_URL=https://api.example.com to point at a separate
# API host instead.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM nginx:1.27-alpine

# Serves dist/ and reverse-proxies /api/ to the backend, so the browser only
# ever talks to one origin and CORS never enters the picture.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
