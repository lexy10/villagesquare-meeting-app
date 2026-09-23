// Backend the meeting client talks to (auth, room lifecycle, guest tokens,
// moderation). Media itself goes straight to LiveKit via the URL the API returns.
export const API_BASE = 'https://production-api.villagesquare.io/v2';

// Livestream category the meeting rooms are created under.
export const MEETING_CATEGORY_ID = '1';

// Tile key suffix for a participant's screen-share tile (pinning refers to it).
export const SCREEN_SUFFIX = '::screen';
