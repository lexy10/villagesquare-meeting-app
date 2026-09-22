import * as app from '../engine';

export default function Meeting() {
  return (
    <div className="screen" id="meeting">
      <div className="mt-top">
        <div className="vsmark sm"><img src="logo.png" alt="VillageSquare" /></div>
        <div className="title" id="mtTitle">Meeting</div>
        <span className="mt-live"><span className="d"></span> Live</span>
        <div className="sp"></div>
        <button className="themebtn" onClick={() => app.toggleTheme()} title="Toggle theme" aria-label="Toggle light or dark theme"><span className="material-symbols-rounded t-light">light_mode</span><span className="material-symbols-rounded t-dark">dark_mode</span></button>
        <div className="codechip"><span className="material-symbols-rounded">tag</span><span id="mtCode">—</span>
          <button onClick={() => app.copyLink()} title="Copy invite link"><span className="material-symbols-rounded">content_copy</span></button>
        </div>
      </div>

      <div className="mt-stage">
        <div className="mt-gridwrap"><div className="mt-grid" id="grid"></div></div>
        <div className="mt-panel" id="panel">
          <div className="pnl-head"><h3 id="pnlTitle">People</h3><button className="pnl-x" onClick={() => app.closePanel()}><span className="material-symbols-rounded">close</span></button></div>
          <div className="pnl-body" id="peopleBody" style={{ display: 'none' }}></div>
          <div className="pnl-body" id="chatBody" style={{ display: 'none' }}><div className="chat-msgs" id="chatMsgs"><div className="chat-empty">Messages are visible to everyone in the room and disappear when the meeting ends.</div></div></div>
          <div className="chat-bar" id="chatBar" style={{ display: 'none' }}>
            <div className="chat-box"><textarea id="chatInput" rows={1} placeholder="Send a message" onInput={e => { app.grow(e.currentTarget); app.onChatInput(); }} onKeyDown={e => app.chatKey(e)}></textarea></div>
            <button className="chat-send" id="chatSend" onClick={() => app.sendChat()} disabled><span className="material-symbols-rounded">send</span></button>
          </div>
        </div>
      </div>

      <div id="reactBar">
        <button onClick={() => app.react('👍')}>👍</button><button onClick={() => app.react('❤️')}>❤️</button>
        <button onClick={() => app.react('🎉')}>🎉</button><button onClick={() => app.react('👏')}>👏</button>
        <button onClick={() => app.react('😂')}>😂</button><button onClick={() => app.react('😮')}>😮</button>
        <button onClick={() => app.react('🔥')}>🔥</button><button onClick={() => app.react('🙌')}>🙌</button>
      </div>

      <div id="tileMenu"></div>

      <div id="leaveMenu">
        <button onClick={() => app.leaveMeeting()}><span className="material-symbols-rounded">logout</span><div className="lm-txt"><b>Leave meeting</b><span>Others stay in the room</span></div></button>
        <button className="danger" id="lmEnd" onClick={() => app.endMeeting()}><span className="material-symbols-rounded">call_end</span><div className="lm-txt"><b>End for everyone</b><span>Takes the room offline for all</span></div></button>
      </div>

      <div className="mt-dock">
        <button className="dbtn" id="dMic" onClick={() => app.toggleMic()} title="Microphone"><span className="material-symbols-rounded">mic</span></button>
        <button className="dbtn" id="dCam" onClick={() => app.toggleCam()} title="Camera"><span className="material-symbols-rounded">videocam</span></button>
        <button className="dbtn" id="dShare" onClick={() => app.toggleShare()} title="Present"><span className="material-symbols-rounded">present_to_all</span></button>
        <button className="dbtn" id="dHand" onClick={() => app.toggleHand()} title="Raise hand"><span className="material-symbols-rounded">front_hand</span></button>
        <button className="dbtn" id="dReact" onClick={() => app.toggleReact()} title="React"><span className="material-symbols-rounded">mood</span></button>
        <div className="dock-sep"></div>
        <button className="dbtn rel" id="dPeople" onClick={() => app.openPanel('people')} title="People"><span className="material-symbols-rounded">group</span><span className="cnt" id="peopleCnt">1</span></button>
        <button className="dbtn rel" id="dChat" onClick={() => app.openPanel('chat')} title="Chat"><span className="material-symbols-rounded">chat</span><span className="cnt red" id="chatCnt" style={{ display: 'none' }}>0</span></button>
        <div className="dock-sep"></div>
        <button className="dbtn leave" onClick={e => app.onLeaveClick(e)} title="Leave"><span className="material-symbols-rounded">call_end</span></button>
      </div>
    </div>
  );
}
