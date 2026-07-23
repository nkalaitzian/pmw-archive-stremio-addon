---
description: "Use when working on the PMW archive addon project. Covers project scope, runtime capabilities, Stremio contract rules, scraping constraints, configuration, and likely follow-up improvements."
name: "PMW Archive Stremio Addon Project Instructions"
---

# PMW Project Instructions

- Hard rules in this file apply unless the user explicitly asks to override them for a specific change.
- Keep CommonJS style used by the project: require/module.exports and use double quotes for new string literals, except when the string contains a double quote, in which case use single quotes.

## Project Overview

- This repository is a Stremio addon that exposes content from archive.wubby.tv as a browsable PMW archive.
- The addon is centered on `series` metadata, with yearly catalog entries and monthly episode groupings derived from archived stream listings.
- Runtime behavior is designed to prefer cached data, tolerate upstream network failures, keep third-party request concurrency at or below the value in config.js, and avoid adding new fetches without an accompanying cache lookup.

## Current Capabilities

- `PMW Archive` lists one series per year and lazily resolves monthly episodes for that year.
- `PMW Recently Added` exposes the latest archived episodes sorted by derived stream date.
- The configure flow supports per-user settings for recent item count, year order, and cleaned vs raw titles.
- Cache-first runtime behavior stores index, recent items, and month payloads under `.cache/pmw` with TTL-driven refresh.
- Optional diagnostics endpoints are available when `DEBUG_PMW=true`.
- Local publication to Stremio Central remains opt-in behind `PUBLISH_CENTRAL=true`.

## Stremio Contract Rules

- Preserve manifest contract consistency in addon.js: id, catalogs, resources, and types must stay aligned so handlers return compatible data.
- Keep response shapes strict for Stremio handlers:
  - defineCatalogHandler returns { metas: [...] }
  - defineMetaHandler returns { meta: {...} }
  - defineStreamHandler returns { streams: [...] }
- Preserve PMW catalog item ID format `pmwArchive:<season>:<episode>` unless a migration plan updates all dependent lookups.
- Keep the yearly catalog model and recent catalog semantics consistent with current user-facing behavior unless the user requests a product change.

## Scraping And Runtime Constraints

- In scraping utilities, only emit playable video links (mp4/mkv/webm) and keep URL construction deterministic.
- Use safe async iteration for network scraping and catalog assembly:
  - avoid await inside Array.forEach callbacks
  - use for...of for ordered execution, or Promise.all for intentional parallel execution
- Keep network failures non-fatal when possible: return empty arrays/objects with logging rather than throwing uncaught exceptions from handlers.
- Do not change deployment/publication behavior in server.js unless explicitly requested (serveHTTP and publishToCentral usage is operationally sensitive).

## Configuration And Validation Notes

- Respect environment-driven configuration in config.js before introducing hard-coded timing, retry, concurrency, or cache changes.
- When changing catalog building or cache behavior, prefer narrow tests and behavior checks over broad refactors.
- If package.json and addon.js both expose a version, keep them in sync. When they differ, treat package.json as the source of truth and update addon.js to match.

## Potential Follow-Up Improvements

- Add focused tests for version-management scripts and catalog cache refresh edge cases.
- Add release documentation describing the intended version bump, tag, and deploy sequence.
- Improve diagnostics coverage around stale cache usage, remote fetch retries, and recent-catalog refresh timing.
- Consider explicit validation for malformed archive entries so bad upstream filenames do not leak into user-facing metadata.
- Consider a small CI check that verifies package.json and addon.js versions match before release work.