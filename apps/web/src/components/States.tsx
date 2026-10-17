import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.js';
import { Link } from 'react-router-dom';
import { SignalIllustration } from './SignalIllustration.js';
import { useOnline } from '../hooks/useOnline.js';

export function LoadingState() {
  const { t } = useTranslation();
  return <div className="state panel" role="status"><span className="spinner"/>{t('loading', 'Loading…')}</div>;
}
export function ErrorState({ message, retry, busy = false }: { message: string; retry?: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  return <div className="state panel error-state" role="alert"><SignalIllustration mode="lost"/><h2>{t('error-title', 'This view could not be loaded')}</h2><p>{message}</p><div className="state-actions">{retry && <button className="button primary" disabled={busy} onClick={retry}>{busy ? <span className="spinner"/> : <Icon name="refresh"/>}{t('retry', 'Try again')}</button>}<Link className="button secondary" to="/">{t('return-home', 'Back to home')}</Link></div></div>;
}

export function ConnectionStatus() {
  const { t } = useTranslation();
  const online = useOnline();
  return online ? null : <div className="connection-banner" role="status"><Icon name="offline" size={17}/>{t('offline', 'You are offline. Updates will resume when your connection returns.')}</div>;
}

export function RefreshStatus({ fetching, error, retry }: { fetching: boolean; error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  if (error) return <div className="inline-alert refresh-status" role="status"><Icon name="warning" size={17}/><span>{t('refresh-failed', 'Could not refresh. Your last loaded data is still shown.')}</span><button className="button secondary" disabled={fetching} onClick={retry}>{t('retry', 'Try again')}</button></div>;
  return fetching ? <div className="refresh-status muted" role="status"><span className="status-dot"/>{t('refreshing', 'Updating…')}</div> : null;
}
export function Unavailable({ note }: { note?: string }) {
  const { t } = useTranslation();
  return <div className="unavailable"><Icon name="chart"/><strong>{t('unavailable', 'Not available yet')}</strong><p>{note ?? t('analytics-unavailable', 'This demo has no calculated analytics for this section yet.')}</p></div>;
}
