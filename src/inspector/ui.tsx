/**
 * Presentational layer: highlight outline, name label, editor picker.
 * Inline styles only, so the inspector never depends on (or collides with)
 * the host app's CSS. The overlay layer is pointer-events: none; the editor
 * picker is the only interactive piece.
 */

import type { EditorOption } from "./source"

const BLUE = "#2563eb"
const LABEL_HEIGHT = 22
const GAP = 4
const FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

export type TargetInfo = {
  rect: { top: number; left: number; width: number; height: number }
  name: string
  file: string | null // null while resolving
  line: number | null
  failed: boolean
  // "source": innermost site (default). "usage": outermost site in the
  // project, shown while Shift is held — where the component is used.
  mode: "source" | "usage"
}

const USAGE = "#7c3aed"

/**
 * Floating editor picker, top-right; visible only while inspecting. A plain
 * text pill that hugs its content, with an invisible <select> stretched on
 * top so the native dropdown still does the work.
 */
export function EditorSelect({
  editors,
  value,
  onChange,
}: {
  editors: EditorOption[]
  value: string
  onChange: (id: string) => void
}) {
  const options = editors.some((e) => e.id === value)
    ? editors
    : [...editors, { id: value, label: value }]
  const label = options.find((e) => e.id === value)?.label ?? value
  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 2147483647,
        pointerEvents: "auto",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 8px",
          background: "#18181b",
          color: "#fff",
          borderRadius: 6,
          fontSize: 11,
          lineHeight: 1,
          whiteSpace: "nowrap",
          opacity: 0.9,
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
        }}
      >
        <span>{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
          }}
        >
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function InspectorOverlay({ target }: { target: TargetInfo | null }) {
  if (!target) return null
  const { rect, name, file, line, failed, mode } = target
  const usage = mode === "usage" && !failed

  const labelAbove = rect.top >= LABEL_HEIGHT + GAP * 2
  const labelTop = labelAbove
    ? rect.top - LABEL_HEIGHT - GAP
    : Math.min(rect.top + rect.height + GAP, window.innerHeight - LABEL_HEIGHT - GAP)

  return (
    <div
      data-inspector=""
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        pointerEvents: "none",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "fixed",
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxSizing: "border-box",
          border: `0.5px solid ${BLUE}`,
          background: "rgba(37, 99, 235, 0.08)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: labelTop,
          left: Math.max(GAP, Math.min(rect.left, window.innerWidth - 200)),
          height: LABEL_HEIGHT,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          background: failed ? "#b91c1c" : usage ? USAGE : BLUE,
          color: "#fff",
          fontSize: 11,
          lineHeight: 1,
          borderRadius: 4,
          whiteSpace: "nowrap",
          boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
        }}
      >
        {usage && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              opacity: 0.85,
            }}
          >
            usage
          </span>
        )}
        <span style={{ fontSize: 10, fontWeight: 500 }}>
          {name}
          {line != null && !failed && <span style={{ opacity: 0.75 }}>:{line}</span>}
        </span>
        <span style={{ opacity: 0.75 }}>
          {failed ? "source not found" : file ?? "…"}
        </span>
      </div>
    </div>
  )
}

/**
 * Transient toast, bottom-center. Shown when a click resolved a location but
 * the chosen editor couldn't be opened (e.g. the Vite project root is unknown,
 * so the picker choice can't be honored). Console warnings go unseen; this
 * surfaces the reason where the user is already looking.
 */
export function InspectorNotice({ message }: { message: string }) {
  return (
    <div
      data-inspector=""
      style={{
        position: "fixed",
        bottom: 12,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        pointerEvents: "none",
        display: "flex",
        justifyContent: "center",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          maxWidth: "min(90vw, 460px)",
          padding: "8px 12px",
          background: "#b91c1c",
          color: "#fff",
          fontSize: 12,
          lineHeight: 1.4,
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        {message}
      </div>
    </div>
  )
}
