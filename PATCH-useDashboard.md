# Patch: `src/store/useDashboard.js`

Swaps localStorage for the `DynamicLpDashboard` object type. Four edits.

The hook now takes a `store` (from `createDashboardStore`) and a `record` (the
loaded dashboard row). Everything else — `commit`, `updateWidget`, `addWidget`,
undo/redo — is unchanged.

---

**1. Replace the imports and the `KEY` constant**

```js
// REMOVE
const KEY = "dashboard:v3";
```

```js
// KEEP the existing imports, no new ones needed here.
```

---

**2. Change the signature and initial state**

```js
// FROM
export function useDashboard(metaFor) {
  const [spec, setSpec] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return emptySpec();
  });
  ...
  const [versions, setVersions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${KEY}:versions`) || "[]"); } catch { return []; }
  });
```

```js
// TO
export function useDashboard(metaFor, store, record) {
  const [spec, setSpec] = useState(() => record?.draft ?? emptySpec());
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState(() => record?.versions ?? []);
  const [publishedVersion, setPublishedVersion] = useState(() => record?.publishedVersion ?? 0);
```

Delete the old `publishedVersion` derivation at the bottom of the return object
(`publishedVersion: versions[0]?.version ?? 0`) and return the state value instead.

---

**3. Replace the autosave effect**

```js
// FROM
useEffect(() => {
  if (!dirty) return;
  clearTimeout(timer.current);
  timer.current = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(spec)); } catch {}
  }, 700);
  return () => clearTimeout(timer.current);
}, [spec, dirty]);
```

```js
// TO
useEffect(() => {
  if (!dirty || !store || !record) return;
  clearTimeout(timer.current);
  timer.current = setTimeout(async () => {
    setSaving(true);
    try {
      await store.saveDraft(record, spec);
    } catch (e) {
      console.error("Draft save failed", e);
    } finally {
      setSaving(false);
    }
  }, 900);   // a touch longer than localStorage: this is a network write
  return () => clearTimeout(timer.current);
}, [spec, dirty, store, record]);
```

---

**4. Replace `publish` and `restore`**

```js
// FROM
const publish = useCallback(() => {
  const entry = { version: (versions[0]?.version ?? 0) + 1, at: ..., by: "you", spec: clone(spec) };
  const next = [entry, ...versions];
  setVersions(next);
  try { localStorage.setItem(`${KEY}:versions`, JSON.stringify(next)); } catch {}
  setDirty(false);
  return entry;
}, [spec, versions]);

const restore = useCallback((version) => {
  const found = versions.find((v) => v.version === version);
  if (found) commit((d) => Object.assign(d, clone(found.spec)));
}, [versions, commit]);
```

```js
// TO
const publish = useCallback(async () => {
  const entry = await store.publish(record, spec);
  setVersions((v) => [entry, ...v].slice(0, 10));
  setPublishedVersion(entry.version);
  setDirty(false);
  return entry;
}, [spec, store, record]);

const restore = useCallback(async (version) => {
  const restored = await store.restore(record, version);
  if (restored) commit((d) => Object.assign(d, clone(restored)));
}, [store, record, commit]);
```

Add `saving` to the returned object so the top bar can show "Saving…".

---

## `App.jsx`

Two changes:

```js
// FROM
export default function App() {
  const { objectTypes, metaFor, loading } = useOntology();
  const d = useDashboard(metaFor);
```

```js
// TO
export default function App({ dashboardStore }) {
  const { objectTypes, metaFor, loading } = useOntology();
  const [record, setRecord] = useState(null);

  // Load (or create) this user's dashboard once.
  useEffect(() => {
    if (!dashboardStore) return;
    (async () => {
      const mine = await dashboardStore.listMine();
      if (mine.length) setRecord(mine[0]);
      else {
        await dashboardStore.create("Untitled dashboard", emptySpec());
        setRecord((await dashboardStore.listMine())[0]);
      }
    })();
  }, [dashboardStore]);

  const d = useDashboard(metaFor, dashboardStore, record);
```

And `onPublish` becomes async:

```js
onPublish={async () => {
  const v = await d.publish();
  notify(`Shared version ${v.version}`);
}}
```
