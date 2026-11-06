FROM oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/server/package.json packages/server/
COPY packages/sdk/package.json packages/sdk/
RUN bun install --frozen-lockfile
COPY packages ./packages
COPY secenv.example.toml ./secenv.toml

ENV NODE_ENV=production
# Mount a persistent disk here; the SQLite database lives at /app/data/secenv.db.
VOLUME /app/data
EXPOSE 4400
CMD ["bun", "packages/server/src/index.ts"]
