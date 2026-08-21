# MP3 Streamer

Personal home media server: a C# ASP.NET Core backend streams an mp3 library
(scanned from disk, ID3 tags read via TagLibSharp) to a React web client, so
Ryan can browse/play his music from any device. Built collaboratively with
Claude Code across several sessions — this file exists so a new session (or a
different person's Claude account, e.g. Ryan's brother) can pick up with full
context instead of re-deriving it.

**Ryan and his brother each run their own local copy of this project**
against their own separate music libraries — not a shared running server.
The code is synced between them (e.g. via git, once that's set up — see
"Not yet done" below).

## Collaboration convention — read this first

Two people, two separate Claude accounts, one codebase. To keep both sides
in sync without manually re-explaining changes every time:

**Whenever you (Claude) finish a meaningful chunk of work in this repo,
append a dated entry to `DEVLOG.md` at the project root** summarizing what
changed and why — a few bullet points, not a full transcript. Use today's
date and the name of whoever you're working with (ask if you don't already
know it from context). Newest entries go at the top of that file.

**Whenever you start work in this repo, `git fetch` and pull any new
commits from `origin/main` first** — before making any changes, and before
reading `DEVLOG.md` (that file itself would be stale locally otherwise).
The other person's Claude session may have pushed work since you last
touched this project; if their branch is ahead, pull it in (a plain
fast-forward `git pull` should suffice — this is a single shared `main`
branch, not a PR-based workflow). If there are local uncommitted changes in
the way, stash them first rather than discarding anything. Only proceed to
the collaboration steps below once local `main` matches `origin/main`.

**Then, skim `DEVLOG.md`** — specifically any entries you don't already
have context for — to catch up on what the *other* person's Claude session
did since you last touched this project. That's the whole point of the
file: it's cheaper and more reliable than re-deriving intent from a raw
`git log` or diff.

## Status

v1 scope is complete and verified end-to-end (tested in-browser against a
real album, and from a phone over the LAN):

- **Backend**: library scanning, SQLite+EF Core storage, browse/search/facet
  endpoints, HTTP range-request streaming (seekable audio), embedded artwork
  extraction, full playlist CRUD + reorder.
- **Frontend**: browsing UI (All Tracks / Artists / Albums / Genres /
  Playlists), audio player (play/pause/seek/auto-advance-on-end), playlist
  management (create/rename/delete/add/remove/reorder), mobile-responsive
  layout, a **Now Playing Screen** (tap the **Mini Player** to open it —
  reflows correctly between portrait and landscape, dismiss by dragging the
  artwork down in portrait / right in landscape), a Settings panel (⋮ icon)
  with a Light/Dark/System theme picker persisted in `localStorage`.

  **Terminology** (use these consistently — established 2026-08-17): the
  persistent bottom bar is the **Mini Player**; the full-screen expanded
  view is the **Now Playing Screen**.
- **Deployment**: LAN-only, no authentication (deliberate — see below). The
  backend serves the built frontend itself (single process, single port) so
  it's reachable from any device on the same Wi-Fi via the host machine's
  LAN IP. Runs as a **Windows Service** on Ryan's PC (`Mp3Streamer`, set up
  2026-08-18/19) — always on, survives reboots, no dependency on a
  terminal or Claude Code session being open. See "Running as a Windows
  Service" below for the full setup and the redeploy workflow.

## Architecture

### Backend — `server/Mp3Streamer.Api` (.NET 10, ASP.NET Core Minimal API)

- `Data/LibraryDbContext.cs` — EF Core DbContext, SQLite (`library.db`)
- `Models/Track.cs`, `Playlist.cs`, `Dtos.cs` — entities + response DTOs
- `Services/LibraryScanner.cs` — recursively scans `LibraryRootPaths`
  (from config) for `.mp3` files, reads ID3 tags via TagLibSharp, upserts
  changed tracks, and either removes DB rows for files no longer on disk
  or flags them `IsMissing` instead — see `RemoveMissingTracks` setting
  under Key decisions below
