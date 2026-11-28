import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { authLoginSchema, authRegistrationSchema } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { demoBuild } from '../../shared/env.js';
import { useAuth } from './AuthProvider.js';
import { waitUntil } from './session.js';

function authMessage(error: unknown, t: TFunction): string {
  switch (error instanceof ApiClientError ? error.code : '') {
    case 'INVALID_CREDENTIALS': return t('auth-invalid-credentials', 'Incorrect username or password.');
    case 'INVALID_REQUEST': return t('auth-invalid-input', 'Enter a valid username and password.');
    case 'SESSION_EXPIRED':
    case 'UNAUTHENTICATED': return t('auth-expired', 'Your session has ended. Sign in again.');
    case 'RATE_LIMITED': return t('auth-rate-limited', 'Too many attempts. Try again shortly.');
    case 'USERNAME_TAKEN': return t('auth-username-taken', 'This username is already taken.');
    case 'AUTH_ORIGIN_NOT_ALLOWED': return t('auth-origin', 'Sign-in is unavailable at this site address.');
    case 'AUTH_SESSION_UNCERTAIN': return t('auth-restore-uncertain', 'The session could not be restored safely. Sign in again.');
    default: return t('auth-unavailable', 'Sign-in is temporarily unavailable.');
  }
}

export function AuthNavigation() {
  const { t } = useTranslation();
  const { session, snapshot } = useAuth();
  if (demoBuild) return null;
  if (snapshot.state === 'AUTHENTICATED' && snapshot.user) {
    return <div className="account-controls">
      <Link className="account-name" to="/profile" aria-label={t('auth-signed-in', 'Signed in as {{name}}', { name: snapshot.user.displayName })}>
        <bdi>{snapshot.user.displayName}</bdi>
      </Link>
      <button type="button" className="button secondary" disabled={snapshot.busy} onClick={() => void session.logout()}>{t('auth-logout', 'Sign out')}</button>
    </div>;
  }
  if (snapshot.state === 'CHECKING') return <span className="account-status" role="status">{t('auth-checking', 'Checking session…')}</span>;
  return <div className="account-controls">
    {snapshot.state === 'UNAVAILABLE' && <span className="account-status" role="status">{snapshot.logoutUnconfirmed
      ? t('auth-logout-unconfirmed', 'Sign-out could not be confirmed.')
      : authMessage(snapshot.error, t)}</span>}
    {snapshot.logoutUnconfirmed
      ? <button type="button" className="button secondary" disabled={snapshot.busy} onClick={() => void session.logout()}>{t('retry', 'Try again')}</button>
      : <Link className="button secondary" to="/login">{t('auth-login', 'Sign in')}</Link>}
  </div>;
}

export function LoginPage() {
  return <AuthForm registering={false}/>;
}

export function RegisterPage() {
  return <AuthForm registering/>;
}

function AuthForm({ registering }: { registering: boolean }) {
  const { t } = useTranslation();
  const { session, snapshot } = useAuth();
  const { busy } = snapshot;
  const [showPassword, setShowPassword] = useState(false);
  const [validation, setValidation] = useState<'credentials' | 'steamId' | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setTimeout(() => setRetryUntil(0), Math.min(Math.max(0, retryUntil - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [retryUntil]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials = { username: data.get('username'), password: data.get('password') };
    let authenticated: boolean;
    if (registering) {
      const steamId = String(data.get('steamId') ?? '').trim();
      const input = authRegistrationSchema.safeParse({ ...credentials, steamId: steamId || undefined });
      if (!input.success) {
        setValidation(input.error.issues.some(issue => issue.path[0] !== 'steamId') ? 'credentials' : 'steamId');
        return;
      }
      setValidation(null);
      authenticated = await session.register(input.data);
    } else {
      const input = authLoginSchema.safeParse(credentials);
      if (!input.success || new TextEncoder().encode(input.data.password).length > 1024) {
        setValidation('credentials');
        return;
      }
      setValidation(null);
      authenticated = await session.login(input.data.username, input.data.password);
    }
    if (authenticated) void navigate('/profile', { replace: true });
    else setRetryUntil(waitUntil(session.getSnapshot().error, Date.now()));
  }
  if (snapshot.state === 'AUTHENTICATED' && !busy) return <Navigate to="/profile" replace/>;
  const title = registering ? t('auth-register', 'Create account') : t('auth-login', 'Sign in');
  const error = validation === 'steamId' ? t('auth-register-invalid-steam-id', 'Enter a valid SteamID64 or leave the field blank.')
    : validation === 'credentials' ? registering
      ? t('auth-register-invalid-input', 'Use 3–32 Latin letters, digits, underscores or hyphens for the username, starting with a letter or digit. Use at least 12 characters for the password.')
      : t('auth-invalid-input', 'Enter a valid username and password.')
    : snapshot.error ? authMessage(snapshot.error, t) : null;
  const errorId = registering ? 'register-error' : 'login-error';
  return <section className="panel auth-panel">
    <h1>{title}</h1>
    <form onSubmit={event => void submit(event)} noValidate aria-busy={busy}>
      <label htmlFor="auth-username">{t('auth-username', 'Username')}</label>
      <input id="auth-username" name="username" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} aria-describedby={error ? errorId : undefined}/>
      <label htmlFor="auth-password">{t('auth-password', 'Password')}</label>
      <div className="password-control">
        <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required maxLength={1024} aria-describedby={error ? errorId : undefined}/>
        <button type="button" className="button secondary" aria-controls="auth-password" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
          {showPassword ? t('auth-hide-password', 'Hide password') : t('auth-show-password', 'Show password')}
        </button>
      </div>
      {registering && <>
        <label htmlFor="auth-steam-id">{t('auth-register-steam-id', 'SteamID64 (optional)')}</label>
        <input id="auth-steam-id" name="steamId" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={17} aria-describedby={validation === 'steamId' ? `auth-steam-note ${errorId}` : 'auth-steam-note'}/>
        <p className="muted" id="auth-steam-note">{t('auth-register-steam-note', 'Without a SteamID, we cannot find you in analyzed matches or show your personal statistics. You can add it later in About me. Entering a SteamID manually does not verify ownership of the Steam account.')}</p>
      </>}
      {error && <p className="inline-alert danger" id={errorId} role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy || retryUntil > 0 || snapshot.state === 'CHECKING'}>
        {busy ? registering ? t('auth-registering', 'Creating account…') : t('auth-signing-in', 'Signing in…') : title}
      </button>
      {registering
        ? <Link to="/login">{t('auth-register-to-login', 'Already have an account? Sign in')}</Link>
        : <Link to="/register">{t('auth-login-to-register', 'No account? Create one')}</Link>}
    </form>
  </section>;
}
