import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    // e2e/ belongs to Playwright — Vitest must not try to run those files.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      // The rules worth guarding: workflow legality, access control, and the
      // anonymity boundary. Coverage elsewhere is informational.
      include: ["lib/workflow/**", "lib/auth/**", "lib/dto/**", "lib/files/**"],
    },
  },
});
