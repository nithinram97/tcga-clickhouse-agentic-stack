import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

/**
 * The Foundry packages live in a private registry, so a checkout without access
 * must still build and run in mock mode. This aliases any that are absent to a
 * stub that throws only if something actually calls them — nothing does unless
 * VITE_DATA_SOURCE=foundry.
 */
function optionalFoundry() {
  const pkgs = [
    "@fdc9-skywiseperfodynamiclp/sdk",
    "@osdk/client",
    "@osdk/oauth",
    "@osdk/foundry.admin"
  ];
  const missing = pkgs.filter((p) => {
    try { require.resolve(p); return false; } catch { return true; }
  });

  return {
    name: "optional-foundry",
    config() {
      if (!missing.length) return {};
      const stub = path.resolve(process.cwd(), "src/data/foundry-missing.js");
      return { resolve: { alias: Object.fromEntries(missing.map((p) => [p, stub])) } };
    },
    configResolved() {
      if (missing.length) {
        console.log(`\n  Foundry SDK not installed — running in mock mode.`);
        console.log(`  Missing: ${missing.join(", ")}\n`);
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  /**
   * Your registered redirect URI is
   *   http://localhost:5173/skywise-perfo-dynamic-lp/auth/callback
   * so the app is served under that base path, not at the root. Vite has to know
   * — otherwise /skywise-perfo-dynamic-lp/… 404s and the OAuth callback lands on
   * a page that never loads the app.
   *
   * Set VITE_BASE_PATH=/skywise-perfo-dynamic-lp/ in .env (leading AND trailing
   * slash).
   */
  const base = env.VITE_BASE_PATH || "/";

  return {
    base,
    plugins: [react(), optionalFoundry()],
    server: { port: 5173 }
  };
});
