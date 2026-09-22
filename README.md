# VillageSquare Meet

Instant, link-based video meetings for VillageSquare — a Google-Meet-style
browser client. A host signs in and starts a room, shares one link, and anyone
opens it and joins with just their name. Real-time video, chat, and reactions,
powered by the VillageSquare live media stack (LiveKit).

This is the **React + Vite + TypeScript** port of the original vanilla-JS app.
The UI is unchanged: `css/styles.css` is reused verbatim and the markup is a
1:1 replica. The intricate imperative meeting logic (grid layout solver,
`<video>`/`<audio>` tile diffing, the iOS mic-reuse trick) is preserved in
`src/engine.ts` and driven imperatively — React only paints the initial DOM.

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
(hard-coded in `src/engine.ts`). Only the host authenticates; guests join by
room id + name. The API brokers LiveKit rooms/tokens; the client then connects
directly to LiveKit over WebRTC (`livekit-client` v2 from npm).

## Project layout

```
index.html            # Vite entry (head verbatim: fonts, OG/twitter meta,
                       #   pre-paint theme bootstrap; loads /src/main.tsx)
css/styles.css         # original stylesheet, reused VERBATIM (imported, unedited)
src/
  main.tsx             # React root; imports the stylesheet(s)
  App.tsx              # renders every screen once, calls initEngine()
  engine.ts            # ALL meeting logic (ported from legacy/app.js) + the
                       #   four audio fixes
  audio-gate.css       # the one new style: the "Tap to enable sound" affordance
  components/          # Landing, HostSignin, HostSetup, Prejoin, NotLive,
                       #   Meeting, ShareModal — exact-markup replicas
public/                # logo.png, favicon.png, og.png, sounds/*  (served at /)
legacy/                # original index.html + app.js, kept for reference
```

## The four WebRTC audio fixes

Added on top of the original — search `AUDIO FIX` in `src/engine.ts`:

- **(a) Autoplay gating** — `RoomEvent.AudioPlaybackStatusChanged` toggles a
  persistent "Tap to enable sound" banner when `!room.canPlaybackAudio`; the
  banner calls `room.startAudio()`. (`connectRoom` / `updateAudioGate` /
  `enableAudio`.)
- **(b) Background/restore** — a `visibilitychange` listener re-arms audio on
  return (`room.startAudio()`, resume the reaction `AudioContext`, re-render the
  grid). (`initEngine`.)
- **(c) Reconnect** — `RoomEvent.Reconnected` re-renders the grid (re-attaching
  every remote track) and calls `room.startAudio()`; `RoomEvent.Reconnecting`
  shows a brief toast. (`connectRoom`.)
- **(d) Clean teardown** — on disconnect, every local `mediaStreamTrack` is
  stopped so the mic/cam are released for the next call. (`cleanup`.)
