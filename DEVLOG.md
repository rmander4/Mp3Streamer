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

## 2026-08-24 — Ryan (7)

- Increased the Artists tab's per-artist album-art thumbnail cap from 4 to
  10 (`/api/artists` no longer `Take()`s a fixed count server-side at all
  — it sends every album, uncapped, and lets the frontend decide how to
  show them).
- Added an auto-scrolling **marquee** for artists with more than 10
  albums, replacing what would otherwise be an ever-widening static row.
  Scrolls left until the last thumbnail is fully in view, holds there 2
  seconds, reverses back to the start, holds again, and repeats — not a
  seamless one-way loop, a genuine bounce with real endpoints. Driven by
  the Web Animations API (`MarqueeStack` in `FacetList.tsx`), not plain
  CSS `@keyframes` — the per-artist hold duration means the animation's
  keyframe *offsets* (not just values) depend on how many albums that
  artist has, which static CSS custom properties can't express. Hovering
  pauses it (`Animation.pause()`/`.play()`) so a click or the tooltip
  isn't chasing a moving target.
- Iterated through several real bugs found via Ryan's live testing before
  landing on the final version — worth knowing for next time:
  - The bounce initially stopped short of the true last thumbnail
    ("Ride the Lightning... you never get to see the whole art").
    Root cause: `.album-art-stack-item` has a 1px border with no
    `box-sizing: border-box`, so its real rendered footprint is 24px, not
    the 22px the distance math assumed — undercounted by 2px per
    thumbnail, compounding across the whole track. Fixed by correcting
    the `THUMB_SIZE` constant to 24, verified by freezing the track at
    its computed end position and confirming the last thumbnail's edge
    lands exactly flush (0px gap) with the window's edge.
  - An edge-fade mask (meant to signal "more content" at each side, like
    a continuous loop uses) doesn't make sense for a *bounce* — at the
    true start/end of a bounded list there's nothing beyond the edge to
    fade for, so the fade was clipping real content that should show in
    full. Removed entirely once the bounce (not a loop) was settled on.
  - **Real, confirmed bug**: hovering to pause the marquee also hid the
    per-thumbnail tooltip (the album name popup) — reported by Ryan after
    the pause feature made reading a tooltip possible for the first time.
    Root cause, confirmed via direct DOM/hit-testing (not guesswork): the
    tooltip is `position: absolute`, a DOM descendant of the marquee's
    clipped window — and there is no CSS-only way for a descendant to
    escape an ancestor's `overflow`/`clip-path` while staying in the
    tree. (Tried `overflow-x: hidden; overflow-y: visible` — the spec
    quirk where that pairing forces `overflow-y`'s *computed* value to
    `auto` instead. Tried `clip-path: inset()` with a large negative
    top/bottom offset, expecting it to extend the clip region — it
    doesn't in practice, the browser clamps it flush to the box. Neither
    worked.) Fixed properly via a React portal: each thumbnail
    (`AlbumArtThumb`) now renders its tooltip into `document.body` via
    `createPortal`, `position: fixed`, positioned from the thumbnail's
    own `getBoundingClientRect()` computed on hover/focus — the standard
    fix this exact class of "tooltip trapped in a clipped/scrollable
    container" problem always uses (same technique Radix/Popper/Floating
    UI use). This also happened to fix a second, pre-existing instance of
    the same underlying issue: the very first artist row's tooltip could
    collide with the sticky content-header above it.
  - Verified conclusively, not just theorized: reproduced each bug via
    direct DOM measurement (frozen animation positions, `elementsFromPoint`
    stacks, A/B toggling one CSS property at a time) rather than relying
    on visual screenshots, since the Browser pane wasn't compositing
    frames for screenshots this session — flagged that limitation to Ryan
    explicitly rather than claiming a visual check that didn't happen.
    Also caught and corrected two of my own invalid tests along the way
    (checking with `pointer-events: none` still in effect, which defeats
    `elementFromPoint` regardless of whether the tooltip is actually
    visible or not) rather than reporting a false conclusion from them.

## 2026-08-24 — Ryan (6)

- Added automatic album art lookup via the **iTunes Search API** (free,
  keyless, no auth) — a "Search iTunes" button now sits next to "Browse…"
  in both the single-track and bulk ID3 editors. Searches by whatever the
  Artist/Album fields currently hold (bulk dialog uses the shared value
  across the selection, or whatever's been typed if the field was
  touched), shows up to 5 candidate covers as clickable thumbnails, and
  selecting one flows through the exact same preview/apply path as
  picking a local file — just backed by a remote URL instead of a `File`.
  New shared `components/ItunesArtworkSearch.tsx`, used by both dialogs.
- Backend: `GET /api/artwork/search?artist=&album=` proxies
  `itunes.apple.com/search` server-side (registered `IHttpClientFactory`
  in `Program.cs`) and bumps the thumbnail URL from iTunes' default
  100x100 up to 600x600 — same undocumented CDN-path trick every
  iTunes-artwork tool uses. `PUT /api/tracks/{id}/artwork-from-url`
  downloads the chosen image server-side and writes it into the track's
  ID3 art via the same `SaveArtwork` helper the existing file-upload
  endpoint now shares. That endpoint validates the URL is `https` and
  hosted on `*.mzstatic.com`/`*.apple.com` before fetching it — a
  same-origin-only allowlist, not just trusting whatever URL a client
  sends, to keep the server from being usable as an open fetch proxy.
- Verified carefully given the earlier session's real album-art-corruption
  incident (2026-08-24, entry 3): backed up a real track's embedded art
  first, applied a real iTunes URL through the new endpoint, confirmed
  the bytes actually changed, then restored the original bytes and
  confirmed byte-for-byte equality with the backup before moving on.
  Also verified the host allowlist rejects a non-Apple URL (400), and the
  full UI flow (search → 5 thumbnail results → select → preview updates →
  Apply enables) in-browser without ever clicking Apply against a real
  track.

## 2026-08-24 — Ryan (5)