- `Services/LibraryWatcherService.cs` — `FileSystemWatcher`-based background
  service; runs one scan on startup, then rescans (debounced) whenever the
  library folders change, plus a periodic health check that reconnects any
  watcher that's gone stale
- `Endpoints/LibraryEndpoints.cs` — `/api/tracks` (search/filter/paginate),
  `/api/artists`, `/api/albums`, `/api/genres` (facets),
  `/api/tracks/{id}/stream` (range-enabled), `/api/tracks/{id}/download`
  (attachment with a sanitized "Artist - Title.mp3" filename),
  `/api/tracks/{id}/artwork`, `/api/tracks/{id}/rating` and
  `/api/tracks/{id}/tags` (both write through to the file's actual ID3v2
  tag via TagLibSharp, then mirror into the DB — not DB-only)
- `Endpoints/PlaylistEndpoints.cs` — full CRUD + `/reorder` for playlists
- `Endpoints/HistoryEndpoints.cs` — play history (today-only, self-pruning —
  see Key decisions below) and the `HistoryEnabled` app setting
- `Program.cs` — wires everything up; also serves `wwwroot/` (the built
  frontend) via `UseDefaultFiles`/`UseStaticFiles` for single-port deploys

### Frontend — `client/mp3streamer-web` (React + TypeScript + Vite)

