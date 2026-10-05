# Prisma Report Explorer

A browser-based navigator for Prisma Cloud vulnerability exports. Drop in an
`.xlsx` export and get a filterable dashboard: KPI tiles, charts, a virtualised
data grid, CVE rollups and a remediation plan.

The file never leaves the machine — parsing happens in the browser.

```bash
npm install
npm run dev
```

Then drop your export on the page, or click **Load sample** to use the bundled
19-row snapshot in `public/samples/`.

## The determinism contract

The same file always produces the same dashboard. That rests on four rules:

1. **Columns are matched by header name, not position.** Every column is
   normalised (case, whitespace, non-breaking spaces, trailing punctuation) and
   looked up in an alias table in [`src/lib/schema.ts`](src/lib/schema.ts). A
   re-export with reordered or renamed-in-case columns lands on the same fields.
   Unrecognised columns are kept and shown in the grid's column chooser rather
   than dropped.
2. **The header row is found, not assumed.** The parser scans the first 25 rows
   and picks the one matching the most known headers, so a title block above the
   table does not break it.
3. **Dates are decoded in UTC.** Excel serials are converted against the
   1899-12-30 epoch directly instead of letting the spreadsheet library build
   `Date` objects, which would bake the *reader's* timezone into the result and
   make the same file parse differently in Kuala Lumpur and in Prague.
4. **Row identity is content-derived.** Each row's id is a hash of CVE, image,
   digest, repo, tag, namespace, cluster, host, package and path. The report
   also carries a `fingerprint` (visible under the ⓘ button) — two parses of the
   same bytes always produce the same fingerprint.

Verify any export against these rules without opening the UI:

```bash
npm run verify -- path/to/your-export.xlsx
```

It prints the column mapping, what was skipped, the derived breakdowns and a
sample row, then asserts that the parse is stable and well-formed.

## Multi-sheet workbooks

If the workbook has more than one sheet you get a picker, with each tab summarised
by how many of its headers match the Prisma schema — the real export is usually
obvious at a glance:

```
  Cover      ~4 data rows  ·  2 columns  ·  0 recognised   Unrecognised
  Summary    ~2 data rows  ·  2 columns  ·  2 recognised   Unrecognised
  Export    ~22 data rows  · 56 columns  · 56 recognised   Prisma export
  Appendix   ~1 data rows  ·  1 columns  ·  0 recognised   Unrecognised
```

Inspection only touches each sheet's declared range and its first 25 rows, so the
picker opens instantly even on a large workbook. A single-sheet file skips the
picker entirely.

**Your choice is remembered in `localStorage`**, at two levels:

| Level | Key | Behaviour |
|---|---|---|
| This exact file | SHA-256 of the file's bytes | Re-uploading the identical workbook skips the picker and loads straight in — even if the file has been renamed |
| This sheet name | the names you have picked before | A *new* export has different bytes, so it still asks — but the sheet you usually pick is pre-selected |

The distinction matters: silently reusing a choice across a file you have never
seen before would be a good way to read the wrong tab without noticing.

Once loaded, the toolbar shows which sheet is being read and why
(`chosen by you`, `remembered from a previous upload`, …). Use it to switch
sheets — that re-parses the workbook already in memory, so it is instant — or to
stop remembering the choice for that file.

The CLI check understands sheets too:

```bash
npm run verify -- report.xlsx                 # lists sheets, picks the best one
npm run verify -- report.xlsx --sheet Export  # force a specific sheet
```

`public/samples/prisma-multi-sheet.xlsx` is a synthetic four-sheet fixture for
exercising this.

## CVE hover preview

Hovering a CVE cell opens a preview card, in two layers:

1. **Instantly**, from the export itself — severity, CVSS, the vulnerability
   description and the remediation line.
