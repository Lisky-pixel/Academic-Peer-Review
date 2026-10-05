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
    // One file at a time. The *.db.test.ts files share one real database and
    // delete the accounts they create; run in parallel, one file's cleanup
    // removes an administrator at the moment another file's submission is
    // notifying "every administrator", and the insert fails on a foreign key.
    // That cannot happen in the application, which never deletes active
    // users — it is purely an artefact of concurrent test cleanup.
    fileParallelism: false,
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
