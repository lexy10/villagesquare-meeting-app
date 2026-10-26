// Backend the meeting client talks to (auth, room lifecycle, guest tokens,
// moderation). Media itself goes straight to LiveKit via the URL the API returns.
// VITE_API_BASE (e.g. in .env.local) points a local build at another API, such
// as staging, for testing before a deploy.
export const API_BASE: string = import.meta.env.VITE_API_BASE || 'https://production-api.villagesquare.io/v2';

// Tile key suffix for a participant's screen-share tile (pinning refers to it).
export const SCREEN_SUFFIX = '::screen';
