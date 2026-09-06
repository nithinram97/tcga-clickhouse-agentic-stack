/**
 * Chooses the data source at startup.
 *
 *   VITE_DATA_SOURCE=foundry   → real ontology + DynamicLpDashboard persistence
 *   anything else (default)    → mock ontology + localStorage
 *
 * The Foundry modules load with dynamic import, so a mock-mode build never pulls
 * in the SDK and a checkout without registry access still runs.
 */
export async function bootstrap() {
  const mode = import.meta.env.VITE_DATA_SOURCE === "foundry" ? "foundry" : "mock";

  if (mode === "mock") {
    const [{ createMockProvider }, { createLocalStore }, demo] = await Promise.all([
      import("./mockProvider.js"),
      import("./localStore.js"),
      import("../config/demo-ontology.json")
    ]);
    return {
      mode,
      provider: createMockProvider(demo.default ?? demo),
      store: createLocalStore({ currentUser: "you" })
    };
  }

  const [Ontology, clientModule, { createOsdkProvider }, { createDashboardStore }] =
    await Promise.all([
      import("@fdc9-skywiseperfodynamiclp/sdk"),
      import("./client.js"),
      import("./osdkProvider.js"),
      import("./dashboardStore.js")
    ]);

  const { client, ensureSignedIn, rememberReturnPath } = clientModule;

  // Record where the user was BEFORE any redirect, so they come back to it.
  rememberReturnPath();
  await ensureSignedIn();

  const currentUser = await resolveUser(client);

  return {
    mode,
    currentUser,
    // DynamicLpDashboard stores dashboards, so it is not business data to chart.
    provider: createOsdkProvider(client, Ontology, { exclude: ["DynamicLpDashboard"] }),
    store: createDashboardStore(client, Ontology, { currentUser })
  };
}

/**
 * The `user` property on DynamicLpDashboard needs a stable identifier. Uses
 * @osdk/foundry.admin if the scope is granted; falls back rather than blocking
 * startup, since a wrong user string is recoverable and a blank screen is not.
 */
async function resolveUser(client) {
  try {
    const { Users } = await import("@osdk/foundry.admin");
    const me = await Users.getCurrent(client);
    return me.id ?? me.username ?? me.email ?? "unknown-user";
  } catch {
    return "unknown-user";
  }
}
