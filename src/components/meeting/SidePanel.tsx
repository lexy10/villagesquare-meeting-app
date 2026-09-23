import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { avatarStyle, initials } from '../../lib/format';
import { displayName, micLive } from '../../lib/participants';
import { handPosition, meeting, STATUSES, useMeeting, type Poll, type Vote } from '../../meeting/store';
import { Icon } from '../Brand';

function People() {
  const s = useMeeting();
  const { theme } = useApp();
  return (
    <div className="pnl-body">
      <div className="psec">In the room · {s.participants.length}</div>
      {/* Raised hands float to the top in the order they went up. */}
      {s.participants
        .map(p => ({ p, pos: handPosition(s.handsUp, p.identity) }))
        .sort((a, b) => (a.pos || 1e9) - (b.pos || 1e9))
        .map(({ p, pos }) => {
          const muted = !micLive(p);
          const name = displayName(p);
          const status = s.statuses.get(p.identity);
          return (
            <div className="person" key={p.identity}>
              <div className="pav" style={avatarStyle(p.identity, theme)}>{initials(name)}</div>
              <div className="pnm">{name}{p.isLocal ? ' (You)' : ''}</div>
              <div className="pstat">
                {status && <span className="pst-emoji" title={STATUSES[status].label}>{STATUSES[status].emoji}</span>}
                {pos > 0 && <span className="phand"><Icon name="front_hand" className="hand" /><b>{pos}</b></span>}
                <Icon name={muted ? 'mic_off' : 'mic'} className={muted ? 'muted' : undefined} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function PollCard({ poll, me }: { poll: Poll; me: string }) {
  let up = 0, down = 0;
  poll.votes.forEach(v => { if (v === 'up') up++; else down++; });
  const total = up + down;
  const mine = poll.votes.get(me);
  const opt = (v: Vote, emoji: string, n: number) => (
    <button className={mine === v ? 'poll-opt voted' : 'poll-opt'} onClick={() => meeting.vote(poll.id, v)}>
      <span className="po-bar" style={{ width: total ? `${(n / total) * 100}%` : 0 }}></span>
      <span className="po-emoji">{emoji}</span><span className="po-n">{n}</span>
    </button>
  );
  return (
    <div className="poll">
      <div className="poll-q"><Icon name="ballot" />{poll.q}</div>
      <div className="poll-opts">{opt('up', '👍', up)}{opt('down', '👎', down)}</div>
      <div className="poll-foot">{total === 0 ? 'No votes yet' : `${total} vote${total === 1 ? '' : 's'}`}{mine ? ' · tap again to undo' : ''}</div>
    </div>
  );
}

function Chat() {
  const s = useMeeting();
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(t); }, []);

  // Keep the newest message in view.
  useEffect(() => {
    [bodyRef.current, msgsRef.current].forEach(el => { if (el) el.scrollTop = el.scrollHeight; });
  }, [s.chat.length]);

  // Grow with the text, up to the stylesheet's max height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 90)}px`;
  }, [text]);

  const send = () => {
    if (!text.trim()) return;
    meeting.sendChat(text);
    setText('');
  };

  return (
    <>
      <div className="pnl-body" ref={bodyRef}>
        <div className="chat-msgs" ref={msgsRef}>
          {s.chat.length === 0 ? (
            <div className="chat-empty">Messages are visible to everyone in the room and disappear when the meeting ends.<br />Start a quick vote with <b>/poll</b> and a question.</div>
          ) : s.chat.map(m => (
            <div className={m.mine ? 'cm mine' : 'cm'} key={m.id}>
              <div className="cmh"><span className="cmn">{m.name}{m.mine ? ' (You)' : ''}</span><span className="cmt">{m.ts}</span></div>
              {m.pollId && s.polls[m.pollId]
                ? <PollCard poll={s.polls[m.pollId]} me={s.room?.localParticipant.identity || ''} />
                : <div className="cmx">{m.text}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="chat-bar">
        <div className="chat-box">
          <textarea ref={inputRef} rows={1} placeholder="Send a message, or /poll a question" value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        </div>
        <button className="chat-send" onClick={send} disabled={!text.trim()}><Icon name="send" /></button>
      </div>
    </>
  );
}

export default function SidePanel() {
  const s = useMeeting();
  return (
    <div className={s.panel ? 'mt-panel open' : 'mt-panel'}>
      <div className="pnl-head">
        <h3>{s.panel === 'chat' ? 'In-call messages' : 'People'}</h3>
        <button className="pnl-x" onClick={meeting.closePanel}><Icon name="close" /></button>
      </div>
      {s.panel === 'people' && <People />}
      {s.panel === 'chat' && <Chat />}
    </div>
  );
}
