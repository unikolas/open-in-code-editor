/**
 * Path helpers shared by both source resolvers (source.next.ts and
 * source.vite.ts), so a fix to either lands for every framework.
 */

/** A POSIX (`/…`) or Windows drive (`C:\…`, `C:/…`) absolute path. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * The path part of an editor deeplink. URL schemes want `file/` followed by a
 * slash-led path, so a Windows path gets one: `vscode://file/C:/Users/me/app/…`,
 * not `fileC:/…`. `%`, `#` and `?` are escaped, or the editor would decode a
 * stray escape or cut the path at a fragment/query (`/Users/me/C#/app`);
 * spaces are left to the browser, which encodes them on navigation.
 */
export function deeplinkPath(abs: string): string {
  const path = abs.replace(/\\/g, "/").replace(/[%#?]/g, encodeURIComponent)
  return path.startsWith("/") ? path : `/${path}`
}
