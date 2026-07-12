/**
 * Turns fiber debug stacks into original source locations and opens them,
 * using two endpoints Next.js's own dev overlay ships:
 *
 *   POST /__nextjs_original-stack-frames  — source-maps compiled frames
 *   GET  /__nextjs_launch-editor          — opens file:line in the editor
 *
 * Frame files come in three shapes (all verified on Next 16 / Turbopack):
 *   - about://React/Server/file://…  server-replayed stacks; pass through
 *   - http://<origin>/_next/static/chunks/X.js  client chunks; the resolver
 *     rejects http URLs, but the same chunk exists on disk under
 *     <projectRoot>/.next/dev/static/…, so rewrite to a file:// URL
 *   - node:/<anonymous>/react internals — dropped
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

/** Map a frame's file to something the resolver accepts, or null to drop it. */
function normalizeFrameFile(file: string, projectRoot: string): string | null {
  if (file.startsWith("about://React/Server/")) return file
  if (file === "<anonymous>" || file.startsWith("node:")) return null
  if (file.includes("next_dist_compiled") || file.includes("/next/dist/")) return null
  if (/^https?:\/\//.test(file)) {
    let url: URL
    try {
      url = new URL(file)
    } catch {
      return null
    }
    if (typeof location !== "undefined" && url.origin !== location.origin) return null
    const prefix = "/_next/static/"
    if (!url.pathname.startsWith(prefix)) return null
    return `file://${projectRoot}/.next/dev/static/${url.pathname.slice(prefix.length)}`
  }
  return file
}

/** JSX call-site candidates: up to two useful frames per owner level. */
function candidateFrames(sources: DebugSource[], projectRoot: string): RawFrame[] {
  const frames: RawFrame[] = []
  for (const source of sources) {
    if (!source.stack) continue
    let taken = 0
    for (const frame of parseStack(source.stack)) {
      if (taken >= 2) break
      if (REACT_INTERNAL_METHODS.test(frame.methodName)) continue
      const file = normalizeFrameFile(frame.file, projectRoot)
      if (!file) continue
      frames.push({ ...frame, file })
      taken++
    }
  }
  return frames
}

type ResolvedFrame = {
  status: "fulfilled" | "rejected"
  value?: {
    originalStackFrame?: {
      file: string | null
      line1: number | null
      column1: number | null
      ignored?: boolean
    } | null
  }
}

/**
 * Resolve the JSX call sites for this element, walking outward through the
 * owner chain: index 0 is the innermost site (inside the component that
 * directly renders the element — its "definition"), and the last entry is
 * the outermost site in the project (typically where the component is used
 * on the page). Duplicates and node_modules/framework frames are dropped.
 * Returns an empty array when nothing in the project matches.
 */
export async function resolveSources(
  sources: DebugSource[],
  projectRoot: string
): Promise<SourceLocation[]> {
  const frames = candidateFrames(sources, projectRoot)
  if (frames.length === 0) return []

  const res = await fetch("/__nextjs_original-stack-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames,
      isServer: false,
      isEdgeServer: false,
      isAppDirectory: true,
    }),
  })
  if (!res.ok) return []
  const resolved = (await res.json()) as ResolvedFrame[]

  const locations: SourceLocation[] = []
  const seen = new Set<string>()
  for (let i = 0; i < resolved.length; i++) {
    const entry = resolved[i]
    if (entry?.status !== "fulfilled") continue
    const frame = entry.value?.originalStackFrame
    if (!frame?.file || frame.ignored) continue
    if (frame.file.includes("node_modules") || frame.file.startsWith("node:")) continue
    const line1 = frame.line1 ?? 1
    const column1 = frame.column1 ?? 1
    const key = `${frame.file}:${line1}:${column1}`
    if (seen.has(key)) continue
    seen.add(key)
    const methodName = frames[i]?.methodName.replace(/^Object\./, "")
    locations.push({
      file: frame.file,
      line1,
      column1,
      enclosingName:
        methodName && methodName !== "<anonymous>" ? methodName : null,
    })
  }
  return locations
}

export type EditorOption = { id: string; label: string }

export const FALLBACK_EDITORS: EditorOption[] = [
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
  { id: "cursor", label: "Cursor" },
  { id: "windsurf", label: "Windsurf" },
  { id: "zed", label: "Zed" },
  { id: "auto", label: "Auto (dev server)" },
]

/**
 * Installed-editor detection via the optional /api/inspector route; falls
 * back to the static list when the route isn't present (e.g. after copying
 * only src/inspector/ into another app).
 */
export async function detectEditors(): Promise<EditorOption[]> {
  try {
    const res = await fetch("/api/inspector")
    if (!res.ok) return FALLBACK_EDITORS
    const body = (await res.json()) as { editors?: EditorOption[] }
    return body.editors?.length ? body.editors : FALLBACK_EDITORS
  } catch {
    return FALLBACK_EDITORS
  }
}

/**
 * Open the location in the editor. `editor` is a URL scheme ("vscode",
 * "vscode-insiders", "cursor", "windsurf", …) launched straight from the
 * browser — immune to the dev server's PATH/EDITOR environment. The special
 * value "auto" instead asks the dev server's launch-editor endpoint, which
 * auto-detects from running processes and REACT_EDITOR/EDITOR env vars.
 */
export function openInEditor(
  loc: SourceLocation,
  projectRoot: string,
  editor: string
): void {
  if (editor === "auto") {
    const params = new URLSearchParams({
      file: loc.file,
      line1: String(loc.line1),
      column1: String(loc.column1),
    })
    void fetch(`/__nextjs_launch-editor?${params}`)
    return
  }
  const abs = loc.file.startsWith("/") ? loc.file : `${projectRoot}/${loc.file}`
  window.location.href = `${editor}://file${abs}:${loc.line1}:${loc.column1}`
}
