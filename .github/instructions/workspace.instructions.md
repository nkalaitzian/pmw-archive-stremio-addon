---
description: "Use when modifying the PMW Stremio addon JavaScript files. Covers manifest consistency, handler response shapes, archive scraping behavior, and safe async patterns for catalog building."
name: "PMW Stremio Addon Guidelines"
applyTo: ["addon.js", "fetchCatalog.js", "fetchUtil.js", "server.js"]
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

# PMW Stremio Addon Guidelines

- Hard rules in this file apply unless the user explicitly asks to override them for a specific change.
- Keep CommonJS style used by the project: require/module.exports and double quotes for new string literals when possible.
- Preserve manifest contract consistency in addon.js: id, catalogs, resources, and types must stay aligned so handlers return compatible data.
- Keep response shapes strict for Stremio handlers:
	- defineCatalogHandler returns { metas: [...] }
	- defineMetaHandler returns { meta: {...} }
	- defineStreamHandler returns { streams: [...] }
- Preserve PMW catalog item ID format pmwArchive:<season>:<episode> unless a migration plan updates all dependent lookups.
- In scraping utilities, only emit playable video links (mp4/mkv/webm) and keep URL construction deterministic.
- Use safe async iteration for network scraping and catalog assembly:
	- avoid await inside Array.forEach callbacks
	- use for...of for ordered execution, or Promise.all for intentional parallel execution
- Keep network failures non-fatal when possible: return empty arrays/objects with logging rather than throwing uncaught exceptions from handlers.
- Do not change deployment/publication behavior in server.js unless explicitly requested (serveHTTP and publishToCentral usage is operationally sensitive).