import { useEffect, useRef } from 'react';
import { useMeeting } from '../../meeting/store';

const COLORS = ['#1560d8', '#00d4ff', '#25d97a', '#ffce3a', '#ea4b5a', '#b36bff', '#ffffff'];
const MAX_BITS = 450;

interface Bit { x: number; y: number; vx: number; vy: number; rot: number; spin: number; w: number; h: number; color: string; age: number }

// Full-screen confetti on every 🎉, fired from both bottom corners. A canvas
// rather than DOM nodes, so a whole room celebrating at once stays smooth.
export default function Confetti() {
  const { confetti } = useMeeting();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bits = useRef<Bit[]>([]);
  const frame = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!confetti || !canvas || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    for (let i = 0; i < 110; i++) {
      const left = i % 2 === 0;
      const angle = (left ? -62 : -118) * Math.PI / 180 + (Math.random() - 0.5) * 0.8;
      const speed = (10 + Math.random() * 9) * Math.min(1.35, Math.max(0.8, H / 800));
      bits.current.push({
        x: left ? -5 : W + 5, y: H + 5, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.35,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, color: COLORS[i % COLORS.length], age: 0,
      });
    }
    if (bits.current.length > MAX_BITS) bits.current.splice(0, bits.current.length - MAX_BITS);
    if (frame.current) return; // already running: the new bits join the loop

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const step = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      bits.current = bits.current.filter(b => b.y < H + 30 && b.age < 420);
      for (const b of bits.current) {
        b.age++;
        // Fast up, then a slow flutter down: capped fall speed plus a sideways sway.
        b.vy = Math.min(b.vy + 0.28, 3.4);
        b.vx *= 0.985;
        b.x += b.vx + Math.sin(b.age / 9) * 0.7;
        b.y += b.vy;
        b.rot += b.spin;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.cos(b.age / 7));
        ctx.restore();
      }
      if (bits.current.length) frame.current = requestAnimationFrame(step);
      else { frame.current = 0; ctx.clearRect(0, 0, W, H); }
    };
    frame.current = requestAnimationFrame(step);
  }, [confetti]);

  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; bits.current = []; }, []);

  return <canvas className="confetti" ref={canvasRef} aria-hidden="true" />;
}
