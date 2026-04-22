import { cookies } from "next/headers";
import { getDefaultWorkspace, getWorkspace, type Workspace } from "./workspace-store";

// Name of the cookie that carries the active workspace id for server-side
// scoping. Kept short so it doesn't balloon request headers. The value is a
// workspace UUID — if it's missing or resolves to a deleted workspace we fall
// back to the default workspace so the app stays usable.
export const WORKSPACE_COOKIE = "enricher_ws";

// Cookie lives a year. No need to be short-lived — the active workspace is a
// UX preference, not an auth credential. The share-token gate on /r/<token>
// handles the actual tenant isolation.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function getActiveWorkspace(): Promise<Workspace> {
  const store = await cookies();
  const raw = store.get(WORKSPACE_COOKIE)?.value;
  if (raw) {
    const ws = getWorkspace(raw);
    if (ws) return ws;
  }
  return getDefaultWorkspace();
}

export async function getActiveWorkspaceId(): Promise<string> {
  const ws = await getActiveWorkspace();
  return ws.id;
}

// Cookie options applied when we set the active workspace from an API route.
// httpOnly=false so the client-side switcher can read it to know the current
// selection without a round-trip. sameSite=lax keeps cross-site navigation
// safe; secure is left to the runtime (always on in production).
export function workspaceCookieAttrs(): {
  maxAge: number;
  path: string;
  sameSite: "lax";
  httpOnly: false;
} {
  return {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  };
}
