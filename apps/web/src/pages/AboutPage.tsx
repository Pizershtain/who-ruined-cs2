import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon.js';
import { SignalIllustration } from '../components/SignalIllustration.js';
import { Disclosure } from '../components/Disclosure.js';
import { Story } from '../components/Story.js';

/** How the analysis works, told as stories: pipeline, what is visible today, what stays open. */
export function AboutPage() {
  const { t } = useTranslation('about');
  const { t: home } = useTranslation('home');
  const { t: match } = useTranslation('match');
  const facts = [
    { icon: 'rounds' as const, title: t('facts', 'What you can see today'), text: t('facts-text', 'Parsed players, roster-based teams, rounds, K/D/A and recorded events. Additional match metrics appear when the analysis service provides them. Teams stay together when T and CT sides switch.') },
    { icon: 'chart' as const, title: t('future', 'What comes next'), text: t('future-text', 'Contextual ratings, team coordination and tactical conclusions need additional analysis. They remain unavailable until the service calculates them.') },
    { icon: 'warning' as const, title: t('uncertainty', 'Gaps stay visible'), text: t('uncertainty-text', 'A dash means unavailable, not zero. Partial matches show their quality issues. An ordinary death is never presented as a proven mistake.') },
    { icon: 'upload' as const, title: t('data', 'Where your data goes'), text: t('data-text', 'Uploaded demos and reports are stored by your configured analysis server. This version is a local workspace without account isolation; public hosting requires a separate access and retention design.') },
  ];
  return <article className="about-page">
    <Story hero label={t('eyebrow', 'Behind the analysis')} title={t('title', 'Evidence over assumptions.')} lead={t('intro', 'A scoreboard describes what happened. Understanding why takes context. We keep those two things separate.')}
      actions={<Link className="button primary" to="/analyze">{t('start', 'Analyze a match')}<Icon name="arrow" size={18}/></Link>}>
      <SignalIllustration/>
    </Story>
    <Story alt band label={home('workflow', 'How analysis works')} title={t('pipeline-title', 'From demo to report')} lead={home('step-understand-text', 'Available facts, with gaps clearly marked.')}>
      <ol className="workflow-steps">{[
        { icon: 'upload' as const, title: home('step-upload', 'Bring your match'), description: home('step-upload-text', 'Upload a recorded CS2 demo.') },
        { icon: 'rounds' as const, title: home('step-reconstruct', 'Reconstruct the rounds'), description: home('step-reconstruct-text', 'Follow teams, scores and parsed events.') },
        { icon: 'chart' as const, title: home('step-understand', 'Read the evidence'), description: home('step-understand-text', 'Available facts, with gaps clearly marked.') },
      ].map((step, index) => <li key={step.icon}><span className="step-number">0{index + 1}</span><span className="workflow-icon"><Icon name={step.icon} size={22}/></span><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol>
    </Story>
    <Story label={t('facts', 'What you can see today')} title={t('uncertainty', 'Gaps stay visible')} lead={t('uncertainty-text', 'A dash means unavailable, not zero. Partial matches show their quality issues. An ordinary death is never presented as a proven mistake.')}>
      <div className="about-grid">{facts.map((fact) => <section key={fact.title}><Icon name={fact.icon}/><h3>{fact.title}</h3><p>{fact.text}</p></section>)}</div>
    </Story>
    <Story alt band label={t('faq-title', 'Questions, answered')} title={t('faq-title', 'Questions, answered')} lead={t('faq-metrics', 'How should I read the metrics?')}>
      <div className="faq">{[
        { question: t('faq-missing', 'Why are some values unavailable?'), answer: t('uncertainty-text', 'A dash means unavailable, not zero. Partial matches show their quality issues. An ordinary death is never presented as a proven mistake.') },
        { question: t('faq-ratings', 'Where are the ratings?'), answer: t('future-text', 'Contextual ratings, team coordination and tactical conclusions need additional analysis. They remain unavailable until the service calculates them.') },
        { question: t('faq-metrics', 'How should I read the metrics?'), answer: match('metric-definitions', 'ADR: average damage per round. KAST: rounds with a kill, assist, survival or trade. Opening K/D: the first elimination in a round. TK: team kills. Performance, Impact and Mistakes require contextual calculations from the analysis service.') },
        { question: t('faq-storage', 'Where is my demo stored?'), answer: t('data-text', 'Uploaded demos and reports are stored by your configured analysis server. This version is a local workspace without account isolation; public hosting requires a separate access and retention design.') },
      ].map((item) => <Disclosure variant="quiet" className="faq-item" level={3} key={item.question} title={item.question}><p>{item.answer}</p></Disclosure>)}</div>
    </Story>
  </article>;
}
export function NotFoundPage() {
  const { t } = useTranslation();
  return <section className="not-found"><div className="lost-coordinate" aria-hidden="true">404</div><SignalIllustration mode="lost"/><p className="eyebrow">404</p><h1>{t('page-not-found', 'Page not found')}</h1><p>{t('page-not-found-note', 'This link does not lead to a report. Head back and choose a match.')}</p><Link className="button primary" to="/"><Icon name="back" size={18}/>{t('return-home', 'Back to home')}</Link></section>;
}
