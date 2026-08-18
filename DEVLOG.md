# Development Log

This file is a running, human-and-Claude-readable log of what's been built
and why. Ryan and his brother each run their own local copy of this project
against their own music libraries — two separate people, two separate
Claude accounts, touching the same codebase over time (synced via git once
that's set up). See `CLAUDE.md` for the standing instruction: **every Claude
session that makes a meaningful change here appends a dated entry below.**
That way, whoever pulls in the other person's changes can have their own
Claude session read this file and catch up immediately, instead of
re-deriving context from a raw diff or git log.

Newest entries go at the top.

---

## 2026-08-18 — Ryan (5)

- Added real track pre-buffering, replacing reliance on the browser's
  default `<audio>` streaming behavior (which only keeps a small rolling
  buffer ahead of playback, not enough to survive more than a brief
  network hiccup). Motivated by Ryan's actual goal for this project:
  listening from **outside** the LAN, where the connection is expected to
  be less reliable than at home.
  - New `player/bufferTrack.ts`: before playback starts, fetches the whole
    track into an in-memory Blob if it's ≤5 minutes, otherwise just the
    first 5 minutes (a 1-byte `Range: bytes=0-0` request first reveals the
    file's total size via `Content-Range`, then a real range request pulls
    the target prefix — no backend changes needed, `/stream` already
    supported range requests). `NowPlayingBar` plays from the resulting
    Blob URL instead of streaming directly.
  - For tracks over the cap, once playback nears the end of the buffered
    portion, `NowPlayingBar` hands off to normal live streaming (swaps
    `<audio>` src to the network URL, resumes at the same `currentTime`) —
    so only the first 5 minutes is drop-resistant, and the rest streams
    normally same as before. This was Ryan's explicit call ("5 minutes or
    whole song, whichever comes first") rather than buffering an hour-long
    track entirely.
  - Hit and fixed a real bug during testing: a truncated mp3 Blob's
    `audio.duration` reported the *original full track's* length (989s for
    a 5-minute-truncated 16:29 track), not the actual playable content —
    caused by a VBR header (Xing) near the start of the file declaring the
    whole file's duration, which the browser trusts over the Blob's actual
    byte length. Fixed by having `bufferTrack` return its own
    `bufferedSeconds` estimate and using *that* (never `audio.duration`)
    to decide when to hand off. Documented in `CLAUDE.md` under Key
    decisions & gotchas since it's a non-obvious trap.
  - Also hit and fixed a second bug: initially wired the handoff's stall
    /safety-net fallback to the `<audio>` element's `waiting`/`stalled`
    events unconditionally, and it fired a false-positive handoff ~9
    seconds into a fresh long-track buffer (well before real data could
    have run out) — those events fire for brief, benign reasons too, not
    just genuine data exhaustion. Fixed by only trusting them once
    playback is already near the expected buffered-cushion cutoff.
  - Verified end-to-end in-browser: a short track (3:24) buffers entirely
    (confirmed via a single plain `200 OK` fetch, no `Range` header, and
    `audio.duration` matching exactly once loaded from the Blob); a long
    track (16:29) buffers only the first ~5 minutes (confirmed via the
    two-request `206`/`206` pattern) and correctly hands off to live
    streaming when scrubbed near the cutoff, resuming playback from the
    network mid-song with no interruption.

## 2026-08-18 — Ryan (4)

- Added the Settings (⋮) trigger to the **Now Playing Screen** — it was only
  reachable from the main browse screen before, with no way to change theme
  or toggle full screen while the full-screen player was open. Placed as a
  small top-right button above the artwork (`.fullscreen-header`, right
  above `.fullscreen-main`), reusing the same `.settings-trigger` styling
  and the same `SettingsPanel` component/modal already used elsewhere, so
  it behaves identically (including in landscape, where the header stretches
  full-width above the side-by-side art/controls layout). Verified in
  portrait: no overlap with the artwork (button bottom ~y71, art top ~y95),
  panel opens/closes correctly on top of the full-screen player. Confirmed
  good by Ryan on his phone.

## 2026-08-18 — Ryan (3)

