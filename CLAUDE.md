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

**Whenever you start work in this repo, skim `DEVLOG.md` first** —
specifically any entries you don't already have context for — to catch up
on what the *other* person's Claude session did since you last touched this
project. That's the whole point of the file: it's cheaper and more reliable
than re-deriving intent from a raw `git log` or diff.

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
  LAN IP.

## Architecture

### Backend — `server/Mp3Streamer.Api` (.NET 10, ASP.NET Core Minimal API)

- `Data/LibraryDbContext.cs` — EF Core DbContext, SQLite (`library.db`)
- `Models/Track.cs`, `Playlist.cs`, `Dtos.cs` — entities + response DTOs
- `Services/LibraryScanner.cs` — recursively scans `LibraryRootPaths`
  (from config) for `.mp3` files, reads ID3 tags via TagLibSharp, upserts
  changed tracks and removes DB rows for files no longer on disk
- `Endpoints/LibraryEndpoints.cs` — `/api/tracks` (search/filter/paginate),
  `/api/artists`, `/api/albums`, `/api/genres` (facets),
  `/api/tracks/{id}/stream` (range-enabled), `/api/tracks/{id}/artwork`
- `Endpoints/PlaylistEndpoints.cs` — full CRUD + `/reorder` for playlists
- `Program.cs` — wires everything up; also serves `wwwroot/` (the built
  frontend) via `UseDefaultFiles`/`UseStaticFiles` for single-port deploys

### Frontend — `client/mp3streamer-web` (React + TypeScript + Vite)

- `api/client.ts`, `api/types.ts` — typed fetch wrappers for every endpoint
- `components/` — `Sidebar`, `TrackList`, `AlbumGrid`, `FacetList`,
  `SearchBar`, `PlaylistPanel`, `SettingsPanel`
- `player/PlayerContext.tsx` — queue/currentIndex/isPlaying via React Context
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
- **Mobile detection uses `(pointer: coarse), (max-width: 700px)`**, not
  just `max-width` — a phone held in landscape is often wider than 700px,
  so width alone misses it.
- **No authentication in v1** — deliberate, since it's LAN-only. Don't wire
  up anything internet-facing without building auth first (see below).

## Done since the original plan

- ✅ Per-track 5-star ratings — persisted into the mp3's ID3v2 POPM frame
  (not just the DB), see `RatingMapper` and `PUT /api/tracks/{id}/rating`.
- ✅ Periodic background library scanning (`LibraryScanBackgroundService`,
  default every 5 min, configurable via `LibraryScanIntervalMinutes`) — also
  covers scan-on-startup, since the first tick runs immediately. Before
  this, the library only updated when something explicitly called
  `POST /api/library/scan`.

## Not built yet (future phases, roughly in the order discussed with Ryan)

1. Play count tracking (server-side) — natural extension of the rating work
   above, since POPM already has a play-count field alongside rating
2. Client-side ID3 tag editing (title/artist/album/genre write-back via
   TagLibSharp)
3. iTunes Library XML import as an alternative to the filesystem scanner
4. A system tray app wrapping the backend, with a configuration UI (GUI
   settings prompt) for things like `LibraryRootPaths` and
   `LibraryScanIntervalMinutes` instead of hand-editing `appsettings.json`.
   Not started — noted 2026-08-17 so config stays in mind as something a
   future settings UI will read/write, not just a file to hand-edit forever.
5. Authentication, then remote/internet access via a Cloudflare Tunnel + a
   purchased domain — this was explicitly deferred until the LAN-only
   experience was solid. **Do not expose this app to the internet without
   auth in front of it.**

Ryan's brother runs his own copy of this app against his own music
library — a separate local instance, not a connection to Ryan's running
server. So none of the auth/remote-access work above is a blocker for
sharing the code with him; it only matters if someone wants to reach a
*running instance* over the internet.

## Running it locally

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

## Requirements

- .NET 10 SDK
- Node.js 18+ (Vite requires it). Ryan's machine originally had Node 16
  (EOL) and got Node 24 LTS installed side-by-side via nvm-windows — nothing
  was removed, so this doesn't necessarily apply to a different machine.

## Not yet done: version control

This project isn't in git yet. Before sharing it with anyone else, it should
go into a repo (e.g. a private GitHub repo) — passing files around directly
doesn't scale past one person, and this file is most useful when it travels
with the code automatically.
