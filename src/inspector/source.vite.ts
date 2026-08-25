/**
 * Vite variant of source resolution.
 *
 * Where the Next.js build rides the dev server's `/__nextjs_original-stack-frames`
 * endpoint, Vite serves every dev module with an inline sourcemap
 * (`//# sourceMappingURL=data:application/json;base64,…`). So this resolver
 * needs no plugin and no server round-trip for resolution: it fetches the
 * served module a fiber frame points at, decodes its inline sourcemap in the
 * browser, and maps the compiled line/column back to your `src/` file.
 *
 * Opening still uses the chosen editor's URL scheme, which needs an absolute
 * path. Vite has no server render to hand us `process.cwd()`, so the project
 * root comes from the dev-only plugin in `vite-plugin.ts` (`GET
 * /__open-in-code-editor`), which the installer registers in vite.config. A
 * `VITE_INSPECTOR_ROOT` env var passed in as `projectRoot` still works for
 * installs predating the plugin, but the plugin wins when both are present: its
 * value comes off the running server, so it can't go stale. With neither, we
 * fall back to Vite's built-in `GET /__open-in-editor`, which resolves a
 * root-relative path itself but chooses the editor on its own.
 */

import type { DebugSource } from "./fiber"
// The endpoint the dev-server plugin serves. Imported rather than duplicated so
// the two sides can't drift; the plugin module has no Node imports, so pulling
// it into the browser graph costs one string constant.
import { INSPECTOR_ENDPOINT } from "./vite-plugin"

export type SourceLocation = {
  file: string
  line1: number
  column1: number
  /** Name of the component whose body contains this JSX, when known. */
  enclosingName: string | null
}

type RawFrame = {
  file: string
  methodName: string
  line1: number
  column1: number
}

const REACT_INTERNAL_METHODS = /jsxDEV|fakeJSXCallSite|react_stack_bottom_frame/
const FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/

function parseStack(stack: string): RawFrame[] {
  const frames: RawFrame[] = []
  for (const line of stack.split("\n")) {
    const m = line.match(FRAME_RE)
    if (!m) continue
    frames.push({
      methodName: m[1] || "<anonymous>",
      file: m[2],
      line1: Number(m[3]),
      column1: Number(m[4]),
    })
  }
  return frames
}

/**
 * Keep a frame only if it points at one of the app's own dev modules. Vite
 * serves those same-origin (`http://host/src/App.tsx`); React internals live
 * under `/node_modules/.vite/deps/` and Vite's own client under `/@vite`,
 * `/@react-refresh` — all dropped. The full URL (query included) is returned
 * so the module can be fetched exactly as it was served.
 */
function acceptFrameFile(file: string): string | null {
  if (file === "<anonymous>" || file.startsWith("node:")) return null
  if (!/^https?:\/\//.test(file)) return null
  let url: URL
  try {
    url = new URL(file)
  } catch {
    return null
  }
  if (typeof location !== "undefined" && url.origin !== location.origin) return null
  if (url.pathname.includes("/node_modules/")) return null
  // Not anchored at "/": under a non-default `base` these live at
  // `/app/@vite/client`, not `/@vite/client`.
  if (/\/@(vite|react-refresh)/.test(url.pathname)) return null
  return file
}

/** JSX call-site candidates: up to two useful frames per owner level. */
function candidateFrames(sources: DebugSource[]): RawFrame[] {
  const frames: RawFrame[] = []
  for (const source of sources) {
    if (!source.stack) continue
    let taken = 0
    for (const frame of parseStack(source.stack)) {
      if (taken >= 2) break
      if (REACT_INTERNAL_METHODS.test(frame.methodName)) continue
      const file = acceptFrameFile(frame.file)
      if (!file) continue
      frames.push({ ...frame, file })
      taken++
    }
  }
  return frames
}

// --- Inline sourcemap decoding -------------------------------------------

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const CHAR_TO_INT: Record<string, number> = {}
for (let i = 0; i < BASE64.length; i++) CHAR_TO_INT[BASE64[i]] = i

/**
 * Decode a sourcemap `mappings` string into per-generated-line arrays of
 * segments `[genCol, sourceIndex, sourceLine, sourceColumn, nameIndex?]`
 * (all 0-based). A tiny VLQ reader so there's no runtime dependency.
 */
function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = []
  let line: number[][] = []
  let genCol = 0
  let srcIdx = 0
  let srcLine = 0
  let srcCol = 0
  let nameIdx = 0
  let i = 0
  const n = mappings.length
  while (i < n) {
    const ch = mappings[i]
    if (ch === ";") {
      lines.push(line)
      line = []
      genCol = 0
      i++
    } else if (ch === ",") {
      i++
    } else {
      const fields: number[] = []
      while (i < n && mappings[i] !== "," && mappings[i] !== ";") {
        let result = 0
        let shift = 0
        let digit: number
        let cont: number
        do {
          digit = CHAR_TO_INT[mappings[i++]]
          cont = digit & 32
          result += (digit & 31) << shift
          shift += 5
        } while (cont)
        fields.push(result & 1 ? -(result >>> 1) : result >>> 1)
      }
      genCol += fields[0]
      const seg = [genCol]
      if (fields.length >= 4) {
        srcIdx += fields[1]
        srcLine += fields[2]
        srcCol += fields[3]
        seg.push(srcIdx, srcLine, srcCol)
        if (fields.length >= 5) {
          nameIdx += fields[4]
          seg.push(nameIdx)
        }
      }
      line.push(seg)
    }
  }
  lines.push(line)
  return lines
}