- Investigated a report that the **Light** theme "wasn't really light." Confirmed
  via computed styles in a desktop browser that `ThemeContext`/`index.css` were
  already correct (white bg, dark text, no hardcoded colors anywhere) — not an
  app bug. Root cause, found by comparing phone screenshots of Light vs. Dark
  side by side: they rendered **pixel-identical**, which pointed at the browser
  itself rather than the page. It was **Samsung Internet's "Dark mode for
  websites" setting**, forcibly darkening the page on top of whatever the site
  set. Disabling it in Samsung Internet (Settings → Useful features → Dark
  mode) fixed it — confirmed by Ryan.
  - Still made one real hardening change: `ThemeContext.tsx` now sets
    `document.documentElement.style.colorScheme` to the specific active value
    (`light` / `dark`) instead of leaving the unconditional `light dark` from
    `index.css`, since some forced-dark browser engines use an ambiguous
    `light dark` declaration as a signal to just follow the OS theme instead
    of respecting the page's explicit choice. Didn't fix this particular case
    (a browser-level toggle, not a heuristic), but is a reasonable defense
    against similar issues elsewhere.
  - Worth remembering for next time this comes up (with Ryan's brother, or
    anyone else): if a "theme looks wrong" report ever shows the *same*
    rendering for two different theme selections, suspect the browser's own
    forced-dark feature before touching app CSS.

## 2026-08-18 — Ryan (2)

- Replaced the fixed-interval polling library scan
  (`LibraryScanBackgroundService`, every `LibraryScanIntervalMinutes`) with
  `FileSystemWatcher`-based live updates (`LibraryWatcherService`). Dropping
  a new folder into a `LibraryRootPaths` directory now gets picked up within
  a couple seconds instead of waiting for the next timer tick — verified by
  copying a test mp3 into a brand-new subfolder while the server was running
  and confirming it appeared via `/api/tracks` shortly after, then confirming
  removal was picked up the same way.
  - Runs one full scan on startup (unchanged behavior), then watches each
    configured root recursively (`IncludeSubdirectories = true`) for
    create/delete/change/rename, debouncing bursts of events (e.g. copying
    a whole album) into a single rescan 2 seconds after the last change.
  - Added a periodic health check (every 1 minute) that verifies each
    watcher is still connected and reconnects it if not — covers cases like
    a network share or external drive dropping and remounting, where the
    watcher's underlying handle can go stale without necessarily raising an
    `Error` event. Also picks up root paths that didn't exist at startup but
    became available later, and drops watchers for roots that disappear.
  - Removed `LibraryScanIntervalMinutes` from `appsettings.json` — no
    longer used, since there's no timer left to configure.
  - `POST /api/library/scan` (manual trigger) is untouched.
  - Also from this session: got the app running end-to-end on Ryan's own
    machine for the first time via Claude Code — neither the .NET 10 SDK
    nor Node.js were actually present in the Claude Code sandbox despite
    earlier notes, so both were installed via `winget`
    (`Microsoft.DotNet.SDK.10`, `OpenJS.NodeJS.LTS`) with Ryan's OK. Built
    the frontend, copied `dist/` into `wwwroot/`, ran the backend bound to
    `0.0.0.0:5288`, and pointed `LibraryRootPaths` at the `Music/` folder,
    which already had the 184-track Iced Earth discography from earlier
    testing sitting in it. Generated a QR code (PNG, via a scratch `qrcode`
    npm script) encoding the LAN URL so Ryan could scan it from his phone
    instead of typing the IP in by hand.

## 2026-08-18 — Ryan

- Ryan switched from his work Claude account to his own personal Pro
  account for this project going forward — same person, different Claude
  session/account. Noting it here in case the account switch is confusing
  context in a future session.
