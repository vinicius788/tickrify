import "dotenv/config";
import { defineConfig } from "prisma/config";

function pickDbUrl() {
  const raw =
    process.env.MIGRATIONS_DATABASE_URL ??
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!raw) {
    throw new Error(
      "Missing DB env. Set MIGRATIONS_DATABASE_URL (recommended) or DATABASE_URL.",
    );
  }

  const url = raw.trim();

  if (url.startsWith('"') || url.startsWith("'")) {
    throw new Error(
      "DB URL starts with quotes. In Vercel env vars, do NOT include quotes in the value.",
    );
  }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      `Invalid DB URL scheme: ${url.slice(0, 20)}... Must start with postgresql:// or postgres://`,
    );
  }

  return url;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: pickDbUrl() },
});
