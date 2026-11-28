import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function ReuseNotice({ status }: { status: 'RESULT_READY' | 'ANALYSIS_IN_PROGRESS' }) {
  const { state } = useLocation();
  const { t } = useTranslation('home');
  if (!state || typeof state !== 'object' || !('reuse' in state) || state.reuse !== status) return null;
  return <p className="inline-alert" role="status">{status === 'RESULT_READY'
    ? t('upload-report-reused', 'This demo was already analyzed. The saved report is opening.')
    : t('upload-job-reused', 'This demo is already being analyzed. Tracking the existing job.')}</p>;
}
