import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { JobDto } from '@who-ruined/contracts';
import { errorCodeMessage, statusLabel } from '../shared/messages.js';
import { useElapsed } from '../hooks/useElapsed.js';
import { SignalIllustration } from './SignalIllustration.js';
import { Icon } from './Icon.js';

const stages = ['QUEUED', 'PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING'] as const;

export function JobProgress({ job, reportPath }: { job: JobDto; reportPath?: string }) {
  const { t, i18n } = useTranslation('job');
  const common = useTranslation().t;
  const stopped = job.status === 'FAILED' || job.status === 'CANCELLED';
  const ready = job.status === 'COMPLETED' || job.status === 'PARTIAL';
  const activeStage = stages.findIndex((stage) => stage === job.status);
  const elapsed = useElapsed(job.createdAt, !stopped && !ready);
  const digits = new Intl.NumberFormat(i18n.resolvedLanguage, { minimumIntegerDigits: 2, useGrouping: false });
  const time = elapsed === null ? null : '\u2066' + digits.format(Math.floor(elapsed / 60)) + ':' + digits.format(elapsed % 60) + '\u2069';
  return <section className={`job-page ${stopped ? 'job-stopped' : ''}`}><Link className="text-link back-link" to="/"><Icon name="back" size={17}/>{t('back', 'Back to upload')}</Link><p className="eyebrow">{t('eyebrow', 'Match processing')}</p><h1 aria-live="polite">{statusLabel(job.status, common)}</h1>
    <div className="panel job-panel"><div className="job-visual"><SignalIllustration mode={stopped ? 'lost' : ready ? 'ready' : 'scan'}/><span className={`pill ${stopped ? 'warning' : 'success'}`}><Icon name={stopped ? 'warning' : ready ? 'check' : 'clock'} size={14}/>{stopped || ready ? statusLabel(job.status, common) : t('live-status', 'Live status')}</span></div><div className="job-stage-content"><p>{stopped ? t('stopped', 'Processing has stopped. You can return and upload a different demo.') : ready ? t('ready', 'Your report is ready.') : t('working', 'Rebuilding the match from your demo. This page updates automatically.')}</p>
      {!stopped && !ready && <ol className="job-stages">{stages.slice(0, Math.max(5, activeStage + 1)).map((stage, index) => <li className={index === activeStage ? 'active' : index < activeStage ? 'done' : ''} key={stage} aria-current={index === activeStage ? 'step' : undefined}><span>{index < activeStage ? <Icon name="check" size={14}/> : digits.format(index + 1)}</span>{statusLabel(stage, common)}</li>)}</ol>}
      {ready && <Link className="button primary" to={reportPath ?? `/matches/${encodeURIComponent(job.matchId)}`}>{t('open-report', 'Open report')}<Icon name="arrow" size={16}/></Link>}
      {stopped && <Link className="button primary" to="/">{t('back', 'Back to upload')}<Icon name="arrow" size={16}/></Link>}
      {job.errorCode && <p role="alert" className="inline-alert danger">{errorCodeMessage(job.errorCode, common)}<small>{job.errorCode}</small></p>}
    </div></div>
    {!stopped && !ready && <div className="job-timing">{time && <span><Icon name="clock" size={15}/>{t('elapsed', 'Elapsed {{time}}', { time })}</span>}<span>{t('stage-note', 'Stages show confirmed progress, not an estimated completion time.')}</span></div>}
    {!stopped && !ready && elapsed !== null && elapsed >= 90 && <p className="inline-alert" role="status">{t('taking-longer', 'Still processing. The last confirmed stage is shown; duration depends on the demo.')}</p>}
  </section>;
}
