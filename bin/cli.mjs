#!/usr/bin/env node
// One-command installer for the click-to-source inspector (Next.js + Vite).
//   npx open-in-code-editor            install (skips files that exist)
//   npx open-in-code-editor update     re-copy the inspector to this version
//   npx open-in-code-editor --force    same as update (alias)
// Detects a Next.js app-router or a Vite + React project, copies the inspector
// in with a relative import (no `@/` alias required), and wires the entry file
// (layout.tsx for Next, main.tsx for Vite). On Vite it also registers a dev-only
// plugin in vite.config so the dev server can report the project root that
// editor deeplinks need. Idempotent and dependency-free.
// The entry wiring is never touched twice; `update`/`--force` only overwrites
// the copied inspector files, so pin a version to upgrade:
// `npx open-in-code-editor@latest update`.

import {
  appendFileSync,
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

// --- 1. Detect the framework ---------------------------------------------

// Next.js app router: a root layout renders <body> (src/app or ./app).
function findNextLayout() {
  for (const base of ["src", "."]) {
    const appDir = join(cwd, base, "app")
    for (const ext of ["tsx", "jsx"]) {
      const layout = join(appDir, `layout.${ext}`)
      if (existsSync(layout)) return { base: join(cwd, base), appDir, layout }
    }
  }
  return null
}

// Vite: a vite config plus a client entry module. Prefer the entry declared in
// index.html; fall back to the conventional src/main.{tsx,jsx}.
function findViteEntry() {
  const configFile = ["ts", "js", "mts", "mjs", "cts", "cjs"]
    .map((ext) => join(cwd, `vite.config.${ext}`))
    .find((f) => existsSync(f))
  if (!configFile) return null

  const indexHtml = join(cwd, "index.html")
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, "utf8")
    const m =
      html.match(/<script[^>]*type=["']module["'][^>]*\ssrc=["']([^"']+)["']/i) ||
      html.match(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*type=["']module["']/i)
    if (m) {
      const entry = join(cwd, m[1].replace(/^\//, ""))
      if (/\.[jt]sx$/.test(entry) && existsSync(entry)) {
        return { base: dirname(entry), entry, configFile }
      }
    }
  }

  for (const rel of ["src/main.tsx", "src/main.jsx", "main.tsx", "main.jsx"]) {
    const entry = join(cwd, rel)
    if (existsSync(entry)) return { base: dirname(entry), entry, configFile }
  }
  return null
}

const nextApp = findNextLayout()
const viteApp = nextApp ? null : findViteEntry()

if (!nextApp && !viteApp) {
  console.error(
    "Could not find a supported project here. Run this from your project root.\n" +
      "  • Next.js 16 (app router): expected app/layout.tsx or src/app/layout.tsx\n" +
      "  • Vite + React: expected vite.config.* and a src/main.tsx entry\n" +
      "https://github.com/unikolas/open-in-code-editor#supported-frameworks",
  )
  process.exit(1)
}

const framework = nextApp ? "next" : "vite"
const base = nextApp ? nextApp.base : viteApp.base

// --- 2. Copy the inspector folder (framework resolver copied in as source.ts).

const inspectorDir = join(base, "inspector")
const inspectorExists = existsSync(inspectorDir)
if (inspectorExists && !force) {
  log(
    `• inspector/ already exists at ${relative(cwd, inspectorDir)} — ` +
      "re-run with `update` to refresh it. Skipping.",
  )
  // The dev-server plugin arrived after the first Vite releases, so add it even
  // on a plain re-run — without it editor deeplinks have no project root.
  if (framework === "vite" && !existsSync(join(inspectorDir, "vite-plugin.ts"))) {
    copyFileSync(
      join(templates, "inspector", "vite-plugin.ts"),
      join(inspectorDir, "vite-plugin.ts"),
    )
    log(`✓ Added ${relative(cwd, join(inspectorDir, "vite-plugin.ts"))} (new in this version)`)
  }
} else {
  mkdirSync(inspectorDir, { recursive: true })
  const resolver = framework === "next" ? "source.next.ts" : "source.vite.ts"
  for (const file of readdirSync(join(templates, "inspector"))) {
    if (file === "source.next.ts" || file === "source.vite.ts") continue
    // The plugin is Vite's way of reporting the project root; Next.js gets that
    // from its server render, so it has no use for the file.
    if (file === "vite-plugin.ts" && framework !== "vite") continue
    const src = join(templates, "inspector", file)
    const dst = join(inspectorDir, file)
    if (framework === "vite" && file === "Inspector.tsx") {
      // "use client" only means something to Next.js, and Rollup (Vite < 8)
      // warns about module-level directives on every production build.
      writeFileSync(dst, readFileSync(src, "utf8").replace(/^"use client"\r?\n\r?\n?/, ""))
    } else {
      copyFileSync(src, dst)
    }
  }
  copyFileSync(join(templates, "inspector", resolver), join(inspectorDir, "source.ts"))
  const dst = relative(cwd, inspectorDir)
  log(inspectorExists ? `✓ Updated inspector in ${dst}/` : `✓ Copied inspector into ${dst}/`)
}

// The relative import path from a file to a module inside inspector/.
function importPathFrom(entryFile, target = "Inspector") {
  let p = relative(dirname(entryFile), join(inspectorDir, target))
  if (!p.startsWith(".")) p = `./${p}`
  return p.split("\\").join("/") // windows -> posix
}

if (framework === "next") {
  wireNext()
} else {
  wireVite()
}

// --- 3a. Next.js: optional API route + patch layout.tsx ------------------

function wireNext() {
  const routeDir = join(nextApp.appDir, "api", "inspector")
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

  const layout = nextApp.layout
  const importPath = importPathFrom(layout)
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
}

// --- 3b. Vite: wire main.tsx + register the plugin in vite.config ---------

function wireVite() {
  // Wire the config first: whether the plugin is in place decides how the mount
  // gets the project root. With the plugin the browser asks the dev server for
  // it; without it we fall back to the older .env.local mechanism (machine-
  // specific, gitignored, needs a restart) and the mount has to pass it in.
  const wired = wireViteConfig()

  const entry = viteApp.entry
  const importPath = importPathFrom(entry)

  let src = readFileSync(entry, "utf8")
  if (/from ["'][^"']*inspector\/Inspector["']/.test(src)) {
    log("• entry already imports Inspector — leaving it as is.")
  } else {
    const importLines =
      `import { createRoot as __inspectorRoot } from "react-dom/client"\n` +
      `import { Inspector as __Inspector } from "${importPath}"\n`
    const element = wired
      ? "<__Inspector />"
      : "<__Inspector projectRoot={import.meta.env.VITE_INSPECTOR_ROOT} />"
    const mount =
      "\n// open-in-code-editor: dev-only click-to-source inspector.\n" +
      "if (import.meta.env.DEV) {\n" +
      "  const el = document.createElement(\"div\")\n" +
      "  document.body.appendChild(el)\n" +
      `  __inspectorRoot(el).render(${element})\n` +
      "}\n"
    const lastImport = [...src.matchAll(/^import[^\n]*\n/gm)].pop()
    if (lastImport) {
      const insertAt = lastImport.index + lastImport[0].length
      src = src.slice(0, insertAt) + importLines + src.slice(insertAt)
      src = src.replace(/\n?$/, "\n") + mount
      writeFileSync(entry, src)
      log(`✓ Wired ${relative(cwd, entry)} (import "${importPath}")`)
    } else {
      log(
        "! Could not auto-edit the entry — add to " + relative(cwd, entry) + ":\n" +
          `    ${importLines.trim().replace(/\n/g, "\n    ")}\n` +
          `    ${mount.trim().replace(/\n/g, "\n    ")}`,
      )
    }
  }

  if (wired) {
    log(
      "\nDone. Vite reloads its config on its own — hold ⌥ Option and click " +
        "any element.",
    )
  } else {
    writeEnvLocal()
    ensureGitignore()
    log(
      "\nDone. Restart your dev server (to load .env.local), then hold ⌥ Option " +
        "and click any element.",
    )
  }
}

// Whether to write the plugin import with an explicit `.ts` extension.
// Neither form is universally right: TypeScript's `nodenext` resolution (the
// current Vite templates) *requires* the extension and Vite 8's native config
// loader warns without it, while `bundler` resolution rejects it unless
// `allowImportingTsExtensions` is set. So: use the extension unless a tsconfig
// exists that hasn't enabled the flag.
function tsImportExtension() {
  const configs = readdirSync(cwd).filter((f) => /^tsconfig.*\.json$/.test(f))
  if (configs.length === 0) return ".ts"
  const allowed = configs.some((f) =>
    /"allowImportingTsExtensions"\s*:\s*true/.test(readFileSync(join(cwd, f), "utf8")),
  )
  return allowed ? ".ts" : ""
}

// Register inspector/vite-plugin.ts in vite.config.* so the dev server can tell
// the browser the absolute project root (editor deeplinks need it). Returns true
// when the config is wired — already or by us. Idempotent: keyed on the import.
function wireViteConfig() {
  const configFile = viteApp.configFile
  const pluginPath = importPathFrom(configFile, "vite-plugin") + tsImportExtension()
  const importLine = `import { inspectorPlugin } from "${pluginPath}"\n`

  let src = readFileSync(configFile, "utf8")
  if (/inspector\/vite-plugin/.test(src)) {
    log("• vite.config already registers the inspector plugin — leaving it as is.")
    return true
  }

  const lastImport = [...src.matchAll(/^import[^\n]*\n/gm)].pop()
  // The first `plugins: [` is the config's own in every layout we can safely
  // patch (object literal or a function returning one).
  if (!lastImport || !/plugins\s*:\s*\[/.test(src)) {
    log(
      "! Could not auto-edit " + relative(cwd, configFile) + " — add manually:\n" +
        `    ${importLine.trim()}\n` +
        "    plugins: [inspectorPlugin(), /* your other plugins */]",
    )
    return false
  }

  const insertAt = lastImport.index + lastImport[0].length
  src = src.slice(0, insertAt) + importLine + src.slice(insertAt)
  const plugins = src.match(/plugins\s*:\s*\[/)
  const at = plugins.index + plugins[0].length
  // No trailing comma when the array was empty, so `plugins: [inspectorPlugin()]`
  // stays clean.
  const insertion = /^\s*\]/.test(src.slice(at)) ? "inspectorPlugin()" : "inspectorPlugin(), "
  src = src.slice(0, at) + insertion + src.slice(at)
  writeFileSync(configFile, src)
  log(`✓ Registered the inspector plugin in ${relative(cwd, configFile)}`)
  return true
}

// Fallback for projects whose vite.config we couldn't patch: bake the absolute
// project root into a gitignored .env.local instead. Vite has no server render
// to hand us process.cwd(), and editor deeplinks need an absolute path.
function writeEnvLocal() {
  const envFile = join(cwd, ".env.local")
  const line = `VITE_INSPECTOR_ROOT=${cwd}`
  let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : ""
  if (/^VITE_INSPECTOR_ROOT=/m.test(content)) {
    content = content.replace(/^VITE_INSPECTOR_ROOT=.*$/m, line)
    writeFileSync(envFile, content)
    log("✓ Updated VITE_INSPECTOR_ROOT in .env.local")
  } else {
    if (content && !content.endsWith("\n")) content += "\n"
    content +=
      "# open-in-code-editor: absolute project root for editor deeplinks (dev only)\n" +
      `${line}\n`
    writeFileSync(envFile, content)
    log("✓ Wrote VITE_INSPECTOR_ROOT to .env.local")
  }
}

// Make sure .env.local won't be committed (its value is machine-specific).
function ensureGitignore() {
  const gi = join(cwd, ".gitignore")
  const content = existsSync(gi) ? readFileSync(gi, "utf8") : ""
  if (/^\s*(\.env\.local|\.env\*\.local|\.env\*|\*\.local)\s*$/m.test(content)) return
  appendFileSync(gi, (content && !content.endsWith("\n") ? "\n" : "") + ".env.local\n")
  log("✓ Added .env.local to .gitignore")
}
