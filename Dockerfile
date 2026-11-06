FROM oven/bun:1.4.4
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages/server/package.json packages/server/
COPY packages/sdk/package.json packages/sdk/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY secenv.example.toml ./secenv.toml

ENV NODE_ENV=production
# The SQLite database lives here; mount a persistent disk at this path.
# Runs as root because platform disks (e.g. Render) are mounted root-owned.
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||4400)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "packages/server/src/index.ts"]
