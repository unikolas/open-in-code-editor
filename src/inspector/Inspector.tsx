"use client"

/**
 * Click-to-source inspector (dev only).
 *
 * Hold Option/Alt to highlight the element under the cursor with its
 * component name and source location; Option+click opens that location in
 * your editor. While inspecting, an editor picker appears top-right.
 * Source-map resolution rides the endpoint built into the Next.js dev
 * server; opening uses the chosen editor's URL scheme.
 *
 * ── Using this in another Next.js app ─────────────────────────────────────
 * 1. Copy the src/inspector/ folder.
 * 2. In app/layout.tsx, render inside <body>:
 *      {process.env.NODE_ENV === "development" && (
 *        <Inspector projectRoot={process.cwd()} />
 *      )}
 * 3. Optional: copy src/app/api/inspector/route.ts so the editor picker
 *    only lists editors actually installed on the machine; without it a
 *    static list is shown.
 * Requirements: Next.js 16 dev server (Turbopack, default `.next` distDir),
 * React 19 in dev mode. Opening uses the editor's URL scheme
 * (vscode://, cursor://, …) chosen in the picker (persisted in
 * localStorage); the "Auto" option defers to the dev server's own
 * editor detection (REACT_EDITOR/EDITOR env) instead.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { getDebugSources, getDisplayName, getFiberFromNode } from "./fiber"
import {
  detectEditors,
  FALLBACK_EDITORS,
  openInEditor,
  resolveSource,
  type EditorOption,
  type SourceLocation,
} from "./source"
import { EditorSelect, InspectorOverlay, type TargetInfo } from "./ui"

const EDITOR_STORAGE_KEY = "inspector.editor"

const locationCache = new WeakMap<Element, Promise<SourceLocation | null>>()

function resolveElement(el: Element, projectRoot: string) {
  let promise = locationCache.get(el)
  if (!promise) {
    const fiber = getFiberFromNode(el)
    promise = fiber
      ? resolveSource(getDebugSources(fiber), projectRoot)
      : Promise.resolve(null)
    locationCache.set(el, promise)
  }
  return promise
}

function isInspectorUi(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest("[data-inspector]") !== null
}

// Renders nothing during SSR/hydration, everything after mount.
const emptySubscribe = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

export function Inspector({ projectRoot }: { projectRoot: string }) {
  const mounted = useMounted()
  const [target, setTarget] = useState<TargetInfo | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [editors, setEditors] = useState<EditorOption[]>(FALLBACK_EDITORS)
  const [editor, setEditor] = useState<string>(
    () =>
      (typeof localStorage !== "undefined" &&
        localStorage.getItem(EDITOR_STORAGE_KEY)) ||
      "vscode"
  )

  const targetElRef = useRef<Element | null>(null)
  const lastPointer = useRef({ x: 0, y: 0 })
  const editorRef = useRef(editor)

  const changeEditor = (id: string) => {
    setEditor(id)
    editorRef.current = id
    try {
      localStorage.setItem(EDITOR_STORAGE_KEY, id)
    } catch {}
  }

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    let cancelled = false
    detectEditors().then((list) => {
      if (cancelled) return
      setEditors(list)
      // If nothing was stored and the default isn't installed, pick the
      // first detected editor.
      const stored =
        typeof localStorage !== "undefined" &&
        localStorage.getItem(EDITOR_STORAGE_KEY)
      if (!stored && !list.some((e) => e.id === editorRef.current) && list[0]) {
        setEditor(list[0].id)
        editorRef.current = list[0].id
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    const clearTarget = () => {
      targetElRef.current = null
      setTarget(null)
    }

    const clearAll = () => {
      clearTarget()
      setInspecting(false)
    }

    const setFromElement = (el: Element) => {
      if (el === targetElRef.current) return
      targetElRef.current = el

      const fiber = getFiberFromNode(el)
      const fiberName = fiber ? getDisplayName(fiber) : el.tagName.toLowerCase()
      const toInfo = (
        name: string,
        file: string | null,
        line: number | null,
        failed = false
      ): TargetInfo => {
        const r = el.getBoundingClientRect()
        return {
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          name,
          file,
          line,
          failed,
        }
      }
      setTarget(toInfo(fiberName, null, null))

      resolveElement(el, projectRoot).then((loc) => {
        if (targetElRef.current !== el) return
        setTarget(
          loc
            ? toInfo(loc.enclosingName ?? fiberName, loc.file, loc.line1)
            : toInfo(fiberName, null, null, true)
        )
      })
    }

    const refreshRect = () => {
      const el = targetElRef.current
      if (!el) return
      if (!el.isConnected) return clearTarget()
      setTarget((prev) => {
        if (!prev) return prev
        const r = el.getBoundingClientRect()
        return { ...prev, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
      })
    }

    const onPointerMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY }
      if (!e.altKey) {
        clearAll()
        return
      }
      setInspecting(true)
      // Over the inspector's own UI (editor picker): drop the element
      // highlight but keep inspect mode visible.
      if (isInspectorUi(e.target)) {
        clearTarget()
        return
      }
      if (e.target instanceof Element) setFromElement(e.target)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return clearAll()
      if (e.key !== "Alt") return
      setInspecting(true)
      const el = document.elementFromPoint(lastPointer.current.x, lastPointer.current.y)
      if (el && !isInspectorUi(el)) setFromElement(el)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") clearAll()
    }

    const onBlur = () => clearAll()

    // Swallow the whole click gesture while inspecting so the app's own
    // handlers (including pointerdown-driven ones) never fire. The
    // inspector's own UI is exempt — the editor picker must stay clickable
    // while Option is held.
    const swallow = (e: MouseEvent | PointerEvent) => {
      if (!e.altKey || !targetElRef.current) return
      if (isInspectorUi(e.target)) return
      e.preventDefault()
      e.stopPropagation()
    }

    // Open on pointerup, not click: canceling pointerdown (above) can
    // suppress the compatibility click event, but pointer events always fire.
    const onPointerUp = (e: PointerEvent) => {
      const el = targetElRef.current
      if (!e.altKey || !el || isInspectorUi(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      resolveElement(el, projectRoot).then((loc) => {
        if (loc) openInEditor(loc, projectRoot, editorRef.current)
      })
    }

    const opts = { capture: true } as const
    window.addEventListener("pointermove", onPointerMove, opts)
    window.addEventListener("keydown", onKeyDown, opts)
    window.addEventListener("keyup", onKeyUp, opts)
    window.addEventListener("blur", onBlur)
    window.addEventListener("scroll", refreshRect, opts)
    window.addEventListener("resize", refreshRect)
    window.addEventListener("pointerdown", swallow, opts)
    window.addEventListener("mousedown", swallow, opts)
    window.addEventListener("mouseup", swallow, opts)
    window.addEventListener("click", swallow, opts)
    window.addEventListener("pointerup", onPointerUp, opts)
    return () => {
      window.removeEventListener("pointermove", onPointerMove, opts)
      window.removeEventListener("keydown", onKeyDown, opts)
      window.removeEventListener("keyup", onKeyUp, opts)
      window.removeEventListener("blur", onBlur)
      window.removeEventListener("scroll", refreshRect, opts)
      window.removeEventListener("resize", refreshRect)
      window.removeEventListener("pointerdown", swallow, opts)
      window.removeEventListener("mousedown", swallow, opts)
      window.removeEventListener("mouseup", swallow, opts)
      window.removeEventListener("click", swallow, opts)
      window.removeEventListener("pointerup", onPointerUp, opts)
    }
  }, [projectRoot])

  if (!mounted || process.env.NODE_ENV !== "development") return null
  return createPortal(
    <div data-inspector="">
      {inspecting && (
        <EditorSelect editors={editors} value={editor} onChange={changeEditor} />
      )}
      <InspectorOverlay target={target} />
    </div>,
    document.body
  )
}