- Moved the browser-fullscreen toggle out of the Settings (⋮) menu and
  into its own small icon button, placed directly to the left of the ⋮
  trigger — both in the main sidebar header and the Now Playing Screen's
  own header. Styled after YouTube's expand/collapse control: an outward-
  pointing corner-bracket icon when not fullscreen, inward-pointing when
  in fullscreen (Material Design's `fullscreen`/`fullscreen_exit` icon
  paths). New `components/FullscreenToggle.tsx` holds all the logic
  (feature detection via `document.documentElement.requestFullscreen`,
  `fullscreenchange` listener, toggle handler) that previously lived
  inline in `SettingsPanel.tsx` — that file no longer has a "Display"
  section at all. Note: "fullscreen" here is the browser's actual
  Fullscreen API, unrelated to (and confusingly similarly named as) the
  "Now Playing Screen" (a.k.a. `FullScreenPlayer.tsx`), which is a
  same-app full-viewport view, not OS-level fullscreen.

## 2026-08-24 — Ryan (4)

- Fixed mobile long-press on an album card in the Albums grid opening
  Chrome/Android's native "save/copy image" menu instead of the app's own
  custom context menu — the `<img>` inside `.album-card` now has
  `pointer-events: none` (plus `-webkit-user-drag: none`) so a long-press
  always hits the parent card button, the same technique `TrackList`
  already used for row long-presses. `.album-card` itself also got
  `-webkit-touch-callout: none`/`user-select: none` for the same reason.
- Added a universal **Cancel** option to `TrackContextMenu` — previously,
  once a right-click or long-press menu opened, there was no way to
  dismiss it without picking a real action (tapping outside works on
  desktop but isn't discoverable on a touch device that just long-pressed
  something). Per Ryan: "I think we should add a 'cancel' or a timeout.
  I'm leaning towards a third option for cancel." Applies everywhere this
  shared component is used (track rows and album cards alike).
- **Workflow change**: selecting an artist from the Artists tab now
  navigates to the Albums tab filtered to just that artist's albums,
  instead of going straight to a flat track list. `App.tsx` tracks this
  via a new `albumsArtistFilter` state (separate from `drillDown`, which
  still handles album/genre drill-down) with its own "← Back to artists"
  breadcrumb; drilling into one of those filtered albums stacks a second
  breadcrumb level ("← Back to {artist}") on top via the existing
  `drillDown` breadcrumb. Verified the full round trip: Artists → filtered
  Albums → track list → back → back.
