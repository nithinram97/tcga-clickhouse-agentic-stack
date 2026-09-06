# Wiring the dashboard builder to your Foundry ontology

Files here replace or add to `dashboard-builder-v3`. Nothing else changes.

| File | What it does |
|---|---|
| `.env.example` | Copy to `.env`, fill from Developer Console |
| `src/data/client.js` | **new** — Foundry client, browser OAuth as the signed-in user |
| `src/data/osdkProvider.js` | **replaces** the stub — the five provider methods, real |
| `src/data/dashboardStore.js` | **new** — persistence via `DynamicLpDashboard` + your 3 Actions |
| `src/main.jsx` | **replaces** — sign in, then render with the real provider |
| `PATCH-useDashboard.md` | Line edits for `useDashboard.js` and `App.jsx` |

## Install

```bash
npm i @fdc9-skywiseperfodynamiclp/sdk@^0.18.0 @osdk/client@^2.56.0 \
      @osdk/oauth@^1.1.1 @osdk/foundry@latest
```

## One thing to check before it runs

I could read your object type and Action *names* from the screenshots, but not
the Actions' **apiNames and parameter names** — those are on each Action's own
page in Developer Console. They live in a single `ACTIONS` block at the top of
`dashboardStore.js`; correct them there and nothing else needs touching.

The other thing worth confirming against one real response is the aggregation
result shape for a named metric (`result.revenue` vs `result.revenue.sum`).
`readNamed()` in `osdkProvider.js` handles both — delete the branch you don't
need once you've seen it.

## Why versions live inside `dashboardConfig`

Your object type has four properties and none of them can hold history. So
`dashboardConfig` stores an envelope:

```json
{
  "envelope": 1,
  "draft":     { "...": "spec" },
  "published": { "...": "spec" },
  "publishedVersion": 3,
  "versions": [ { "version": 3, "at": "...", "by": "...", "spec": {} } ]
}
```

That keeps draft-vs-published working with no ontology change — editing writes
`draft`, Share writes `published`, and viewers read `published`. History is
capped at 10 entries (`VERSION_LIMIT`) so the string doesn't grow without bound;
if you'd rather keep more, add a `DynamicLpDashboardVersion` object type and move
the array there.

A config written by anything other than this app is treated as a bare spec
rather than discarded, so nothing is lost if the property already has content.

## Two things you now get for free

**Live updates.** `store.subscribe()` uses OSDK object-set subscriptions
(available on `@osdk/client` 2.1.x+; you're on 2.56). If someone edits a
dashboard in another tab, you find out instead of silently overwriting.

**Foundry permissions.** `createPublicOauthClient` authenticates the browser as
the signed-in user, so every aggregation carries their own permissions. Don't
replace it with a service token in a backend proxy — row-level security stops
applying and every user sees every row.

## Hiding the dashboard object type

`createOsdkProvider` excludes `DynamicLpDashboard` by default — it stores
dashboards, so it isn't business data to chart. Charting your own storage would
work, but it would be a confusing first thing for a user to see. Pass
`include: [...]` if you'd rather allow-list explicitly.
