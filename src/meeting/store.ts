import { useSyncExternalStore } from 'react';
import {
  ConnectionState, Room, RoomEvent, Track,
  type LocalTrack, type Participant,
} from 'livekit-client';
import { SCREEN_SUFFIX } from '../config';
import { api } from '../lib/api';
import { canShareScreen, deviceError } from '../lib/devices';
import { clock } from '../lib/format';
import { releaseAllMediaElements, replayMediaElements } from '../lib/mediaElements';
import { displayName, screenPubAny } from '../lib/participants';
import { chime, clap, reactionSound, resumeAudioContext, talkingDrum, warmReactionSamples } from '../lib/sounds';
import { forgetHostMeeting } from '../lib/storage';
import { toast } from '../app/toast';

export type Role = 'host' | 'guest';
export type Panel = 'people' | 'chat';
export interface ChatMsg { id: number; name: string; text: string; ts: string; mine: boolean; pollId?: string }
export interface FloatingReaction { id: number; emoji: string; name: string; left: number }

export type StatusId = 'brb' | 'listening' | 'noisy';
export const STATUSES: Record<StatusId, { emoji: string; label: string }> = {
  brb: { emoji: '☕', label: 'BRB' },
  listening: { emoji: '🎧', label: 'Listening' },
  noisy: { emoji: '🔇', label: 'Noisy room' },
};
const isStatus = (s: unknown): s is StatusId => typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATUSES, s);

export type Vote = 'up' | 'down';
export interface Poll { id: string; q: string; by: string; mine: boolean; votes: ReadonlyMap<string, Vote> }
const isVote = (v: unknown): v is Vote => v === 'up' || v === 'down';

const CLAP = '\u{1F44F}', PARTY = '\u{1F389}';

export interface MeetingSnapshot {
  status: 'idle' | 'connecting' | 'connected';
  room: Room | null;
  /** Local participant first, then everyone else. Re-derived on every room event. */
  participants: Participant[];
  role: Role;
  roomId: string;
  title: string;
  shareUrl: string;
  livestreamUuid: string;
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  handRaised: boolean;
  /** Tile key spotlighted for everyone ('' = none). */
  pinned: string;
  /** Raised hands: identity → when it went up (sender's clock), which orders the queue. */
  handsUp: ReadonlyMap<string, number>;
  statuses: ReadonlyMap<string, StatusId>;
  speaking: ReadonlySet<string>;
  chat: ChatMsg[];
  polls: Readonly<Record<string, Poll>>;
  unread: number;
  panel: Panel | null;
  reactions: FloatingReaction[];
  /** Bumped on every 🎉 so the confetti overlay knows to fire. */
  confetti: number;
  /** False while the browser's autoplay policy is blocking remote audio. */
  canPlaybackAudio: boolean;
}

export interface ConnectOptions {
  token: string;
  livekitUrl: string;
  title: string;
  /** Tracks already granted in the pre-join preview; handed straight to LiveKit. */
  seed: MediaStream | null;
  role: Role;
  roomId: string;
  livestreamUuid?: string;
  micOn: boolean;
  camOn: boolean;
  /** Host bearer token for moderation / end calls. */
  authToken?: string;
}

interface Handlers { onEnded: () => void }

// `sync` marks state re-sent to someone who just joined: apply it quietly.
type DataMsg =
  | { t: 'chat'; text: string; name?: string }
  | { t: 'reaction'; emoji: string; name?: string }
  | { t: 'pin'; identity?: string }
  | { t: 'hand'; raised: boolean; name?: string; at?: number; sync?: boolean }
  | { t: 'status'; status: StatusId | '' }
  | { t: 'poll'; id: string; q: string; name?: string; votes?: Record<string, Vote> }
  | { t: 'vote'; id: string; v: Vote | null }
  | { t: 'photo'; name?: string };