- Fixed: the "N matches" count next to a section search box (Artists/
  Albums/Genres) was showing even with an empty search box (e.g. "5
  matches" with nothing typed). Now only renders when
  `sectionSearch.trim()` is non-empty.
- All four changes above verified together in-browser on a test instance
  (port 5289) before deploying — long-press/Cancel via simulated
  `PointerEvent`s (a real touchscreen long-press can't be scripted, same
  caveat as the right-click-menu testing limitation noted elsewhere in
  this file/`CLAUDE.md`), the workflow change via full click-through, and
  the match-count fix by typing/clearing a search box and checking the
  DOM directly.

## 2026-08-24 — Ryan (3)

- Added album art editing to both the single-track and bulk ID3 editors —
  a "Browse…" button that replaces the embedded picture entirely (same
  code path handles "had no art" and "replace existing art", since
  assigning a single-element `Pictures` array is idempotent either way).
  New `PUT /api/tracks/{id}/artwork` endpoint (`IFormFile`, needs
  `.DisableAntiforgery()` like the iTunes import endpoint).
- Added: right-click (or long-press) an album card in the Albums grid →
  "Edit ID3 Tags" opens the same bulk editor as selecting every one of
  that album's tracks from the track list, fetching them via
  `fetchTracks({ album, artist })` first.
- Bulk album-art upload switched from one atomic bulk endpoint to
  sequential per-track requests with a real progress bar — a multi-MB
  image times two dozen-plus tracks (each a full file rewrite via
  TagLibSharp) genuinely takes a while, and a single opaque request gave
  no way to show progress. Continues past a single track's failure rather
  than aborting the whole batch. Removed the now-unused
  `PUT /api/tracks/bulk-artwork` endpoint and its client function.
- **Found and fixed two real, fairly serious caching bugs** while
  building this:
  - `/api/tracks/{id}/artwork` set `Cache-Control: public,max-age=86400`
    *before* checking whether the track actually had a picture — so a
    track's first "no art yet" 404 got cached by the browser for a full
    day right alongside real 200s. Adding art later to a previously
    art-less track wouldn't show up until that cache expired or a hard
    refresh forced it. Fixed by moving the cache headers to after
    confirming a picture exists.
  - Bigger one: static files (`index.html` included) had no explicit
    `Cache-Control` at all — ASP.NET Core's default `UseStaticFiles()`
    only sends `ETag`/`Last-Modified`, which lets browsers apply their
    own heuristic caching. For `index.html` specifically, that's a real
    problem: every redeploy embeds a *new* content-hashed JS/CSS
    filename, but a browser sitting on a heuristically-cached copy of the
    old `index.html` keeps loading the old bundle indefinitely with no
    visible sign anything's wrong. Very plausibly the actual cause behind
    several "I tested and it's still broken" reports this session that
    turned out to already be fixed server-side. Fixed in `Program.cs` via
    `StaticFileOptions.OnPrepareResponse`: `index.html` (and other
    non-hashed files) now get `Cache-Control: no-cache` (always
    revalidate, cheap 304 if unchanged); Vite's content-hashed `/assets/*`
    files get `public,max-age=31536000,immutable` instead, since their
    filename itself changes whenever their content does.
- Fixed album grid card misalignment: a long album title (e.g.
  "Something Wicked This Way Comes") wrapped to 3 lines and made that
  card taller than its row-mates. `.album-card-title` now clamps to 2
  lines with a matching `min-height`, so every card reserves the same
  text height regardless of actual title length — verified all cards in
  a row report the identical height afterward, long-title one included.
- **Important process mistake, worth any future session reading this
  knowing about**: discovered mid-session that the "test instance" on
  port 5289 (`dotnet run`, Development environment) was never actually
  isolated from production — `appsettings.Development.json` only
  overrides `LibraryRootPaths`, not `ConnectionStrings`, so it inherits
  the *same* production `library.db` and the *same* real MP3 files from
  the base `appsettings.json`. Several rounds of artwork-upload testing
  this session wrote real test images (solid color squares) directly
  into real files before this was noticed — confirmed corrupted as of
  this entry: track 246 ("Warheart," Children of Bodom / Hatebreeder,
  single track) and all 28 tracks of Kalisia's "Cybion." No backup was
  taken before overwriting, so the original art for both is gone unless
  Ryan has it saved elsewhere. Proposed to Ryan but not yet done: give
  the dev environment its own database file and a small copied subset of
  MP3s to test against, so this class of mistake becomes structurally
  impossible rather than just "be more careful next time."

---

## 2026-08-24 — Ryan (2)

- Fixed an empty gap where the Mini Player goes, showing up even with no
  track playing. `.body-row` was unconditionally reserving 84px (76px on
  mobile) of bottom padding for it, regardless of whether `NowPlayingBar`
  actually rendered anything (it correctly renders `null` with no
  `currentTrack`). Fixed by only applying that padding via a new
  `has-now-playing` class on `.body-row`, added in `App.tsx` when
  `currentTrack` is truthy — verified directly via the DOM that padding
  is `0px` idle and `76px`/`84px` once a track loads.
- Ryan asked to emulate mobile landscape to show a bug, which surfaced a
  second one along the way: the volume slider (Earthwormzim's) was still
  showing up at that width. Root cause: its `display: none` only lived
  inside the plain `@media (max-width: 700px)` block — the known
  width-only-breakpoint gap already documented in `CLAUDE.md`'s "Mobile
  detection" note, since a landscape phone is often wider than 700px.
  Fixed by moving it to its own `@media (pointer: coarse), (max-width:
  700px)` block, matching the same touch-aware pattern the JS
  `MOBILE_QUERY` constant already uses. Verified the `pointer: coarse`
  half of the query actually works (narrow-width test with touch
  emulation correctly hides it) — couldn't verify the exact "wide +
  touch" combination in-tool, since the browser automation here only
  emulates touch under 768px width; flagged that limitation to Ryan and
  had him confirm on his own phone in landscape instead.

---

## 2026-08-24 — Ryan

- Fixed a real bug Earthwormzim hit on his ~285k-track library: typing in
  the "All Tracks" search box made the results flicker/"refresh" without
  ever settling, instead of actually filtering. Root cause was in
  `App.tsx`'s track-fetching effect — it fired a new `fetchTracks()` call
  on every search but never cancelled the previous one, so on a library
  large enough that searches take a noticeable amount of time (the
  `%term%` LIKE pattern can't use an index, forcing a full table scan),
  overlapping requests could resolve out of order and repeatedly
  overwrite fresh results with stale ones. Ryan's small library never hit
  this — searches resolve too fast for the race window to matter. Fixed
  with an `AbortController` per search, cancelling the previous in-flight
  request whenever a new one starts (`api/client.ts`'s `fetchTracks` now
  takes an optional `AbortSignal`). Verified by patching `window.fetch` in
  a test browser to simulate a slow backend and confirming stale requests
  actually got aborted rather than just hoping the timing worked out.
- Investigated a report from Ryan: several different tracks kept playing
  successfully while he was outside the LAN (no route to the server at
  all). Worried it meant the single-track Blob buffering
  (`bufferTrack.ts`) wasn't being cleaned up and multiple tracks were
  piling up in memory. Verified that's not what's happening —
  `NowPlayingBar.tsx` already revokes the previous track's Blob URL
  before buffering a new one, confirmed by re-reading the effect. The
  actual cause: `/api/tracks/{id}/stream` sent no `Cache-Control` header
  at all (just `Last-Modified`), which lets browsers heuristically cache
  full audio byte ranges to disk indefinitely, completely outside the
  app's own buffering logic — so previously-streamed tracks kept working
  offline well after their in-memory Blob was long gone. Ryan's specific
  worry (2026-08-24): "thousands of songs still working... like a cache
  that isn't clearing out" over time, for a library that size. Fixed by
  sending `Cache-Control: no-store` on the stream endpoint — offline
  playback is now strictly limited to whichever one track the app's own
  buffering is actively holding, nothing more.

---

## 2026-08-23 — Ryan

- Ryan wanted his own library imported via the same `ItunesXmlImporter.cs`
  path Earthwormzim's brother uses, for consistency between their two
  setups — even though Ryan's plain filesystem scan already gets the same
  `AlbumArtist` benefit for free (confirmed: `LibraryScanner.cs` already
  reads `tag.FirstAlbumArtist` directly). Real iTunes turned out to be
  unusable for this though — it was leaking 100+ GB of RAM on Ryan's
  machine trying to import a library of well under 100 songs (likely an
  iCloud Music Library / Apple Music catalog-matching bug, unrelated to
  library size). Uninstalled.
- Built `tools/ItunesXmlGenerator` instead — a small standalone console
  tool (own `.csproj`, references TagLibSharp directly) that generates a
  real iTunes-Library-XML-format file straight from a folder of MP3s,
  reading the same tags the app's scanner already reads. No real iTunes
  involved at all. Usage: `dotnet run -- <music-folder> [output-xml-path]`.
  Persistent IDs are a stable hash of each file's path (real iTunes uses
  random ones) so re-running the generator updates existing rows on
  re-import instead of duplicating them.
- **Found and fixed a real, serious bug in `ItunesXmlImporter.cs` itself**
  while testing the generator's output against it — not a generator
  problem. The root dict's key-scanning loop used
  `reader.ReadToFollowing("key")` to walk sibling keys, but that method
  searches the *entire remaining document* for the next `<key>` element
  (not just the current dict level) and always advances past the current
  node even when it already matches. Once nested dicts are involved (the
  "Tracks" value is one), this silently desyncs — confirmed by
  reproduction with a debug-logged root-key trace, not just theorized: it
  could skip the "Tracks" key entirely and start walking the numeric
  per-track keys as if they were root-level siblings, corrupting the
  import in a way that depended on the exact number of metadata keys
  iTunes happened to write before "Tracks", not a change in behavior
  Ryan's file specifically triggered. Fixed by replacing that loop with
  the same manual node-walking pattern the (already-correct) per-track
  reading loop just below it already uses — verified robust afterward
  against multiple synthetic files with 0, 1, and 4 metadata keys ahead of
  "Tracks", plus Ryan's real 133-track library, all importing correctly
  and idempotently (re-importing doesn't duplicate rows). This is a fix to
  shared code Earthwormzim's brother also depends on — his own prior
  285k-track import may have had some fields silently misattributed by
  this bug even though the row count looked like a clean success; worth
  him knowing about, not just Ryan.
- Also suppressed EF Core's `PendingModelChangesWarning` on `LibraryDbContext`
  (`Program.cs`) — discovered while first bringing up a test instance
  after the previous merge: EF's strict model/snapshot parity check
  believed the merged model had drift even though every migration in the
  chain applies cleanly and produces the correct schema (confirmed: the
  "fix" it proposes is a redundant `CreateTable` for `PlaybackState`, a
  table that already exists everywhere). Suppressed per EF's own
  documented guidance rather than accepting that migration, which would
  have crashed on any database (dev or production) where `PlaybackState`
  already exists. The exact snapshot-vs-model discrepancy causing the
  false positive is still unidentified — flagged as a TODO in the code
  rather than silently hidden.

---

## 2026-08-22 — Ryan (2)

- Merged in Earthwormzim's changes (iTunes XML import, section search,
  volume control, album pagination, `AlbumArtist`-based album grouping —
  see his entry below) with the playback-resume/album-art work from
  earlier today. Branches had diverged (4 local commits, 2 remote), so
  this was a real merge, not a fast-forward. Conflicts in `DEVLOG.md`,
  `App.tsx`, `api/client.ts`, and `NowPlayingBar.tsx` — all resolved by
  keeping both sides' additions (e.g. `App.tsx`'s Artists view now has
  both his search-filtering *and* the album-art click-to-navigate
  behavior; `NowPlayingBar.tsx` has both his volume control and the
  resume-seek logic in the direct-streaming fallback path). Verified the
  merge produced a semantically correct EF migrations snapshot (both his
  two new migrations and mine) by generating a throwaway
  `dotnet ef migrations add` afterward and confirming it came out
  completely empty — no undetected schema drift — then removed it.
  Verified both frontend and backend still build cleanly afterward.
- Found and fixed a real problem during the merge: `appsettings.json`
  (the production config — DB path, music library path) had been tracked
  in git this whole time, and the merge silently overwrote Ryan's real
  local values with Earthwormzim's own machine-specific paths (`E:\Music\HQ`,
  a `C:\Projects\...` DB path) — caught by comparing against the
  currently-*deployed* `publish/appsettings.json` before committing
  anything. Restored Ryan's real values. Per Ryan's request, un-versioned
  `appsettings.json` going forward: it's now gitignored (kept locally,
  never committed) with a new `appsettings.json.example` template
  checked in instead for fresh setups to copy from.
  `appsettings.Development.json` stays tracked as-is — it only has a
  relative path (`../../Music`), which is the same for any checkout, not
  a per-machine value like the production config.

