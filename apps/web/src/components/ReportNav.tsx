import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { revealSection } from './Disclosure.js';
import { Icon } from './Icon.js';
import { demoBuild } from '../shared/env.js';

const sections = ['scoreboard', 'rounds', 'statistics', 'moments'] as const;
// Once stuck, the nav keeps following for this far down before it folds into a strip while reading.
const COLLAPSE_AFTER_PX = 280;
// After the strip was opened by hand, this much reading down folds it again.
const RECOLLAPSE_AFTER_PX = 48;

/** Lands on a section: scrolls there and briefly lights the stage edge once the scroll has settled. */
function land(id: string) {
  const section = document.getElementById(id);
  if (!section) return;
  revealSection(id);
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const stage = section.querySelector('.stage');
  if (!stage || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let done = false;
  const glow = () => {
    if (done) return;
    done = true;
    stage.classList.remove('is-landing');
    void (stage as HTMLElement).offsetWidth;
    stage.classList.add('is-landing');
    window.setTimeout(() => stage.classList.remove('is-landing'), 900);
  };
  window.addEventListener('scrollend', glow, { once: true });
  window.setTimeout(glow, 900);
}

export function ReportNav({ focus, score }: { focus?: { name: string; clear: () => void } | undefined; score?: { map: string; parts: Array<{ value: string; team: number }> } | undefined }) {
  const { t } = useTranslation('match');
  const [active, setActive] = useState<string>('scoreboard');
  const [docked, setDocked] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const motion = useRef({ anchorY: 0, peeked: false, landing: false });
  const navRef = useRef<HTMLElement>(null);
  // Zero-height marker at the nav's place in the flow: tells when the nav has left it and is sticking.
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requested = demoBuild ? '' : window.location.hash.slice(1);
    if (sections.some((id) => id === requested)) document.getElementById(requested)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
      }
      const nearest = [...visible].sort((a, b) => Math.abs(a.getBoundingClientRect().top - 100) - Math.abs(b.getBoundingClientRect().top - 100))[0];
      if (nearest) setActive(nearest.id);
    }, { rootMargin: '-80px 0px -55% 0px' });
    for (const id of sections) { const element = document.getElementById(id); if (element) observer.observe(element); }
    return () => observer.disconnect();
  }, []);

  // While the nav sits in its place in the flow it stays put. Only once it sticks to the top and
  // follows the scroll does it carry the match score, and after following for a while on the way
  // down it folds into a thin strip; any scroll up, a hover on the strip or focus opens it again.
  useEffect(() => {
    let lastY = window.scrollY;
    let stuck = false;
    let frame = 0;
    const state = motion.current;
    const update = () => {
      frame = 0;
      const nav = navRef.current, sentinel = sentinelRef.current;
      if (!nav || !sentinel) return;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      const style = getComputedStyle(nav);
      const isStuck = sentinel.getBoundingClientRect().top + (parseFloat(style.marginTop) || 0) < (parseFloat(style.top) || 0) - 0.5;
      if (isStuck !== stuck) {
        stuck = isStuck;
        state.anchorY = y;
        state.peeked = false;
        setDocked(isStuck);
        if (!isStuck) setCollapsed(false);
      }
      if (!stuck || Math.abs(delta) < 6) return;
      if (delta < 0) { state.anchorY = y; state.peeked = false; setCollapsed(false); return; }
      if (state.landing) return;
      // Never fold away under the pointer or the keyboard focus. A link that merely kept focus after a
      // click does not count, otherwise the nav would never fold again after picking a section.
      if (y - state.anchorY > (state.peeked ? RECOLLAPSE_AFTER_PX : COLLAPSE_AFTER_PX) && !nav.querySelector(':focus-visible') && !nav.matches(':hover')) {
        state.peeked = false;
        setCollapsed(true);
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const expand = () => {
    if (!collapsed) return;
    Object.assign(motion.current, { anchorY: window.scrollY, peeked: true });
    setCollapsed(false);
  };

  // A picked section is flown to with the nav open; reading on from there folds it again.
  const pick = (id: string) => {
    const state = motion.current;
    state.landing = true;
    // The flight has settled once the page has been still for a moment (works without `scrollend`).
    let timer = 0;
    const settle = () => {
      window.removeEventListener('scroll', wait);
      Object.assign(state, { landing: false, anchorY: window.scrollY, peeked: true });
    };
    const wait = () => { window.clearTimeout(timer); timer = window.setTimeout(settle, 160); };
    window.addEventListener('scroll', wait, { passive: true });
    timer = window.setTimeout(settle, 400);
    setActive(id);
    land(id);
  };

  const labels = { scoreboard: t('scoreboard', 'Player scoreboard'), rounds: t('round-history-short', 'Rounds'), statistics: t('statistics', 'Statistics'), moments: t('moments', 'Key moments') };
  return <><div ref={sentinelRef} className="report-nav-sentinel" aria-hidden="true"/>{/* Portalled to the body: the route wrapper keeps a transform from its entry animation, which
       would pin a fixed child to the top of the page instead of the viewport. */}
    {createPortal(<div className={`report-nav-handle ${collapsed ? 'is-active' : ''}`} aria-hidden="true" onPointerEnter={expand} onClick={expand}/>, document.body)}<nav ref={navRef} className={`report-nav ${collapsed ? 'is-collapsed' : ''}`} aria-label={t('report-sections', 'Report sections')} onFocus={expand}>
    {score && docked && <button type="button" className="nav-score" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span>{score.map}</span><b dir="ltr">{score.parts.map((part, index) => <span key={index} className={`team-text-${part.team}`}>{part.value}{index < score.parts.length - 1 && <i>:</i>}</span>)}</b></button>}
    {focus && <button type="button" className="focus-chip" onClick={focus.clear} title={t('clear-focus', 'Clear player selection')}><span>{t('focus-player', 'In focus: {{name}}', { name: focus.name })}</span><span className="sr-only">{t('clear-focus', 'Clear player selection')}</span><Icon name="close" size={14}/></button>}
    {sections.map((id) => <a href={'#' + id} key={id} onClick={(event) => { event.preventDefault(); pick(id); if (!demoBuild) window.history.replaceState(null, '', '#' + id); }} aria-current={active === id ? 'location' : undefined}>{labels[id]}</a>)}
  </nav></>;
}