type DecodedMap = {
  url: string
  sources: (string | null)[]
  sourceRoot: string | null
  lines: number[][][]
}

const INLINE_MAP_RE = /sourceMappingURL=(data:application\/json[^\s'"]+)/

const mapCache = new Map<string, Promise<DecodedMap | null>>()

async function loadSourceMap(moduleUrl: string): Promise<DecodedMap | null> {
  let cached = mapCache.get(moduleUrl)
  if (!cached) {
    cached = fetchAndDecodeMap(moduleUrl)
    mapCache.set(moduleUrl, cached)
  }
  return cached
}

async function fetchAndDecodeMap(moduleUrl: string): Promise<DecodedMap | null> {
  let text: string
  try {
    const res = await fetch(moduleUrl)
    if (!res.ok) return null
    text = await res.text()
  } catch {
    return null
  }
  const m = text.match(INLINE_MAP_RE)
  if (!m) return null
  const uri = m[1]
  const comma = uri.indexOf(",")
  if (comma === -1) return null
  const meta = uri.slice(0, comma)
  const data = uri.slice(comma + 1)
  let json: { mappings?: unknown; sources?: unknown; sourceRoot?: unknown }
  try {
    json = JSON.parse(/;base64/.test(meta) ? atob(data) : decodeURIComponent(data))
  } catch {
    return null
  }
  if (typeof json.mappings !== "string") return null
  return {
    url: moduleUrl,
    sources: Array.isArray(json.sources) ? (json.sources as (string | null)[]) : [],
    sourceRoot: typeof json.sourceRoot === "string" ? json.sourceRoot : null,
    lines: decodeMappings(json.mappings),
  }
}

/**
 * Map a compiled (1-based) position to the original source file and position.
 * `file` comes back as a project-relative path (no leading slash), derived by
 * resolving the sourcemap's (usually relative) source against the module URL.
 */
function originalPositionFor(
  map: DecodedMap,
  line1: number,
  column1: number
): { file: string; line1: number; column1: number } | null {
  const segs = map.lines[line1 - 1]
  if (!segs || segs.length === 0) return null
  const genCol = column1 - 1
  let seg: number[] | null = null
  for (const s of segs) {
    if (s[0] <= genCol) seg = s
    else break
  }
  if (!seg || seg.length < 4) return null
  const source = map.sources[seg[1]]
  if (source == null) return null

  // /@fs/ is Vite's way of serving an absolute path — unwrap to the fs path.
  const raw = source.startsWith("/@fs/") ? source.slice(4) : source

  let file: string
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
    // Absolute source path (some toolchains emit these) — keep it as-is so
    // openInEditor sees the leading slash and won't re-prefix projectRoot.
    file = raw
  } else {
    // Vite's usual case: source is relative to the served module. Resolve it
    // to a project-relative path (leading slash stripped).
    try {
      const base = map.sourceRoot
        ? new URL(map.sourceRoot.replace(/\/?$/, "/"), map.url)
        : new URL(map.url)
      file = new URL(raw, base).pathname.replace(/^\/+/, "")
    } catch {
      file = raw.replace(/^\/+/, "")
    }
  }
  return { file, line1: seg[2] + 1, column1: seg[3] + 1 }
}

/**
 * Resolve the JSX call sites for this element, walking outward through the
 * owner chain: index 0 is the innermost site (the component's own definition),
 * the last entry is the outermost site (typically where it's used on the page).
 * Duplicates and node_modules frames are dropped; empty when nothing resolves.
 */
export async function resolveSources(
  sources: DebugSource[],
  projectRoot: string
): Promise<SourceLocation[]> {
  // Resolution is projectRoot-independent — Vite frames carry the project path
  // in their URLs. The parameter is kept for parity with the Next resolver.
  void projectRoot
  const frames = candidateFrames(sources)
  if (frames.length === 0) return []

  const locations: SourceLocation[] = []
  const seen = new Set<string>()
  for (const frame of frames) {
    const map = await loadSourceMap(frame.file)
    if (!map) continue
    const orig = originalPositionFor(map, frame.line1, frame.column1)
    if (!orig) continue
    if (orig.file.includes("node_modules")) continue
    const key = `${orig.file}:${orig.line1}:${orig.column1}`
    if (seen.has(key)) continue
    seen.add(key)
    const methodName = frame.methodName.replace(/^Object\./, "")
    locations.push({
      file: orig.file,
      line1: orig.line1,
      column1: orig.column1,
      enclosingName:
        methodName && methodName !== "<anonymous>" ? methodName : null,
    })
  }
  return locations
}

export type EditorOption = { id: string; label: string }

/**
 * Dev gate for the shared inspector files. `import.meta.env.DEV` is Vite's
 * canonical flag; the cast keeps this file compiling in projects without
 * `vite/client` types (including this repo's own Next.js demo app).
 */
export const IS_DEV = Boolean(
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
)

export const FALLBACK_EDITORS: EditorOption[] = [
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
  { id: "cursor", label: "Cursor" },
  { id: "windsurf", label: "Windsurf" },
  { id: "zed", label: "Zed" },
  { id: "auto", label: "Auto (dev server)" },
]

/**
 * Vite has no install-aware editor route, so the picker always shows the static
 * list. (Detecting installed apps needs `node:fs`, which the plugin can't touch
 * — it lives in the app's `src/` and would break the app's own typecheck.)
 */
export async function detectEditors(): Promise<EditorOption[]> {
  return FALLBACK_EDITORS
}

type ServerInfo = { root: string; base: string }

/**
 * Vite inlines the configured base here, so a resolved path can be
 * de-prefixed even when the plugin isn't registered to report it.
 */
const ENV_BASE =
  (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/"

const NO_SERVER_INFO: ServerInfo = { root: "", base: ENV_BASE }

let serverInfo: Promise<ServerInfo> | null = null

/**
 * Ask the dev server where the project lives. An empty root means the Vite
 * plugin isn't registered — the inspector then falls back to
 * `VITE_INSPECTOR_ROOT` and, failing that, to Vite's own `/__open-in-editor`.
 * Successes are cached for the page's lifetime; failures aren't, so a click that
 * lands while the server is restarting (which registering the plugin itself
 * causes) doesn't pin the tab to the fallback until a manual reload.
 */
async function fetchServerInfo(): Promise<ServerInfo> {
  if (!serverInfo) {
    serverInfo = (async () => {
      try {
        const res = await fetch(INSPECTOR_ENDPOINT)
        if (!res.ok) return NO_SERVER_INFO
        const body = (await res.json()) as { root?: unknown; base?: unknown }
        if (typeof body.root !== "string" || !body.root) return NO_SERVER_INFO
        return {
          root: body.root,
          base: typeof body.base === "string" && body.base ? body.base : ENV_BASE,
        }
      } catch {
        return NO_SERVER_INFO
      }
    })()
  }
  const info = await serverInfo
  if (!info.root) serverInfo = null
  return info
}

/**
 * Resolved paths are derived from module URL *pathnames*, so under a non-default
 * `base` they carry that prefix (`base: "/app/"` -> `app/src/Card.tsx`) while
 * the project root does not. Strip it before joining the two.
 */
function stripBase(file: string, base: string): string {
  const prefix = base.replace(/^\/+/, "").replace(/\/*$/, "/")
  return prefix !== "/" && file.startsWith(prefix) ? file.slice(prefix.length) : file
}

/**
 * Open the location. A concrete editor id ("vscode", "cursor", …) launches that
 * editor's URL scheme with an absolute path — which needs the project root:
 *
 *   1. the root reported by inspector/vite-plugin.ts — read off the running dev
 *      server, so it can never be stale;
 *   2. the `projectRoot` prop (`VITE_INSPECTOR_ROOT`), how installs predating
 *      the plugin got the root;
 *   3. neither: fall back to Vite's built-in `/__open-in-editor`, which resolves
 *      the path server-side but picks the editor itself (LAUNCH_EDITOR/EDITOR,
 *      else a guess that needs `code` on PATH), so the picker is ignored.
 *
 * "auto" always takes route 3 by request. Returns a message for the overlay when
 * the click couldn't be honored as asked, else null.
 */
let warnedMissingRoot = false
let warnedRootMismatch = false

export async function openInEditor(
  loc: SourceLocation,
  projectRoot: string,
  editor: string
): Promise<string | null> {
  const isAbsolute = loc.file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(loc.file)
  const envRoot = projectRoot ? projectRoot.replace(/\/+$/, "") : ""
  let root = envRoot
  let file = loc.file
  let authoritative = false

  // Only pay for the round trip when a root is actually needed.
  if (!isAbsolute) {
    const info = await fetchServerInfo()
    const pluginRoot = info.root.replace(/\/+$/, "")
    file = stripBase(file, info.base)
    if (pluginRoot) {
      root = pluginRoot
      authoritative = true
    }
    if (envRoot && pluginRoot && envRoot !== pluginRoot && !warnedRootMismatch) {
      warnedRootMismatch = true
      console.warn(
        `[open-in-code-editor] VITE_INSPECTOR_ROOT (${envRoot}) disagrees with ` +
          `the dev server's project root (${pluginRoot}); using the dev ` +
          "server's. The .env.local line is stale — you can delete it."
      )
    }
  }

  // Absolute paths are used as-is; only project-relative paths get root prefixed.
  const abs = isAbsolute ? file : root ? `${root}/${file}` : null
  // A concrete editor was picked but there's no absolute path to feed its URL
  // scheme — neither the plugin nor VITE_INSPECTOR_ROOT told us the project
  // root. This is the usual "nothing opens on click" / "wrong editor opens":
  // the pick can't be honored, so we hand the click to the dev server and
  // return a message the caller shows in the overlay (a console warning alone
  // goes unseen).
  const missingRoot = editor !== "auto" && !abs
  if (editor === "auto" || !abs) {
    if (missingRoot && !warnedMissingRoot) {
      warnedMissingRoot = true
      console.warn(
        `[open-in-code-editor] "${editor}" is selected, but the project root is ` +
          "unknown, so the dev server's own editor detection decides which " +
          "editor opens (and fails outright if `code` isn't on your PATH). Run " +
          "`npx open-in-code-editor@latest update` to add the Vite plugin that " +
          "reports the root."
      )
    }
    // Only hand over an absolute path we trust. An unverified `VITE_INSPECTOR_ROOT`
    // may point at a moved project, and Vite resolves a relative path against
    // its own root anyway — strictly better than a confidently wrong one.
    const target = `${authoritative && abs ? abs : file}:${loc.line1}:${loc.column1}`
    void fetch(`/__open-in-editor?file=${encodeURIComponent(target)}`)
    return missingRoot
      ? `Can't open "${editor}": the inspector doesn't know your project path, ` +
          "so the dev server picked the editor. Run `npx " +
          "open-in-code-editor@latest update` to add the Vite plugin."
      : null
  }
  window.location.href = `${editor}://file${abs}:${loc.line1}:${loc.column1}`
  return null
}
