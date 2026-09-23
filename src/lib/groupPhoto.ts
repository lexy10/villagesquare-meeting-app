// Group photo: redraws the meeting grid onto a canvas and exports a PNG. Drawn
// from the live <video> elements rather than a DOM screenshot; WebRTC frames
// aren't cross-origin, so the canvas stays exportable.

const PAD = 16, FOOTER = 40;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawVideo(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, x: number, y: number, w: number, h: number) {
  const cs = getComputedStyle(video);
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = cs.objectFit === 'contain' ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
  const dw = vw * s, dh = vh * s;
  ctx.save();
  // Your own camera is shown mirrored; keep the photo matching what you saw.
  if (/matrix\(-1/.test(cs.transform)) { ctx.translate(2 * x + w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawAvatar(ctx: CanvasRenderingContext2D, tav: HTMLElement, ox: number, oy: number) {
  const r = tav.getBoundingClientRect(), cs = getComputedStyle(tav);
  const cx = r.left - ox + r.width / 2, cy = r.top - oy + r.height / 2;
  const bg = cs.backgroundColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r.width / 2, 0, Math.PI * 2);
  ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#1560d8';
  ctx.fill();
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tav.textContent || '', cx, cy + 1);
}

function drawLabel(ctx: CanvasRenderingContext2D, label: HTMLElement, ox: number, oy: number) {
  const nm = label.querySelector<HTMLElement>('.nm');
  if (!nm) return;
  const r = label.getBoundingClientRect(), n = nm.getBoundingClientRect(), cs = getComputedStyle(nm);
  ctx.save();
  roundRect(ctx, r.left - ox, r.top - oy, r.width, r.height, 10);
  ctx.fillStyle = 'rgba(6,14,28,.62)';
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(nm.textContent || '', n.left - ox, n.top - oy + n.height / 2);
  ctx.restore();
}

export async function captureGrid(grid: HTMLElement, title: string): Promise<Blob> {
  const g = grid.getBoundingClientRect();
  const W = g.width + PAD * 2, H = g.height + PAD * 2 + FOOTER;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.scale(scale, scale);

  const root = getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  ctx.fillStyle = cssVar('--bg', '#202124');
  ctx.fillRect(0, 0, W, H);

  // Page coordinates → canvas coordinates.
  const ox = g.left - PAD, oy = g.top - PAD;
  grid.querySelectorAll<HTMLElement>('.tile').forEach(tile => {
    const r = tile.getBoundingClientRect();
    // Skip tiles scrolled out of the filmstrip's view.
    if (r.width < 2 || r.right <= g.left || r.left >= g.right || r.bottom <= g.top || r.top >= g.bottom) return;
    const x = r.left - ox, y = r.top - oy;
    ctx.save();
    roundRect(ctx, x, y, r.width, r.height, parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 16);
    ctx.clip();
    ctx.fillStyle = cssVar('--surface-2', '#35363a');
    ctx.fillRect(x, y, r.width, r.height);
    const video = tile.querySelector('video');
    const tav = tile.querySelector<HTMLElement>('.tav');
    if (video && video.videoWidth && video.readyState >= 2) drawVideo(ctx, video, x, y, r.width, r.height);
    else if (tav && tav.style.display !== 'none') drawAvatar(ctx, tav, ox, oy);
    const label = tile.querySelector<HTMLElement>('.tname');
    if (label) drawLabel(ctx, label, ox, oy);
    ctx.restore();
  });

  const fy = H - FOOTER / 2 - 2;
  ctx.textBaseline = 'middle';
  ctx.font = `700 15px 'Plus Jakarta Sans', sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = cssVar('--ink-c', '#e8eaed');
  ctx.fillText('villagesquare', PAD, fy);
  const brandW = ctx.measureText('villagesquare ').width;
  ctx.fillStyle = '#00d4ff';
  ctx.fillText('meet', PAD + brandW, fy);
  ctx.font = `500 13px Inter, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = cssVar('--muted-c', '#9aa0a6');
  const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  ctx.fillText(title ? `${title} · ${when}` : when, W - PAD, fy);

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));
}

export function photoFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `villagesquare-meet-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
