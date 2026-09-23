import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Track } from 'livekit-client';
import { useApp } from '../../app/AppContext';
import { GAP_DESKTOP, GAP_PHONE, isPhonePortrait, scrollLayout, solveLayout, targetAspect, type Box } from '../../lib/layout';
import { pruneMediaElements } from '../../lib/mediaElements';
import { cameraPub, micLive, micTrack, renderables, screenPub } from '../../lib/participants';
import { useMeeting } from '../../meeting/store';
import Tile, { type Aspect } from './Tile';

interface Props {
  onMore: (identity: string, name: string, isLocal: boolean, anchor: HTMLElement) => void;
}

function contentBox(el: HTMLElement): Box {
  const cs = getComputedStyle(el);
  return {
    w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

export default function VideoGrid({ onMore }: Props) {
  const s = useMeeting();
  const { theme } = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [pinAspect, setPinAspect] = useState<{ key: string; a: Aspect } | null>(null);

  // The best column count depends on the real container, so re-solve whenever
  // it changes size: window resize, rotation, or the side panel opening.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const b = contentBox(wrap);
      setBox(prev => (prev && prev.w === b.w && prev.h === b.h ? prev : b));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const all = renderables(s.participants);
  const pinIdx = s.pinned ? all.findIndex(t => t.key === s.pinned) : -1;
  const hasPin = pinIdx >= 0;
  const specs = hasPin ? [all[pinIdx], ...all.filter((_, i) => i !== pinIdx)] : all;
  const n = specs.length;

  const views = specs.map(spec => {
    const video = spec.screen ? screenPub(spec.p) : cameraPub(spec.p);
    const audio = !spec.p.isLocal && !spec.screen ? micTrack(spec.p) : null;
    return { spec, video, audio };
  });

  // Every media element not on screen after this render is released.
  const liveTracks = new Set<Track>();
  views.forEach(v => { if (v.video) liveTracks.add(v.video.track); if (v.audio) liveTracks.add(v.audio); });
  useEffect(() => { pruneMediaElements(liveTracks); });

  let gridStyle: CSSProperties = {};
  let cols = 1, rows = 1, fit = false, centred = false;
  if (hasPin) {
    gridStyle = { height: '100%', maxWidth: '100%', aspectRatio: 'auto' };
  } else if (box) {
    const gap = isPhonePortrait() ? GAP_PHONE : GAP_DESKTOP;
    // With a single tile, match the sender's real shape so nothing is cropped.
    const d = n === 1 ? views[0].video?.pub.dimensions : undefined;
    const ar = targetAspect(box, n, d?.width && d?.height ? d.width / d.height : null);
    // Landscape caps at 16:9 so desktop grids stay clean; portrait tolerates a
    // little wider so stacked rows fill the screen instead of leaving margins.
    const portrait = box.h > box.w;
    const maxAR = n <= 1 ? 0 : (portrait ? 1.9 : 16 / 9);
    let L = solveLayout(n, box, gap, ar, maxAR, 1, portrait);
    if (!L.fits) L = scrollLayout(n, box, gap, ar);
    cols = L.c; rows = L.r; fit = L.fits; centred = true;
    // Size the grid to the solved tiles so each cell is exactly tw x th; doubled
    // columns let a short last row start on a half-column and centre.
    gridStyle = {
      gap: `${gap}px`,
      gridTemplateColumns: `repeat(${cols * 2},${L.tw / 2}px)`,
      gridAutoRows: `${L.th}px`,
      width: `${L.tw * cols + gap * (cols - 1)}px`,
      height: L.fits ? `${L.th * L.r + gap * (L.r - 1)}px` : 'auto',
      maxWidth: '100%',
      aspectRatio: 'auto',
    };
  }
  const scrollMode = !hasPin && !fit;
  const pinPortrait = hasPin && pinAspect?.key === s.pinned && pinAspect.a.h > pinAspect.a.w;

  const tiles = views.map(({ spec, video, audio }, i) => {
    const isPinned = hasPin && i === 0;
    let gridColumn: string | undefined;
    if (centred) {
      const row = Math.floor(i / cols), inRow = i % cols;
      const inThisRow = row === rows - 1 ? n - (rows - 1) * cols : cols;
      gridColumn = `${(cols - inThisRow) + 1 + 2 * inRow} / span 2`;
    }
    return (
      <Tile
        key={spec.key}
        spec={spec}
        video={video}
        audio={audio}
        isLocal={spec.p.isLocal}
        isPinned={isPinned}
        isHost={s.role === 'host'}
        speaking={s.speaking.has(spec.p.identity)}
        handUp={s.handsUp.has(spec.p.identity)}
        micOn={micLive(spec.p)}
        theme={theme}
        gridColumn={gridColumn}
        onMore={onMore}
        onPinAspect={isPinned ? a => setPinAspect({ key: spec.key, a }) : undefined}
      />
    );
  });

  const gridCls = ['mt-grid'];
  if (hasPin) gridCls.push('pinned');
  if (pinPortrait) gridCls.push('pin-portrait');
  if (fit) gridCls.push('fit');
  if (scrollMode) gridCls.push('scrolling');

  return (
    <div className={scrollMode ? 'mt-gridwrap scrollmode' : 'mt-gridwrap'} ref={wrapRef}>
      <div className={gridCls.join(' ')} style={gridStyle}>
        {hasPin ? (
          <>
            {tiles[0]}
            {tiles.length > 1 && <div className="filmstrip">{tiles.slice(1)}</div>}
          </>
        ) : tiles}
      </div>
    </div>
  );
}
