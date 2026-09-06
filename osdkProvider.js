import { GROUPINGS, AGGREGATIONS } from "../config/propertyTypes.js";

/**
 * Real OSDK provider — drop-in replacement for createMockProvider.
 *
 * Same five methods, so no component changes. Written against the API surface
 * in your Developer Console docs for @osdk/client 2.56:
 *
 *   client(ObjectType).where({...}).aggregate({ $select, $groupBy })
 *   client.fetchMetadata(ObjectType)
 *   $select keys: "$count" | "property:sum" | "property:avg" | "property:max"
 *                 | "property:min" | "property:approximateDistinct"
 *                 | "property:exactDistinct"
 *   ordering:     "unordered" | "asc" | "desc"
 *   $groupBy:     "exact" | "topValues" | { $fixedWidth } | { $duration } | { $ranges }
 *
 * Usage:
 *   import * as Ontology from "@fdc9-skywiseperfodynamiclp/sdk";
 *   import { client } from "./client.js";
 *   const provider = createOsdkProvider(client, Ontology);
 */
export function createOsdkProvider(client, ontologyModule, options = {}) {
  const {
    // Object types the builder should expose. Omit to auto-discover everything
    // the generated SDK exports — including DynamicLpDashboard itself, which you
    // probably want to hide since it stores dashboards rather than business data.
    include = null,
    exclude = ["DynamicLpDashboard"]
  } = options;

  const objectTypes = Object.fromEntries(
    Object.entries(ontologyModule).filter(([name, v]) => {
      if (!isObjectType(v)) return false;
      if (include) return include.includes(name);
      return !exclude.includes(name);
    })
  );

  const defOf = (apiName) => {
    const d = objectTypes[apiName];
    if (!d) throw new Error(`Object type not exported by the generated SDK: ${apiName}`);
    return d;
  };

  const metaCache = new Map();

  return {
    id: "osdk",

    async listObjectTypes() {
      const entries = await Promise.all(
        Object.entries(objectTypes).map(async ([apiName, def]) => {
          const m = await client.fetchMetadata(def);
          return {
            apiName,
            displayName: m.displayName ?? apiName,
            description: m.description ?? m.pluralDisplayName ?? undefined
          };
        })
      );
      return entries;
    },

    /**
     * fetchMetadata is what makes the whole app ontology-agnostic: display names,
     * descriptions and property types come from the ontology at runtime, so an
     * ontology change needs no code change. Your docs note it returns the LATEST
     * metadata even if your generated SDK is older — so a newly added property
     * appears in the pickers before you regenerate.
     */
    async describeObjectType(apiName) {
      if (metaCache.has(apiName)) return metaCache.get(apiName);
      const m = await client.fetchMetadata(defOf(apiName));

      const described = {
        apiName,
        displayName: m.displayName ?? apiName,
        description: m.description,
        primaryKey: m.primaryKeyApiName ?? m.primaryKeyPropertyApiName,
        properties: Object.entries(m.properties ?? {}).map(([pApi, p]) => ({
          apiName: pApi,
          displayName: p.displayName ?? pApi,
          description: p.description,
          // Normalised in config/propertyTypes.js — nothing downstream reads the
          // raw Foundry type name.
          type: normaliseType(p)
        })),
        links: Object.entries(m.links ?? {}).map(([lApi, l]) => ({
          apiName: lApi,
          displayName: l.displayName ?? lApi,
          targetType: l.targetType,
          multiplicity: l.multiplicity
        }))
      };
      metaCache.set(apiName, described);
      return described;
    },

    /**
     * Values for filter checklists, via a grouped count ordered descending, so
     * the most common values come first. Users pick from what is actually in the
     * data instead of typing a string and hoping.
     */
    async distinctValues(objectType, property, limit = 12) {
      const rows = await client(defOf(objectType)).aggregate({
        $select: { $count: "desc" },
        $groupBy: { [property]: "exact" }
      });
      return asArray(rows)
        .slice(0, limit)
        .map((r) => ({ value: r.$group?.[property], count: r.$count ?? 0 }))
        .filter((r) => r.value != null && r.value !== "");
    },

    async numericRange(objectType, property) {
      const res = await client(defOf(objectType)).aggregate({
        $select: {
          [`${property}:min`]: "unordered",
          [`${property}:max`]: "unordered"
        }
      });
      const r = asArray(res)[0] ?? res;
      return { min: readNamed(r, property, "min") ?? 0, max: readNamed(r, property, "max") ?? 0 };
    },

    /** One aggregate call per widget. */
    async aggregate(query) {
      const { objectType, where, groupBy, split, measures, limit = 12 } = query;

      const $select = {};
      measures.forEach((m) => {
        const agg = AGGREGATIONS[m.fn];
        $select[agg.osdk ? `${m.property}:${agg.osdk}` : "$count"] = "unordered";
      });

      const args = { $select };
      if (groupBy) {
        args.$groupBy = {
          [groupBy.property]: GROUPINGS[groupBy.strategy].build(groupBy.options)
        };
        if (split) {
          args.$groupBy[split.property] = GROUPINGS[split.strategy].build(split.options);
        }
      }

      let objectSet = client(defOf(objectType));
      if (where && Object.keys(where).length) objectSet = objectSet.where(where);

      const rows = await objectSet.aggregate(args);
      return shape(asArray(rows), query, limit);
    }
  };
}

