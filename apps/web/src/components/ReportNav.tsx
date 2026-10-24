import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { revealSection } from './Disclosure.js';
import { Icon } from './Icon.js';
import { demoBuild } from '../shared/env.js';

const sections = ['scoreboard', 'rounds', 'statistics', 'moments'] as const;

export function ReportNav({ focus }: { focus?: { name: string; clear: () => void } | undefined }) {
  const { t } = useTranslation('match');
  const [active, setActive] = useState<string>('scoreboard');
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
  const labels = { scoreboard: t('scoreboard', 'Player scoreboard'), rounds: t('round-history-short', 'Rounds'), statistics: t('statistics', 'Statistics'), moments: t('moments', 'Key moments') };
  return <nav className="report-nav" aria-label={t('report-sections', 'Report sections')}>{focus && <button type="button" className="focus-chip" onClick={focus.clear} title={t('clear-focus', 'Clear player selection')}><span>{t('focus-player', 'In focus: {{name}}', { name: focus.name })}</span><span className="sr-only">{t('clear-focus', 'Clear player selection')}</span><Icon name="close" size={14}/></button>}{sections.map((id) => <a href={'#' + id} key={id} onClick={(event) => { event.preventDefault(); setActive(id); revealSection(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!demoBuild) window.history.replaceState(null, '', '#' + id); }} aria-current={active === id ? 'location' : undefined}>{labels[id]}</a>)}</nav>;
}
