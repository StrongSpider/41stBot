import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

function encode(value: unknown): string {
  return encodeURIComponent(String(value || ""));
}

function databaseUrlFromConfig(): string | undefined {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];

  const configPath = resolve("config.json");
  if (!existsSync(configPath)) return undefined;

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const postgres = config.POSTGRES || {};
  const user = encode(postgres.USER);
  const password = encode(postgres.PASSWORD);
  const host = postgres.HOST || "localhost";
  const port = postgres.PORT || 5432;
  const database = encode(postgres.DATABASE);

  if (!user || !database) return undefined;
  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrlFromConfig(),
  },
});