/* ---------- helpers ---------- */

function isObjectType(v) {
  return !!v && typeof v === "object" && (v.type === "object" || v.__DefinitionMetadata?.type === "object");
}

function normaliseType(p) {
  // fetchMetadata returns type as a string or as { type: "string" }.
  const t = typeof p.type === "string" ? p.type : p.type?.type;
  return t ?? "string";
}

const asArray = (r) => (Array.isArray(r) ? r : r == null ? [] : [r]);

/**
 * Reads one metric from an aggregation row.
 *
 * The migration guide shows `"prop:approximateDistinct"` in $select being read
 * back as `result.prop`, while some shapes nest it as `result.prop.metric`.
 * Both are handled — check one real response and you can delete the branch you
 * do not need.
 */
function readNamed(row, property, metric) {
  if (!row) return undefined;
  const v = row[property];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return v[metric];
  return row[`${property}:${metric}`];
}

function readMetric(row, measure) {
  const agg = AGGREGATIONS[measure.fn];
  if (!agg.osdk) return row?.$count ?? 0;
  return readNamed(row, measure.property, agg.osdk) ?? 0;
}

/** OSDK returns a flat list of groups; the renderer wants { keys, series }. */
function shape(list, query, limit) {
  const { groupBy, split, measures } = query;

  if (!groupBy) {
    const r = list[0];
    return {
      keys: ["All"],
      series: measures.map((m) => ({
        name: m.label,
        measureId: m.id,
        splitKey: null,
        values: [readMetric(r, m)]
      })),
      truncated: false
    };
  }

  const keyOf = (r) => String(r.$group?.[groupBy.property] ?? "");
  const allKeys = [...new Set(list.map(keyOf))];
  const keys = allKeys.slice(0, limit);

  const series = [];
  const push = (name, measure, splitKey) => {
    const values = keys.map((k) => {
      const r = list.find(
        (row) =>
          keyOf(row) === k &&
          (splitKey == null || String(row.$group?.[split.property] ?? "") === splitKey)
      );
      return r ? readMetric(r, measure) : 0;
    });
    series.push({ name, values, measureId: measure.id, splitKey });
  };

  if (split) {
    const splitKeys = [...new Set(list.map((r) => String(r.$group?.[split.property] ?? "")))];
    splitKeys.slice(0, split.limit ?? 4).forEach((s) => push(s, measures[0], s));
  } else {
    measures.forEach((m) => push(m.label, m, null));
  }

  // Foundry reports dropped groups as excludedItems when maxGroupCount is hit.
  return { keys, series, truncated: allKeys.length > keys.length };
}
