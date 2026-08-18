# Mp3Streamer — Dependency Inventory

Reference doc for a future one-click installer. This lists everything needed
to build and run the project from a clean machine, split by what an
installer would need to (a) install system-wide vs. (b) just restore from
the lockfiles already checked into the repo.

## 1. System-level prerequisites (installer would need to install these)

| Dependency | Version used | Why | Notes for an installer |
|---|---|---|---|
| **.NET SDK** | 10.0 (10.0.111 confirmed working) | Builds/runs the backend (`server/Mp3Streamer.Api`) | On Windows, the official `dotnet-install.ps1` script or the winget package `Microsoft.DotNet.SDK.10` can do a silent/unattended install. Alternative: publish the backend as a **self-contained** build (`dotnet publish -r win-x64 --self-contained`) so end users don't need the SDK or even the runtime installed at all — worth considering for the installer instead of requiring .NET on the target machine. |
| **Node.js** | 18+ required; project built/tested on Node 24 LTS (also has npm 10.9.7 bundled) | Builds the frontend (`client/mp3streamer-web`) | Only needed at **build time** — once `npm run build` produces `dist/`, Node isn't needed to *run* the app (the .NET backend serves the static files). An installer could ship a pre-built `dist/` and skip requiring Node on the end-user machine entirely. |
| **SQLite** | bundled | Backend's database engine | No separate install needed — `Microsoft.EntityFrameworkCore.Sqlite` pulls in `SQLitePCLRaw` with a native SQLite binary bundled per-platform. Nothing extra to install. |
| **Git** (optional) | — | Only needed if the installer pulls source from GitHub (`rmander4/Mp3Streamer`) rather than shipping a pre-built package | Not needed if shipping compiled output. |

## 2. Backend — NuGet packages (`server/Mp3Streamer.Api/Mp3Streamer.Api.csproj`)

Restored automatically by `dotnet restore` / `dotnet build` — an installer
just needs network access to nuget.org (or a bundled/offline NuGet cache)
the first time it builds:

- `Microsoft.AspNetCore.OpenApi` 10.0.7
- `Microsoft.EntityFrameworkCore.Design` 10.0.11 (build-time only)
- `Microsoft.EntityFrameworkCore.Sqlite` 10.0.11
- `Microsoft.OpenApi` 2.12.0
- `TagLibSharp` 2.3.0 (reads/writes MP3 ID3 tags, incl. the POPM rating frame)

Each of these pulls in its own transitive dependencies (e.g. EF Core core
libraries, `SQLitePCLRaw` native SQLite bindings) — NuGet resolves those
automatically, nothing to track by hand.

**Note from this session:** the cloud sandbox this was checked from has
`api.nuget.org` blocked at the network level (returns 403), so the backend
restore/build could only be verified conceptually here, not actually run.
Should build fine on a normal machine with normal internet access — worth
confirming on your PC to be sure. The frontend built and ran fine here
since npm's registry isn't blocked.

## 3. Frontend — npm packages (`client/mp3streamer-web/package.json`)

Restored via `npm install` (lockfile: `package-lock.json`, 27 resolved
packages total as of this check):

**Runtime dependencies:**
- `react` ^19.2.8
- `react-dom` ^19.2.8

**Build-time only (devDependencies):**
- `typescript` ~6.0.2
- `vite` ^8.2.0
- `@vitejs/plugin-react` ^6.0.4
- `oxlint` ^1.75.0 (linter)
- `@types/node`, `@types/react`, `@types/react-dom`

Verified in this session: `npm install` (2s, 0 vulnerabilities) then
`npm run build` (tsc -b && vite build) both succeeded cleanly, producing
`dist/` (~209 KB JS, ~11 KB CSS, gzip ~65 KB total).

## 4. Runtime configuration (not a "dependency" but installer-relevant)

- `appsettings.json` / `appsettings.Development.json` — `LibraryRootPaths`
  needs to point at the user's actual music folder(s). An installer should
  prompt for this (this is exactly the "system tray app with a config UI"
  idea already on the project roadmap in `CLAUDE.md`).
- `LibraryScanIntervalMinutes` — optional, defaults to 5.
- The backend creates/migrates its own SQLite DB file (`library.db`) on
  first run via EF Core migrations — no manual DB setup step needed.

## 5. Summary for a future installer

The leanest version of an installer would probably:
1. Ship a **pre-built** frontend (`dist/`) and a **self-contained** backend
   publish (`dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true`)
   so end users need **zero** prerequisites (no .NET, no Node) — just run
   an .exe.
2. Prompt for the music library path(s) on first run and write them into
   `appsettings.json` (or a small settings UI, per the existing roadmap
   item).
3. Optionally register it as a Windows service / tray app so it starts on
   login, rather than requiring a manual `dotnet run` each time.

This is a roadmap item, not built yet — captured here so the eventual
installer work has a ready reference instead of re-deriving it.