---

## 2026-08-22 — Ryan

- Added cross-device "continue where you left off" playback resume — pause
  a song in the car, open the site on the PC later, get prompted to pick
  up right where it left off. Talked through the design with Ryan first:
  - Save trigger is the `pause` event, not browser-close detection — Ryan's
    own insight, since there's no reliable way to detect a tab/browser
    closing (especially on mobile), but `pause` always fires deterministically
    whenever playback actually stops. A periodic ~10s autosave during
    playback is a backstop for the rare case `pause` never fires at all
    (crash, phone force-killed).
  - Deliberately *not* saved when a track ends naturally (`onEnded`) — only
    a genuine mid-track pause is worth resuming. `onEnded` actively clears
    any saved position instead, so a finished song never leaves a stale
    resume prompt behind.
  - On app load: if a position is saved, show a modal (art + title +
    artist) — "Continue playing this track?" Yes/No. Yes seeks to the
    saved position and starts playback immediately (a real button click,
    so autoplay isn't blocked). No dismisses *and* clears the saved
    position server-side — otherwise it'd just re-prompt next time for a
    song already declined. (Discussed skipping the clear-on-decline as
    redundant, since the next real pause/autosave overwrites it anyway —
    but the gap where the user declines and never plays anything else
    before closing again made explicit clearing the simpler choice.)
  - Storage is server-side (new `PlaybackState` table — always at most one
    row, `{TrackId, PositionSeconds, UpdatedAtUtc}`, overwritten each save),
    not localStorage — the whole point is resuming on a *different* device,
    so it has to live somewhere both devices can reach. New endpoints:
    `GET/PUT/DELETE /api/playback-state`. Cascade-deletes if its track is
    ever removed from the library, same pattern as PlayHistory.
  - `PlayerContext.playQueue()` grew an optional `resumeSeconds` param;
    `NowPlayingBar` seeks there once the track is buffered/ready (or via
    the same live-stream handoff a manual seek past the buffered portion
    already triggers, for a long track resumed near/past its buffer cap).
  - Verified the whole flow on a separate test instance: no prompt when
    nothing's saved, save-on-pause, resume-and-play, decline-and-clear,
    natural-completion-clears, and the periodic backstop autosave actually
    firing without an explicit pause — before deploying to the live
    service (which required a migration; ran automatically via the
    existing `db.Database.Migrate()` on startup, no manual DB step).

---

## 2026-08-20 — Ryan (4)

- Fixed a bug in voice search's error banner ("Speak to text search is not
  available at this time..."): it could reappear right after correctly
  auto-dismissing. Cause — the 8-second timeout backstop (in case the
  browser's recognition session hangs) wasn't being cancelled when a real
  `onerror` fired, only when `onend` fired afterward. If the browser was
  slow to raise `onend` right after `onerror`, the stale backstop timer
  would fire later, re-showing the banner. Fixed by cancelling the
  backstop the moment `onerror` fires, not just on `onend`. Also bumped
  the banner's own auto-dismiss from 4s to 20s per Ryan's ask, so there's
  more time to actually read it while driving. Verified live on Ryan's
  phone.

---

## 2026-08-20 — Ryan (3)

- Added voice search: a mic button next to the search box (`SearchBar.tsx`)
  using the browser's built-in Web Speech API — no custom backend
  transcription endpoint, the phone/browser does the speech-to-text
  itself. Tap to start listening, speak, and the transcript populates the
  search box and runs the search automatically (reuses the existing
  debounced search state, no separate code path). Talked through a few
  design options with Ryan first before landing here:
  - Considered detecting LAN vs. remote network access and only enabling
    voice search off-LAN (reasoning: hands-free matters more away from
    home). Technically doable later (compare `window.location.hostname`
    against the LAN IP once remote access exists), but there's no "remote"
    case to compare against yet, so shelved for now.
  - Landed on: always show the mic button, and handle failure gracefully
    — an 8s timeout backstop plus the Web Speech API's own error events
    trigger an inline "Speak to text search is not available at this
    time. Try again later." message. Simpler, and the LAN-detection
    approach wouldn't have actually caught most real failure modes (mic
    permission denied, browser unsupported) anyway.
  - Added minimal ambient TypeScript types for `SpeechRecognition` in
    `src/types/speech.d.ts`, since it's not part of TS's built-in DOM lib.
  - Verified the button/feature-detection/error-banner styling on a local
    test instance (the sandboxed browser tooling can't grant real mic
    access), then confirmed the full transcribe-and-search flow works
    live on Ryan's phone after deploying.

---

## 2026-08-20 — Ryan (2)

- Fixed misaligned track counts on the mobile Artists tab: they were
  drifting based on artist-name length instead of sitting flush right.
  Root cause was a CSS specificity trap — `.album-art-stack + .facet-count`
  (a fixed 10px margin, meant to sit the count close to the art stack on
  desktop) still matched and overrode the plain `.facet-count`'s
  `margin-left: auto` on mobile, even though `.album-art-stack` itself is
  `display: none` there. A hidden element still counts for CSS sibling
  selectors — display:none removes it from layout, not from the DOM/CSSOM.
  Fixed with a mobile-only override restoring `margin-left: auto` on that
  selector (`App.css`).
- Reworked the Mini Player's mobile-portrait layout: the seek bar was
  getting visibly cut off at the right edge sharing a single row with the
  album art, track info, and prev/pause/next buttons. Split it into two
  rows — art/info/controls on top, seek bar on its own full-width row
  below, edge-to-edge. Required a small JSX restructure in
  `NowPlayingBar.tsx` (new `.now-playing-main` / `.now-playing-identity`
  wrapper divs around art+info+controls) so the seek bar could become an
  independent flex row via `flex-direction: column` on mobile, without
  changing the desktop single-row layout. Freed-up space on the top row
  also let the controls spread out instead of being cramped. Ryan mocked
  up the target layout with an annotated screenshot before implementation.
- Both changes verified on a separate test instance (port 5289, including
  measuring actual pixel positions in-browser) before Ryan stopped/started
  the live Windows Service to deploy each one.

---

## 2026-08-22 — Earthwormzim

- Added read-only iTunes Library XML import. The importer parses the plist
  export into the local SQLite catalog, preserves iTunes Persistent IDs, and
  converts iTunes file URLs into local Windows paths.
- Added an iTunes catalog mode that skips the full MP3 filesystem scan and
  watcher setup. Added the Settings file picker and import endpoint, including
  support for the large XML export size.
- Added browser and C# progress logging for upload/import phases. Fixed the
  standard iTunes plist DTD handling while keeping external XML resolution
  disabled.
- Verified end-to-end against the backed-up XML: HTTP 200 and 23,970 tracks
  imported, with 1 skipped. No `.itl`, XML, or MP3 files were modified.
- Added section search fields with live match counts for Artists, Albums,
  Genres, and Playlists. Albums search both album and artist names; the
  other sections search their displayed names.
- Added persisted browser volume control, album pagination options (20, 50,
  100, or all), and album-art loading for iTunes-imported tracks. Artwork
  requests now verify the actual MP3 instead of relying on incomplete XML
  artwork metadata.
- Rebuilt and reran the corrected XML importer after discovering incomplete
  coverage. Verified 285,173 records processed, 285,168 tracks in SQLite,
  and Lammoth present with valid paths and `IsMissing = false`.
- Kept the content search header sticky while its main pane scrolls, and
  applied the saved browser volume to the audio element on mount and before
  each new buffered or live track source starts.
- Extended the sticky content header across the main pane's top padding so
  scrolled album cards cannot show behind the search panel.
- Added a positioned background layer to cover the header's negative-margin
  strip, preventing scrolled album art from appearing above the panel.
- Added `AlbumArtist` catalog metadata and changed album grouping to use it,
  falling back to `Artist` when unavailable. Reimported the XML and verified
  `A.M.G.O.D.` is one 9-track album and `Cypher` is one 13-track album.

---

## 2026-08-20 — Ryan

- Added a small album-art "stack" to the desktop Artists view: each artist
  row now shows up to 4 small cascaded album-art thumbnails (one per
  distinct album, no y-axis overlap — left-to-right only), right-justified
  next to the track count. `GET /api/artists` now returns
  `albumArtTrackIds` per artist (`ArtistDto`, `LibraryEndpoints.cs`); the
  frontend renders them via a new `AlbumArtStack` component in
  `FacetList.tsx`. Iterated through several rounds of visual feedback with
  Ryan (spacing, right-justification, single-digit count alignment) before
  landing on the final layout. Desktop-only — hidden under the existing
  `max-width: 700px` layout breakpoint, same as other desktop-only columns.
- Added a fallback icon for the rare case where an album has no embedded
  art: previously a failed artwork load just went invisible (`visibility:
  hidden`), leaving a blank gap in the stack. Now it renders a small
  music-note glyph in a placeholder box matching the real thumbnails'
  size/border, tracked via per-stack React state (`AlbumArtStack`'s
  `failed` set) rather than mutating the DOM node directly.
- Also answered a question (no code change): landscape-mode mobile looks
  like desktop because the CSS layout breakpoint
  (`@media (max-width: 700px)`) is width-only, unlike the JS
  `MOBILE_QUERY` constant used for touch-interaction logic (`(pointer:
  coarse), (max-width: 700px)`) — a landscape phone is usually wider than
  700px and falls on the desktop side of that breakpoint. Real gap, not
  fixed yet — flagged for a future session if it's worth addressing.
- Verified both changes on a separate test instance (port 5289) before
  deploying. Along the way, discovered the checked-in (but gitignored)
  `server/Mp3Streamer.Api/wwwroot/` build output had gone stale from an
  earlier session and was masking the fresh frontend build during local
  testing — re-copied `dist/` into it before publishing. Deployed to the
  live Windows Service via `Restart-Service`.

---

## 2026-08-19 — Ryan (2)

- Ryan was actively reorganizing his real music library (adding new
  artists — Children of Bodom, Kalisia — and renaming Iced Earth's album
  folders) while the site was live, and noticed the changes weren't
  appearing even after a browser refresh. Diagnosed two separate things:
  1. A plain page reload alone was never going to show new backend data
     if the *server* hadn't scanned yet — expected, not a bug.
  2. But the automatic watcher genuinely hadn't picked up most of the
     changes either: a manual `POST /api/library/scan` immediately found
     50 tracks (two whole new artists) the watcher had missed. Root cause
     is almost certainly `FileSystemWatcher`'s internal OS buffer
     overflowing during Ryan's bulk add (many files across new folders in
     a short window) — a known failure mode where excess events are
     silently dropped rather than queued.
  - Fixed by raising `FileSystemWatcher.InternalBufferSize` from the
    8KB default to 64KB (the practical max) in `LibraryWatcherService`,
    to make this less likely going forward.
  - Added the **Refresh Library** button Ryan asked for (Settings →
    Library) as a user-facing fallback regardless — calls the existing
    `POST /api/library/scan` endpoint, then reloads the page so whatever
    view is open shows fresh results immediately, no manual reload
    needed on top of the click.
  - Verified the whole flow on a separate port (5289) against the real
    library before touching the live deployment, per Ryan's standing
    request to always test before deploying: confirmed the button
    triggers a scan and the page reloads with fresh data, no console
    errors. Only then repeated the real Windows Service redeploy
    workflow (from `CLAUDE.md`) — had Ryan `Stop-Service`, published,
    had him `Start-Service`, then confirmed via the API and in-browser
    that the live site (108 tracks matching his in-progress
    reorganization) has the new build.

