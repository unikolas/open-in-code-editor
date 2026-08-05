"use client"

/**
 * Click-to-source inspector (dev only).
 *
 * Hold Option/Alt to highlight the element under the cursor with its
 * component name and source location; Option+click opens that location in
 * your editor. Add Shift to jump to where the component is *used* on the
 * page (the outermost call site) instead of its own definition — the label
 * turns violet and reads "usage" so it's clear where a click will land.
 * While inspecting, an editor picker appears top-right. Source-map
 * resolution rides the endpoint built into the Next.js dev server; opening
 * uses the chosen editor's URL scheme.
 *
 * ── Using this in another Next.js app ─────────────────────────────────────
 * Run `npx open-in-code-editor` from your app root — it copies this folder
 * in and wires up layout.tsx with a relative import. Or do it by hand:
 * 1. Copy the inspector/ folder.
 * 2. In app/layout.tsx, render inside <body>:
 *      import { Inspector } from "../inspector/Inspector"
 *      {process.env.NODE_ENV === "development" && (
 *        <Inspector projectRoot={process.cwd()} />
 *      )}
 * 3. Optional: copy the api/inspector/route.ts route so the editor picker
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
  IS_DEV,
  openInEditor,
  resolveSources,
  type EditorOption,
  type SourceLocation,
} from "./source"
import { EditorSelect, InspectorNotice, InspectorOverlay, type TargetInfo } from "./ui"

const EDITOR_STORAGE_KEY = "inspector.editor"

const locationCache = new WeakMap<Element, Promise<SourceLocation[]>>()

function resolveElement(el: Element, projectRoot: string) {
  let promise = locationCache.get(el)
  if (!promise) {
    const fiber = getFiberFromNode(el)
    promise = fiber
      ? resolveSources(getDebugSources(fiber), projectRoot)
      : Promise.resolve<SourceLocation[]>([])
    locationCache.set(el, promise)
  }
  return promise
}

// With Shift held, target the outermost site (where the component is used)
// instead of the innermost (the component's own definition).
function pickLocation(locs: SourceLocation[], shift: boolean): SourceLocation | null {
  if (locs.length === 0) return null
  return shift && locs.length > 1 ? locs[locs.length - 1] : locs[0]
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
  const [notice, setNotice] = useState<string | null>(null)

  const targetElRef = useRef<Element | null>(null)
  const targetLocsRef = useRef<SourceLocation[] | null>(null)
  const fiberNameRef = useRef("")
  const shiftRef = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const editorRef = useRef(editor)
  const detectStartedRef = useRef(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const changeEditor = (id: string) => {
    setEditor(id)
    editorRef.current = id
    try {
      localStorage.setItem(EDITOR_STORAGE_KEY, id)
    } catch {}
  }

  // Detect installed editors on the first inspect, not at mount: the Next.js
  // detection fetches the optional /api/inspector route, and doing that on
  // every page load logs a 404 in the console when the route isn't installed.
  useEffect(() => {
    if (!IS_DEV || !inspecting || detectStartedRef.current) return
    detectStartedRef.current = true
    detectEditors().then((list) => {
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
  }, [inspecting])

  useEffect(() => {
    if (!IS_DEV) return

    const clearTarget = () => {
      targetElRef.current = null
      targetLocsRef.current = null
      setTarget(null)
    }

    const clearAll = () => {
      shiftRef.current = false
      clearTarget()
      setInspecting(false)
    }

    // Paint the label/highlight from the current element, resolved locations,
    // and Shift state. Re-run whenever any of those change (hover, resolve,
    // Shift down/up, scroll) so the label always shows where a click will go.
    const paint = () => {
      const el = targetElRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const rect = { top: r.top, left: r.left, width: r.width, height: r.height }
      const name = fiberNameRef.current
      const locs = targetLocsRef.current

      if (locs === null) {
        setTarget({ rect, name, file: null, line: null, failed: false, mode: "source" })
        return
      }
      const loc = pickLocation(locs, shiftRef.current)
      if (!loc) {
        setTarget({ rect, name, file: null, line: null, failed: true, mode: "source" })
        return
      }
      // Derived from the picked site so the label can never disagree with
      // where a click lands: anything but the innermost site is a "usage".
      setTarget({
        rect,
        name: loc.enclosingName ?? name,
        file: loc.file,
        line: loc.line1,
        failed: false,
        mode: loc === locs[0] ? "source" : "usage",
      })
    }

    const setFromElement = (el: Element) => {
      if (el === targetElRef.current) return
      targetElRef.current = el
      const fiber = getFiberFromNode(el)
      fiberNameRef.current = fiber ? getDisplayName(fiber) : el.tagName.toLowerCase()
      targetLocsRef.current = null
      paint()

      resolveElement(el, projectRoot).then((locs) => {
        if (targetElRef.current !== el) return
        targetLocsRef.current = locs
        paint()
      })
    }

    const refreshRect = () => {
      const el = targetElRef.current
      if (!el) return
      if (!el.isConnected) return clearTarget()
      paint()
    }

    const setShift = (down: boolean) => {
      if (shiftRef.current === down) return
      shiftRef.current = down
      if (targetElRef.current) paint()
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
      if (e.key === "Shift") return setShift(true)
      if (e.key !== "Alt") return
      setInspecting(true)
      const el = document.elementFromPoint(lastPointer.current.x, lastPointer.current.y)
      if (el && !isInspectorUi(el)) setFromElement(el)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") return setShift(false)
      if (e.key !== "Alt") return
      // Releasing Alt while the editor picker has focus (its native dropdown
      // may be open) must not unmount the picker — that would close the
      // dropdown and silently drop the user's editor choice. Keep the picker
      // up; the next pointermove without Alt clears everything as usual.
      if (isInspectorUi(document.activeElement)) {
        setShift(false)
        clearTarget()
        return
      }
      clearAll()
    }

    // Same guard as onKeyUp: on some platforms opening the picker's native
    // dropdown blurs the window, and tearing the picker down here would eat
    // the selection.
    const onBlur = () => {
      if (isInspectorUi(document.activeElement)) return
      clearAll()
    }

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
      const shift = e.shiftKey
      resolveElement(el, projectRoot).then((locs) => {
        const loc = pickLocation(locs, shift)
        if (!loc) return
        const warning = openInEditor(loc, projectRoot, editorRef.current)
        // Reflect the latest attempt: a successful open (null) also clears any
        // lingering notice from an earlier failed click.
        setNotice(warning)
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        if (warning) noticeTimer.current = setTimeout(() => setNotice(null), 6000)
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
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [projectRoot])

  if (!mounted || !IS_DEV) return null
  return createPortal(
    <div data-inspector="">
      {inspecting && (
        <EditorSelect editors={editors} value={editor} onChange={changeEditor} />
      )}
      <InspectorOverlay target={target} />
      {notice && <InspectorNotice message={notice} />}
    </div>,
    document.body
  )
}
