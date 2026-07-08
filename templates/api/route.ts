import { existsSync } from "node:fs"

/**
 * Dev-only helper for the click-to-source inspector: reports which known
 * editors are installed so the picker only offers real choices. Optional —
 * the inspector falls back to a static list when this route is absent.
 */

const KNOWN_EDITORS = [
  { id: "vscode", label: "VS Code", app: "Visual Studio Code.app" },
  { id: "vscode-insiders", label: "VS Code Insiders", app: "Visual Studio Code - Insiders.app" },
  { id: "cursor", label: "Cursor", app: "Cursor.app" },
  { id: "windsurf", label: "Windsurf", app: "Windsurf.app" },
  { id: "zed", label: "Zed", app: "Zed.app" },
]

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 })
  }
  const installed =
    process.platform === "darwin"
      ? KNOWN_EDITORS.filter(
          (e) =>
            existsSync(`/Applications/${e.app}`) ||
            existsSync(`${process.env.HOME}/Applications/${e.app}`)
        )
      : KNOWN_EDITORS
  return Response.json({
    editors: [
      ...installed.map(({ id, label }) => ({ id, label })),
      { id: "auto", label: "Auto (dev server)" },
    ],
  })
}
