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
  tag via TagLibSharp, then mirror into the DB — not DB-only),
  `/api/artwork/search` (proxies the free iTunes Search API for album art
  candidates) and `/api/tracks/{id}/artwork-from-url` (downloads a chosen
  candidate server-side and writes it the same way the upload endpoint
  does — see Key decisions below for the host-allowlist reasoning)
- `Endpoints/PlaylistEndpoints.cs` — full CRUD + `/reorder` for playlists
- `Endpoints/HistoryEndpoints.cs` — play history (today-only, self-pruning —
  see Key decisions below) and the `HistoryEnabled` app setting
- `Endpoints/PlaybackStateEndpoints.cs` — `GET/PUT/DELETE /api/playback-state`,
  the cross-device "continue where you left off" resume feature — see Key
  decisions below
- `Program.cs` — wires everything up; also serves `wwwroot/` (the built
  frontend) via `UseDefaultFiles`/`UseStaticFiles` for single-port deploys

### `tools/ItunesXmlGenerator` — standalone console tool, own `.csproj`

Generates a real iTunes-Library-XML-format file directly from a folder of
MP3s (reading tags via TagLibSharp, same as the main scanner) — no actual
iTunes involved. Built for Ryan so he could use the same
`ItunesXmlImporter.cs` import path as his brother without fighting real
iTunes (which was leaking 100+ GB of RAM on his machine for a library
under 100 songs — see DEVLOG.md, 2026-08-23). Usage:
`dotnet run -- <music-folder> [output-xml-path]`.

### Frontend — `client/mp3streamer-web` (React + TypeScript + Vite)

- `api/client.ts`, `api/types.ts` — typed fetch wrappers for every endpoint
- `components/` — `Sidebar`, `TrackList` (also owns desktop drag-to-select
  and the right-click menu — see Key decisions below), `AlbumGrid`,
  `FacetList`, `SearchBar` (includes a mic button for voice search via the
  Web Speech API — see Key decisions below), `PlaylistPanel`, `SettingsPanel`,
  `TrackContextMenu` (generic right-click menu — first item is "Edit ID3
  Tag(s)", desktop-only), `EditTagsDialog` (single-track ID3 editor —
  includes Previous/Next paging through the rest of the track's album
  without closing the dialog),
  `EditTagsBulkDialog` (multi-track variant — only Artist/Album/Genre/Year,
  since Title/Track #/Rating are inherently per-track), `HistoryPanel`
  (today's play history, read-only), `FullscreenToggle` (the browser
  Fullscreen API toggle button, next to the ⋮ settings trigger — not the
  Now Playing Screen, which is a different, same-app "full screen" concept),
  `ItunesArtworkSearch` (the "Search iTunes" button + thumbnail-candidate
  picker shared by both ID3 editors)
- `history/HistoryContext.tsx` — the Track History on/off setting; fetched
  once from the server and shared (both `Sidebar`, to show/hide the History
  nav item, and every `SettingsPanel` instance need the same live value —
  see Key decisions below)
- `player/PlayerContext.tsx` — queue/currentIndex/isPlaying via React Context;
  `playQueue()` takes an optional `resumeSeconds` for the resume feature below
- `player/ResumePrompt.tsx` — the cross-device "Continue playing this
  track?" modal, fetched once on app load — see Key decisions below
- `player/bufferTrack.ts` — pre-buffers a track into an in-memory Blob before
  playback starts (whole file if ≤5 min, else just the first 5 min), so a
  temporary connection drop doesn't interrupt playback
- `player/NowPlayingBar.tsx` — the Mini Player; tapping it on a touch device
  (`pointer: coarse`) or narrow viewport opens `FullScreenPlayer`. Drives
  playback through two `<audio>` elements (`primaryRef`/`secondaryRef`),
  not one — see the gapless-handoff gotcha below before touching the
  buffered→stream handoff logic
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
- **A DOM descendant cannot escape an ancestor's `overflow`/`clip-path`
  clipping while staying in the DOM tree — there's no CSS property that
  opts a specific descendant out.** Hit this with the Artists-tab album
  art marquee's hover tooltip (`position: absolute`, popping up above a
  thumbnail): once the thumbnail sat inside a horizontally-clipped
  scrolling window, the tooltip got silently clipped/hidden too, even
  though visually it "should" float free above the clipped box. Two
  plausible-looking CSS fixes were tried and both failed in practice:
  `overflow-x: hidden; overflow-y: visible` looks like it clips one axis
  only, but per spec that pairing forces `overflow-y`'s *computed* value
  to `auto` instead, which still clips; `clip-path: inset()` with a large
  *negative* top/bottom offset looks like it should expand the clip
  region beyond the box, but the browser clamps it flush to the box
  instead (confirmed via reproduction, not just spec-reading — a
  same-point `elementFromPoint` A/B test with clip-path toggled on/off
  showed the real difference). The actual fix: render the tooltip via a
  React portal into `document.body` (`position: fixed`, coordinates from
  `getBoundingClientRect()` on hover/focus) — see `AlbumArtThumb` in
  `FacetList.tsx`. This is the standard fix for "tooltip/popover trapped
  in a clipped or scrolling ancestor" (same technique Radix/Popper/
  Floating UI use) — reach for a portal directly next time this shape of
  bug shows up, rather than re-trying overflow/clip-path variations.
