#!/usr/bin/env node
// Regenerates templates/ from the live inspector source so src/inspector/
// stays the single source of truth. The demo app runs the real files;
// `npx open-in-code-editor` ships these generated copies. Run via
// `pnpm sync-templates` or automatically on `prepack`.

import { copyFileSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const templates = join(root, "templates")

rmSync(templates, { recursive: true, force: true })

const inspectorSrc = join(root, "src", "inspector")
const inspectorOut = join(templates, "inspector")
mkdirSync(inspectorOut, { recursive: true })

// Shared inspector files — identical for every framework.
for (const file of ["Inspector.tsx", "fiber.ts", "ui.tsx"]) {
  copyFileSync(join(inspectorSrc, file), join(inspectorOut, file))
}

// Framework-specific source resolvers. The CLI copies the right one in as
// source.ts. The demo app (Next.js) imports source.ts directly, so the Next
// implementation *is* src/inspector/source.ts.
copyFileSync(join(inspectorSrc, "source.ts"), join(inspectorOut, "source.next.ts"))
copyFileSync(join(inspectorSrc, "source.vite.ts"), join(inspectorOut, "source.vite.ts"))

// Optional Next.js API route -> templates/api/route.ts
const routeOut = join(templates, "api")
mkdirSync(routeOut, { recursive: true })
copyFileSync(
  join(root, "src", "app", "api", "inspector", "route.ts"),
  join(routeOut, "route.ts"),
)

console.log(
  "Synced templates/ (shared inspector + source.next/source.vite + API route).",
)
