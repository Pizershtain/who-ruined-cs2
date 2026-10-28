import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { brand } from '../brand.js';
import { AsciiField } from '../components/AsciiField.js';
import { Icon } from '../components/Icon.js';
import { previewEnabled } from '../shared/env.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';

export function LandingPage() {
  const { t } = useTranslation();
  const { t: home } = useTranslation('home');
  return <section className="landing">
    <AsciiField/>
    <div className="landing-copy">
      <span className="brand-mark"><Icon name="crosshair" size={26}/></span>
      <h1>{brand.shortName} <b>{brand.suffix}</b></h1>
      <p>{t('site-description', 'CS2 match analysis. Explore players, rounds and the evidence behind every result.')}</p>
    </div>
    <nav className="landing-dock" data-spotlight="off" aria-label={t('navigation', 'Main navigation')}>
      <NavLink className="liquid-pill primary" to="/analyze"><Icon name="upload" size={17}/>{t('nav-analyze', 'Analyze a match')}</NavLink>
      <NavLink className="liquid-pill" to="/about">{t('nav-method', 'How it works')}</NavLink>
      {previewEnabled && <Link className="liquid-pill" to="/preview/available">{home('preview-link', 'Explore an example report')}<span className="micro-badge">{home('synthetic', 'Sample data')}</span></Link>}
      <LanguageSwitcher/>
    </nav>
  </section>;
}
