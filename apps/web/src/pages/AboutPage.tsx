import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon.js';
import { SignalIllustration } from '../components/SignalIllustration.js';

export function AboutPage() {
  const { t } = useTranslation('about');
  const { t: home } = useTranslation('home');
  const { t: match } = useTranslation('match');
  return <article className="about-page"><div className="about-hero"><div><p className="eyebrow">{t('eyebrow', 'Behind the analysis')}</p><h1>{t('title', 'Evidence over assumptions.')}</h1><p className="lead">{t('intro', 'A scoreboard describes what happened. Understanding why takes context. We keep those two things separate.')}</p></div><SignalIllustration/></div>
    <section className="workflow-section"><h2>{t('pipeline-title', 'From demo to report')}</h2><ol className="workflow-steps">{[
      { icon: 'upload' as const, title: home('step-upload', 'Bring your match'), description: home('step-upload-text', 'Upload a recorded CS2 demo.') },
      { icon: 'rounds' as const, title: home('step-reconstruct', 'Reconstruct the rounds'), description: home('step-reconstruct-text', 'Follow teams, scores and parsed events.') },
      { icon: 'chart' as const, title: home('step-understand', 'Read the evidence'), description: home('step-understand-text', 'Available facts, with gaps clearly marked.') },
    ].map((step) => <li className="panel" key={step.icon}><span className="workflow-icon"><Icon name={step.icon} size={24}/></span><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol></section><div className="about-grid">
    <section className="panel"><Icon name="rounds"/><h2>{t('facts', 'What you can see today')}</h2><p>{t('facts-text', 'Parsed players, roster-based teams, rounds, K/D/A and recorded events. Additional match metrics appear when the analysis service provides them. Teams stay together when T and CT sides switch.')}</p></section>
    <section className="panel"><Icon name="chart"/><h2>{t('future', 'What comes next')}</h2><p>{t('future-text', 'Contextual ratings, team coordination and tactical conclusions need additional analysis. They remain unavailable until the service calculates them.')}</p></section>
    <section className="panel"><Icon name="warning"/><h2>{t('uncertainty', 'Gaps stay visible')}</h2><p>{t('uncertainty-text', 'A dash means unavailable, not zero. Partial matches show their quality issues. An ordinary death is never presented as a proven mistake.')}</p></section>
    <section className="panel"><Icon name="upload"/><h2>{t('data', 'Where your data goes')}</h2><p>{t('data-text', 'Uploaded demos and reports are stored by your configured analysis server. This version is a local workspace without account isolation; public hosting requires a separate access and retention design.')}</p></section>
  </div><section className="faq-section"><h2>{t('faq-title', 'Questions, answered')}</h2>{[
    { question: t('faq-missing', 'Why are some values unavailable?'), answer: t('uncertainty-text', 'A dash means unavailable, not zero. Partial matches show their quality issues. An ordinary death is never presented as a proven mistake.') },
    { question: t('faq-ratings', 'Where are the ratings?'), answer: t('future-text', 'Contextual ratings, team coordination and tactical conclusions need additional analysis. They remain unavailable until the service calculates them.') },
    { question: t('faq-metrics', 'How should I read the metrics?'), answer: match('metric-definitions', 'ADR: average damage per round. KAST: rounds with a kill, assist, survival or trade. Opening K/D: the first elimination in a round. TK: team kills. Performance, Impact and Mistakes require contextual calculations from the analysis service.') },
    { question: t('faq-storage', 'Where is my demo stored?'), answer: t('data-text', 'Uploaded demos and reports are stored by your configured analysis server. This version is a local workspace without account isolation; public hosting requires a separate access and retention design.') },
  ].map((item) => <details className="panel faq-item" key={item.question}><summary>{item.question}<span className="disclosure-mark" aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</section><div className="about-cta"><Link className="button primary" to="/">{t('start', 'Analyze a match')}<Icon name="arrow" size={18}/></Link></div></article>;
}
export function NotFoundPage() {
  const { t } = useTranslation();
  return <section className="not-found panel"><div className="lost-coordinate" aria-hidden="true">404</div><SignalIllustration mode="lost"/><p className="eyebrow">404</p><h1>{t('page-not-found', 'Page not found')}</h1><p>{t('page-not-found-note', 'This link does not lead to a report. Head back and choose a match.')}</p><Link className="button primary" to="/"><Icon name="back" size={18}/>{t('return-home', 'Back to home')}</Link></section>;
}