- **`.settings-option`'s base `flex: 1` silently overrides an explicit
  `height` once reused inside a *column*-direction flex container.**
  Hit this sizing the ID3 editors' stacked Browse…/Search iTunes buttons
  to match the enlarged album art: `flex: 1` expands to `flex-basis: 0%`,
  which wins over a plain `height` in the flex sizing algorithm, so the
  two buttons rendered noticeably shorter than the height I'd actually
  set — confirmed via `getBoundingClientRect()`, not just eyeballing.
  `.settings-option` was designed for the *horizontal* button rows it's
  normally used in (`.tags-actions`, `.settings-options`), where
  `flex: 1` is exactly what makes buttons share a row's width evenly —
  it just doesn't carry over cleanly to a vertical stack. Fixed with a
  `flex: none` override on the column-context selector, same pattern
  `.tags-actions .settings-option` already used for a different reason.
  If `.settings-option` gets reused inside another column-direction flex
  container in the future, override `flex` there too rather than
  assuming an explicit `height`/`width` alone will stick.
- **`currentTrack?.id` alone is not a reliable "the user (re)selected a
  track" signal.** It doesn't change when re-selecting the track that's
  already playing, which silently broke both buffering-restart and
  history-recording for repeat-selection (real bug, found by Ryan via
  History not growing on repeat clicks). Fixed with `PlayerContext`'s
  `selectionSeq` counter, bumped on every explicit play action including
  re-selecting the same track — `NowPlayingBar`'s track-change effect
  depends on that, not `currentTrack?.id`. If something needs to react to
  "a track was (re)selected" in the future, key off `selectionSeq`.
- **The `<audio>` element's `pause` event also fires right before `ended`**
  when a track finishes naturally, not just on a genuine user-initiated
  pause. Matters for the playback-resume feature: saving on every `pause`
  would otherwise save a useless "resume" position for a track that's
  already over. `NowPlayingBar`'s `handlePause` guards against this with
  `audio.duration - audio.currentTime < 1` rather than checking
  `audio.ended` — the exact ordering of when the `ended` flag itself
  becomes `true` relative to the `pause` event firing isn't consistent
  enough across browsers to rely on.
- **`XmlReader.ReadToFollowing(name)` searches the entire remaining
  document, not just sibling nodes at the current level, and always
  advances past the current node even if it already matches.** Hit this
  in `ItunesXmlImporter.cs`'s root-dict key-scanning loop: once a nested
  `<dict>` is involved (the "Tracks" value), this silently desyncs — it
  could skip the "Tracks" key entirely and start walking the numeric
  per-track keys as if they were root-level siblings, with the exact
  failure depending on how many metadata keys happened to precede
  "Tracks" rather than failing consistently. Confirmed by reproduction
  (a debug root-key trace), not just theorized. Fixed by replacing it
  with manual node-walking (check `NodeType`/`Name` directly, `ReadAsync()`
  to advance) — the same safe pattern the per-track reading loop just
  below it already used, which never had this problem. If a future
  `XmlReader`-based parser needs to iterate a dict's own key/value
  siblings, don't reach for `ReadToFollowing` — it's for finding a
  specific descendant anywhere ahead in the document, not for walking a
  known, bounded set of siblings.
