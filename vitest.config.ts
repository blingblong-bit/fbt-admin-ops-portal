import { defineConfig } from "vitest/config";

// Unit tests exercise mocked handlers directly, not Vite's generated SSR RPC stubs.
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: { environment: "node" },
});