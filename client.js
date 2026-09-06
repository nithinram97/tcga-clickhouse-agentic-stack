import { createClient } from "@osdk/client";
import { createPublicOauthClient } from "@osdk/oauth";

/**
 * Foundry client and sign-in.
 *
 * Matches the call signature in your generated SimpleReactComponent example:
 *
 *   createPublicOauthClient(
 *     clientId, url, redirectUrl,
 *     true,                        // useHistory
 *     undefined,                   // loginPage
 *     window.location.toString(),  // where to return after login
 *     scopes
 *   );
 *
 * The arguments are POSITIONAL, not an options object — passing `{ scopes }` as
 * the fourth argument silently lands in the `useHistory` slot and the scopes
 * never reach the authorize request.
 */

const FOUNDRY_URL = import.meta.env.VITE_FOUNDRY_URL;
const CLIENT_ID = import.meta.env.VITE_FOUNDRY_CLIENT_ID;
const ONTOLOGY_RID = import.meta.env.VITE_FOUNDRY_ONTOLOGY_RID;
const REDIRECT_URL =
  import.meta.env.VITE_FOUNDRY_REDIRECT_URL || `${window.location.origin}/auth/callback`;

/**
 * Scope names are `api:use-*`, per your Developer Console snippet — not
 * `api:ontologies-read`. A wrong scope name makes the authorize request fail
 * before it ever reaches the callback, which is exactly what produces a return
 * with no usable parameters.
 *
 * Grant these in Developer Console → your application → OAuth & scopes:
 *   api:use-ontologies-read    reading object types, aggregations
 *   api:use-ontologies-write   the Create/Update/Delete Dashboard Actions
 *   api:use-admin-read         resolving the current user for `user`
 */
const SCOPES = (
  import.meta.env.VITE_FOUNDRY_SCOPES ||
  "api:use-ontologies-read api:use-ontologies-write api:use-admin-read"
)
  .split(/\s+/)
  .filter(Boolean);

function requireEnv() {
  const missing = Object.entries({
    VITE_FOUNDRY_URL: FOUNDRY_URL,
    VITE_FOUNDRY_CLIENT_ID: CLIENT_ID,
    VITE_FOUNDRY_ONTOLOGY_RID: ONTOLOGY_RID
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env, fill it from Developer Console, then restart the dev server ` +
        `— Vite only reads .env at startup.`
    );
  }
}

requireEnv();

export const auth = createPublicOauthClient(
  CLIENT_ID,
  FOUNDRY_URL,
  REDIRECT_URL,
  true,                       // useHistory — keeps the callback out of the back stack
  undefined,                  // loginPage — we have no separate login screen
  window.location.toString(), // return here once signed in
  SCOPES
);

export const client = createClient(FOUNDRY_URL, ONTOLOGY_RID, auth);

/**
 * The path part of the redirect URL. Your example serves the app under a base
 * path — "/skywise-perfo-dynamic-lp/auth/callback" — so this is derived rather
 * than hardcoded to "/auth/callback".
 */
const CALLBACK_PATH = new URL(REDIRECT_URL, window.location.origin).pathname;

/**
 * Removes any half-finished OAuth flow from storage.
 *
 * The library stores a state and PKCE verifier before redirecting to Foundry. If
 * that flow never completes, the stored entry survives; on the next load the
 * library sees a pending state, treats the current URL as the callback, finds no
 * `state` parameter and throws — and keeps throwing, because nothing clears it.
 */
function clearStaleAuthState() {
  const looksLikeAuth = (k) => /osdk|oauth|pkce|code_verifier|auth[_-]?state|token/i.test(k);
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(store).filter(looksLikeAuth).forEach((k) => store.removeItem(k));
    } catch {
      /* storage unavailable */
    }
  }
}

const isStateError = (e) => {
  const msg = String(e?.message ?? e);
  return (
    /parameter "?state"? missing/i.test(msg) ||
    /state mismatch/i.test(msg) ||
    /PKCE/i.test(msg) ||
    e?.code === "OAUTH_STATE_MISSING"
  );
};

/** Call once before rendering. Redirects to Foundry and back if needed. */
export async function ensureSignedIn() {
  const onCallback = window.location.pathname === CALLBACK_PATH;

  try {
    await auth.signIn();
  } catch (e) {
    if (!isStateError(e)) throw e;

    console.warn("Stale OAuth state detected; clearing it and restarting sign-in.", e);
    clearStaleAuthState();
    window.history.replaceState({}, "", window.location.pathname);

    try {
      await auth.signIn();
    } catch (again) {
      throw new Error(
        `Sign-in failed after clearing stored OAuth state: ${again.message ?? again}\n\n` +
          `Redirect URI this app sent:\n  ${REDIRECT_URL}\n` +
          `Scopes requested:\n  ${SCOPES.join(" ")}\n\n` +
          `Both must match your application's OAuth settings in Developer Console exactly.`
      );
    }
  }

  // Don't leave ?code=…&state=… in the address bar — a refresh would try to
  // redeem an already-used code and fail confusingly.
  if (onCallback) {
    const back = sessionStorage.getItem("postLoginPath") || import.meta.env.BASE_URL || "/";
    sessionStorage.removeItem("postLoginPath");
    window.history.replaceState({}, "", back);
  } else if (window.location.search.includes("code=")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

/** Remember where the user was, so the callback can send them back. */
export function rememberReturnPath() {
  if (window.location.pathname !== CALLBACK_PATH) {
    sessionStorage.setItem("postLoginPath", window.location.pathname + window.location.search);
  }
}

/** For a sign-out control, and handy from the console while debugging. */
export function resetAuth() {
  clearStaleAuthState();
  window.location.replace(import.meta.env.BASE_URL || "/");
}
