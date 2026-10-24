import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { JobDto } from '@who-ruined/contracts';
import { errorCodeMessage, statusLabel } from '../shared/messages.js';
import { useElapsed } from '../hooks/useElapsed.js';
import { AsciiField } from './AsciiField.js';
import { Icon } from './Icon.js';
import { Story } from './Story.js';

const stages = ['QUEUED', 'PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING'] as const;

/** Processing as one story: the stage is a glyph field that fills in as confirmed stages complete. */
export function JobProgress({ job, reportPath }: { job: JobDto; reportPath?: string }) {
  const { t, i18n } = useTranslation('job');
  const common = useTranslation().t;
  const stopped = job.status === 'FAILED' || job.status === 'CANCELLED';
  const ready = job.status === 'COMPLETED' || job.status === 'PARTIAL';
  const activeStage = stages.findIndex((stage) => stage === job.status);
  const elapsed = useElapsed(job.createdAt, !stopped && !ready);
  const digits = new Intl.NumberFormat(i18n.resolvedLanguage, { minimumIntegerDigits: 2, useGrouping: false });
  const time = elapsed === null ? null : '⁦' + digits.format(Math.floor(elapsed / 60)) + ':' + digits.format(elapsed % 60) + '⁩';
  // Confirmed progress only: the share of stages already passed, never an estimate of what is left.
  const progress = ready ? 1 : stopped ? 0.15 : Math.max(0.08, activeStage / stages.length);
  return <Story hero className={`job-story ${stopped ? 'job-stopped' : ''}`} label={t('eyebrow', 'Match processing')} title={<span aria-live="polite">{statusLabel(job.status, common)}</span>}
    lead={stopped ? t('stopped', 'Processing has stopped. You can return and upload a different demo.') : ready ? t('ready', 'Your report is ready.') : t('working', 'Rebuilding the match from your demo. This page updates automatically.')}
    aside={<>{!stopped && !ready && <div className="story-aside">{time && <span><Icon name="clock" size={15}/>{t('elapsed', 'Elapsed {{time}}', { time })}</span>}<span>{t('stage-note', 'Stages show confirmed progress, not an estimated completion time.')}</span></div>}
      {!stopped && !ready && elapsed !== null && elapsed >= 90 && <p className="inline-alert" role="status">{t('taking-longer', 'Still processing. The last confirmed stage is shown; duration depends on the demo.')}</p>}
      {job.errorCode && <p role="alert" className="inline-alert danger">{errorCodeMessage(job.errorCode, common)}<small>{job.errorCode}</small></p>}</>}
    actions={<>{ready && <Link className="button primary" to={reportPath ?? `/matches/${encodeURIComponent(job.matchId)}`}>{t('open-report', 'Open report')}<Icon name="arrow" size={16}/></Link>}{stopped && <Link className="button primary" to="/analyze">{t('back', 'Back to upload')}<Icon name="arrow" size={16}/></Link>}{!stopped && !ready && <Link className="button secondary" to="/analyze"><Icon name="back" size={16}/>{t('back', 'Back to upload')}</Link>}</>}>
    <AsciiField className="job-field" progress={progress}/>
    <div className="job-overlay">
      <span className={`pill ${stopped ? 'warning' : 'success'}`}><Icon name={stopped ? 'warning' : ready ? 'check' : 'clock'} size={14}/>{stopped || ready ? statusLabel(job.status, common) : t('live-status', 'Live status')}</span>
      <ol className="job-stages">{stages.slice(0, Math.max(5, activeStage + 1)).map((stage, index) => <li className={index === activeStage && !ready && !stopped ? 'active' : index < activeStage || ready ? 'done' : ''} key={stage} aria-current={index === activeStage ? 'step' : undefined}><span>{index < activeStage || ready ? <Icon name="check" size={14}/> : digits.format(index + 1)}</span>{statusLabel(stage, common)}</li>)}</ol>
    </div>
  </Story>;
}
