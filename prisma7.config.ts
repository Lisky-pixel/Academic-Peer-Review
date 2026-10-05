import path from "node:path";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

/**
 * Next.js loads `.env.local` automatically; the Prisma CLI does not. Loading the
 * same files here, in the same precedence order Next uses, keeps one source of
 * truth for DATABASE_URL — otherwise `pnpm dev` and `pnpm db:migrate` can end
 * up pointed at different databases.
 *
 * dotenv does not overwrite variables that are already set, so a real
 * environment (CI, Vercel) always wins over these files.
 */
dotenv.config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // The seed runs as a separate process, so it loads .env.local itself.
    seed: "tsx --env-file-if-exists=.env.local prisma/seed.ts",
  },
  datasource: {
    // Migrations take locks that a connection pooler (Neon's pooled string)
    // does not pass through reliably. When a direct connection is provided it
    // is used for the CLI; the running application always uses DATABASE_URL.
    url: process.env.DIRECT_DATABASE_URL || env("DATABASE_URL"),
  },
});
