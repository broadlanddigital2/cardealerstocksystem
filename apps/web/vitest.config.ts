import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/server$/, replacement: path.resolve(import.meta.dirname, "server/index.ts") },
      { find: /^@\/server\/(.*)$/, replacement: path.resolve(import.meta.dirname, "server/$1") },
      { find: /^@\/(.*)$/, replacement: path.resolve(import.meta.dirname, "src/$1") },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    testTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.{ts,tsx}", "middleware.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          environment: "node",
          include: ["server/test/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});
