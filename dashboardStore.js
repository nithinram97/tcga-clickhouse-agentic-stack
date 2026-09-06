/**
 * Dashboard persistence via the DynamicLpDashboard object type.
 *
 * Your ontology gives us exactly four properties:
 *   primaryKey_      String   (primary key)
 *   dashboardName    String
 *   dashboardConfig  String   "Stores the entire dashboard configuration in JSON format"
 *   user             String
 *
 * There is no column for draft-vs-published or version history, so BOTH live
 * inside dashboardConfig as an envelope:
 *
 *   {
 *     "envelope": 1,
 *     "draft":     { ...spec },        // autosaved, only the owner sees it
 *     "published": { ...spec } | null, // what viewers see
 *     "publishedVersion": 3,
 *     "versions": [ { version, at, by, spec }, ... ]   // most recent first
 *   }
 *
 * This needs no ontology change. The cost is that history grows the string, so
 * VERSION_LIMIT trims it — raise it if your Foundry column tolerates the size,
 * or split history into its own object type later.
 */

const ENVELOPE = 1;
const VERSION_LIMIT = 10;

/**
 * ACTION NAMES — CHECK THESE.
 *
 * Your docs show three Actions: "[Dynamic LP] Create New Dashboard",
 * "[Dynamic LP] Update dashboard", "[Dynamic LP] Delete Dashboard". The
 * generated SDK exports them under camelCase apiNames, and the parameter names
 * are whatever the Action defines — I can't see those from the object-type page.
 *
 * Open Developer Console → Actions → each Action to read its exact apiName and
 * parameters, then correct this one block. Nothing else in the app refers to
 * Action names.
 */
export const ACTIONS = {
  create: {
    name: "createNewDashboard",
    params: (o) => ({
      dashboardName: o.dashboardName,
      dashboardConfig: o.dashboardConfig,
      user: o.user
    })
  },
  update: {
    name: "updateDashboard",
    params: (o) => ({
      // Most edit Actions take the object itself as the parameter, some take
      // the primary key. If yours takes the key, pass o.primaryKey instead.
      DynamicLpDashboard: o.object,
      dashboardName: o.dashboardName,
      dashboardConfig: o.dashboardConfig
    })
  },
  remove: {
    name: "deleteDashboard",
    params: (o) => ({ DynamicLpDashboard: o.object })
  }
};

export function createDashboardStore(client, Ontology, { currentUser }) {
  const ObjectType = Ontology.DynamicLpDashboard;
  const action = (key) => {
    const a = Ontology[ACTIONS[key].name];
    if (!a) {
      throw new Error(
        `Action "${ACTIONS[key].name}" is not exported by the SDK. ` +
          `Check its apiName in Developer Console → Actions and fix ACTIONS in dashboardStore.js.`
      );
    }
    return a;
  };

  const parse = (row) => {
    let env;
    try {
      env = JSON.parse(row.dashboardConfig || "{}");
    } catch {
      env = {};
    }
    if (!env.envelope) {
      // A config written by something other than this app (or an older version)
      // is treated as a bare spec rather than discarded.
      env = { envelope: ENVELOPE, draft: env, published: null, publishedVersion: 0, versions: [] };
    }
    return {
      primaryKey: row.primaryKey_,
      name: row.dashboardName,
      user: row.user,
      object: row,
      ...env
    };
  };

  return {
    /** Dashboards owned by the signed-in user. */
    async listMine(pageSize = 50) {
      const page = await client(ObjectType)
        .where({ user: { $eq: currentUser } })
        .fetchPage({ $orderBy: { dashboardName: "asc" }, $pageSize: pageSize });
      return page.data.map(parse);
    },

    /** Every dashboard, for a gallery or a shared list. */
    async listAll(pageSize = 50) {
      const page = await client(ObjectType).fetchPage({
        $orderBy: { dashboardName: "asc" },
        $pageSize: pageSize
      });
      return page.data.map(parse);
    },

    async load(primaryKey) {
      const row = await client(ObjectType).fetchOne(primaryKey);
      return parse(row);
    },

    async create(name, spec) {
      const envelope = {
        envelope: ENVELOPE,
        draft: spec,
        published: null,
        publishedVersion: 0,
        versions: []
      };
      const a = action("create");
      return client(a).applyAction(
        ACTIONS.create.params({
          dashboardName: name,
          dashboardConfig: JSON.stringify(envelope),
          user: currentUser
        }),
        { $returnEdits: true }
      );
    },

    /** Autosave. Writes the draft only — viewers keep seeing the published copy. */
    async saveDraft(record, spec) {
      const next = { ...pick(record), draft: spec };
      return this._write(record, next);
    },

    /** Snapshot the draft as the new published version. */
    async publish(record, spec, label) {
      const version = (record.publishedVersion ?? 0) + 1;
      const entry = { version, at: new Date().toISOString(), by: currentUser, label, spec };
      const next = {
        ...pick(record),
        draft: spec,
        published: spec,
        publishedVersion: version,
        versions: [entry, ...(record.versions ?? [])].slice(0, VERSION_LIMIT)
      };
      await this._write(record, next);
      return entry;
    },

    async restore(record, version) {
      const found = (record.versions ?? []).find((v) => v.version === version);
      if (!found) return null;
      await this._write(record, { ...pick(record), draft: found.spec });
      return found.spec;
    },

    async rename(record, name) {
      const a = action("update");
      return client(a).applyAction(
        ACTIONS.update.params({
          object: record.object,
          primaryKey: record.primaryKey,
          dashboardName: name,
          dashboardConfig: JSON.stringify(pick(record))
        })
      );
    },

    async remove(record) {
      const a = action("remove");
      return client(a).applyAction(
        ACTIONS.remove.params({ object: record.object, primaryKey: record.primaryKey })
      );
    },

    async _write(record, envelope) {
      const a = action("update");
      return client(a).applyAction(
        ACTIONS.update.params({
          object: record.object,
          primaryKey: record.primaryKey,
          dashboardName: record.name,
          dashboardConfig: JSON.stringify(envelope)
        })
      );
    },

    /**
     * Live updates. Your docs confirm subscribe is available on @osdk/client
     * 2.1.x+, and you are on 2.56 — so a second person editing the same
     * dashboard shows up rather than silently overwriting.
     *
     * Returns the subscription; call .unsubscribe() on unmount.
     */
    subscribe(onRecord, onOutOfDate) {
      return client(ObjectType)
        .where({ user: { $eq: currentUser } })
        .subscribe(
          {
            onChange(update) {
              if (update.state === "ADDED_OR_UPDATED") onRecord(parse(update.object));
            },
            onSuccessfulSubscription() {},
            onError(err) {
              console.error("Dashboard subscription failed", err);
            },
            onOutOfDate() {
              onOutOfDate?.();
            }
          },
          { properties: ["dashboardName", "dashboardConfig", "primaryKey_", "user"] }
        );
    }
  };
}

const pick = (r) => ({
  envelope: ENVELOPE,
  draft: r.draft ?? null,
  published: r.published ?? null,
  publishedVersion: r.publishedVersion ?? 0,
  versions: r.versions ?? []
});
