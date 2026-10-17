import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const sections = ['scoreboard', 'rounds', 'statistics', 'moments'] as const;

export function ReportNav() {
  const { t } = useTranslation('match');
  const [active, setActive] = useState<string>('scoreboard');
  useEffect(() => {
    const requested = window.location.hash.slice(1);
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
  return <nav className="report-nav" aria-label={t('report-sections', 'Report sections')}>{sections.map((id) => <a href={'#' + id} key={id} onClick={() => setActive(id)} aria-current={active === id ? 'location' : undefined}>{labels[id]}</a>)}</nav>;
}
