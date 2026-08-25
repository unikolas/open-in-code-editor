/**
 * Dev-only Vite plugin for the click-to-source inspector.
 *
 * The browser needs an *absolute* path to build an editor deeplink
 * (`cursor://file/Users/you/app/src/Card.tsx:12:3`), but a Vite app only ever
 * sees project-relative module URLs. This plugin closes that gap: it answers
 * `GET /__open-in-code-editor` with the dev server's own project root, so the
 * inspector never has to be told the path out of band (the older
 * `VITE_INSPECTOR_ROOT` in `.env.local` still works, but it is machine-specific,
 * gitignored, and only picked up on a dev-server restart).
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

export const INSPECTOR_ENDPOINT = "/__open-in-code-editor"

type ResolvedConfigLike = { root?: string }

type ServerLike = {
  middlewares: {
    use(
      path: string,
      handler: (
        req: { method?: string },
        res: {
          statusCode: number
          setHeader(name: string, value: string): void
          end(body?: string): void
        },
        next: () => void
      ) => void
    ): unknown
  }
}

export function inspectorPlugin() {
  // Vite's `root` — not the process cwd — is what module URLs are relative to,
  // so it's the correct base for the paths the inspector resolves. The two
  // differ in monorepos and whenever `root` is set explicitly.
  let root = ""

  return {
    name: "open-in-code-editor",
    apply: "serve" as const,
    configResolved(config: ResolvedConfigLike) {
      root = config.root ?? ""
    },
    configureServer(server: ServerLike) {
      server.middlewares.use(INSPECTOR_ENDPOINT, (req, res, next) => {
        if (req.method && req.method !== "GET" && req.method !== "HEAD") return next()
        res.statusCode = 200
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        res.end(JSON.stringify({ root }))
      })
    },
  }
}
