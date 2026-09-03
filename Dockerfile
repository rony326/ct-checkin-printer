# syntax=docker/dockerfile:1

# Multi-Stage-Build (siehe Plan, Abschnitt "Deployment"): Frontend- und
# Backend-Build laufen isoliert mit vollen devDependencies, das Runtime-Image
# enthält nur die kompilierten Artefakte + Produktions-Abhängigkeiten +
# Python3 ausschliesslich für den Brother-Raster-Helper (siehe
# backend/python/requirements.txt und LabelRenderer.ts-Kommentar zur
# Adapter-gekapselten Python-Abhängigkeit).
#
# Debian-slim statt Alpine: @napi-rs/canvas liefert vorkompilierte
# Native-Binaries aus, aber ungetestet gegen musl/Alpine in diesem Setup —
# glibc (Debian) ist der sichere Default. NICHT in diesem Sandbox gebaut/
# getestet (kein Docker-Daemon verfügbar) — vor dem ersten produktiven
# Rollout einmal `docker compose build && docker compose up` durchspielen.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
COPY frontend frontend
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/python/requirements.txt backend/python/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r backend/python/requirements.txt

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/migrations backend/migrations
COPY --from=build /app/backend/assets backend/assets
COPY backend/python backend/python
COPY --from=build /app/frontend/dist frontend/dist

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/backend
# Migration läuft vor jedem Start — idempotent (drizzle überspringt bereits
# angewendete Migrationen), damit ein Update per `docker compose up` allein
# genügt, ohne einen separaten Migrationsschritt zu vergessen.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
