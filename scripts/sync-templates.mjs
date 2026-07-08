#!/usr/bin/env node
// Regenerates templates/ from the live inspector source so src/inspector/
// stays the single source of truth. The demo app runs the real files;
// `npx open-in-code-editor` ships these generated copies. Run via
// `pnpm sync-templates` or automatically on `prepack`.

import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const templates = join(root, "templates")

rmSync(templates, { recursive: true, force: true })

// Inspector component + helpers -> templates/inspector/
const inspectorSrc = join(root, "src", "inspector")
const inspectorOut = join(templates, "inspector")
mkdirSync(inspectorOut, { recursive: true })
for (const file of readdirSync(inspectorSrc)) {
  copyFileSync(join(inspectorSrc, file), join(inspectorOut, file))
}

// Optional API route -> templates/api/route.ts
const routeOut = join(templates, "api")
mkdirSync(routeOut, { recursive: true })
copyFileSync(
  join(root, "src", "app", "api", "inspector", "route.ts"),
  join(routeOut, "route.ts"),
)

console.log("Synced templates/ from src/inspector/ and the API route.")