## 2026-08-19 — Ryan (1)

- Deployed the backend as a permanent Windows Service (`Mp3Streamer`) on
  Ryan's PC, so it survives reboots and doesn't need Claude Code or any
  terminal open — motivation, verbatim: "when I close Claude, I want to
  still access the website." Chose a plain Windows Service over IIS
  (overkill for one self-hosted app) and over Tailscale/Cloudflare Tunnel
  (Ryan wants to stay LAN-only, not exposed to the internet).
  - Added `Microsoft.Extensions.Hosting.WindowsServices` +
    `builder.Host.UseWindowsService()` in `Program.cs`.
  - Made `appsettings.json` self-sufficient with absolute paths (DB
    connection string, `LibraryRootPaths`, and a new `"Urls"` key) since a
    service doesn't go through `launchSettings.json` — no
    `ASPNETCORE_ENVIRONMENT=Development`, no `--urls` flag.
  - Hit a real scare mid-setup: testing the published exe, the scan
    reported "114 removed" tracks. Turned out to be a **real, correct**
    result — Ryan had deleted 8 albums' worth of files earlier and "Remove
    Tracks That Do Not Exist" defaults to On — but before confirming that,
    also hit a **second, genuinely broken** run moments later (wrong
    working directory → wrong content root → silently fell back to
    defaults, port 5000, empty `LibraryRootPaths`, a fresh empty
    database) that looked identical to data loss at a glance. Root cause:
    `WebApplication.CreateBuilder(args)` resolves `ContentRootPath` from
    the current directory, and Windows Services always start in
    `%SystemRoot%\System32` — not the exe's own folder. Fixed by pinning
    `ContentRootPath = AppContext.BaseDirectory` explicitly. Verified the
    fix by deliberately launching the exe from the wrong directory
    afterward and confirming it still resolved everything correctly.
  - `dotnet publish -c Release -o publish` for the actual deployed build
    (not just `dotnet run` from source); added `publish/` to `.gitignore`.
  - Installing/starting/stopping the service needs an elevated
    (Administrator) PowerShell — Claude can't self-elevate, so that one
    step has to be run by Ryan directly. Gave him the exact
    `New-Service`/`Start-Service` commands.
  - Hit one more real snag going live: `Start-Service` "succeeded" but the
    service immediately showed `Status: Stopped` — a leftover background
    test instance (from my own verification steps) was still bound to
    port 5288, so the service's own Kestrel failed to bind and crashed on
    startup with no obvious error surfaced to `Get-Service`. Killing the
    stray process fixed it. Documented this in `CLAUDE.md`'s redeploy
    workflow as a thing to check before every `Restart-Service`.
  - Verified fully working end-to-end through the actual service
    afterward: API responding with the correct live library, frontend
    loading correctly in-browser. Startup Type is `Automatic`.
  - Full setup + the redeploy workflow (`npm run build` → copy to
    `wwwroot` → `dotnet publish` → `Restart-Service`) written up in
    `CLAUDE.md` under "Running as a Windows Service" — that's the
    reference for future deploys, not this entry.