- `api/client.ts`, `api/types.ts` — typed fetch wrappers for every endpoint
- `components/` — `Sidebar`, `TrackList` (also owns desktop drag-to-select
  and the right-click menu — see Key decisions below), `AlbumGrid`,
  `FacetList`, `SearchBar`, `PlaylistPanel`, `SettingsPanel`,
  `TrackContextMenu` (generic right-click menu — first item is "Edit ID3
  Tag(s)", desktop-only), `EditTagsDialog` (single-track ID3 editor),
  `EditTagsBulkDialog` (multi-track variant — only Artist/Album/Genre/Year,
  since Title/Track #/Rating are inherently per-track), `HistoryPanel`
  (today's play history, read-only)
- `history/HistoryContext.tsx` — the Track History on/off setting; fetched
  once from the server and shared (both `Sidebar`, to show/hide the History
  nav item, and every `SettingsPanel` instance need the same live value —
  see Key decisions below)
- `player/PlayerContext.tsx` — queue/currentIndex/isPlaying via React Context
- `player/bufferTrack.ts` — pre-buffers a track into an in-memory Blob before
  playback starts (whole file if ≤5 min, else just the first 5 min), so a
  temporary connection drop doesn't interrupt playback
- `player/NowPlayingBar.tsx` — the Mini Player; tapping it on a touch device
  (`pointer: coarse`) or narrow viewport opens `FullScreenPlayer`
- `player/FullScreenPlayer.tsx` — the Now Playing Screen; CSS reflows it to
  a side-by-side layout in landscape. Dismissed by dragging the artwork
  (Pointer Events) down in portrait / right in landscape past a threshold —
  there's no close button by design
- `theme/ThemeContext.tsx` — Light/Dark/System, persisted to `localStorage`,
  applied via a `data-theme` attribute on `<html>`

## Key decisions & gotchas

Worth knowing before you re-discover these the hard way:

- **Targets .NET 10, not 8.** 10 is what's installed and is itself the
  current LTS (.NET's even-numbered releases are LTS).
- **SQLite's EF Core provider can't translate `GroupBy(...).Select(g => new
  SomeRecord(...))`** directly — project to an anonymous type first,
  `ToListAsync()`, then map to the DTO record client-side. Hit this on
  `/api/artists`, `/api/genres`, `/api/albums`.
- **`Results.File(path, ...)` treats a non-rooted path as virtual
  (content-root-relative), not physical.** The scanner resolves each
  `LibraryRootPaths` entry with `Path.GetFullPath()` before storing, so
  `Track.FilePath` is always absolute — otherwise streaming 500s.
- **Don't drive `<audio>` playback from a React-state-triggered effect** —
  React StrictMode's double-effect-invocation caused spurious pauses a few
  seconds into playback. The `<audio>` element's native `play`/`pause`
  events are the single source of truth for `isPlaying`; buttons call
  `audioRef.current.play()/pause()` imperatively instead.
- **A truncated mp3 Blob's `audio.duration` can report the *original* full
  file's length, not the actual bytes present.** Discovered building the
  buffering feature below: many mp3s carry a VBR header (e.g. Xing) near
  the start declaring the whole file's duration, which the browser trusts
  even when the Blob only physically contains a truncated prefix of the
  file. `bufferTrack.ts` returns its own `bufferedSeconds` estimate for
  exactly this reason — never trust `audio.duration` to reflect how much of
  a partially-buffered track is actually playable.
- **Mobile detection uses `(pointer: coarse), (max-width: 700px)`**, not
  just `max-width` — a phone held in landscape is often wider than 700px,
  so width alone misses it. **This is only true of the JS `MOBILE_QUERY`
  constant** (interaction logic — long-press vs. right-click, tap-to-open
  Now Playing Screen). `App.css`'s layout breakpoint (the one that hides
  desktop-only columns/sidebar) is still plain `@media (max-width: 700px)`
  — known, not yet fixed (flagged to Ryan 2026-08-20). Net effect: a phone
  in landscape gets the desktop *layout* but still behaves like a touch
  device for those specific interactions.
- **`TrackList`'s drag-to-select uses `onMouseOver`, not `onMouseEnter`.**
  React's `onMouseEnter`/`onMouseLeave` are synthesized internally rather
  than mapped straight from a native event, and in testing this via
  synthetic `dispatchEvent` calls (browser automation, not a real mouse),
  React 19 didn't reliably fire `onMouseEnter` no matter how the dispatched
  event's `relatedTarget`/`buttons` were set — `onMouseOver` (real native
  bubbling event) did. If a future session needs to script/test a drag
  interaction here again, dispatch native `mouseover` (or `pointerover`),
  not `mouseenter`.
- **A right-click handler that opens a popup must `e.stopPropagation()`,
  not just `e.preventDefault()`.** Hit this building `TrackContextMenu`:
  the popup's own mount-time `useEffect` attaches a `document`-level
  listener that closes it on the next `contextmenu`/click anywhere — but
  without `stopPropagation()`, the *same* native event that opened the menu
  keeps bubbling and can reach that listener, closing the menu the instant
  it opens. Looks exactly like "right-click does nothing." Notably, this
  didn't reproduce in synthetic-`dispatchEvent`-based browser-automation
  testing, only with a real user right-click — don't treat that kind of
  testing as proof a click/context-menu interaction is bug-free.
- **A `display: none` element still matches CSS sibling selectors.**
  `.album-art-stack + .facet-count` (a fixed 10px margin, for when the art
  stack is visible on desktop) kept overriding `.facet-count`'s plain
  `margin-left: auto` on mobile — even though `.album-art-stack` itself is
  hidden there — because `display: none` removes an element from layout,
  not from the DOM/CSSOM, so adjacent-sibling (`+`) matching still sees it.
  Symptom looked like a layout bug in the count column itself (drifting
  based on artist-name length) with nothing obviously wrong in the rule
  that was actually misbehaving. Fixed with a mobile-only override
  restoring `margin-left: auto` on that same selector. Worth checking for
  elsewhere if a "should be simple" flex/margin rule doesn't seem to apply
  the way its own declaration says it should — check for a more specific
  sibling-combinator rule matching a *hidden* neighbor first.
- **`currentTrack?.id` alone is not a reliable "the user (re)selected a
  track" signal.** It doesn't change when re-selecting the track that's
  already playing, which silently broke both buffering-restart and
  history-recording for repeat-selection (real bug, found by Ryan via
  History not growing on repeat clicks). Fixed with `PlayerContext`'s
  `selectionSeq` counter, bumped on every explicit play action including
  re-selecting the same track — `NowPlayingBar`'s track-change effect
  depends on that, not `currentTrack?.id`. If something needs to react to
  "a track was (re)selected" in the future, key off `selectionSeq`.
- **No authentication in v1** — deliberate, since it's LAN-only. Don't wire
  up anything internet-facing without building auth first (see below).
- **A published exe's `ContentRootPath` defaults to the current directory,
  not the exe's own folder** — bites you the moment it's launched from
  anywhere else (a different CWD, or a Windows Service, which always starts
  in `System32`). Fixed by pinning `ContentRootPath = AppContext.BaseDirectory`
  explicitly in `Program.cs`. Full story under "Running as a Windows
  Service" below — don't remove that pin, the service depends on it.
- **`FileSystemWatcher` can silently drop events during a large bulk
  change.** Its internal OS buffer defaults to 8KB; a big add (many files
  across several new folders in a short window — e.g. Ryan adding two new
  artists' worth of albums at once, 2026-08-19) can overflow it, and the
  overflowing events are just lost, not queued — no exception in the
  common case, the watcher just doesn't react. Raised
  `InternalBufferSize` to 64KB (the practical max) in
  `LibraryWatcherService` to make this less likely, and added a manual
  **Refresh Library** button (Settings) as a user-facing fallback for
  whenever it still happens — don't remove that button on the assumption
  the watcher is now fully reliable, it isn't guaranteed to be.

## Done since the original plan

- ✅ Per-track 5-star ratings — persisted into the mp3's ID3v2 POPM frame
  (not just the DB), see `RatingMapper` and `PUT /api/tracks/{id}/rating`.
- ✅ Automatic library updates via `LibraryWatcherService` — a
  `FileSystemWatcher` per `LibraryRootPaths` entry triggers a debounced
  rescan whenever files change (drop in a new folder and it shows up within
  seconds), plus one scan on startup. Replaced an earlier fixed-interval
  polling timer (`LibraryScanBackgroundService` /
  `LibraryScanIntervalMinutes`, both removed 2026-08-18) — polling is gone
  entirely now, not just supplemented. A periodic health check (every
  minute) reconnects any watcher whose underlying handle has gone stale
  (e.g. a network share or external drive dropping and coming back).
  `POST /api/library/scan` still exists for a manual on-demand trigger.
- ✅ Resilient track buffering — see `player/bufferTrack.ts`; pre-buffers a
  track into memory before playback (whole file if ≤5 min, else the first 5
  min) so a temporary connection drop doesn't interrupt playback, with a
  handoff to live streaming for the remainder of longer tracks.
- ✅ Track downloads — a Download column/icon on desktop
  (`GET /api/tracks/{id}/download`); on mobile (where that column is
  hidden) it's the "Download" item in the long-press menu — see below. Text
  selection/`-webkit-touch-callout` is disabled on track rows so a
  long-press reads as this gesture, not the OS copy/select menu.
- ✅ Client-side ID3 tag editing — right-click a track (desktop) or
  long-press it (mobile — the two are equivalent gestures here) →
  "Edit ID3 Tag" opens `EditTagsDialog` with Title/Artist/Album/Genre/Track
  #/Year, pre-filled from the current tag. "Apply Changes" is disabled
  until a field actually changes (and Title, which is required, is
  non-empty); on apply, `PUT /api/tracks/{id}/tags` writes all fields to
  the file's real ID3v2 tag via TagLibSharp (not just the DB) and mirrors
  into the DB in the same request. `TrackContextMenu` is a generic
  right-click/long-press menu component — desktop's items are "Edit ID3
  Tag(s)" only (single or bulk depending on selection — see below);
  mobile's are "Edit ID3 Tag" + "Download" (always single-track — no
  multi-select on mobile), since mobile has no visible Download column.
  Future right-click/long-press actions should be added to that same
  items list rather than building a new one-off menu.
- ✅ Desktop multi-select (`TrackList`) — mousedown on a row + drag over
  others selects a contiguous range (plain click still just plays, same as
  always; only an actual drag turns into a selection). Right-clicking
  inside the current selection edits the whole selection; right-clicking
  outside it resets selection to just the clicked row (standard
  file-explorer convention). Desktop/mouse-only, gated the same way as the
  right-click menu.
- ✅ Bulk ID3 tag editing — right-clicking a multi-selection opens
  `EditTagsBulkDialog` instead, showing **only** Artist/Album/Genre/Year
  (never Title/Track #/Rating — those are inherently per-track, not
  something multiple tracks could share). Per-field "touched" tracking is
  required here unlike the single-track dialog: a field shows blank with a
  "multiple values" placeholder when the selection disagrees, and is only
  written if the user actually edits it — `PUT /api/tracks/bulk-tags`
  takes an explicit `Set*` boolean per field for exactly this reason,
  since sending every field unconditionally (fine for the single-track
  case) would silently overwrite differing values across the batch with
  blanks. Verified in-browser: selected 2 tracks from different albums,
  changed only Genre, confirmed Album/Year (left blank, mixed) were
  untouched and stayed different per track — then confirmed via a full
  rescan that the Genre change actually landed in both files, not just
  the DB.
- ✅ Play history — records one entry (track + UTC timestamp) every time a
  track starts playing (`POST /api/tracks/{id}/play`, fired from
  `NowPlayingBar`'s track-change effect — once per *selection*, not per
  pause/resume). Lives in our own DB only; can't be an ID3/POPM field the
  way rating is, since POPM holds one counter byte, not a list of
  timestamps — this is why item 1 below (play *count*) and this feature
  are different things. **Deliberately scoped to today only, per Ryan
  (2026-08-18): "this will prevent it from growing too large over time."**
  The `/api/tracks/{id}/play` write path actually deletes anything older
  than today (`ExecuteDeleteAsync`) before inserting the new row, rather
  than just filtering old rows out on read — the table stays bounded
  instead of accumulating forever. `GET /api/history` also filters to
  today defensively (the delete is lazy — only runs on the next write, so
  a stale prior-day row can briefly linger right after midnight until
  something plays again).
  - Toggle: Settings → **Track History: On/Off**, backed by a generic
    `AppSetting` key/value table (`HistoryEnabledKey`) rather than a
    dedicated column, since it's the kind of one-off flag more settings
    will probably join later. Enforced **server-side** (the record
    endpoint checks the setting itself and silently no-ops when off) —
    the frontend always calls it unconditionally and doesn't need to know
    the setting's value just to fire that call.
  - The History nav item (Sidebar, after Playlists, all layouts) only
    shows once the setting is confirmed on — added `history/
    HistoryContext.tsx` so `Sidebar` and both `SettingsPanel` render sites
    (Mini Player's and the Now Playing Screen's) share one fetched value
    instead of drifting out of sync with independent copies.
  - `HistoryPanel` rows are clickable — clicking one queues the whole
    day's history (in the order shown) starting at that track, so Next/
    Previous can browse through it too. This is *the* point of the
    feature per Ryan (2026-08-18): "you think you heard [a song] around
    3pm... click on various songs around 3pm and eventually you will find
    it." Required `PlayHistoryEntryDto` to carry a full nested `TrackDto`
    (not just title/artist/album) — without full track fields
    (duration/rating/etc.) there isn't enough to actually queue and play.
    No editing/rating/download from this view, just playback.
  - A **Clear History** button (top-right of the view, only shown when
    there's something to clear) wipes it manually via `DELETE
    /api/history`, gated by a confirm — same `window.confirm` pattern
    used for bulk tag edits and the mobile download prompt.
- ✅ Missing-file handling — previously the scanner unconditionally
  hard-deleted a `Track` row (and, via cascade, its `PlaylistTrack`
  memberships and `PlayHistory` entries) the moment its file couldn't be
  found on disk. Per Ryan (2026-08-18): "maybe I don't want those tracks
  to be removed... hence the setting. Maybe just gray them out." Now:
  - Settings → **Remove Tracks That Do Not Exist: On/Off** (another
    `AppSetting` row, `RemoveMissingTracks`; **defaults to On**, i.e. the
    original always-delete behavior, so this is opt-in to change, not a
    behavior change for anyone who ignores the new setting).
  - When On: unchanged — missing tracks are deleted, same as always.
  - When Off: the scanner sets `Track.IsMissing = true` instead of
    deleting the row (clears it back to `false` if the file reappears at
    the same path later). Playlist memberships and history survive since
    the row itself isn't touched.
  - Frontend: `TrackDto`/`Track` now carry `IsMissing`. `TrackList` and
    `HistoryPanel` both gray out (`opacity: 0.45`) missing rows, add an
    "(missing)" label next to the title, and block clicking them from
    starting playback (would just 404 against `/stream` otherwise —
    right-click/edit is left alone since the tag-edit endpoints already
    404 gracefully on a missing file, no extra guard needed there).
  - Verified the full lifecycle in-browser/via API: confirmed default-On
    still hard-deletes (regression check); toggled Off, removed the same
    test file again, confirmed the row survived with `isMissing: true`
    and rendered grayed-out/unclickable; restored the file, confirmed
    `isMissing` cleared back to `false` on the next scan; reset the
    toggle back to On afterward.
- ✅ Runs as a permanent **Windows Service** (`Mp3Streamer`) on Ryan's PC —
  survives reboots, no dependency on Claude Code or a terminal staying
  open. See "Running as a Windows Service" above for full setup, the
  redeploy workflow, and the `ContentRootPath` gotcha that came with it.
  Deliberately stayed LAN-only (no Tailscale/Cloudflare Tunnel) per Ryan.
- ✅ Manual **Refresh Library** button (Settings) — calls the existing
  `POST /api/library/scan` then reloads the page, so whatever view is open
  shows fresh results immediately. Added as a fallback for the
  `FileSystemWatcher` buffer-overflow gotcha above, found 2026-08-19 when
  Ryan added two new artists' worth of albums at once and the watcher
  missed most of it (a manual scan found all 50 missing tracks instantly,
  confirming the scanner itself was fine — only the automatic watcher had
  dropped events). Verified on a separate port against the real library
  before redeploying to the live service, per Ryan's standing "test
  before you deploy" preference.
- ✅ Album-art stack (desktop Artists view) — each artist row shows up to 4
  small (22x22px) album-art thumbnails, one per distinct album, cascaded
  left-to-right only (no y-axis overlap), right-justified next to the
  track count. `GET /api/artists` returns `AlbumArtTrackIds` per artist
  (`ArtistDto`); rendered by `AlbumArtStack` inside `FacetList.tsx`.
  Desktop-only, hidden under the same `max-width: 700px` layout breakpoint
  as other desktop-only columns. Iterated through several rounds of
  visual feedback with Ryan before landing on the final look.
  When a track has no embedded art, the thumbnail falls back to a small
  music-note glyph in a placeholder box (same size/border as a real
  thumbnail) rather than an invisible gap — tracked via per-stack React
  state, not DOM mutation, since directly hiding the failed `<img>` node
  broke re-render on Fast Refresh/remount.

## Not built yet (future phases, roughly in the order discussed with Ryan)

1. Play count tracking (server-side) — natural extension of the rating work
   above, since POPM already has a play-count field alongside rating
2. iTunes Library XML import as an alternative to the filesystem scanner.
   Noted 2026-08-18: the actual motivation for this is **Smart Playlists**
   (item 3 below), not iTunes import for its own sake — it's worth doing
   first/alongside since it'd be a rich existing source of the
   ratings/play-counts/genres a rule engine would filter on.
3. Smart Playlists — rule-based playlists that auto-update as the library
   changes (e.g. "Genre = Rock AND Rating ≥ 4, sorted by Date Added, limit
   50") rather than a fixed hand-picked track list, the way iTunes/
   foobar2000/MusicBee/Plex do it. Depends on / follows from item 2 above.
   Not designed yet (no rule schema, no UI mockup) — just captured here so
   the goal isn't lost. Explicitly not being built now, per Ryan
   (2026-08-18): "we aren't doing that now, but eventually we will."
4. "Playlist windows" and standard playback modes (shuffle, repeat) — per
   Ryan (2026-08-18), the expectation is these get built out around the
   same time as Smart Playlists (item 3), likely because a proper
   playlist-focused window/view is where shuffle/repeat controls would
   naturally live. Also not designed yet. Note: shuffle/repeat don't
   strictly *require* Smart Playlists to exist first — worth flagging to
   Ryan if it ever makes sense to build those two independently/earlier,
   rather than only as part of this same future phase.
5. A system tray app wrapping the backend, with a configuration UI (GUI
   settings prompt) for things like `LibraryRootPaths` instead of
   hand-editing `appsettings.json`. Not started — noted 2026-08-17 so config
   stays in mind as something a future settings UI will read/write, not
   just a file to hand-edit forever.
6. Authentication, then remote/internet access via a Cloudflare Tunnel + a
   purchased domain — this was explicitly deferred until the LAN-only
   experience was solid. **Do not expose this app to the internet without
   auth in front of it.** (Discussed 2026-08-18: a Tailscale/mesh-VPN
   alternative avoids needing a domain at all — each user, including
   Ryan's brother on his own instance, would set up their own free
   Tailscale between their own phone and PC. Not started.)
7. A simple one-click **installer** so Ryan can set this up on another
   computer without hand-installing prerequisites — noted 2026-08-18. Likely
   shape: ship a pre-built frontend (`dist/`) plus a self-contained backend
   publish (`dotnet publish -r win-x64 --self-contained`) so no .NET/Node
   install is required on the target machine, prompt for the music library
   path(s) on first run, and consider pairing this with item 5's tray app.
   See `DEPENDENCIES.md` (added the same day) for the full list of what an
   installer would need to handle.

Ryan's brother runs his own copy of this app against his own music
library — a separate local instance, not a connection to Ryan's running
server. So none of the auth/remote-access work above is a blocker for
sharing the code with him; it only matters if someone wants to reach a
*running instance* over the internet.

## Running it locally (dev)

```bash
# Backend
cd server/Mp3Streamer.Api
dotnet run
# add --urls http://0.0.0.0:PORT to expose it on your LAN instead of just localhost

# Frontend, dev mode (hot reload, proxies /api to the backend — see vite.config.ts)
cd client/mp3streamer-web
npm run dev

# Frontend, production build for LAN deployment (single port, no CORS)
cd client/mp3streamer-web
npm run build
# then copy dist/* into server/Mp3Streamer.Api/wwwroot/, and run the backend
# bound to 0.0.0.0 as above
```

A `Music/` folder at the project root (gitignored) holds test mp3s for local
development. Point `appsettings.Development.json`'s `LibraryRootPaths` at it,
or at a real library path once one is decided.

## Running as a Windows Service (Ryan's actual deployment, since 2026-08-18/19)

The backend runs permanently as a Windows Service named **`Mp3Streamer`** on
Ryan's PC, rather than in a terminal — so it survives reboots and needs
nothing running (no Claude Code, no open terminal) to stay up. Motivation,
verbatim (2026-08-18): "when I close Claude, I want to still access the
website." Chose a plain Windows Service over IIS — IIS is for reverse-
proxying multiple sites; this is one single self-hosted Kestrel app, so a
service is the simpler fit. Chose that over Tailscale/Cloudflare Tunnel
(also discussed) because Ryan explicitly wants to **stay LAN-only**, not
expose this to the internet.

**What makes this work — three things, all necessary:**

1. **`Microsoft.Extensions.Hosting.WindowsServices` + `UseWindowsService()`**
   in `Program.cs` — wires up proper start/stop lifecycle handling with the
   Service Control Manager when actually running as a service; a no-op
   otherwise, so the exact same published exe still works fine run directly
   (`dotnet run`, or double-clicking it) for local testing.
2. **`ContentRootPath` pinned to `AppContext.BaseDirectory`** — also in
   `Program.cs`, via `WebApplication.CreateBuilder(new WebApplicationOptions
   { Args = args, ContentRootPath = AppContext.BaseDirectory })`. **This one
   is critical and easy to skip**: Windows Services start with their working
   directory set to `%SystemRoot%\System32`, not the exe's own folder — the
   default `WebApplication.CreateBuilder(args)` resolves `ContentRootPath`
   from the current directory, so without this fix the service would boot
   with the *wrong* `appsettings.json` (or none at all) and a missing
   `wwwroot`. Confirmed this personally the hard way while setting this up:
   ran the published exe from the wrong directory and watched it silently
   fall back to defaults (port 5000, empty `LibraryRootPaths`, a
   freshly-created empty database) — looked like real data loss for a
   minute until the actual cause (working directory, not the app or the
   data) became clear. After the fix, confirmed it resolves correctly
   *even when deliberately launched from the wrong directory*.
3. **Absolute paths in `appsettings.json`** (the base/Production config —
   services don't go through `launchSettings.json`, so there's no
   `ASPNETCORE_ENVIRONMENT=Development` and no `--urls` flag to rely on):
   - `"Urls": "http://0.0.0.0:5288"` — Kestrel reads this directly.
   - `ConnectionStrings:Library` — full absolute path to the *existing*
     `library.db` (not a fresh one), so all prior ratings/playlists/history
     carry over instead of starting from an empty database.
   - `LibraryRootPaths` — full absolute path to the real music folder.

**One-time setup** (needs an elevated/Administrator PowerShell — Claude
cannot self-elevate, so this step has to be run by Ryan or his brother
directly, not by a Claude session):

```powershell
New-Service -Name "Mp3Streamer" -BinaryPathName "C:\...\server\Mp3Streamer.Api\publish\Mp3Streamer.Api.exe" -DisplayName "MP3 Streamer" -Description "Personal MP3 streaming server (LAN-only)" -StartupType Automatic
Start-Service -Name "Mp3Streamer"
```

**Redeploying after making changes** — this is the part to actually repeat
each time there's an update:

```powershell
# 1. Build the frontend and copy it into wwwroot (same as the dev workflow)
cd client/mp3streamer-web
npm run build
# copy dist/* into server/Mp3Streamer.Api/wwwroot/

# 2. Publish the backend (picks up the fresh wwwroot automatically)
cd server/Mp3Streamer.Api
dotnet publish -c Release -o publish

# 3. Restart the service to pick up the new build (needs Administrator)
Restart-Service -Name "Mp3Streamer"
```

Before step 3, make sure nothing else (e.g. a `dotnet run` left over from
testing) is still bound to port 5288 — the service will fail to start and
silently show `Status: Stopped` if the port's already taken, with no
obvious error surfaced to `Get-Service`. Hit exactly this once: a leftover
background test instance was still holding the port, `Start-Service`
"succeeded" but immediately reverted to Stopped; killing the stray process
first fixed it. `Get-Service -Name "Mp3Streamer"` to check status;
`Stop-Service`/`Start-Service`/`Restart-Service` all need elevation too.

## Requirements

- .NET 10 SDK
- Node.js 18+ (Vite requires it). Ryan's machine originally had Node 16
  (EOL) and got Node 24 LTS installed side-by-side via nvm-windows — nothing
  was removed, so this doesn't necessarily apply to a different machine.

## Version control

In git, pushed to a private GitHub repo (`rmander4/Mp3Streamer`) — done as
of 2026-08-18 (this section previously said "not yet done"; that's now
stale). Also see `DEPENDENCIES.md` at the project root for a full inventory
of build/runtime dependencies, kept as a reference for the future installer
(roadmap item 6 above).
