import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * The single Prisma client for the process.
 *
 * Each PrismaClient opens its own connection pool. Next.js hot-reloads modules
 * on every edit in development, so without caching on globalThis a long session
 * would quietly open dozens of pools until Postgres refuses new connections.
 */

const createClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const db = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
