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
  const mysql = config.MYSQL || {};
  const user = encode(mysql.USER);
  const password = encode(mysql.PASSWORD);
  const host = mysql.HOST || "localhost";
  const port = mysql.PORT || 3306;
  const database = encode(mysql.DATABASE);

  if (!user || !database) return undefined;
  return `mysql://${user}:${password}@${host}:${port}/${database}`;
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
