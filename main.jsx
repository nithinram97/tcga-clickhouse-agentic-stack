import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { DataProviderContext } from "./data/provider.js";
import "./styles.css";

// ---- Mock (default) ----------------------------------------------------
// import { createMockProvider } from "./data/mockProvider.js";
// import demoOntology from "./config/demo-ontology.json";
// const provider = createMockProvider(demoOntology);

// ---- Real Foundry ------------------------------------------------------
import * as Ontology from "@fdc9-skywiseperfodynamiclp/sdk";
import { client, ensureSignedIn } from "./data/client.js";
import { createOsdkProvider } from "./data/osdkProvider.js";
import { createDashboardStore } from "./data/dashboardStore.js";

const provider = createOsdkProvider(client, Ontology, {
  // DynamicLpDashboard stores dashboards, so it is not business data to chart.
  exclude: ["DynamicLpDashboard"]
});

const root = createRoot(document.getElementById("root"));

// The OAuth redirect happens before the first render, so nothing flashes.
ensureSignedIn()
  .then(async () => {
    const currentUser = await resolveUser();
    const store = createDashboardStore(client, Ontology, { currentUser });

    root.render(
      <React.StrictMode>
        <DataProviderContext.Provider value={provider}>
          <App dashboardStore={store} />
        </DataProviderContext.Provider>
      </React.StrictMode>
    );
  })
  .catch((e) => {
    root.render(<div className="boot">Could not sign in to Foundry: {String(e.message ?? e)}</div>);
  });

/**
 * The `user` property on DynamicLpDashboard needs a stable identifier. Use
 * @osdk/foundry's user endpoint if you have the scope; otherwise fall back to
 * whatever your app already knows.
 */
async function resolveUser() {
  try {
    const { Users } = await import("@osdk/foundry.admin");
    const me = await Users.getCurrent(client);
    return me.id ?? me.username ?? me.email;
  } catch {
    return "unknown-user";
  }
}
