import { createClient } from "@osdk/client";
import { createPublicOauthClient } from "@osdk/oauth";

/**
 * Foundry client and sign-in.
 *
 * createPublicOauthClient runs the auth flow in the BROWSER, as the signed-in
 * user, so every query carries that user's own permissions and Foundry's
 * row-level security keeps applying.
 */

const FOUNDRY_URL = import.meta.env.VITE_FOUNDRY_URL;
const CLIENT_ID = import.meta.env.VITE_FOUNDRY_CLIENT_ID;
const ONTOLOGY_RID = import.meta.env.VITE_FOUNDRY_ONTOLOGY_RID;
const REDIRECT_URL =
  import.meta.env.VITE_FOUNDRY_REDIRECT_URL || `${window.location.origin}/auth/callback`;

const SCOPES = (import.meta.env.VITE_FOUNDRY_SCOPES ||
  "api:ontologies-read api:ontologies-write")
  .split(/\s+/)
  .filter(Boolean);

/**
 * Fail on missing config with a readable message. A blank VITE_FOUNDRY_URL
 * otherwise surfaces much later as an obscure OAuth error, which is a miserable
 * thing to debug.
 */
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
        `Copy .env.example to .env and fill it from Developer Console, then restart the dev server ` +
        `(Vite only reads .env at startup).`
    );
  }
}

requireEnv();

export const auth = createPublicOauthClient(CLIENT_ID, FOUNDRY_URL, REDIRECT_URL, {
  scopes: SCOPES
});

export const client = createClient(FOUNDRY_URL, ONTOLOGY_RID, auth);

/** The path portion of the redirect URL, e.g. "/auth/callback". */
const CALLBACK_PATH = new URL(REDIRECT_URL, window.location.origin).pathname;

/**
 * Removes any half-finished OAuth flow from storage.
 *
 * This is the fix for `OperationProcessingError: response parameter "state"
 * missing`. The library stores a state and PKCE verifier before redirecting to
 * Foundry. If that flow never completes — the tab was closed, the redirect URI
 * did not match, Foundry returned an error — the stored state survives. On the
 * next load the library sees a pending state, treats the current URL as the
 * callback, finds no `state` query parameter, and throws. It then throws again
 * on every subsequent load, because nothing ever clears the stale entry.
 *
 * Wiping it and retrying once turns a permanent dead end into one extra
 * redirect.
 */
function clearStaleAuthState() {
  const looksLikeAuth = (k) => /osdk|oauth|pkce|code_verifier|auth[_-]?state|token/i.test(k);
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(store)
        .filter(looksLikeAuth)
        .forEach((k) => store.removeItem(k));
    } catch {
      /* storage unavailable — nothing to clear */
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

/**
 * Completes sign-in, then returns.
 *
 * Call this once before rendering. It redirects to Foundry and back if needed.
 */
export async function ensureSignedIn() {
  const onCallback = window.location.pathname === CALLBACK_PATH;

  try {
    await auth.signIn();
  } catch (e) {
    if (!isStateError(e)) throw e;

    // Second attempt from a clean slate. Strip any leftover query string so the
    // library cannot mistake this load for a callback.
    console.warn("Stale OAuth state detected; clearing it and restarting sign-in.", e);
    clearStaleAuthState();
    window.history.replaceState({}, "", window.location.pathname);

    try {
      await auth.signIn();
    } catch (again) {
      throw new Error(
        `Sign-in failed after clearing stored OAuth state: ${again.message ?? again}\n\n` +
          `The usual cause is a redirect URI mismatch. The value this app sends is:\n` +
          `  ${REDIRECT_URL}\n` +
          `It must be registered EXACTLY — scheme, host, port and path — under your ` +
          `application's OAuth settings in Developer Console.`
      );
    }
  }

  // Land back on the app rather than leaving ?code=…&state=… in the address bar,
  // where a refresh would try to redeem an already-used code.
  if (onCallback) {
    const back = sessionStorage.getItem("postLoginPath") || "/";
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

/** Exposed for a "sign out" control, and useful from the console while debugging. */
export function resetAuth() {
  clearStaleAuthState();
  window.location.replace("/");
}
