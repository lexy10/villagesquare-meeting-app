# VillageSquare Meet

Instant, link-based video meetings for VillageSquare — a Google-Meet-style
browser client. A host signs in and starts a room, shares one link, and anyone
opens it and joins with just their name. Real-time video, chat, and reactions,
powered by the VillageSquare live media stack (LiveKit).

Built with **React + Vite + TypeScript**. The UI matches the original
vanilla-JS app exactly: `css/styles.css` is reused verbatim and the markup is a
1:1 replica. All meeting state lives in one store (`src/meeting/store.ts`) that
components read through `useSyncExternalStore`; React renders every screen.

## Run

```bash
# Node 22 (see .nvmrc / your version manager)
npm install
npm run dev        # dev server at http://localhost:5174
```

Camera/mic and the LiveKit connection require a secure context — `localhost`
counts, so `npm run dev` works; a deployed build must be served over HTTPS.

## Build (static SPA)

```bash
npm run build      # type-checks (tsc --noEmit) then builds to dist/
npm run preview    # serve the built dist/ locally
```

`vite build` emits a plain static site to `dist/` (an `index.html` + hashed
`assets/*` + the copied `public/` files). Deploy it as static files exactly like
the original three-file app — asset URLs are relative (`base: './'`) so it works
under any path or domain. `public/` holds `logo.png`, `favicon.png`, `og.png`
and `sounds/`, so their runtime paths are identical to before.

## Backend

Talks to the VillageSquare API at `https://production-api.villagesquare.io/v2`
(set in `src/config.ts`). Only the host authenticates; guests join by
room id + name. The API brokers LiveKit rooms/tokens; the client then connects
directly to LiveKit over WebRTC (`livekit-client` v2 from npm).

## Project layout

```
index.html             # Vite entry (fonts, OG/twitter meta, pre-paint theme
                       #   bootstrap; loads /src/main.tsx)
css/styles.css         # original stylesheet, reused VERBATIM (imported, unedited)
src/
  main.tsx             # React root; imports the stylesheets
  App.tsx              # switches between screens
  app.css              # styles added on top of styles.css (audio gate, media slot)
  config.ts            # API base URL, meeting category
  app/                 # AppContext (screen, theme, host auth, join flow), toasts
  meeting/store.ts     # MeetingStore: LiveKit room, participants, chat,
                       #   reactions, moderation, the audio fixes
  components/          # Landing, HostSignin, HostSetup, Prejoin, NotLive,
                       #   overlays; meeting/ holds the grid, tiles, dock, panels
  hooks/               # useClock, usePreview (camera preview before joining)
  lib/                 # API client, grid layout solver, media-element cache,
                       #   devices, sounds, storage, formatting
public/                # logo.png, favicon.png, og.png, sounds/*  (served at /)
```

## The four WebRTC audio fixes

Search `AUDIO FIX` in `src/meeting/store.ts`:

- **(a) Autoplay gating** — `RoomEvent.AudioPlaybackStatusChanged` tracks
  `room.canPlaybackAudio`; while it is false the "Tap to enable sound" banner
  (`AudioGate` in `components/Overlays.tsx`) shows and calls `enableAudio()`.
- **(b) Background/restore** — a `visibilitychange` listener resumes audio when
  the tab comes back (`room.startAudio()`, the reaction `AudioContext`, and a
  replay of every media element).
- **(c) Reconnect** — `RoomEvent.Reconnected` re-derives participants and
  resumes playback; `RoomEvent.Reconnecting` shows a brief toast.
- **(d) Clean teardown** — on disconnect every local track is stopped so the
  mic and camera are released for the next call (`cleanup()`).