2. **Then live**, from [OSV](https://osv.dev) and
   [FIRST EPSS](https://www.first.org/epss/): a plain-language exploit-probability
   bar, the OSV summary, fixed versions per ecosystem, and aliases (GHSA etc.).

> **Why this is not an iframe of the CVE page.** NVD, MITRE and CISA all serve
> `X-Frame-Options: DENY` and a `frame-ancestors` CSP, so a browser refuses to
> render them in a frame — an embedded preview of those pages is blank by
> design, not by misconfiguration. These two APIs are the CORS-enabled sources
> that let the same information be shown natively.

Lookups fire only on hover, are cached for the session, and send **only the CVE
id** — no report content leaves the machine. If your environment does not permit
calls to third-party APIs from an analyst's browser, turn them off under the 🔗
CVE menu; the card then shows the report's own data only. That preference is
remembered.

## Performance on large exports

A real export is ~30MB zipped but **343MB uncompressed**: 91,578 findings across
56 columns, plus a 166MB pivot cache Excel leaves behind. Numbers below are from
profiling that file, not the 19-row sample.

Where the time actually went, before any of this work (Node, ~18.4s total):

| Phase | Time | Share |
|---|---|---|
| `XLSX.read` — every sheet, sparse | 14.3s | 78% |
| `sheet_to_json` — a second full copy | 2.2s | 12% |
| row loop → `Finding[]` | 2.0s | 10% |

What changed:

- **Dense cell storage** (`dense: true`). A sparse read keys all 5.1M cells into
  one A1-addressed map. Dense stores `[row][col]` instead: **14.3s → 8.4s**, peak
  heap 860MB → 600MB. Single biggest win.
- **Two-pass read.** The sheet picker only looks at 25 rows per sheet, so it now
  reads with `sheetRows: 25` (~2.5s) and the picker appears almost immediately
  instead of after the whole workbook is inflated. The chosen sheet is then read
  on its own.
- **No intermediate matrix.** The row loop walks the dense grid directly instead
  of materialising `sheet_to_json`'s second full copy.
- **Parsing in a Web Worker.** Worst main-thread stall during a full load went
  from *seconds of frozen tab* to **2ms**, with a real progress bar.
- **IndexedDB cache**, keyed by the same file-content hash as the sheet memory.
  Reopening the same export: **~40s → ~1.7s** (measured back-to-back; the
  machine was loaded, so treat the ratio as the signal, not the absolute).
- **Single-pass faceting.** Counting each open facet separately meant one full
  scan per facet — five open facets over 91k rows measured **344ms** per filter
  change. One pass with a per-row fail-count does the same work in **70ms**, with
  byte-identical output.
- **Columnar, dictionary-encoded index** (`columnar.ts`). Filtering, facet
  counting and every Overview tally now run as integer comparisons and histograms
  over typed arrays rather than scans over 91k row objects. One filter change
  went from **373ms to 15ms**.

  This works because of the shape of the data: a 30MB export carries 4.5M cell
  references but only **~5,500 distinct strings**, so every column encodes
  tightly (the whole index is 17MB) and a free-text search resolves against a few
  thousand dictionary entries instead of 91k rows.
- **Deferred heavy panes.** The sidebar and the headline count update from the
  live filter state; the grids and the ten charts read a `useDeferredValue` copy.
  Clicking a facet checkbox now blocks the main thread for **0–1ms** — React
  paints the checkbox first and catches the panes up after, dimming them briefly
  so the lag is legible rather than mysterious.
- **Debounce fix.** The facet panel was counting against the *undebounced* filter
  state, so every keystroke in the search box triggered those scans while the
  grid and charts correctly waited.

Two things the plan expected that measurement contradicted, and which were
therefore **not** done:

- *Reading only the chosen sheet is a big win.* It is not: `sheets: ['Export']`
  saved 0.1s, because the other tab is small and the cost is inflating the data
  sheet itself. Kept anyway — it bounds peak memory — but it is not the lever.
- *Collapsing the ~12 chart tally passes.* Measured at **19ms** — and that call
  turned out to be wrong, because it was measured on an 8.7k-row *filtered*
  subset. On a filter that keeps most of the report those same passes cost
  **~340ms**, and they were the single biggest cause of the click lag. Measure at
  the scale the user actually hits.

DuckDB-WASM was considered and not used. It fixes the same two things the
columnar index below fixes, but it cannot read `.xlsx` — SheetJS would still do
the decoding, which is the dominant *load* cost — and getting its memory benefit
would mean moving the grid to a server-side row model and rewriting the filter
and stats layers as SQL. The columnar index buys the interaction win for a
fraction of that, with no new dependency.

The row-object implementations in `filters.ts` and `stats.ts` are kept as the
readable reference, and `npm run verify:columnar` asserts the fast path still
agrees with them across 16 filter shapes:

```bash
npm run verify:columnar -- path/to/real-export.xlsx
```

### Known ceiling

Chrome refuses a single IndexedDB value over ~127MB, and this report serialises
to ~235MB, so cached rows are written in chunks of 10,000. The cache read is
also sliced with yields between chunks — pulling it back in one burst blocked
the main thread for 4.6s.

## What it reads from the export

The sample export has 56 columns and three kinds of row:

| Row kind | Handling |
|---|---|
| Data rows | Parsed into findings |
| `Total` footer | Skipped; its grand total is surfaced separately as "Export total" |
| `Applied filters:` footer | Skipped; shown under ⓘ as report provenance |

A row counts as data only if it fills at least 20% of the mapped columns, which
is what keeps the sparse footer rows out of the dataset.

### Derived fields

These are computed, never read from the sheet:

| Field | How it is derived |
|---|---|
| **Surface** (Container / Code) | Tiered: package type first (`deb`/`rpm`/`apk` → Container, `jar`/`npm`/`python`/… → Code), then Prisma's vulnerability category, then the PURL scheme. Every finding records *why* it was classified — hover the badge. |
| **Exploitable / Patchable** | Strict tri-state (`Yes` / `No` / `Unknown`) parsed from `Is Exploitable` / `Is Patchable`. Blank stays `Unknown` rather than being guessed as `No`. |
| **Triage class** | The exploitable × patchable cross-product. |
| **Age** | Days since `Discovered`, plus an ordered bucket (0-7d … 180d+). |
| **Tag structure** | Image tags from this pipeline are structured, so they are decomposed into branch/stream, version, build number and build timestamp. |
| **Image age** | Days since the image was *built* (from the tag's timestamp) — distinct from how long the finding has been open. |

### Filtering by image tag

Raw tags are filterable, but on a real export there are 333 distinct ones, so
they are also decomposed:

```
246-MYEXP-PHASE1-SIT-20260917-1-2026-09-17-11-40
|   |                           `- built at        -> Image age
|   `- stream (run counter stripped)               -> Branch / stream
`- build number

9-develop-1.0.0-2026-07-15-09-27   -> stream "develop", version "1.0.0"
```

That collapses 333 tags into **22 streams**, which is a usable facet:
`MYEXP-PHASE1-SIT` (51,854 findings), `release-main` (15,088), `release`
(12,596), `develop` (5,214), and a long tail of feature branches.

Tags that do not match the pattern (`latest`, `curl`, `alpine`) keep the whole
tag as their stream rather than being dropped — verified across all 91,578 rows
that no tag loses its identity and no build timestamp parses to a nonsense date.

## Views

- **Overview** — KPI tiles, severity donut, the exploitable × patchable matrix,
  container-vs-code split, top repos, environment/exposure, age and discovery
  timeline. Every tile and chart element is a filter: click it.
- **Findings** — the full ag-grid, with a CVE hover preview. All 56 columns available via the column
  chooser, per-column filters, sorting, CSV export of the current view.
- **By CVE** — one row per CVE with its blast radius: how many findings, how
  many repos and namespaces, whether *any* instance is exploitable or patchable.
- **Remediation** — one row per package: *"if I bump this one dependency, how
  many findings close and which repos do I have to touch?"* Sorted by blast
  radius, which is the fastest route from a 10k-row export to a sprint plan.

## Filtering

The left sidebar is a faceted filter over every dimension in the export. Counts
are computed against the rows surviving all *other* filters, so selecting one
value does not zero out its siblings.

**Filter state lives in the URL.** A filtered view is a shareable link and
survives a reload — use the 🔗 button to copy one.

The panel is resizable — repo names, package paths and owner groups routinely
run past any fixed width. Drag its right edge, double-click to reset, or focus
the divider and use the arrow keys (`Shift` for bigger steps, `Home`/`End` for
the limits). The width is remembered.

## CVE links

Any value matching `CVE-YYYY-NNNN` links out to a vulnerability database;
internal identifiers like `SW-Bulletin-4105464` render as plain text rather than
a dead link. Pick the target database from the toolbar:

NVD · MITRE · CISA KEV · OSV · GitHub Advisory · FIRST EPSS

The detail sheet offers all six at once for the selected finding.

## Stack

- **Vite + React 19 + TypeScript**
- **Tailwind v4** + **shadcn/ui** components (vendored into `src/components/ui`)
- **ag-grid-community** 36 — row virtualisation, so 10k+ rows scroll smoothly
- **Recharts** 3 via shadcn-style chart wrappers
- **SheetJS (`xlsx`)** for parsing

### A note on the `xlsx` dependency

This installs SheetJS **0.20.3 from the vendor's own CDN**, which is how SheetJS
now distributes it:

```
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

The copy on the public npm registry is abandoned at 0.18.5 and carries a
prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6). For a security-reporting
tool, shipping that would be a bad look. If you re-lock dependencies, keep the
CDN URL.

## Colour

Charts use a palette validated for colour-vision deficiency and contrast against
both the light and dark surfaces. Severity is treated as a **status** scale, not
a series palette: its four steps are fixed in both modes and every severity is
rendered with its text label, so hue never carries the meaning alone.

## Project layout

```
src/
  lib/
    schema.ts     canonical fields + header aliases
    parse.ts      workbook -> findings, sheet inspection, fingerprint
    columnar.ts   dictionary-encoded column index
    filters-columnar.ts  fast row selection + facet counting
    stats-columnar.ts    every Overview tally in one pass
    parse.worker.ts  parsing off the main thread
    parse-client.ts  main-thread handle on the worker
    report-cache.ts  parsed reports cached in IndexedDB (chunked)
    sheet-prefs.ts  remembered sheet choice (localStorage)
    cve-data.ts   live OSV + EPSS lookup for the hover card
    filters.ts    filter model, faceting, URL serialisation
    stats.ts      KPIs, breakdowns, CVE and remediation rollups
    cve.ts        vulnerability database links
    format.ts     number/date formatting (UTC)
  components/
    ui/           shadcn primitives
    charts/       dashboard charts
    ...           facet panel, grids, detail sheet, toolbar
scripts/
  verify-parse.ts parser smoke test / determinism check
```
