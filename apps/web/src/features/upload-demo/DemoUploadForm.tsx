import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { uploadDemo, type UploadProgress } from './api.js';
import { uploadDestination, uploadRecovery } from './admission.js';
import { ApiClientError } from '../../shared/api/transport.js';
import { errorCodeMessage, errorMessage } from '../../shared/messages.js';
import { validateDemo } from './validation.js';
import { Icon } from '../../shared/ui/index.js';
import { previewEnabled } from '../../shared/env.js';

export function DemoUploadForm({ compact = false, inputRef, onBusyChange }: {
  compact?: boolean; inputRef?: RefObject<HTMLInputElement | null>; onBusyChange?: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation('home');
  const common = useTranslation().t;
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
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
    uploading.current = true; setBusy(true); onBusyChange?.(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await uploadDemo(selected, abort.signal, (value) => { if (mounted.current && !abort.signal.aborted) setProgress(value); });
      if (mounted.current && !abort.signal.aborted) {
        const destination = uploadDestination(result);
        void navigate(destination.to, { state: destination.state });
      }
    } catch (cause) {
      if (mounted.current) { if (abort.signal.aborted) setCancelled(true); else setError(cause); }
    } finally {
      uploading.current = false;
      if (mounted.current) { setBusy(false); onBusyChange?.(false); }
      if (input.current) input.current.value = '';
    }
  }
  const recovery = uploadRecovery(error);
  const deleting = error instanceof ApiClientError && error.code === 'MATCH_ACTIVE';
  const percentage = progress?.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : undefined;
  const formatSize = (size: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(size / 1_000_000);

  return <div className={compact ? "upload-card profile-upload" : "upload-card"}>
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
        {(error || validation) && <div className="inline-alert danger" role="alert">
          <p>{validation === 'MULTIPLE_FILES' ? t('one-file', 'Choose one demo at a time.')
            : validation ? errorCodeMessage(validation, common)
            : deleting ? t('upload-deleting', 'The matching demo is being deleted. Try again after deletion finishes.')
            : errorMessage(error, common)}</p>
          {recovery && <p><Link to={`/matches/${encodeURIComponent(recovery.matchId)}`}>
            {t('upload-existing-match', 'Open the existing match')}
          </Link></p>}
        </div>}
        {!compact && previewEnabled && <Link className="button secondary upload-example" to="/preview/available">{t('preview-link', 'Explore an example report')}<span className="micro-badge">{t('synthetic', 'Sample data')}</span></Link>}
      </div>;
}