- Verified the project builds cleanly from a fresh checkout:
  - **Frontend**: `npm install` (27 packages, 0 vulnerabilities) then
    `npm run build` (`tsc -b && vite build`) both succeeded, producing
    `dist/` (~209 KB JS / ~11 KB CSS, ~65 KB gzipped total). Confirmed in
    an isolated sandbox environment, not Ryan's actual machine.
  - **Backend**: could *not* be restored/built in that same sandbox — its
    network egress blocks `api.nuget.org` (403 at the proxy level), while
    npm's registry is allowed through. This is an environment limitation
    of the sandbox used to check this, not a problem with the code or
    `.csproj`. Backend should restore/build normally on a machine with
    ordinary internet access (i.e. Ryan's actual PC) — worth a quick
    `dotnet build` there to double-confirm, but no code changes were
    needed or made.
- Added `DEPENDENCIES.md` at the project root: a full inventory of every
  build/runtime dependency (.NET 10 SDK, the 5 NuGet packages, Node +
  the npm package list, SQLite, config) — written in response to Ryan
  wanting an eventual one-click installer for setting this up on other
  computers. This is groundwork/documentation only — **no installer was
  built**, it's now roadmap item 6 in `CLAUDE.md`.
- Updated `CLAUDE.md`: added the installer as roadmap item 6, and fixed
  the "Not yet done: version control" section, which was stale — the repo
  is already in git and pushed to `rmander4/Mp3Streamer` on GitHub.

## 2026-08-17 — Ryan

- Added a **Rating** column to the desktop track table (`TrackList`), shown
  in both the main browse view and playlist detail view — same `StarRating`
  component used on the mobile Now Playing Screen, just smaller (`size=16`)
  and reused via a new optional `size` prop. Clicking a star inline rates
  the track without triggering row-click playback (`stopPropagation` on the
  cell, same pattern as the existing playlist reorder/remove buttons and
  the "add to playlist" dropdown). Column is hidden on mobile
  (`.col-rating` added to the existing mobile column-hiding rule) since
  rating there lives on the Now Playing Screen instead. `TrackList` now
  takes a required `onRate` prop; both call sites (`App.tsx`,
  `PlaylistPanel.tsx`) update their local track list optimistically and
  also sync `PlayerContext` if the rated track happens to be the one
  currently playing, so the Mini Player stays consistent too.
- Added periodic background library scanning (`LibraryScanBackgroundService`,
  a `BackgroundService`, registered in `Program.cs`). Before this, the
  library only updated when something explicitly called
  `POST /api/library/scan` — no startup scan, no periodic scan. Defaults to
  every 5 minutes, configurable via `LibraryScanIntervalMinutes` in
  appsettings (accepts fractional minutes). First scan runs immediately on
  startup, so this also covers "scan on startup" for free.
  - Found and fixed a real bug while testing: `BackgroundService`'s default
    behavior on ANY unhandled exception is to stop the entire host — so a
    single malformed config value or a transient scan failure would have
    crashed the whole API, not just disabled background scanning. Both the
    scan itself and the interval-config read are now wrapped so a failure
    just logs and retries next cycle instead of taking the app down.
  - Verified against a much bigger, more realistic library: Ryan expanded
    the test `Music/` folder from the one 8-track album to his full Iced
    Earth discography (14 albums, 184 tracks). Background scan picked all
    of it up automatically with no manual trigger, and a second cycle
    correctly reported it as 184 updated / 0 added (idempotent, no dupes).
  - Noted for later: Ryan wants a system tray app wrapping this backend
    with a GUI configuration prompt eventually (not started) — added to
    `CLAUDE.md`'s "not built yet" list so config stays structured with a
    future settings UI in mind rather than assuming `appsettings.json` will
    always be hand-edited directly.
- Replaced all four playback-control glyphs (prev/play/pause/next) in both
  the Mini Player and Now Playing Screen with hand-drawn inline SVG icons
  (`player/icons.tsx`) instead of Unicode symbols (⏮ ⏸ ▶ ⏭). Root cause of
  two separate bugs reported by Ryan: the icons weren't quite centered in
  their circular buttons (font/glyph metrics vary by platform), and on his
  iPhone the pause icon specifically rendered as a full-color yellow emoji
  square — iOS renders that particular codepoint (U+23F8) with emoji
  presentation by default, and CSS `color` cannot affect a color-emoji
  glyph since it's a fixed bitmap, not text. Custom SVG with `fill:
  currentColor` sidesteps both problems permanently and consistently
  across platforms. Lesson: don't use Unicode symbols for UI icons in this
  app going forward — draw a small SVG instead (see `icons.tsx` and
  `StarRating.tsx` for the pattern).
- Also fixed a related but separate issue: mobile Safari's default
  translucent tap-highlight overlay was flashing over buttons on touch
  (`-webkit-tap-highlight-color`, set to `transparent` globally on `button`
  in `index.css`) — a different cause from the emoji-color bug above, but
  reported around the same time and easy to conflate.
- Added 5-star track ratings, persisted into the mp3 file itself (not just
  our DB) via the ID3v2 **POPM (Popularimeter)** frame — the same frame
  most other players (Windows Media Player, MediaMonkey, etc.) use, mapped
  through the widely-used WMP byte scale (0/1/64/128/196/255 for
  0-5 stars) for cross-player compatibility. Verified round-trip: set a
  rating via the UI, ran a full library rescan (simulating "close and
  reopen"), rating was still there — confirmed it's reading it back from
  the file's actual POPM byte, not just a cached DB value.
  - Backend: `Track.Rating` column (migration `AddTrackRating`),
    `RatingMapper` (stars ↔ POPM byte, nearest-match on read so other
    apps' rating bytes still map sensibly), `LibraryScanner` reads POPM on
    every scan, new `PUT /api/tracks/{id}/rating` writes the POPM frame to
    the file (via `TagLib.Id3v2.PopularimeterFrame.Get(tag, "", create:
    true)`) and updates the DB in the same request.
  - Frontend: `StarRating` component (5 inline SVG stars — deliberately
    *not* Unicode glyphs, learned that lesson from the playback-button
    centering issue), placed on the Now Playing Screen directly below the
    track info and above the playback controls. Unrated stars use the same
    outline treatment (`var(--border)`) as the circular button borders;
    filled stars use `var(--text-h)`. Rating updates optimistically in
    `PlayerContext` (`setCurrentTrackRating`) alongside the API call.
- Settled on consistent terminology (use these going forward, including in
  code/comments/UI copy): **Mini Player** for the persistent bottom bar,
  **Now Playing Screen** for the full-screen expanded view.
- Removed the down-chevron close button from the Now Playing Screen.
  Replaced with a drag gesture on the album artwork: drag it downward past
  a small threshold to dismiss back to the Mini Player in portrait; in
  landscape (where the artwork sits on the left) drag it to the right
  instead. Implemented with Pointer Events so it works the same for touch
  and mouse; the artwork visually follows the drag and fades slightly,
  snapping back if released before the threshold.
- Found and fixed a real bug while testing the above: `Element
  .setPointerCapture()` can throw `NotFoundError` if the browser doesn't
  recognize the pointer ID as currently active — wrapped in try/catch so a
  capture failure doesn't stop the drag from being tracked. (Only
  surfaced with synthetic test events; a real touchscreen's pointer ID is
  always valid, so this is defensive rather than something you'd hit on an
  actual phone — but cheap to guard against.)
- Fixed the full-screen "now playing" view (opened by tapping the mini
  player on mobile) to reflow into a side-by-side layout (art left,
  controls right) when the phone is rotated to landscape. Previously it
  stayed in the portrait column layout and looked broken/cramped.
- Fixed the mobile-detection check used to decide whether tapping the mini
  player should open the full-screen view — it was `max-width: 700px`
  only, which misses phones held in landscape (often wider than 700px).
  Now uses `(pointer: coarse), (max-width: 700px)`.
- Added a Settings panel, opened via a `⋮` icon next to the app title.
  Currently holds:
  - A Light/Dark/System theme picker, persisted in `localStorage` so it
    survives reloads. "System" follows the OS/browser's
    `prefers-color-scheme`.
  - A full-screen (browser Fullscreen API) toggle, to hide the mobile
    browser's address bar. Deliberately not persisted — nothing meaningful
    to remember across reloads.
  - This panel is meant to keep growing — add new settings here rather
    than scattering standalone toggle buttons around the UI.
- Added PWA-ish `<meta>` tags (`apple-mobile-web-app-capable`, etc.) so
  "Add to Home Screen" on iOS gives a cleaner, address-bar-free experience
  as a fallback, since iOS Safari's support for the Fullscreen API on
  arbitrary (non-video) elements has been inconsistent across versions.
- Deployed the production build to the LAN (backend serves the built
  frontend from `wwwroot/`, Kestrel bound to `0.0.0.0`) and verified
  playback from an actual phone over Wi-Fi.
- Added `CLAUDE.md` and this file so a second person's Claude session
  (Ryan's brother's) can pick up full context on this project.

## 2026-08-16 — Ryan

- Built and verified the entire v1 scope end-to-end:
  - Backend: solution/project scaffolding (.NET 10), EF Core + SQLite,
    `LibraryScanner` (TagLibSharp-based ID3 tag reading), browse/search/
    facet endpoints, HTTP range-request streaming (206 Partial Content —
    seeking works), embedded artwork extraction, full playlist CRUD +
    reorder endpoints.
  - Frontend: React + TypeScript + Vite scaffold, library browsing UI (All
    Tracks / Artists / Albums / Genres with drill-down and search), audio
    player (native `<audio>`, play/pause/seek/auto-advance via React
    Context), playlist UI (create/rename/delete/add/remove/reorder,
    "add to playlist" dropdown from the browse view).
  - All of the above verified against a real test album (dropped into the
    gitignored `Music/` folder) and in-browser via automated interaction,
    not just written and assumed to work.
- Made the UI mobile-responsive: sidebar collapses to a horizontal
  scrollable nav bar, the track table drops separate Artist/Album columns
  in favor of a subtitle line under the title, the now-playing bar and
  playlist panel both adapt to narrow viewports.
- Installed Node 24 LTS via nvm-windows (Ryan's machine had Node 16, which
  is EOL) — side-by-side, nothing removed; v16 still available if needed.
- Deployed to the LAN for the first time and confirmed reachability from a
  phone browser via the host machine's Wi-Fi IP address.

## 2026-08-16 — Planning

- Initial project scoped: C# ASP.NET Core backend + React client, LAN-only
  for v1, no authentication (deferred to a future phase alongside
  remote/internet access — see "Not built yet" in `CLAUDE.md`).
