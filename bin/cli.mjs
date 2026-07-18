#!/usr/bin/env node
// One-command installer for the click-to-source inspector.
//   npx open-in-code-editor            install (skips files that exist)
//   npx open-in-code-editor update     re-copy the inspector to this version
//   npx open-in-code-editor --force    same as update (alias)
// Copies the inspector into your app and wires up layout.tsx with a relative
// import (no `@/` alias required). Idempotent and dependency-free. The layout
// wiring is never touched twice; `update`/`--force` only overwrites the copied
// inspector files, so pin a version to upgrade: `npx open-in-code-editor@latest`.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const templates = join(dirname(fileURLToPath(import.meta.url)), "..", "templates")
const cwd = process.cwd()

// `update`/`--force`/`-f` re-copy existing files instead of skipping them.
const force = process.argv
  .slice(2)
  .some((a) => a === "update" || a === "--force" || a === "-f" || a === "--update")

function log(msg) {
  console.log(msg)
}

// 1. Locate the app dir and its base (src/app -> base "src", app -> base ".").
function findLayout() {
  for (const base of ["src", "."]) {
    const appDir = join(cwd, base, "app")
    for (const ext of ["tsx", "jsx"]) {
      const layout = join(appDir, `layout.${ext}`)
      if (existsSync(layout)) return { base: join(cwd, base), appDir, layout }
    }
  }
  return null
}

const found = findLayout()
if (!found) {
  console.error(
    "Could not find app/layout.tsx (or src/app/layout.tsx). This tool currently\n" +
      "supports Next.js 16 (app router) only — run it from the root of one.\n" +
      "Vite + React support is coming soon:\n" +
      "https://github.com/unikolas/open-in-code-editor#supported-frameworks",
  )
  process.exit(1)
}
const { base, appDir, layout } = found

// 2. Copy the inspector folder (overwrite existing files with update/--force).
const inspectorDir = join(base, "inspector")
const inspectorExists = existsSync(inspectorDir)
if (inspectorExists && !force) {
  log(
    `• inspector/ already exists at ${relative(cwd, inspectorDir)} — ` +
      "re-run with `update` to refresh it. Skipping.",
  )
} else {
  mkdirSync(inspectorDir, { recursive: true })
  for (const file of readdirSync(join(templates, "inspector"))) {
    copyFileSync(join(templates, "inspector", file), join(inspectorDir, file))
  }
  const dst = relative(cwd, inspectorDir)
  log(inspectorExists ? `✓ Updated inspector in ${dst}/` : `✓ Copied inspector into ${dst}/`)
}

// 3. Copy the optional API route (install-aware editor picker).
const routeDir = join(appDir, "api", "inspector")
const routeFile = join(routeDir, "route.ts")
const routeExists = existsSync(routeFile)
if (routeExists && !force) {
  log(
    `• API route already exists at ${relative(cwd, routeFile)} — ` +
      "re-run with `update` to refresh it. Skipping.",
  )
} else {
  mkdirSync(routeDir, { recursive: true })
  copyFileSync(join(templates, "api", "route.ts"), routeFile)
  const dst = relative(cwd, routeFile)
  log(routeExists ? `✓ Updated API route at ${dst}` : `✓ Copied API route into ${dst}`)
}

// 4. Patch layout.tsx idempotently with a relative import.
let importPath = relative(dirname(layout), join(inspectorDir, "Inspector"))
if (!importPath.startsWith(".")) importPath = `./${importPath}`
importPath = importPath.split("\\").join("/") // windows -> posix

const snippet =
  "{process.env.NODE_ENV === \"development\" && (\n" +
  "        <Inspector projectRoot={process.cwd()} />\n" +
  "      )}"

let src = readFileSync(layout, "utf8")
if (/from ["'][^"']*inspector\/Inspector["']/.test(src)) {
  log("• layout already imports Inspector — leaving it as is.")
} else {
  const importLine = `import { Inspector } from "${importPath}"\n`
  const lastImport = [...src.matchAll(/^import[^\n]*\n/gm)].pop()
  const bodyClose = src.lastIndexOf("</body>")
  if (lastImport && bodyClose !== -1) {
    const insertAt = lastImport.index + lastImport[0].length
    src = src.slice(0, insertAt) + importLine + src.slice(insertAt)
    const bodyIdx = src.lastIndexOf("</body>")
    src = src.slice(0, bodyIdx) + snippet + "\n      " + src.slice(bodyIdx)
    writeFileSync(layout, src)
    log(`✓ Wired ${relative(cwd, layout)} (import "${importPath}")`)
  } else {
    log(
      "! Could not auto-edit layout — add manually inside <body>:\n" +
        `    import { Inspector } from "${importPath}"\n` +
        `    ${snippet.replace(/\n/g, "\n    ")}`,
    )
  }
}

log("\nDone. Start your dev server, then hold ⌥ Option and click any element.")
