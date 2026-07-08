/**
 * React fiber access. Everything that touches React dev-mode internals
 * (`__reactFiber$*` expandos, `_debugOwner`, `_debugStack`) is confined to
 * this file so version drift only ever breaks one module.
 *
 * Verified against React 19.2.4 under Next.js 16 (Turbopack dev).
 */

export type DebugSource = {
  /** Component (or host tag) name, best-effort. */
  name: string | null
  /** Raw `Error.stack` whose first app frame is the JSX call site. */
  stack: string | null
}

// Fiber for host/client components; plain ReactComponentInfo objects appear
// in the owner chain for Server Components (duck-typed via `env`).
type Fiberish = {
  tag?: number
  type?: unknown
  name?: unknown
  env?: unknown
  _debugOwner?: Fiberish | null
  owner?: Fiberish | null
  _debugStack?: unknown
  debugStack?: unknown
}

export function getFiberFromNode(node: Element): Fiberish | null {
  let el: Element | null = node
  while (el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
    if (key) return (el as unknown as Record<string, Fiberish>)[key]
    el = el.parentElement
  }
  return null
}

function typeName(type: unknown): string | null {
  if (typeof type === "string") return type
  if (typeof type === "function") return (type as { displayName?: string; name?: string }).displayName || type.name || null
  if (type && typeof type === "object") {
    const t = type as { displayName?: string; render?: { name?: string }; type?: unknown }
    // forwardRef / memo wrappers
    return t.displayName || t.render?.name || typeName(t.type) || null
  }
  return null
}

function nameOf(node: Fiberish): string | null {
  if (typeof node.name === "string") return node.name // ReactComponentInfo
  return typeName(node.type)
}

function stackOf(node: Fiberish): string | null {
  const err = node._debugStack ?? node.debugStack
  if (err instanceof Error) return err.stack ?? null
  if (typeof err === "string") return err
  return null
}

/**
 * The clicked fiber plus its owner chain, innermost first. Each entry's
 * stack points at the place that JSX was written; resolving them in order
 * and taking the first project-source hit gives "where is this element's
 * code".
 */
export function getDebugSources(fiber: Fiberish): DebugSource[] {
  const sources: DebugSource[] = []
  let node: Fiberish | null = fiber
  let hops = 0
  while (node && hops < 20) {
    sources.push({ name: nameOf(node), stack: stackOf(node) })
    node = node._debugOwner ?? node.owner ?? null
    hops++
  }
  return sources
}

/** First named component in the owner chain — what the hover label shows. */
export function getDisplayName(fiber: Fiberish): string {
  let node: Fiberish | null = fiber
  let hostName: string | null = null
  let hops = 0
  while (node && hops < 20) {
    const name = nameOf(node)
    if (name && typeof node.type !== "string") return name
    if (name && !hostName) hostName = name
    node = node._debugOwner ?? node.owner ?? null
    hops++
  }
  return hostName ?? "element"
}
