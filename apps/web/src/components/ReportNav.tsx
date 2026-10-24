import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { revealSection } from './Disclosure.js';
import { Icon } from './Icon.js';
import { demoBuild } from '../shared/env.js';

const sections = ['scoreboard', 'rounds', 'statistics', 'moments'] as const;
// Element whose score docks into the nav once it scrolls away.
const SCORE_SELECTOR = '#overview .score';

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
  const [hidden, setHidden] = useState(false);
  const navRef = useRef<HTMLElement>(null);

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

  // The hero score docks into the nav as soon as it has scrolled out above the nav.
  useEffect(() => {
    const target = document.querySelector(SCORE_SELECTOR);
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry) setDocked(!entry.isIntersecting && entry.boundingClientRect.top < 0); }, { rootMargin: '-72px 0px 0px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // Hide on the way down, show again on the way up.
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      const nav = navRef.current;
      const focusInside = !!nav && nav.contains(document.activeElement);
      if (Math.abs(delta) > 6) setHidden(delta > 0 && y > 480 && !focusInside);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const labels = { scoreboard: t('scoreboard', 'Player scoreboard'), rounds: t('round-history-short', 'Rounds'), statistics: t('statistics', 'Statistics'), moments: t('moments', 'Key moments') };
  return <nav ref={navRef} className={`report-nav ${hidden ? 'is-hidden' : ''}`} aria-label={t('report-sections', 'Report sections')}>
    {score && docked && <button type="button" className="nav-score" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span>{score.map}</span><b dir="ltr">{score.parts.map((part, index) => <span key={index} className={`team-text-${part.team}`}>{part.value}{index < score.parts.length - 1 && <i>:</i>}</span>)}</b></button>}
    {focus && <button type="button" className="focus-chip" onClick={focus.clear} title={t('clear-focus', 'Clear player selection')}><span>{t('focus-player', 'In focus: {{name}}', { name: focus.name })}</span><span className="sr-only">{t('clear-focus', 'Clear player selection')}</span><Icon name="close" size={14}/></button>}
    {sections.map((id) => <a href={'#' + id} key={id} onClick={(event) => { event.preventDefault(); setActive(id); land(id); if (!demoBuild) window.history.replaceState(null, '', '#' + id); }} aria-current={active === id ? 'location' : undefined}>{labels[id]}</a>)}
  </nav>;
}
