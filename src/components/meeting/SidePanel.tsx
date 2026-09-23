import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { avatarStyle, initials } from '../../lib/format';
import { displayName, micLive } from '../../lib/participants';
import { meeting, useMeeting } from '../../meeting/store';
import { Icon } from '../Brand';

function People() {
  const s = useMeeting();
  const { theme } = useApp();
  return (
    <div className="pnl-body">
      <div className="psec">In the room · {s.participants.length}</div>
      {s.participants.map(p => {
        const muted = !micLive(p);
        const name = displayName(p);
        return (
          <div className="person" key={p.identity}>
            <div className="pav" style={avatarStyle(p.identity, theme)}>{initials(name)}</div>
            <div className="pnm">{name}{p.isLocal ? ' (You)' : ''}</div>
            <div className="pstat">
              {s.handsUp.has(p.identity) && <Icon name="front_hand" className="hand" />}
              <Icon name={muted ? 'mic_off' : 'mic'} className={muted ? 'muted' : undefined} />
            </div>
          </div>
        );
      })}
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
            <div className="chat-empty">Messages are visible to everyone in the room and disappear when the meeting ends.</div>
          ) : s.chat.map(m => (
            <div className={m.mine ? 'cm mine' : 'cm'} key={m.id}>
              <div className="cmh"><span className="cmn">{m.name}{m.mine ? ' (You)' : ''}</span><span className="cmt">{m.ts}</span></div>
              <div className="cmx">{m.text}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="chat-bar">
        <div className="chat-box">
          <textarea ref={inputRef} rows={1} placeholder="Send a message" value={text}
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
