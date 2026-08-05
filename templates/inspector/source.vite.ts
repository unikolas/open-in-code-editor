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
 * path. Vite has no server render to hand us `process.cwd()`, so the installer
 * writes the project root into a gitignored `.env.local` and the mount passes
 * it in as `projectRoot` (see cli.mjs). When it's absent we fall back to Vite's
 * built-in `GET /__open-in-editor`, which resolves a root-relative path itself.
 */

import type { DebugSource } from "./fiber"

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
  if (url.pathname.startsWith("/@vite") || url.pathname.startsWith("/@react-refresh")) return null
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
 * Vite has no install-aware editor route, so the picker always shows the
 * static list. (The "auto" option defers to Vite's own launch-editor.)
 */
export async function detectEditors(): Promise<EditorOption[]> {
  return FALLBACK_EDITORS
}

/**
 * Open the location. A concrete editor id ("vscode", "cursor", …) launches
 * that editor's URL scheme with an absolute path (`projectRoot` + the
 * project-relative file). "auto" — or a missing projectRoot — instead hits
 * Vite's built-in `/__open-in-editor`, which resolves the path server-side.
 */
let warnedMissingRoot = false

export function openInEditor(
  loc: SourceLocation,
  projectRoot: string,
  editor: string
): string | null {
  const root = projectRoot ? projectRoot.replace(/\/+$/, "") : ""
  const isAbsolute = loc.file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(loc.file)
  // Absolute paths are used as-is; only project-relative paths get root prefixed.
  const abs = isAbsolute ? loc.file : root ? `${root}/${loc.file}` : null
  // A concrete editor was picked but there's no absolute path to feed its URL
  // scheme — Vite can't hand the browser the project root unless
  // VITE_INSPECTOR_ROOT is set. This is the usual "nothing opens on click":
  // the pick can't be honored, so we fall back to the dev server's own
  // detection and return a message the caller shows in the overlay (a console
  // warning alone goes unseen).
  const missingRoot = editor !== "auto" && !abs
  if (editor === "auto" || !abs) {
    if (missingRoot && !warnedMissingRoot) {
      warnedMissingRoot = true
      console.warn(
        `[open-in-code-editor] "${editor}" is selected, but the project root ` +
          "is unknown (VITE_INSPECTOR_ROOT is not set), so the dev server's " +
          "own editor detection decides which editor opens. Run `npx " +
          "open-in-code-editor` to write it to .env.local, then restart the " +
          "dev server."
      )
    }
    const target = `${abs ?? loc.file}:${loc.line1}:${loc.column1}`
    void fetch(`/__open-in-editor?file=${encodeURIComponent(target)}`)
    return missingRoot
      ? `Can't open "${editor}": VITE_INSPECTOR_ROOT isn't set, so the dev ` +
          "server picked the editor. Run `npx open-in-code-editor` and restart " +
          "the dev server."
      : null
  }
  window.location.href = `${editor}://file${abs}:${loc.line1}:${loc.column1}`
  return null
}
