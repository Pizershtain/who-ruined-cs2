import { useEffect, useLayoutEffect, useRef } from 'react';

const DIGITS = '0123456789';
const GLYPHS = '·:;+=*#%@ABCDEFGHKMNPRSTVXZ0123456789';
const DURATION = 560;
// Figures that come into view together settle top to bottom: this much later per pixel lower, up to a cap.
const WAVE_MS_PER_PX = 0.9;
const WAVE_MAX_MS = 900;
const BATCH_MS = 40;

type Start = (delay: number) => void;
const pending: Array<{ el: HTMLElement; start: Start }> = [];
let flushTimer = 0;

/** Collects figures that enter the viewport within one short window and staggers them by height. */
function enqueue(el: HTMLElement, start: Start) {
  pending.push({ el, start });
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    const batch = pending.splice(0).map((item) => ({ ...item, top: item.el.getBoundingClientRect().top }));
    const first = Math.min(...batch.map((item) => item.top));
    for (const item of batch) item.start(Math.min(WAVE_MAX_MS, Math.max(0, item.top - first) * WAVE_MS_PER_PX));
  }, BATCH_MS);
}

/**
 * A key figure that scrambles through the glyph ramp the first time it scrolls into view,
 * then settles on the real value. Figures that appear together all start scrambling at once
 * and settle in a wave from top to bottom. The animated text is hidden from assistive tech,
 * which reads the final value straight away. Under reduced motion the value simply appears.
 */
export function Decode({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The span's text is owned here, not by React, so the scramble never fights a re-render.
  useLayoutEffect(() => { if (ref.current) ref.current.textContent = text; }, [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let cancelled = false;
    const run = (delay: number) => {
      if (cancelled) return;
      el.style.minWidth = '';
      el.textContent = text;
      el.style.minWidth = `${Math.ceil(el.getBoundingClientRect().width)}px`;
      const chars = [...text];
      const numeric = /^[\d\s:,.%+\-−/—]+$/.test(text);
      const pool = numeric ? DIGITS : GLYPHS;
      // Characters resolve left to right, all of them shifted by this figure's place in the wave.
      const resolveAt = chars.map((_, i) => delay + (0.25 + 0.6 * (i / Math.max(1, chars.length - 1)) + Math.random() * 0.12) * DURATION);
      const end = delay + DURATION * 1.05;
      const start = performance.now();
      const step = (now: number) => {
        const elapsed = now - start;
        el.textContent = chars.map((ch, i) => /[\s:,.%/—−-]/.test(ch) || elapsed >= (resolveAt[i] ?? end) ? ch : pool[Math.floor(Math.random() * pool.length)]).join('');
        if (elapsed < end) frame = requestAnimationFrame(step); else el.textContent = text;
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); enqueue(el, run); } }, { threshold: 0.6 });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(frame); el.textContent = text; };
  }, [text]);
  return <><span ref={ref} className={`decode ${className}`} aria-hidden="true"/><span className="sr-only">{text}</span></>;
}
