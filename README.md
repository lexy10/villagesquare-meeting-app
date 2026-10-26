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

To work on the meeting screen without a live room, open
`http://localhost:5174/?preview` (stand-in participants; `?preview=9` for more,
`&video` for fake camera feeds). In the console, `vsmPreview.message('Ada', 'hi')`
simulates an incoming chat. It only exists in the dev server, not in builds.

## Meeting PM (latecomer check-in)

The host can switch on **Latecomer check-in** when starting a meeting (start
time + grace), or from the PM chip in the meeting's top bar. Anyone whose first
join is after the cutoff gets a check-in: at the next pause in conversation the
PM (its own tile, marked AI) pauses everyone's open mic, asks why they're late,
listens until they stop talking, replies in one warm sentence and hands back to
whoever spoke last, whose mic comes back on.

- The PM is a participant the media server puts in each meeting (identity
  `__vs_meeting_pm__`). It speaks, listens and sends the data messages every
  app follows (`src/meeting/pm.ts`); the app only accepts PM messages from it.
  Its attributes say whether check-in is on and from when; the tile shows while
  check-in is on. The API decides who is late and writes and voices the lines,
  so no key is anywhere near the browser.
- Check-in settings live on the meeting (`PATCH /meetings/:uuid/settings`, with
  the host's time zone so the PM tells the time right); the host's app nudges
  the PM to re-read them. An admin can switch the PM off platform-wide, which
  takes it out of meetings and hides the controls here.
- `http://localhost:5174/?preview&pm` shows the PM's tile and acts out a
  check-in from its messages (no voice). Click **Simulate a latecomer**.
- To test the real flow against staging before a production deploy, set
  `VITE_API_BASE=https://staging-api.villagesquare.io/v2` in `.env.local`.

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
(set in `src/config.ts`; `VITE_API_BASE` overrides it). Meetings have their own
endpoints under `/v2/meetings`: the host starts one (`POST /meetings`, only for
accounts allowed to host) and shares its code (`?room=abc-defg-hij`; the old
`?room=vs-meeting` link still opens the project-management account's current
meeting); guests join by code + name (`/meetings/:code/guest-token`); moderation,
settings and ending go to `/meetings/:uuid/…`. Each meeting gets its own LiveKit
room of type "meeting" (everyone publishes, nothing is recorded), which the
client then joins directly over WebRTC (`livekit-client` v2 from npm).

## Project layout

```
index.html             # Vite entry (fonts, OG/twitter meta, pre-paint theme
                       #   bootstrap; loads /src/main.tsx)
css/styles.css         # main stylesheet; theme tokens for dark (default) and light at the top
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
  hooks/               # useClock, usePreview (camera preview before joining),
                       #   useDismiss (popovers close on outside click / Esc / mouse away)
  dev/preview.ts       # dev-only stand-in meeting (see Run; ?preview&pm for the PM)
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