## 2026-08-18 — Ryan (12)

- Added a manual "Clear History" button, top-right of the History view —
  `DELETE /api/history` wipes the `PlayHistory` table, gated by a
  `window.confirm` ("Clear today's play history? This cannot be undone.")
  matching the confirm pattern already used elsewhere (bulk tag edits,
  mobile download). Only shown when there's something to clear. Verified
  both directions: confirming actually clears it (checked server-side and
  that the UI drops to the empty state), and Cancel leaves it untouched.

## 2026-08-18 — Ryan (11)

- Added handling for tracks whose files disappear (Ryan asked what
  currently happens — answer was "nothing configurable, always hard
  deletes, and that cascades away the track's playlist memberships and
  history too"). Built the setting Ryan proposed:
  - Settings → **Remove Tracks That Do Not Exist: On/Off**, defaulting to
    On (the original delete-on-missing behavior, unchanged unless someone
    actually flips this).
  - Off: `LibraryScanner` now sets a new `Track.IsMissing` flag instead of
    deleting the row when a file can't be found (and clears it if the
    file comes back at the same path later). `TrackList` and
    `HistoryPanel` gray out (`opacity: 0.45`) those rows, label them
    "(missing)", and block clicking them into playback — everything else
    (right-click, editing) is left alone since the tag-edit endpoints
    already 404 gracefully on a missing file.
  - Verified the whole lifecycle for real: moved a test mp3 out of the
    library folder (not deleted, just relocated, so it's reversible) with
    the setting On — confirmed the track still got hard-deleted, i.e. no
    regression to the original behavior. Restored it, re-added via
    rescan, flipped the setting Off, removed the same file again —
    confirmed the row survived with `isMissing: true` and rendered
    correctly grayed-out/unclickable in the browser. Restored the file
    once more, confirmed `isMissing` cleared back to `false`, and reset
    the toggle back to On afterward.
  - New EF migration `AddTrackIsMissing`.

## 2026-08-18 — Ryan (10)

- Fixed a real bug Ryan found: repeatedly clicking the *same* track (e.g.
  from History, trying to re-confirm a song) wasn't adding new history
  entries after the first click. Root cause: `NowPlayingBar`'s buffering /
  history-recording effect was keyed on `currentTrack?.id`, which doesn't
  change when you re-select the track that's already current — so the
  effect (and `recordPlay()` inside it) silently never re-ran.
  - Fixed at the `PlayerContext` level, not just for History: added a
    `selectionSeq` counter that increments on every explicit "play this"
    action (`playQueue`, and `next`/`previous` when they actually move to
    a different track) — including re-selecting the identical track.
    `NowPlayingBar`'s effect now depends on `selectionSeq` instead of
    `currentTrack?.id`, so re-selection works everywhere (History,
    TrackList, playlists), not just as a special case.
  - Verified precisely: recorded a baseline history count, clicked the
    same track 3 times in a row (pausing between clicks so the click
    itself — not an already-playing guard — was what mattered), confirmed
    the count went up by exactly 3.

## 2026-08-18 — Ryan (9)

- Added play history: records a timestamped entry every time a track
  starts playing, viewable in a new **History** nav item, with an on/off
  toggle in Settings. Also noted for the future: Smart Playlists (a
  separate conversation earlier today) and full play history are
  different features — this one's a full event log, which can't live in
  ID3/POPM (only holds one counter byte, not a list of timestamps), so
  it's DB-only.
  - **Scoped to today only, per Ryan**: "Lets limit play history to
    'current day'... this will prevent it from growing too large over
    time." The write path (`POST /api/tracks/{id}/play`) actually deletes
    anything from a prior day before inserting the new row
    (`ExecuteDeleteAsync`), rather than just filtering old rows out on
    read — keeps the table bounded instead of accumulating forever.
  - Toggle enforced **server-side**: the record endpoint checks a new
    generic `AppSetting` key/value row itself and silently no-ops when
    off, so the frontend just always calls it and doesn't need to know
    the setting's value. Verified both directions — recorded a play with
    it on, toggled off, played another track, confirmed the second one
    did *not* appear in history.
  - History rows are clickable (added mid-build, per Ryan): clicking one
    queues the whole day's history starting at that track, so Next/
    Previous browses through it — explicitly for "I heard a great song
    around 3pm but was heads-down in work and don't remember what it
    was," click around near that time until it turns up. Required
    `PlayHistoryEntryDto` to carry a full nested `TrackDto`, not just
    title/artist/album.
  - The History nav item (after Playlists, same position in every
    layout) only shows once the setting's confirmed on — added
    `history/HistoryContext.tsx` so `Sidebar` and both `SettingsPanel`
    render sites (Mini Player's and the Now Playing Screen's) share one
    fetched value rather than drifting out of sync with independent
    copies of it.
  - Found and fixed a real bug while building this: SQLite loses
    `DateTime.Kind` on round-trip through EF Core (comes back
    `Unspecified`), which made `System.Text.Json` serialize timestamps
    without a trailing `Z` — the frontend would've silently misread an
    actually-UTC time as local time. Fixed by restoring `Kind=Utc` after
    `ToListAsync()` (can't be done inside the LINQ query — EF can't
    translate `DateTime.SpecifyKind` to SQL). Verified the fix directly:
    a play recorded at 22:52 UTC correctly displayed as 6:52 PM Eastern.
  - Installed `dotnet-ef` as a global tool (wasn't present) to generate
    the migration (`AddPlayHistoryAndSettings`) — new `PlayHistory` and
    `Settings` tables, both confirmed created via the startup migration
    log.

## 2026-08-18 — Ryan (8)

- Reworked mobile's long-press: it used to jump straight into a
  `window.confirm("Download X?")` prompt. Ryan wanted it to work like
  desktop's right-click instead — long-press now opens the same
  `TrackContextMenu` with two options, **Edit ID3 Tag** and **Download**,
  always targeting only the single pressed track (multi-select/bulk edit
  stays desktop-only via drag-select; not attempting that on mobile for
  now, per Ryan — "not sure if I want it to happen"). Picking Download from
  the menu downloads immediately, no extra confirm — the menu tap itself is
  already the deliberate action, matching how desktop's download icon has
  no confirm either.
  - Refactored how `TrackList` stores context-menu state: it now holds the
    already-built `items` array directly (`{ x, y, items }`) rather than
    `{ tracks, x, y }` with the item list re-derived at render time — the
    desktop right-click handler and the mobile long-press handler build
    genuinely different item sets (single/bulk edit vs. edit+download), so
    a single derivation path no longer fit.
  - Verified in-browser: long-press opens the two-item menu; "Edit ID3 Tag"
    opens the single-track dialog (never the bulk one, even though the
    underlying mechanism is shared with desktop); no accidental playback
    fires afterward. Could *not* re-verify the actual file landing in
    Downloads for the "Download" item specifically — Chrome's automatic-
    download-blocking silently suppressed even a from-scratch, outside-
    react repro of the identical anchor-click pattern in this same browser
    session, most likely because a prior download already succeeded and
    subsequent non-trusted-gesture downloads got throttled. Not treating
    this as a real bug: the code path is byte-for-byte the same one already
    proven to work for the desktop download icon earlier in this session.

## 2026-08-18 — Ryan (7)

- Fixed two real bugs in right-click, reported by Ryan as "right click
  doesn't work in browser":
  1. The right-click/drag-select gate (`COARSE_POINTER_QUERY`, added in
     entry (6) below to fix an earlier width-based bug) — turned out entry
     (6)'s fix was correct but wasn't the whole story.
  2. `handleRowContextMenu` wasn't calling `e.stopPropagation()` — only
     `e.preventDefault()`. The native `contextmenu` event kept bubbling past
     the row after the menu opened, and `TrackContextMenu`'s own `useEffect`
     attaches a `document`-level "any contextmenu/click closes the menu"
     listener as soon as it mounts. Under the right timing, that still-
     bubbling event reaches `document` and immediately closes the menu that
     just opened — same tick, so it looks exactly like right-click does
     nothing. Added `e.stopPropagation()` alongside `e.preventDefault()`.
  - Notable process point: my own in-browser testing (synthetic
    `dispatchEvent` calls) did **not** reproduce either bug reliably, so
    "verified in-browser" from entry (6) wasn't sufficient — synthetic
    events and real user gestures aren't guaranteed to hit the same code
    paths/timing. Worth remembering for future UI work: browser-automation
    testing here is a good regression check, not a substitute for the
    actual reported behavior when a user says something still doesn't work.
- Added the confirmation Ryan asked for on the bulk ID3 edit dialog:
  clicking "Apply Changes" now shows `window.confirm("Are you sure? You are
  editing N tracks. Changes cannot be undone.")` before actually calling
  `PUT /api/tracks/bulk-tags` — matches the existing `window.confirm`
  pattern already used for the mobile download long-press, rather than
  building a custom nested dialog. Single-track edits don't have this
  (only one track, lower stakes, and "Apply Changes" already requires an
  explicit second click after enabling itself).

## 2026-08-18 — Ryan (6)

- Added the first right-click context menu (desktop only — right-click
  doesn't fire the same way on touch, and mobile already uses long-press
  for the download prompt). `TrackContextMenu` is built generically (an
  items list + position), so future right-click actions should extend that
  same list rather than a new one-off menu.
- Added client-side ID3 tag editing: "Edit ID3 Tag" opens `EditTagsDialog`
  pre-filled with Title/Artist/Album/Genre/Track #/Year, "Apply Changes"
  disabled until something actually changes (and while Title, the one
  required field, is empty). Chose to always send every field's current
  value on apply (not a diff) — simpler, and avoids ambiguity between
  "field wasn't touched" and "field was intentionally cleared."
  `PUT /api/tracks/{id}/tags` writes straight into the file's real ID3v2
  tag via TagLibSharp, then mirrors into the DB in the same request — same
  pattern as the existing rating endpoint.
  - Verified end-to-end: edited a track's genre in the browser, confirmed
    the API/DB reflected it, then triggered a full library rescan (which
    reads straight from the file) and confirmed the new genre survived —
    proving it's actually in the file, not just the DB. Reverted the test
    edit back afterward.
  - Added `downloadUrl`-style backend route naming consistency; also added
    `PlayerContext.setCurrentTrackFields` (a general version of the
    existing `setCurrentTrackRating`) so editing the *currently playing*
    track's tags updates the Mini Player / Now Playing Screen immediately.
- Mid-session, Ryan asked for multi-select (drag across rows, desktop only)
  plus a bulk-edit variant of the same right-click flow. Built and verified:
  - `TrackList` now supports drag-to-select: mousedown + drag over other
    rows selects a contiguous range; a plain click (no drag) still just
    plays the track, unchanged from before. Right-clicking inside the
    current selection edits the whole selection; right-clicking outside it
    resets selection to just the clicked row first (standard file-explorer
    convention).
  - Right-clicking a multi-selection shows "Edit ID3 Tags" (plural) and
    opens `EditTagsBulkDialog` instead of the single-track dialog — showing
    **only** Artist/Album/Genre/Year, never Title/Track #/rating, since
    those are inherently per-track and multiple tracks can't sensibly
    "share" them.
  - This dialog can't reuse the single-track dialog's "always send every
    field" approach — with multiple tracks that can genuinely disagree on a
    field's value, blindly applying all fields would silently overwrite
    values that were never actually touched. So it tracks each field's
    "touched" state independently: a field where the selection disagrees
    shows blank with a "multiple values" placeholder, and is only written
    (via a `Set*` boolean flag per field in the new
    `PUT /api/tracks/bulk-tags` request) if the user actually edits it.
  - Verified end-to-end: drag-selected 2 tracks from different albums
    (different Album/Year, same Artist/Genre), confirmed the dialog showed
    "multiple values" placeholders exactly on Album/Year, changed only
    Genre, applied, and confirmed via the API (then a full rescan, proving
    it hit the actual files) that Genre changed on both while Album/Year
    stayed exactly as they were — untouched, not blanked. Reverted the test
    edits back afterward.
  - Hit a real testing gotcha along the way: React 19's `onMouseEnter`
    wouldn't fire from synthetic `dispatchEvent`-based automation no matter
    how the event was constructed; switched to `onMouseOver` (a real
    bubbling native event) for the drag-select row handler, which behaves
    identically for this use case and is more predictable to drive
    programmatically. Documented in `CLAUDE.md` in case a future session
    needs to script-test a drag interaction here again.

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
