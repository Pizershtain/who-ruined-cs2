import { Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { brand } from '../brand.js';
import { Icon } from './Icon.js';
import { ConnectionStatus, LoadingState } from './States.js';
import { JobSkeleton, ReportSkeleton } from './Skeleton.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { AsciiField } from './AsciiField.js';
import { demoBuild } from '../shared/env.js';

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
    document.documentElement.dir = i18n.dir();
    document.title = brand.name;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('site-description', 'CS2 match analysis. Explore players, rounds and the evidence behind every result.'));
  }, [i18n, i18n.resolvedLanguage, t]);
  useEffect(() => {
    if (demoBuild || !window.location.hash) window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname]);

  const landing = location.pathname === '/';
  const fallback = location.pathname.startsWith('/jobs/') ? <JobSkeleton/> : location.pathname.startsWith('/matches/') ? <ReportSkeleton kind={location.pathname.includes('/players/') ? 'player' : 'match'}/> : <LoadingState/>;
  return <div className={`app-shell ${landing ? 'is-landing' : ''}`}>
    <a className="skip-link" href="#main" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>{t('skip-content', 'Skip to content')}</a>
    {!landing && <AsciiField quiet className="ascii-backdrop"/>}
    {!landing && <header className="site-header"><div className="container header-inner">
      <Link to="/" className="brand" aria-label={brand.name}><span className="brand-mark"><Icon name="crosshair" size={23}/></span><span>{brand.shortName}<b>{brand.suffix}</b></span></Link>
      <nav aria-label={t('navigation', 'Main navigation')}>
        <NavLink to="/analyze">{t('nav-analyze', 'Analyze a match')}</NavLink>
        <NavLink to="/about">{t('nav-method', 'How it works')}</NavLink>
      </nav>
      <div className="header-actions"><span className="local-badge"><span/>{t('local-mode', 'Local workspace')}</span>
        <LanguageSwitcher key={location.pathname}/>
      </div>
    </div></header>}
    <ConnectionStatus/>
    <main id="main" tabIndex={-1} className={landing ? 'main-content landing-main' : 'container main-content'}><div className="route-view" key={location.pathname}><Suspense fallback={fallback}><Outlet/></Suspense></div></main>
    {!landing && <footer className="container site-footer"><span className="footer-brand"><Icon name="crosshair" size={16}/>{brand.name}</span><p>{t('evidence-disclaimer', 'Match facts are evidence, not proof of tactical blame or intent.')}</p><Link to="/about">{t('nav-method', 'How it works')} <span aria-hidden="true">↗</span></Link></footer>}
  </div>;
}
