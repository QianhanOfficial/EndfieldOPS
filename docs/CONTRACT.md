# EOPS v0.1 shared contract
Local only, Chinese UI, no login, same data for UI and MCP.
Server Python stdlib + SQLite at data/dayline.sqlite3 (legacy filename retained so renaming to EOPS preserves existing personal data), 127.0.0.1:11325 serves dist plus SPA history fallback. Never serve source, data, secrets.
GET /api/state returns AppState in src/types.ts. GET /api/health returns ok/version.
POST /api/action accepts {type,payload,expectedRevision?}, responds complete updated AppState. Conflict 409 if provided revision stale.
Actions: project|task|requirement|batch|milestone .create (fields payload, server generates id/defaults), .update ({id,...fields}), .delete ({id}); project/task/requirement/milestone .reorder ({ids:[id,...]}) sets order (front end sends ordered subgroup if appropriate). settings.update ({...fields}); demo.load (only empty database); backup.create; state.import ({state}) with validation and automatic prior backup.
Create defaults: title required except batch, description '', project status active, members ['自己']; Task date '' allowed for unscheduled, difficulty normal, done false, workers ['自己'], subtasks[], dependencies[], requirementId optional; Requirement kind new, done false, difficulty normal, subtasks[]; Batch date required, sequence next per project; Milestone date required, done false.
DELETE project cascades its descendants. DELETE batch cascades requirements but clears task requirementId refs. DELETE requirement clears task requirementId refs. DELETE task removes task from other dependencies. Reject dependency cycles/cross-project links and invalid project dates; max 20 subtasks; robust input validation. No implicit completion by elapsed dates.
All update fields allowlisted. Archive/completion via project.update status. Completed milestone always manual. Task completedAt set on done transition. Order stable on toggle. Tasks are one-day scheduled execution items.
Settings defaults: light, fontSize14, dateFormat YYYY.MM.DD, sidebarPinned false, calendarHeatmap rate, selfName 自己, calendarOverrides {}, reducedMotion false.
POST actions from browser same-origin only; validate Host and Origin. Accept application/json only, loopback. MCP local requests without browser Origin allowed. No wildcard CORS.
UI context supplied by root in src/store.tsx: useApp() returns {state:AppState, act(type,payload):Promise<AppState>, notify(message):void, refresh():Promise<void>}. Routing native history from root: useRoute returns {path,query,navigate(to)}. Workspace props supplied below separately.
No remote AI, no external network needed at runtime. Git excludes data, backups, node_modules, dist, tokens.

Compatibility: existing browser storage keys retain the `dayline` prefix to preserve saved project/view preferences and unsaved background drafts. New exports/backups use `eops-`; the backup list also includes existing `dayline-` JSON backups. MCP tool names use `eops_*`; `EOPS_URL` takes precedence over the legacy `DAYLINE_URL`.
