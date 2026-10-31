import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getMatches, uploadDemo, type UploadProgress } from '../api.js';
import { errorCodeMessage, errorMessage, statusLabel } from '../shared/messages.js';
import { validateDemo } from '../shared/upload.js';
import { Icon } from '../components/Icon.js';
import { previewEnabled } from '../shared/env.js';
import { RecentSkeleton } from '../components/Skeleton.js';
import { RefreshStatus } from '../components/States.js';
import { SignalIllustration } from '../components/SignalIllustration.js';
import { Story } from '../components/Story.js';

/** The workspace: one story to upload a demo, one story with the matches already analysed. */
export function HomePage() {
  const { t, i18n } = useTranslation('home');
  const common = useTranslation().t;
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const navigate = useNavigate();
  const recent = useInfiniteQuery({
    queryKey: ['matches'], initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => getMatches(signal, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((item) => !['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(item.status))) ? 4000 : false,
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  async function select(files: FileList | null) {
    if (uploading.current || !files?.length) return;
    setError(null); setValidation(null); setCancelled(false); setFile(null); setProgress(null);
    if (files.length !== 1) { setValidation('MULTIPLE_FILES'); return; }
    const selected = files[0];
    if (!selected) return;
    const invalid = validateDemo(selected);
    if (invalid) { setValidation(invalid); return; }
    await startUpload(selected);
  }

  async function startUpload(selected: File) {
    if (uploading.current) return;
    setFile(selected); setError(null); setValidation(null); setCancelled(false);
    setProgress({ loaded: 0, total: null, sent: false });
    uploading.current = true; setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await uploadDemo(selected, abort.signal, (value) => { if (mounted.current && !abort.signal.aborted) setProgress(value); });
      if (mounted.current && !abort.signal.aborted) navigate(`/jobs/${encodeURIComponent(result.jobId)}`);
    } catch (cause) {
      if (mounted.current) { if (abort.signal.aborted) setCancelled(true); else setError(cause); }
    } finally {
      uploading.current = false;
      if (mounted.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  const items = recent.data?.pages.flatMap((page) => page.items) ?? [];
  const percentage = progress?.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : undefined;
  const formatSize = (size: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(size / 1_000_000);

  return <>
    <Story hero label={t('new-analysis', 'New analysis')} title={t('upload-title', 'Your next insight starts here.')} lead={t('description', 'Every round tells a story. Open your demo, explore the match and see what the numbers actually say.')}
      aside={<div className="story-aside"><span><Icon name="check" size={15}/>{t('tag-rosters', 'Real rosters')}</span><span><Icon name="check" size={15}/>{t('tag-rounds', 'Round by round')}</span><span><Icon name="check" size={15}/>{t('tag-evidence', 'Evidence first')}</span></div>}
      actions={previewEnabled ? <Link className="button secondary" to="/preview/available">{t('preview-link', 'Explore an example report')}<span className="micro-badge">{t('synthetic', 'Sample data')}</span></Link> : undefined}>
      <div className="upload-card">
        <button type="button" disabled={busy} className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files); }}>
          <span className="upload-icon">{busy ? <span className="spinner"/> : <Icon name="upload" size={27}/>}</span>
          <strong>{busy ? t('uploading', 'Uploading your demo…') : t('drop-title', 'Drop your demo here')}</strong>
          <span>{busy ? t('upload-wait', 'Keep this page open until the upload finishes.') : t('drop-description', 'or click to choose a file')}</span>
          <small>{t('limit', 'CS2 .dem files · up to 512 MiB')}</small>
        </button>
        <input ref={input} type="file" accept=".dem" className="sr-only" tabIndex={-1} aria-label={t('file-input', 'Choose a CS2 demo')} onChange={(event) => { void select(event.target.files); event.target.value = ''; }}/>
        {file && <div className={`upload-transfer ${busy ? 'is-active' : ''}`}><div className="transfer-heading"><Icon name="rounds" size={18}/><div><strong title={file.name}>{file.name}</strong><small>{formatSize(file.size)}</small></div>{busy && !progress?.sent && <button className="icon-button" onClick={() => controller.current?.abort()} aria-label={t('cancel-upload', 'Cancel upload')}><Icon name="close" size={18}/></button>}</div>{busy && <><progress className={progress?.sent ? 'is-confirming' : ''} max={100} value={percentage} aria-label={t('uploading', 'Uploading your demo…')}/><div className="transfer-status"><span role="status">{progress?.sent ? t('upload-confirming', 'Upload sent. Waiting for the server…') : t('uploading', 'Uploading your demo…')}</span><strong>{percentage === undefined ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent' }).format(percentage / 100)}</strong></div></>}{cancelled && <p className="muted" role="status">{t('upload-cancelled', 'Upload stopped. The server may already have received the demo.')}</p>}{!busy && (error || cancelled) && <button className="button primary" onClick={() => void startUpload(file)}><Icon name="refresh" size={16}/>{common('retry', 'Try again')}</button>}</div>}
        {(error || validation) && <p className="inline-alert danger" role="alert">{validation === 'MULTIPLE_FILES' ? t('one-file', 'Choose one demo at a time.') : validation ? errorCodeMessage(validation, common) : errorMessage(error, common)}</p>}
        <div className="coming-soon"><Icon name="link" size={17}/><span>{t('link-import', 'Steam share code / FACEIT')}</span><span className="micro-badge">{t('coming-soon', 'Coming later')}</span></div>
        <p className="stage-footnote">{t('upload-note', 'Your demo is sent to the configured analysis server. Link imports are not available yet.')}</p>
      </div>
    </Story>
    <Story alt band label={t('workspace', 'Your workspace')} title={t('recent-title', 'Recent matches')} lead={t('recent-note', 'Stored on this analysis server')}>
      <div className="recent">
        {recent.data && !recent.isFetchNextPageError && <RefreshStatus fetching={recent.isRefetching} error={recent.error} retry={() => void recent.refetch()}/>}
        {recent.isPending ? <RecentSkeleton/> :
          recent.isError && !recent.data ? <div className="empty-state" role="alert"><SignalIllustration mode="lost"/><p>{errorMessage(recent.error, common)}</p><button className="button primary" disabled={recent.isFetching} onClick={() => void recent.refetch()}>{common('retry', 'Try again')}</button></div> :
          !items.length ? <div className="empty-state empty-matches"><SignalIllustration mode="empty"/><div><h3>{t('empty-title', 'A clean slate.')}</h3><p>{t('empty-text', 'Your match reports will appear here after you upload a demo.')}</p><button className="button primary" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16}/>{t('step-upload', 'Bring your match')}</button></div></div> :
          <div className="recent-list">{items.map((item) => {
            const content = <><span className="map-tile"><Icon name="crosshair" size={26}/></span><span className="recent-map"><strong>{item.map ?? t('map-pending', 'Identifying map')}</strong><small>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</small></span><span className={`pill ${item.status === 'COMPLETED' ? 'success' : ''}`}>{statusLabel(item.status, common)}</span><Icon name={['COMPLETED', 'PARTIAL'].includes(item.status) ? 'arrow' : 'clock'}/></>;
            return ['COMPLETED', 'PARTIAL'].includes(item.status)
              ? <Link className="recent-row" key={item.id} to={`/matches/${encodeURIComponent(item.id)}`}>{content}</Link>
              : <div className="recent-row" key={item.id}>{content}</div>;
          })}</div>}
        {recent.isFetchNextPageError && <p className="inline-alert" role="status">{t('load-more-failed', 'Could not load more matches. Try again.')}</p>}
        {recent.hasNextPage && <button disabled={recent.isFetchingNextPage} className="button secondary load-more" onClick={() => void recent.fetchNextPage()}>{recent.isFetchingNextPage && <span className="spinner"/>}{t('load-more', 'Load more matches')}</button>}
      </div>
    </Story>
  </>;
}
