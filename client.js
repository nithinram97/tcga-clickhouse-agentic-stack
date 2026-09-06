import { createClient } from "@osdk/client";
import { createPublicOauthClient } from "@osdk/oauth";

/**
 * Foundry client.
 *
 * createPublicOauthClient runs the auth flow in the BROWSER, as the signed-in
 * user. That is the point: every query then carries the user's own permissions,
 * so Foundry's row-level security keeps applying. A service token here would
 * silently show every user every row.
 *
 * Requires (from your Developer Console package.json panel):
 *   "@fdc9-skywiseperfodynamiclp/sdk": "^0.18.0"
 *   "@osdk/client": "^2.56.0"
 *   "@osdk/oauth": "^1.1.1"
 *   "@osdk/foundry": "latest"
 */
const FOUNDRY_URL = import.meta.env.VITE_FOUNDRY_URL;
const CLIENT_ID = import.meta.env.VITE_FOUNDRY_CLIENT_ID;
const ONTOLOGY_RID = import.meta.env.VITE_FOUNDRY_ONTOLOGY_RID;
const REDIRECT_URL =
  import.meta.env.VITE_FOUNDRY_REDIRECT_URL ?? `${window.location.origin}/auth/callback`;

export const auth = createPublicOauthClient(CLIENT_ID, FOUNDRY_URL, REDIRECT_URL);

export const client = createClient(FOUNDRY_URL, ONTOLOGY_RID, auth);

/** Call once before rendering; it redirects to Foundry and back if needed. */
export async function ensureSignedIn() {
  await auth.signIn();
}
