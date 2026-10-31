import { useEffect, useRef } from 'react';

/*
  Decorative full-screen glyph field. A slow value-noise flow picks a character
  per cell, so the texture reads as drifting terrain rather than static noise;
  a soft spotlight follows the pointer and lifts both density and brightness
  around it. It never encodes analysis results.
*/
const RAMP = ' ·:;+=*#%@';
const CELL_W = 14;
const CELL_H = 20;
const SPOT_RADIUS = 190;

// Hashed lattice value noise with smooth interpolation; three octaves below.
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function field(x: number, y: number, t: number): number {
  return 0.55 * noise(x * 0.055 + t * 0.06, y * 0.075 - t * 0.04)
    + 0.3 * noise(x * 0.13 - t * 0.05, y * 0.17 + t * 0.07)
    + 0.15 * noise(x * 0.31 + t * 0.1, y * 0.37);
}

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([\da-f]{6})$/i);
  if (hex) { const n = parseInt(hex[1] ?? '0', 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const rgb = value.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [240, 230, 220];
}

/**
 * `quiet` is the backdrop for inner screens: dimmer and slower, no pointer spotlight. Instead the light
 * sits behind the story stage being read and the field drifts with a slow parallax as the page scrolls.
 */
export function AsciiField({ className = '', quiet = false, progress }: { className?: string; quiet?: boolean; progress?: number | undefined }) {
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // With `progress` the field starts sparse and faint and fills in as the value approaches 1.
    const tuned = () => {
      const p = progressRef.current;
      if (p === undefined) return { dim: quiet ? 0.26 : 1, floor: quiet ? 0.44 : 0.32 };
      return { dim: 0.28 + 0.72 * p, floor: 0.6 - 0.3 * p };
    };
    const pace = quiet ? 0.45 : 1;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const styles = getComputedStyle(document.documentElement);
    const base = parseColor(styles.getPropertyValue('--text'));
    const warm = parseColor(styles.getPropertyValue('--accent'));

    let width = 0, height = 0, columns = 0, rows = 0, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      columns = Math.ceil(width / CELL_W) + 1; rows = Math.ceil(height / CELL_H) + 1;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = `500 13px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // The spotlight eases towards the pointer; without one it drifts gently on its own.
    // Over interactive chrome (the dock, the language menu) the spotlight fades out entirely.
    const pointer = { x: width / 2, y: height / 2, active: false, blocked: false };
    const spot = { x: width / 2, y: height / 2, rx: SPOT_RADIUS, ry: SPOT_RADIUS, strength: 0 };
    // The stage nearest the middle of the viewport is the one being read.
    const readingStage = () => {
      let best: DOMRect | null = null, bestDistance = Infinity;
      for (const stage of document.querySelectorAll('.story .stage')) {
        const r = stage.getBoundingClientRect();
        const distance = Math.abs(r.top + r.height / 2 - height / 2);
        if (r.bottom > 0 && r.top < height && distance < bestDistance) { best = r; bestDistance = distance; }
      }
      return best;
    };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
      pointer.active = event.pointerType === 'mouse' || event.type === 'pointerdown';
      pointer.blocked = event.target instanceof Element && event.target.closest('[data-spotlight="off"]') !== null;
    };
    const leave = () => { pointer.active = false; pointer.blocked = false; };
    // Scroll speed (0..1): fast scrolling streaks the quiet backdrop, which then settles in about half a second.
    let velocity = 0;
    let lastScrollY = window.scrollY, lastScrollAt = performance.now();
    const onScroll = () => {
      const now = performance.now();
      const speed = Math.abs(window.scrollY - lastScrollY) / Math.max(16, now - lastScrollAt);
      lastScrollY = window.scrollY; lastScrollAt = now;
      velocity = Math.max(velocity, Math.min(1, speed / 3));
    };
    if (quiet) window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);

    let frame = 0;
    let last = performance.now();
    let time = 0;
    const draw = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const still = reduceMotion.matches;
      if (!still) time += delta * pace;
      const stage = quiet ? readingStage() : null;
      const target = quiet ? (stage ? { x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 } : spot)
        : pointer.active ? pointer : { x: width * (0.5 + 0.22 * Math.sin(time * 0.17)), y: height * (0.5 + 0.18 * Math.cos(time * 0.13)) };
      const ease = still ? 1 : 1 - Math.exp(-delta * (quiet ? 4 : 9));
      if (!pointer.blocked || quiet) { spot.x += (target.x - spot.x) * ease; spot.y += (target.y - spot.y) * ease; }
      if (stage) { spot.rx += (stage.width * 1.25 - spot.rx) * ease; spot.ry += (stage.height * 1.25 - spot.ry) * ease; }
      const wanted = quiet ? (stage ? 1 : 0) : pointer.blocked ? 0 : pointer.active ? 1 : 0.45;
      spot.strength += (wanted - spot.strength) * (pointer.blocked && !quiet ? Math.min(1, ease * 1.4) : ease * 0.6);
      // Parallax: the backdrop scrolls at a quarter of the page speed.
      const drift = quiet ? window.scrollY * 0.25 / CELL_H : 0;
      velocity = still ? 0 : velocity * Math.exp(-delta * 4);

      const { dim, floor } = tuned();
      context.clearRect(0, 0, width, height);
      for (let row = 0; row < rows; row++) {
        const y = row * CELL_H + CELL_H / 2;
        for (let col = 0; col < columns; col++) {
          const x = col * CELL_W + CELL_W / 2;
          const dx = (x - spot.x) / spot.rx, dy = (y - spot.y) / spot.ry;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const light = distance < 1 ? (1 - distance) ** 2 * spot.strength : 0;
          let value = field(col, row + drift, time);
          value = Math.min(1, Math.max(0, (value - floor) * 1.9 + light * 0.45 + velocity * 0.22));
          if (value < 0.06) continue;
          // Digits surface in the denser pockets; symbols carry the texture.
          const digit = noise(col * 0.9 + 40, row * 0.9 - 40) > 0.78;
          const streak = quiet && velocity > 0.05 && hash(col * 1.3, row * 2.1) < velocity;
          const glyph = streak ? (value > 0.45 ? '|' : ':') : digit ? String(Math.floor(value * 9.99)) : RAMP[Math.min(RAMP.length - 1, Math.floor(value * RAMP.length))] ?? ' ';
          if (glyph === ' ') continue;
          const alpha = quiet ? Math.min(1, (0.1 + 0.42 * value) * dim * (1 + light * 2.4)) : Math.min(1, (0.1 + 0.42 * value) * (0.6 + 1.3 * light)) * dim;
          const mix = light * 0.55;
          const r = Math.round(base[0] + (warm[0] - base[0]) * mix), g = Math.round(base[1] + (warm[1] - base[1]) * mix), b = Math.round(base[2] + (warm[2] - base[2]) * mix);
          context.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
          context.fillText(glyph, x, y);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    const start = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(draw); } };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const visibility = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', visibility);
    start();
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('scroll', onScroll);
    };
  }, [quiet]);
  return <canvas ref={canvasRef} className={`ascii-field ${className}`} aria-hidden="true"/>;
}