const shareUrlFor = (roomId: string) => `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;

/** 1-based place in the raised-hand queue (first up = 1), or 0 when the hand is down. */
export function handPosition(handsUp: ReadonlyMap<string, number>, identity: string): number {
  const at = handsUp.get(identity);
  if (at === undefined) return 0;
  let n = 1;
  handsUp.forEach((t, id) => { if (t < at || (t === at && id < identity)) n++; });
  return n;
}

function idleSnapshot(): MeetingSnapshot {
  return {
    status: 'idle', room: null, participants: [], role: 'guest', roomId: '', title: '', shareUrl: '',
    livestreamUuid: '', micOn: true, camOn: true, sharing: false, handRaised: false, pinned: '',
    handsUp: new Map(), statuses: new Map(), speaking: new Set(), chat: [], polls: {}, unread: 0, panel: null,
    reactions: [], confetti: 0, canPlaybackAudio: true,
  };
}

class MeetingStore {
  private snap: MeetingSnapshot = idleSnapshot();
  private listeners = new Set<() => void>();
  private handlers: Handlers = { onEnded: () => {} };
  private room: Room | null = null;
  private authToken = '';
  private knownShares = new Set<string>();
  private micBusy = false;
  private camBusy = false;
  private applyingLocalMedia = false;
  private seq = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  setHandlers(h: Handlers) { this.handlers = h; }

  private replace(next: MeetingSnapshot) { this.snap = next; this.listeners.forEach(l => l()); }
  private set(patch: Partial<MeetingSnapshot>) { this.replace({ ...this.snap, ...patch }); }
  private parts(): Participant[] {
    const r = this.room;
    return r ? [r.localParticipant, ...r.remoteParticipants.values()] : [];
  }

  // ---------- connect ----------
  connect = async (o: ConnectOptions) => {
    if (this.room) throw new Error('Already in a meeting');
    // livekit-client 2.22 defaults to single-PC and tries /rtc/v1 first, which our
    // 1.9.x server lacks (failed socket + 404 on every join). Revisit on upgrade.
    const room = new Room({ adaptiveStream: true, dynacast: true, singlePeerConnection: false });
    this.room = room;
    this.authToken = o.authToken || '';
    this.knownShares.clear();
    this.replace({
      ...idleSnapshot(), status: 'connecting', room, role: o.role, roomId: o.roomId, title: o.title || 'Meeting',
      shareUrl: shareUrlFor(o.roomId), livestreamUuid: o.livestreamUuid || '', micOn: o.micOn, camOn: o.camOn,
    });
    this.wire(room);
    try {
      await room.connect(o.livekitUrl.trim(), o.token);
    } catch (e) {
      room.removeAllListeners();
      this.room = null;
      this.replace(idleSnapshot());
      throw e;
    }
    await this.publishLocalMedia(o.seed, o.micOn, o.camOn);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.set({ status: 'connected', participants: this.parts(), canPlaybackAudio: room.canPlaybackAudio });
    warmReactionSamples();
    toast('You joined the meeting');
  };

  private wire(room: Room) {
    const on = (ev: RoomEvent, fn: (...a: any[]) => void) => room.on(ev as any, fn);

    const refresh = () => {
      const pinned = this.syncPresentations();
      this.set({ participants: this.parts(), pinned, sharing: room.localParticipant.isScreenShareEnabled });
    };
    [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
    ].forEach(ev => on(ev, refresh));

    // Mirror server-side (host) mutes into our own control state.
    [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished]
      .forEach(ev => on(ev, (_pub: unknown, p?: Participant) => {
        if (!p || p === room.localParticipant) void this.syncLocalMediaState();
      }));

    on(RoomEvent.ParticipantConnected, (p: Participant) => {
      chime('join');
      toast(`${displayName(p)} joined`);
      // Someone arriving after a pin was set would otherwise see no spotlight.
      if (this.snap.role === 'host' && this.snap.pinned) {
        setTimeout(() => this.publish({ t: 'pin', identity: this.snap.pinned }), 600);
      }
      setTimeout(() => this.catchUp(p.identity), 600);
    });
    on(RoomEvent.ParticipantDisconnected, (p: Participant) => {
      chime('leave');
      const handsUp = new Map(this.snap.handsUp); handsUp.delete(p.identity);
      const statuses = new Map(this.snap.statuses); statuses.delete(p.identity);
      const speaking = new Set(this.snap.speaking); speaking.delete(p.identity);
      let pinned = this.snap.pinned;
      // Drop the spotlight if the pinned person is the one who left.
      if (pinned === p.identity || pinned === p.identity + SCREEN_SUFFIX) {
        pinned = '';
        if (this.snap.role === 'host') this.publish({ t: 'pin', identity: '' });
      }
      this.knownShares.delete(p.identity);
      this.set({ handsUp, statuses, speaking, pinned });
      toast(`${displayName(p)} left`);
    });
    on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      this.set({ speaking: new Set(speakers.map(s => s.identity)) });
    });
    on(RoomEvent.DataReceived, (payload: Uint8Array, p?: Participant) => {
      try { this.handleData(JSON.parse(new TextDecoder().decode(payload)), p); } catch { /* not ours */ }
    });
    on(RoomEvent.Disconnected, () => this.cleanup());

    // AUDIO FIX (a): the browser's autoplay policy can block remote audio (common
    // on first join without a gesture, and again after backgrounding). LiveKit
    // reports it here; the AudioGate button calls enableAudio() to unblock.
    on(RoomEvent.AudioPlaybackStatusChanged, () => this.set({ canPlaybackAudio: room.canPlaybackAudio }));

    // AUDIO FIX (c): after a network glitch LiveKit reconnects (ICE restart or
    // full resume). Re-derive the tracks and resume playback, or the audio
    // elements can stay paused on the old session.
    on(RoomEvent.Reconnecting, () => toast('Reconnecting…'));
    on(RoomEvent.Reconnected, () => {
      this.set({ participants: this.parts() });
      this.resumePlayback();
    });
  }

  // AUDIO FIX (b): Chrome suspends audio when the tab is backgrounded (minimise,
  // switch app on mobile). Resume everything when it comes back.
  private onVisibility = () => {
    const room = this.room;
    if (document.visibilityState === 'visible' && room && room.state === ConnectionState.Connected) {
      this.resumePlayback();
    }
  };

  private resumePlayback() {
    const room = this.room;
    if (!room) return;
    resumeAudioContext();
    room.startAudio()
      .catch(() => { /* still blocked — the audio gate stays up */ })
      .finally(() => {
        replayMediaElements();
        if (this.room === room) this.set({ canPlaybackAudio: room.canPlaybackAudio });
      });
  }

  /** Audio-gate click: runs inside the user gesture the browser requires. */
  enableAudio = async () => {
    const room = this.room;
    if (!room) return;
    try { await room.startAudio(); } catch (e) { console.warn('startAudio failed', e); }
    resumeAudioContext();
    replayMediaElements();
    this.set({ canPlaybackAudio: room.canPlaybackAudio });
  };

  // Publish local audio/video, preferring tracks already captured in pre-join.
  //
  // iOS (every iOS browser is WebKit) will not re-prompt for the microphone once
  // a granted audio track has been released — a second getUserMedia for audio
  // rejects with NotAllowedError. Handing LiveKit the live pre-join tracks, rather
  // than stopping them and capturing again, is what keeps the mic working, and
  // later dock toggles only mute/unmute that publication.
  private async publishLocalMedia(seed: MediaStream | null, wantMic: boolean, wantCam: boolean) {
    const room = this.room;
    if (!room) return;
    const lp = room.localParticipant;
    // Publishing fires LocalTrackPublished → syncLocalMediaState, which would read
    // a fresh (unmuted) publication and overwrite the chosen state. Hold it off.
    this.applyingLocalMedia = true;
    try {
      const at = seed?.getAudioTracks()[0];
      let vt = seed?.getVideoTracks()[0];
      // Camera chosen off: release it instead of publishing a disabled track,
      // which would keep the device light on.
      if (vt && !wantCam) { try { vt.stop(); } catch { /* ignore */ } vt = undefined; }
      if (at || vt) {
        try {
          // Publish the mic already in the chosen state, never enabled first.
          if (at) at.enabled = wantMic;
          if (vt) vt.enabled = true;
          if (at) await lp.publishTrack(at, { source: Track.Source.Microphone });
          if (vt) await lp.publishTrack(vt, { source: Track.Source.Camera });
          // Mirror into LiveKit's own mute flags: remote tiles read these, and an
          // unmute later works without re-prompting for the device.
          if (at) await lp.setMicrophoneEnabled(wantMic).catch(() => {});
          if (vt) await lp.setCameraEnabled(true).catch(() => {});
          return;
        } catch (e) {
          console.warn('reusing pre-join tracks failed, capturing fresh', e);
          try { seed?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
        }
      }
      await lp.setCameraEnabled(wantCam).catch(() => {});
      await lp.setMicrophoneEnabled(wantMic).catch(() => {});
    } finally {
      this.applyingLocalMedia = false;
      this.set({ micOn: wantMic, camOn: wantCam, participants: this.parts() });
    }
  }

  // ---------- data channel ----------
  private publish(o: DataMsg, to?: string[]) {
    const room = this.room;
    if (!room) return;
    room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(o)), { reliable: true, destinationIdentities: to })
      .catch(e => console.warn('publishData failed', e));
  }

  // Hands, statuses and polls live only in data messages, so someone joining
  // mid-meeting hears about them from each owner directly.
  private catchUp(identity: string) {
    const room = this.room;
    if (!room || !room.remoteParticipants.has(identity)) return;
    const me = room.localParticipant, to = [identity];
    const at = this.snap.handsUp.get(me.identity);
    if (at) this.publish({ t: 'hand', raised: true, name: me.name, at, sync: true }, to);
    const status = this.snap.statuses.get(me.identity);
    if (status) this.publish({ t: 'status', status }, to);
    Object.values(this.snap.polls).filter(p => p.mine)
      .forEach(p => this.publish({ t: 'poll', id: p.id, q: p.q, name: p.by, votes: Object.fromEntries(p.votes) }, to));
  }

  private handleData(d: DataMsg, p?: Participant) {
    const who = p ? displayName(p) : 'Someone';
    if (d.t === 'chat') this.addChat(d.name || who, d.text, false);
    else if (d.t === 'reaction') this.floatEmoji(d.emoji, d.name || who, p?.identity || who);
    else if (d.t === 'pin') this.set({ pinned: d.identity || '' });
    else if (d.t === 'photo') toast(`📸 ${d.name || who} took a group photo`);
    else if (!p) return;
    else if (d.t === 'hand') {
      const handsUp = new Map(this.snap.handsUp);
      if (d.raised) handsUp.set(p.identity, typeof d.at === 'number' ? d.at : Date.now()); else handsUp.delete(p.identity);
      this.set({ handsUp });
      if (d.raised && !d.sync) {
        talkingDrum();
        toast(`${d.name || who} raised their hand ✋`);
      }
    }
    else if (d.t === 'status') this.setStatusOf(p.identity, d.status);
    else if (d.t === 'poll') this.receivePoll(d, p);
    else if (d.t === 'vote') this.applyVote(d.id, p.identity, isVote(d.v) ? d.v : null);
  }

  private addChat(name: string, text: string, mine: boolean, pollId?: string) {
    const chat = [...this.snap.chat, { id: ++this.seq, name, text, ts: clock(), mine, pollId }];
    this.set({ chat, unread: this.snap.panel === 'chat' ? 0 : this.snap.unread + 1 });
  }

  private floatEmoji(emoji: string, name: string, from: string) {
    if (emoji === CLAP) clap(from); else reactionSound(emoji);
    const r = { id: ++this.seq, emoji, name, left: 28 + Math.random() * 44 };
    this.set({ reactions: [...this.snap.reactions, r], confetti: this.snap.confetti + (emoji === PARTY ? 1 : 0) });
    setTimeout(() => this.set({ reactions: this.snap.reactions.filter(x => x.id !== r.id) }), 3200);
  }

  private setStatusOf(identity: string, status: unknown) {
    const statuses = new Map(this.snap.statuses);
    if (isStatus(status)) statuses.set(identity, status); else statuses.delete(identity);
    this.set({ statuses });
  }

  // ---------- polls ----------
  private startPoll(q: string) {
    const room = this.room;
    if (!room) return;
    if (!q) { toast('Add a question, like /poll Ship on Friday?', 3600); return; }
    const me = room.localParticipant, name = me.name || 'You';
    // Prefixed with the creator's identity so nobody else can claim or reset it.
    const id = `${me.identity}:${Date.now().toString(36)}`;
    this.set({ polls: { ...this.snap.polls, [id]: { id, q, by: name, mine: true, votes: new Map() } } });
    this.addChat(name, q, true, id);
    this.publish({ t: 'poll', id, q, name });
  }

  private receivePoll(d: { id: string; q: string; name?: string; votes?: Record<string, Vote> }, p: Participant) {
    if (typeof d.id !== 'string' || typeof d.q !== 'string' || !d.id.startsWith(`${p.identity}:`)) return;
    const votes = new Map<string, Vote>();
    Object.entries(d.votes || {}).forEach(([id, v]) => { if (isVote(v)) votes.set(id, v); });
    const existing = this.snap.polls[d.id];
    if (existing) {
      existing.votes.forEach((v, id) => votes.set(id, v));
      this.set({ polls: { ...this.snap.polls, [d.id]: { ...existing, votes } } });
      return;
    }
    const by = d.name || displayName(p);
    this.set({ polls: { ...this.snap.polls, [d.id]: { id: d.id, q: d.q.slice(0, 300), by, mine: false, votes } } });
    this.addChat(by, d.q.slice(0, 300), false, d.id);
    if (!d.votes && this.snap.panel !== 'chat') toast(`${by} started a poll 📊`);
  }

  private applyVote(id: string, identity: string, v: Vote | null) {
    const poll = this.snap.polls[id];
    if (!poll) return;
    const votes = new Map(poll.votes);
    if (v) votes.set(identity, v); else votes.delete(identity);
    this.set({ polls: { ...this.snap.polls, [id]: { ...poll, votes } } });
  }

  /** Tapping your current choice again takes the vote back. */
  vote = (id: string, v: Vote) => {
    const room = this.room, poll = this.snap.polls[id];
    if (!room || !poll) return;
    const next = poll.votes.get(room.localParticipant.identity) === v ? null : v;
    this.applyVote(id, room.localParticipant.identity, next);
    this.publish({ t: 'vote', id, v: next });
  };

  // Presentations take the spotlight for everyone, then hand it back when they
  // end. Each client detects this from its own view of the room, so it works
  // for guests too and needs no host action or data message.
  private syncPresentations(): string {
    let pinned = this.snap.pinned;
    const room = this.room;
    if (!room) return pinned;
    const parts = this.parts();
    const live = new Set<string>();
    parts.forEach(p => { if (screenPubAny(p)) live.add(p.identity); });
    live.forEach(id => {
      if (this.knownShares.has(id)) return;
      this.knownShares.add(id);
      const p = parts.find(x => x.identity === id);
      const mine = p === room.localParticipant;
      pinned = id + SCREEN_SUFFIX;
      toast(mine ? 'You are presenting to everyone' : `${p ? displayName(p) : 'Someone'} is presenting`, 3600);
      if (!mine) chime('join');
    });
    this.knownShares.forEach(id => {
      if (live.has(id)) return;
      this.knownShares.delete(id);
      // Release the spotlight only if it was still on that presentation.
      if (pinned === id + SCREEN_SUFFIX) pinned = '';
    });
    return pinned;
  }

  // ---------- dock controls ----------
  // Toggles hit getUserMedia when switching ON, which can reject (denied prompt,
  // device busy). The flag only sticks if the device call succeeded, and `busy`
  // blocks re-entry so a double-tap during the prompt can't cancel itself out.
  toggleMic = async () => {
    const room = this.room;
    if (!room || this.micBusy) return;
    this.micBusy = true;
    const next = !this.snap.micOn;
    let micOn = this.snap.micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      micOn = next;
    } catch (e) {
      console.warn('mic toggle failed', e);
      toast(deviceError(e, 'Microphone', next), 4000);
    } finally {
      this.micBusy = false;
      this.set({ micOn, participants: this.parts() });
    }
  };

  // Turning the camera off releases the device outright rather than muting the
  // track, so the browser's camera indicator really goes dark. (The mic is only
  // ever muted: re-acquiring audio is what iOS refuses to re-prompt for.)
  private async releaseCamera() {
    const room = this.room;
    if (!room) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (pub?.track) await room.localParticipant.unpublishTrack(pub.track as LocalTrack, true);
    else await room.localParticipant.setCameraEnabled(false);
  }

  toggleCam = async () => {
    const room = this.room;
    if (!room || this.camBusy) return;
    this.camBusy = true;
    const next = !this.snap.camOn;
    let camOn = this.snap.camOn;
    try {
      if (next) await room.localParticipant.setCameraEnabled(true);
      else await this.releaseCamera();
      camOn = next;
    } catch (e) {
      console.warn('cam toggle failed', e);
      toast(deviceError(e, 'Camera', next), 4000);
    } finally {
      this.camBusy = false;
      this.set({ camOn, participants: this.parts() });
    }
  };

  // Keep the dock honest about what the tracks are actually doing — otherwise a
  // host force-mute left the button reading "on" and the next tap muted an
  // already-muted mic.
  private async syncLocalMediaState() {
    const room = this.room;
    if (!room || this.applyingLocalMedia) return;
    const lp = room.localParticipant;
    const mic = lp.getTrackPublication(Track.Source.Microphone);
    const cam = lp.getTrackPublication(Track.Source.Camera);
    const nextMic = !!(mic?.track && !mic.isMuted);
    const nextCam = !!(cam?.track && !cam.isMuted);
    const { micOn, camOn } = this.snap;
    if (nextMic === micOn && nextCam === camOn) return;
    // Camera paused from outside: drop the capture too, so "paused" frees it.
    if (!nextCam && camOn && !this.camBusy && cam?.track && cam.isMuted) {
      try { await this.releaseCamera(); } catch (e) { console.warn('release on remote pause failed', e); }
    }
    if (!nextMic && micOn && !this.micBusy) toast('You were muted by the host', 3200);
    if (!nextCam && camOn && !this.camBusy) toast('Your video was paused by the host', 3200);
    this.set({ micOn: nextMic, camOn: nextCam, participants: this.parts() });
  }

  toggleShare = async () => {
    const room = this.room;
    if (!room) return;
    if (!canShareScreen()) {
      toast('Screen sharing needs a desktop browser — mobile browsers can’t capture the screen', 5000);
      return;
    }
    const next = !this.snap.sharing;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
    } catch (e) {
      // Picker dismissed is the common case and isn't worth alarming over.
      const name = (e as { name?: string } | null)?.name || '';
      if (name === 'NotAllowedError') toast('Screen share cancelled');
      else {
        console.warn('screen share failed', e);
        toast(`Could not start screen share — ${(e as Error)?.message || 'unknown error'}`, 4500);
      }
    } finally {
      // Source of truth is the publication, which also catches the browser's own
      // "Stop sharing" bar ending the share without going through this button.
      this.set({ sharing: room.localParticipant.isScreenShareEnabled, participants: this.parts() });
    }
  };

  toggleHand = () => {
    const room = this.room;
    if (!room) return;
    const handRaised = !this.snap.handRaised;
    const me = room.localParticipant, at = Date.now();
    const handsUp = new Map(this.snap.handsUp);
    if (handRaised) handsUp.set(me.identity, at); else handsUp.delete(me.identity);
    this.publish({ t: 'hand', raised: handRaised, name: me.name, at });
    this.set({ handRaised, handsUp });
    if (handRaised) talkingDrum();
    toast(handRaised ? 'You raised your hand ✋' : 'Hand lowered');
  };

  react = (emoji: string) => {
    const lp = this.room?.localParticipant;
    const me = lp?.name || 'You';
    this.floatEmoji(emoji, me, lp?.identity || me);
    this.publish({ t: 'reaction', emoji, name: me });
  };

  setStatus = (status: StatusId | '') => {
    const room = this.room;
    if (!room) return;
    this.setStatusOf(room.localParticipant.identity, status);
    this.publish({ t: 'status', status });
  };

  /** Everyone hears when a photo is taken, so nobody is snapped unknowingly. */
  announcePhoto = () => { this.publish({ t: 'photo', name: this.room?.localParticipant.name }); };

  sendChat = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const poll = /^\/poll(?:\s+([\s\S]*))?$/i.exec(t);
    if (poll) { this.startPoll((poll[1] || '').trim()); return; }
    const name = this.room?.localParticipant.name || 'You';
    this.addChat(name, t, true);
    this.publish({ t: 'chat', text: t, name });
  };

  openPanel = (panel: Panel) => this.set({ panel, unread: panel === 'chat' ? 0 : this.snap.unread });
  closePanel = () => this.set({ panel: null });

  // ---------- host moderation ----------
  // Pinning is a shared spotlight: the host's choice is broadcast so every
  // client renders the same layout.
  setPin = (key: string) => {
    const pinned = this.snap.pinned === key ? '' : key;
    this.publish({ t: 'pin', identity: pinned });
    this.set({ pinned });
    toast(pinned ? 'Pinned for everyone' : 'Unpinned');
  };

  // Mute / stop-video / remove go through the API so LiveKit enforces them
  // server-side; a client that ignores the request is still muted or removed.
  moderate = async (identity: string, action: 'mute' | 'stop_video' | 'remove', label: string) => {
    try {
      await api.moderate(this.snap.roomId, identity, action, this.authToken);
      toast(label);
    } catch (e) {
      toast(`Could not ${action.replace('_', ' ')}: ${(e as Error).message}`, 4000);
    }
  };

  // ---------- leave / end ----------
  leave = () => { void this.room?.disconnect(); };

  end = async () => {
    try {
      await api.end(this.snap.livestreamUuid, this.authToken);
      forgetHostMeeting();
      toast('Meeting ended for everyone');
      void this.room?.disconnect();
    } catch (e) {
      // Leave the host in the room so they can retry; it is still live.
      toast(`Could not end meeting: ${(e as Error).message}`, 4500);
    }
  };

  private cleanup() {
    const room = this.room;
    if (!room) return;
    const wasConnected = this.snap.status === 'connected';
    // AUDIO FIX (d): explicitly stop every local track so the mic and camera are
    // really released — otherwise the next meeting in this tab could not
    // re-acquire the microphone.
    room.localParticipant.trackPublications.forEach(pub => {
      try { pub.track?.mediaStreamTrack?.stop(); } catch { /* ignore */ }
      try { pub.track?.stop(); } catch { /* ignore */ }
    });
    room.removeAllListeners();
    document.removeEventListener('visibilitychange', this.onVisibility);
    releaseAllMediaElements();
    this.room = null;
    this.authToken = '';
    this.knownShares.clear();
    this.micBusy = false;
    this.camBusy = false;
    this.replace(idleSnapshot());
    if (wasConnected) this.handlers.onEnded();
  }
}

export const meeting = new MeetingStore();

export function useMeeting(): MeetingSnapshot {
  return useSyncExternalStore(meeting.subscribe, meeting.getSnapshot);
}