- **Static files (including `index.html`) had no explicit `Cache-Control`
  by default.** `UseStaticFiles()` alone only sends `ETag`/`Last-Modified`,
  which leaves browsers free to apply their own heuristic caching. For
  `index.html` specifically that's a real problem — every redeploy embeds
  a *new* content-hashed JS/CSS filename, but a browser sitting on a
  heuristically-cached copy of the old `index.html` keeps loading the old
  bundle indefinitely, with zero visible sign anything's wrong. Very
  plausibly the real cause behind several "I tested and it's still
  broken" reports across this project that turned out to already be
  fixed server-side. Fixed via `StaticFileOptions.OnPrepareResponse` in
  `Program.cs`: non-hashed files (`index.html`, favicon, etc.) get
  `Cache-Control: no-cache` (always revalidate); Vite's content-hashed
  `/assets/*` files get `public,max-age=31536000,immutable` instead,
  since their filename itself changes whenever their content does. If a
  future session sees "I redeployed but nothing changed" and the server
  genuinely has the new code, suspect this class of bug first — same
  root cause once bit `/api/tracks/{id}/artwork` too (see its own
  comment in `LibraryEndpoints.cs`: it was setting a 24-hour
  `Cache-Control` even on a 404 for a track with no art yet).
- **The dev/test environment was never actually isolated from
  production.** `appsettings.Development.json` only overrides
  `LibraryRootPaths`, not `ConnectionStrings` — so `dotnet run` on port
  5289 was reading and writing the *same* production `library.db` and
  the *same* real MP3 files as the live Windows Service the whole time.
  This caused real damage 2026-08-24: test artwork uploads (solid color
  test squares) overwrote real album art with no backup taken first —
  see that date's DEVLOG entries for exactly which tracks. Give the dev
  environment its own database file and a small copied subset of MP3s
  before doing any more testing that writes data, especially anything
  touching embedded artwork (which lives in the files themselves, not
  just the DB, so there's no "just don't commit it" undo).
- **No authentication in v1** — deliberate, since it's LAN-only. Don't wire
  up anything internet-facing without building auth first (see below).
- **`PUT /api/tracks/{id}/artwork-from-url` validates its URL against a
  host allowlist (`*.mzstatic.com`/`*.apple.com`) before the server fetches
  it.** Without that check, an endpoint that takes a client-supplied URL
  and fetches it server-side is a textbook open-proxy/SSRF shape — LAN-only
  and no-auth doesn't make that free, since any device already on the LAN
  could otherwise make the server fetch arbitrary internal or external
  URLs. Any future "fetch this URL server-side" endpoint should get the
  same treatment.
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
- **`<audio>` can't tell "ran out of buffered data early" apart from "the
  track actually ended."** For a partially-buffered long track (see
  `bufferTrack.ts`), the Blob's byte-to-seconds estimate is only an
  average-bitrate approximation — a VBR file's real audio can run out a
  little before that estimate predicts, and since a Blob is a complete,
  finite resource as far as the `<audio>` element is concerned, it fires
  a perfectly normal `ended` when that happens. `handleEnded` in
  `NowPlayingBar.tsx` used to treat every `ended` as "track over, play
  next" unconditionally — real bug, reported live by Ryan ("the song
  doesn't finish... begins playing the next song"), reproduced directly
  (forced `ended` on a 16-minute track at 1:40 in — skipped immediately)
  before fixing. Fix: `handleEnded` now checks whether we're still on the
  partial blob and meaningfully short of the track's real (ID3-tag)
  duration — if so, it hands off to live streaming instead of advancing.
  If a future change touches this path, keep that check; don't let
  `handleEnded` go back to trusting `ended` unconditionally.
