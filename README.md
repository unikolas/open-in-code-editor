# open-in-code-editor

Click-to-source inspector for Next.js apps. Hold <kbd>⌥ Option</kbd> to
highlight any element in your running dev server — a label shows the
component name, line, and source file — then <kbd>⌥ Option</kbd>+click to
open that exact location in your editor.

- Works with Server and Client Components (Next.js 16, Turbopack, React 19)
- Opens VS Code, VS Code Insiders, Cursor, Windsurf, or Zed via their URL
  schemes — pick one in the floating selector shown while inspecting
- Zero build config: rides the source-map resolution endpoint the Next.js
  dev server already ships; renders nothing in production builds

## Try it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, hold <kbd>⌥</kbd>, hover, click.

## Use it in your own app

1. Copy `src/inspector/` into your project.
2. In `app/layout.tsx`, render inside `<body>`:

   ```tsx
   {process.env.NODE_ENV === "development" && (
     <Inspector projectRoot={process.cwd()} />
   )}
   ```

3. Optional: copy `src/app/api/inspector/route.ts` so the editor picker only
   lists editors installed on your machine.

Requires a Next.js 16 dev server (Turbopack, default `.next` distDir) and
React 19 in dev mode. The editor choice persists in localStorage; the
"Auto" option defers to the dev server's own detection
(`REACT_EDITOR`/`EDITOR` env vars) instead of URL schemes.

## How it works

React 19 removed `element._debugSource`, which older click-to-code tools
relied on. This inspector instead walks the fiber `_debugOwner` chain and
parses each owner's `_debugStack` — an `Error` whose stack points at the JSX
call site in compiled code — then asks the dev server's
`/__nextjs_original-stack-frames` endpoint to source-map those frames back
to your `src/` files. Client-chunk frames are rewritten to their on-disk
`.next/dev/static/` twins so they resolve too. Opening the editor is a plain
`vscode://file/<path>:<line>:<column>`-style deeplink fired from the browser.
