/**
 * Dev-only Vite plugin for the click-to-source inspector.
 *
 * The browser needs an *absolute* path to build an editor deeplink
 * (`cursor://file/Users/you/app/src/Card.tsx:12:3`), but a Vite app only ever
 * sees project-relative module URLs. This plugin closes that gap: as the dev
 * server serves inspector/source.ts, it rewrites a placeholder literal there to
 * Vite's own project root. The root is then a constant the moment the module
 * loads — no request, nothing to wait on at click time — and the inspector
 * never has to be told the path out of band (the older `VITE_INSPECTOR_ROOT`
 * in `.env.local` still works, but it is machine-specific, gitignored, and only
 * picked up on a dev-server restart).
 *
 * It's a `transform` hook rather than an index.html injection because every
 * module goes through `transform` — SPAs, SSR frameworks that render their own
 * HTML (React Router, TanStack Start) and Storybook alike.
 *
 * Register it in vite.config.* (the installer does this for you):
 *   import { inspectorPlugin } from "./src/inspector/vite-plugin.ts"
 *   export default defineConfig({ plugins: [inspectorPlugin(), react()] })
 *
 * `apply: "serve"` keeps it out of production builds entirely.
 *
 * Two deliberate constraints, because this file sits in the app's `src/` and is
 * therefore typechecked by the app's tsconfig:
 *  - no `import type { Plugin } from "vite"` — projects that don't depend on
 *    Vite (like this repo's Next.js demo) must still compile it. The structural
 *    types below satisfy Vite's PluginOption.
 *  - no Node built-ins (`node:fs`, `process`) — app tsconfigs typically set
 *    `types: ["vite/client"]`, so anything Node-shaped fails `tsc`. Everything
 *    here comes from Vite's own objects instead.
 */

// The placeholder in source.ts (`SERVED_ROOT`), and the same token with its
// quotes — either style, so a formatter run over inspector/ doesn't break the
// match. Regex literals only: a quoted copy of the token in this file would be
// rewritten too if Vite ever served it (a test importing the plugin, say).
const PLACEHOLDER = /__OPEN_IN_CODE_EDITOR_ROOT__/
const QUOTED_PLACEHOLDER = /(["'])__OPEN_IN_CODE_EDITOR_ROOT__\1/g

/**
 * The route 0.5.0/0.5.1 served the root from. Gone, but still exported: a copy
 * of their source.ts imports it, and a plain re-run of the installer can put
 * this file next to one. Without the export that app wouldn't load at all;
 * with it, the old source.ts falls back to VITE_INSPECTOR_ROOT.
 */
export const INSPECTOR_ENDPOINT = "/__open-in-code-editor"

type ResolvedConfigLike = { root?: string }

export function inspectorPlugin() {
  // Vite's `root` — not the process cwd — is what module URLs are relative to,
  // so it's the correct base for the paths the inspector resolves. The two
  // differ in monorepos and whenever `root` is set explicitly.
  let root = ""

  return {
    name: "open-in-code-editor",
    apply: "serve" as const,
    // Before Vite's own TypeScript transform, so the placeholder is matched in
    // the file exactly as written.
    enforce: "pre" as const,
    configResolved(config: ResolvedConfigLike) {
      root = config.root ?? ""
    },
    transform: {
      // Vite 6.3+ skips the hook for every module without the token; older
      // versions ignore `filter` and call it for everything.
      filter: { code: PLACEHOLDER },
      handler(code: string) {
        if (!root) return null
        // Replaced within its own line, so no other line's mappings move. A
        // function rather than a string, or a `$` in the path (`/srv/a$'b`)
        // would be read as a replacement pattern.
        const out = code.replace(QUOTED_PLACEHOLDER, () => JSON.stringify(root))
        return out === code ? null : { code: out, map: null }
      },
    },
  }
}
