# open-in-code-editor

Click-to-source inspector for Next.js apps. Hold <kbd>⌥ Option</kbd> to
highlight any element in your running dev server — a label shows the
component name, line, and source file — then <kbd>⌥ Option</kbd>+click to
open that exact location in your editor.

![open-in-code-editor in action: holding ⌥ highlights a component and shows its name, line, and file, with an editor picker top-right](docs/screenshot.png)

- **Source or usage**: <kbd>⌥ Option</kbd>+click opens the component that
  renders the element (its definition); add <kbd>⇧ Shift</kbd> to jump
  instead to where that component is *used* on the page. The label turns
  violet and reads "usage" while Shift is held, so you can see where a
  click will land before you click.
- Works with Server and Client Components (Next.js 16, Turbopack, React 19)
- Opens VS Code, VS Code Insiders, Cursor, Windsurf, or Zed via their URL
  schemes — pick one in the floating selector shown while inspecting
- Zero build config: rides the source-map resolution endpoint the Next.js
  dev server already ships; renders nothing in production builds

## Supported frameworks

| Framework | Status |
| --- | --- |
| **Next.js 16** (Turbopack, default `.next` distDir) + React 19 | ✅ Supported |
| **Vite + React** | 🚧 Coming soon |

More frameworks to follow. In a project without an app-router `layout.tsx/jsx`
(such as a Vite app), the installer leaves your files untouched — it prints
what it expects and exits.

## Install

From the root of your Next.js app:

```bash
npx open-in-code-editor
```

That copies the inspector into your project and wires up `layout.tsx` for you
using a **relative import** (no `@/*` path alias required). Start your dev
server, hold <kbd>⌥</kbd>, hover, and click.

The command is idempotent — it skips files that already exist and never
edits `layout.tsx` twice.

### Updating

To pull a newer version of the inspector into a project that already has it,
re-copy the files with `update` (the install skips existing files, so a plain
re-run won't refresh them):

```bash
npx open-in-code-editor@latest update
```

That overwrites the `inspector/` folder and API route with the latest version
while leaving your `layout.tsx` wiring alone. `--force` is an alias for
`update`. It's a copy-in tool, not a dependency, so there's nothing for
`npm update` to act on.

### What it adds

```
your-app/
  (src/)app/layout.tsx          # + import and a dev-only <Inspector/>
  (src/)inspector/              # Inspector.tsx, fiber.ts, source.ts, ui.tsx
  (src/)app/api/inspector/route.ts   # optional: install-aware editor picker
```

The `layout.tsx` edit looks like this:

```tsx
import { Inspector } from "../inspector/Inspector"
// ...
<body>
  {children}
  {process.env.NODE_ENV === "development" && (
    <Inspector projectRoot={process.cwd()} />
  )}
</body>
```

**Requirements:** a Next.js 16 dev server (Turbopack, default `.next`
distDir) and React 19 in dev mode.

### Manual install

If you'd rather not run the installer, copy the `inspector/` folder into your
app and add the two lines above yourself (adjust the relative import path to
where you placed the folder). The API route is optional — without it a static
editor list is shown instead of only the editors installed on your machine.

## Try the demo

This repo is a runnable demo:

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, hold <kbd>⌥</kbd>, hover, click.

## Notes

The editor picker appears top-right while inspecting; your choice persists in
localStorage. The **Auto** option defers to the dev server's own editor
detection (`REACT_EDITOR`/`EDITOR` env vars) instead of a URL scheme.

## How it works

React 19 removed `element._debugSource`, which older click-to-code tools
relied on. This inspector instead walks the fiber `_debugOwner` chain and
parses each owner's `_debugStack` — an `Error` whose stack points at the JSX
call site in compiled code — then asks the dev server's
`/__nextjs_original-stack-frames` endpoint to source-map those frames back
to your `src/` files. Client-chunk frames are rewritten to their on-disk
`.next/dev/static/` twins so they resolve too. Opening the editor is a plain
`vscode://file/<path>:<line>:<column>`-style deeplink fired from the browser.

Because the whole owner chain resolves — innermost (the element's own
definition) through outermost (where it's used on the page) — a plain click
opens the first and <kbd>⇧ Shift</kbd>+click opens the last.

## Uninstall

Delete the `inspector/` folder and `app/api/inspector/route.ts`, then remove
the import and `<Inspector/>` lines from `layout.tsx`.

## Development

`inspector/` is the single source of truth; `templates/` (what the installer
ships) is generated from it. After editing the inspector, run:

```bash
pnpm sync-templates
```
