import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";

/**
 * lib/env.ts validates configuration at import time and throws if it is
 * incomplete, so any test touching a module that reads config needs the same
 * environment the app gets. Vitest does not load .env files on its own.
 *
 * .env.test.local takes precedence, so tests can be pointed at a throwaway
 * database without disturbing the development one.
 */
dotenv.config({ path: [".env.test.local", ".env.local", ".env"], quiet: true });