- **A DOM `<audio>` element cannot gaplessly switch which resource it's
  playing — reassigning `.src` always causes a hard stop/reload, even for
  a same-content, deliberately-timed handoff.** Hit this building the
  buffered→live-stream handoff: swapping `.src` *at* the moment playback
  needed to continue caused a real, audible gap (a network round-trip
  with nothing playing) plus a small content misalignment (the seek
  target for a VBR file over a plain range-request endpoint is an
  estimate, not frame-accurate) — Ryan described it as sounding like "CD
  skipping." There's no single-element fix for this; the standard
  technique (same one this project now uses) is two `<audio>` elements:
  a silent "shadow" deck preloads and seeks to match the audible deck's
  position well ahead of the real handoff, plays forward muted in
  parallel with periodic drift correction, and the actual handoff becomes
  a mute/pause toggle between two already-synced elements — no `.src`
  touched in the moment, so nothing for the ear to catch. See
  `primaryRef`/`secondaryRef`/`getActiveAudio`/`getShadowAudio` in
  `NowPlayingBar.tsx`. Three real bugs turned up reproducing this by
  driving `<audio>.currentTime` and dispatching synthetic events to force
  preload/handoff at exact points, then inspecting `src`/`muted`/`paused`
  on both elements — worth the same treatment if this logic changes
  again, not just eyeballing whether audio "sounds okay":
  - The cold-fallback path (used when the shadow deck isn't ready yet)
    only reset the *active* element — if a separate preload was already
    mid-flight on the shadow deck when a different trigger (e.g. a real
    early `ended`) forced the cold path, that shadow deck kept streaming
    forever in the background, unmuted-never, until the next track change.
  - Revoking a Blob URL invalidates the data but does **not** clear the
    `<audio>` element's own `src` *attribute* — the retired deck's `.src`
    stayed a non-empty string after handoff, which made
    `playBothDecks`/`pauseBothDecks`'s "is the shadow mid-preload?" check
    (`shadow.src` truthy) mistake it for one, and a pause/resume right
    after a handoff resumed *both* decks audibly at once.
  - The two `<audio>` elements are reused across track changes (only
    `src`/`muted`/etc. change, not the elements themselves) — a track
    that ends in a handoff leaves whichever deck was "active" unmuted and
    the retired one muted. Without explicitly unmuting the primary deck
    at the start of every new track, a track loaded right after a prior
    track's handoff would start on a still-muted element and play with
    no audio at all. Confirmed via reproduction, not assumption.

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
  handoff to live streaming for the remainder of longer tracks. The
  handoff itself is gapless — see the dual-`<audio>`-element gotcha below.
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
- ✅ Album-art stack (desktop Artists view) — each artist row shows up to
  10 small (22x22px) album-art thumbnails, one per distinct album,
  cascaded left-to-right only (no y-axis overlap), right-justified next
  to the track count. Beyond 10, it switches to an auto-scrolling
  bounce-style marquee instead of an ever-widening row — see the
  `MarqueeStack`/Web-Animations-API and portaled-tooltip entries further
  below for the full story, including the real bugs found iterating on
  it. `GET /api/artists` returns every album per artist uncapped
  (`ArtistDto`); rendered by `AlbumArtStack`/`MarqueeStack`/`AlbumArtThumb`
  inside `FacetList.tsx`. Desktop-only, hidden under the same
  `max-width: 700px` layout breakpoint as other desktop-only columns.
  Iterated through several rounds of visual feedback with Ryan before
  landing on the final look.
  When a track has no embedded art, the thumbnail falls back to a small
  music-note glyph in a placeholder box (same size/border as a real
  thumbnail) rather than an invisible gap — tracked via per-stack React
  state, not DOM mutation, since directly hiding the failed `<img>` node
  broke re-render on Fast Refresh/remount.
- ✅ Voice search — a mic button next to `SearchBar`'s text input, using the
  browser's built-in Web Speech API (`SpeechRecognition` /
  `webkitSpeechRecognition`), not a custom server-side transcription
  endpoint. Feature-detected at module load (`src/components/SearchBar.tsx`);
  the button simply doesn't render on a browser without it, rather than
  showing something that's guaranteed to fail. On tap: starts listening
  (pulsing accent-colored ring), transcribes on `onresult`, and sets the
  transcript into the same `value` state manual typing uses — so it flows
  through the existing 300ms-debounced search unchanged, no separate
  search-triggering path needed. Any failure (`onerror`, or an 8s timeout
  backstop in case the browser's own recognition session hangs) shows an
  inline "Speak to text search is not available at this time. Try again
  later." banner under the search bar for a few seconds, then clears.
  Deliberately *not* gated on LAN-vs-remote network detection — discussed
  with Ryan first (2026-08-20) and dropped in favor of this simpler
  always-on-with-graceful-failure approach, since LAN access almost always
  has a working internet path for the phone's own STT round-trip anyway.
  TypeScript doesn't ship built-in types for this non-standardized API —
  minimal ambient declarations live in `src/types/speech.d.ts` (only the
  subset actually used, not a full polyfill). Verified the button, feature
  detection, and error-banner styling in-browser (a sandboxed test browser
  can't grant real mic access, so full transcription-to-search-box
  behavior was verified live on Ryan's phone instead).
- ✅ Cross-device playback resume — pause a track on one device, get
  prompted to continue it on another. Saved on `pause` (not on natural
  track-end — see the `PlaybackState` gotcha below) plus a ~10s periodic
  backstop autosave during playback; stored server-side (`PlaybackState`
  table, always at most one row) since the point is resuming on a
  *different* device, which localStorage can't do. On app load,
  `ResumePrompt` fetches the saved state and — if one exists — shows a
  "Continue playing this track?" modal; Yes seeks and plays immediately
  (a real click, so autoplay isn't blocked), No dismisses and clears the
  saved position server-side (otherwise it'd just re-prompt next time for
  a track already declined). Design was talked through with Ryan first —
  full reasoning in `DEVLOG.md`'s 2026-08-22 entry, including why `pause`
  (not browser-close detection, which isn't reliably catchable) is the
  save trigger.
- ✅ Album art editing (single + bulk ID3 editors) — a "Browse…" button
  replaces the embedded picture entirely via `PUT /api/tracks/{id}/artwork`.
  Bulk uploads go one request per track (not one atomic bulk call) with a
  real progress bar, since a multi-MB image times two dozen-plus tracks
  genuinely takes a while. Right-click (or long-press) an album card in
  the Albums grid also opens the bulk editor for that whole album, same
  as selecting all its tracks from the track list would.
- ✅ Artists → Albums navigation — selecting an artist from the Artists tab
  now goes to the Albums tab filtered to that artist's albums (instead of
  a flat track list), with a 2-level breadcrumb when you then drill into
  one of those albums ("← Back to {artist}", then "← Back to artists").
  See `App.tsx`'s `albumsArtistFilter` state, separate from `drillDown`.
- ✅ Universal "Cancel" option on the shared long-press/right-click context
  menu (`TrackContextMenu`) — previously the only way to dismiss it was to
  tap elsewhere (not discoverable after a touch long-press) or pick a real
  action. Applies everywhere the component is used.
- ✅ Fixed mobile long-press on an album card opening the OS's native image
  context menu instead of the app's custom one — the album art `<img>`
  now has `pointer-events: none` so the long-press always targets the
  parent card, same technique as `TrackList`'s row long-press.
- ✅ Fixed the "N matches" search count showing even with an empty search
  box on the Artists/Albums/Genres section search bars.
- ✅ Moved the browser-fullscreen toggle out of the Settings menu into its
  own icon button (`FullscreenToggle`) next to the ⋮ trigger, styled like
  YouTube's expand/collapse control — outward corner-bracket icon when not
  fullscreen, inward when in fullscreen. Appears both in the main sidebar
  header and the Now Playing Screen's header.
- ✅ Automatic album art lookup via the free iTunes Search API — a "Search
  iTunes" button in both ID3 editors, shows up to 5 candidate thumbnails,
  selecting one applies it through `PUT /api/tracks/{id}/artwork-from-url`
  (server downloads the image and writes it into ID3, same as a manual
  upload). See `ItunesArtworkSearch.tsx` and the `/api/artwork/search`
  endpoint.
- ✅ Bounce-style auto-scrolling marquee for artists with more than 10
  albums (see the Album-art-stack entry above) — driven by the Web
  Animations API rather than CSS `@keyframes`, since the per-artist hold
  duration at each end makes the animation's keyframe *offsets* (not just
  values) depend on that artist's own album count, which plain CSS custom
  properties can't express. Each thumbnail's hover tooltip is rendered
  via a React portal into `document.body` (`AlbumArtThumb` in
  `FacetList.tsx`) rather than as a normal absolutely-positioned child —
  see the tooltip-portal gotcha below for why that was necessary, not
  just a style choice.
- ✅ Previous/Next track paging in the single-track ID3 editor
  (`EditTagsDialog`) — pages through the sibling tracks on the same
  album (fetched once on open, ordered by track number) without closing
  the dialog; all per-track editing state resets on every page. Nav
  buttons are always visible, grayed out via `disabled` (not hidden)
  when there's nothing to page to — no album on the track, or no
  siblings. Paired with a split **Apply** / **Apply and Close** (the
  former saves and stays open — the actual point of paging, so you can
  edit down an album one track at a time; the latter is the old
  always-closes behavior). Closing is the dialog's own decision now, not
  the parent's `onSaved` callback.
- ✅ Enlarged album art preview (56px → 84px) and same-size stacked
  Browse…/Search iTunes buttons in both ID3 editors, matching a mockup
  Ryan provided. See the `.tags-art-buttons` gotcha below if reusing
  `.settings-option` inside a *column*-direction flex container again —
  its base `flex: 1` silently wins over an explicit `height` there.

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

   **`appsettings.json` itself is gitignored, not committed** (as of
   2026-08-22) — it holds absolute, per-machine paths (DB location, music
   folder), and Ryan and his brother's real values are different and were
   silently clobbering each other on every merge/pull. Each of you keeps
   your own local copy, started from `appsettings.json.example` (which
   *is* committed, with placeholder paths, as the template). If a
   redeploy or fresh clone is ever missing `appsettings.json`, copy the
   `.example` file and fill in the real paths — don't recreate it from
   scratch or guess at the schema. `appsettings.Development.json` is
   still committed as normal — it uses a relative path (`../../Music`),
   which is the same for anyone's checkout, so it isn't per-machine the
   way the production config is.

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
