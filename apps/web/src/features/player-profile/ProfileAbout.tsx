import { useState, type FormEvent } from 'react';
import { authPlayerLinkInputSchema, type AuthPlayerLink, type AuthPlayerLinkInput } from '@who-ruined/contracts';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../shared/messages.js';
import { ApiClientError } from '../../shared/api/transport.js';

export function ProfileAbout({ link, busy, error, save }: {
  link: AuthPlayerLink; busy: boolean; error: unknown; save: (input: AuthPlayerLinkInput | null) => void;
}) {
  const { t } = useTranslation('player');
  const common = useTranslation().t;
  const [invalid, setInvalid] = useState(false);
  const linked = link.state === 'LINKED';
  const message = invalid ? t('profile-link-invalid', 'Enter a valid SteamID64 and a nickname.')
    : error instanceof ApiClientError && error.status === 401
      ? common('auth-expired', 'Your session has ended. Sign in again.') : error ? errorMessage(error, common) : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = authPlayerLinkInputSchema.safeParse({ steamId: String(form.get('steamId') ?? '').trim(), nickname: form.get('nickname') });
    setInvalid(!input.success);
    if (input.success) save(input.data);
  }

  return <div className="profile-section profile-about">
    <h2>{t('profile-tab-about', 'About me')}</h2>
    <p>{t('profile-link-manual', 'A manually entered SteamID does not verify ownership of a Steam account.')}</p>
    <form key={linked ? `${link.steamId}:${link.nickname}` : 'unlinked'} onSubmit={submit} noValidate aria-busy={busy}>
      <label htmlFor="profile-steam-id">SteamID64</label>
      <input id="profile-steam-id" name="steamId" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={17} required
        defaultValue={linked ? link.steamId : ''} aria-describedby={message ? 'profile-link-error' : undefined} disabled={busy}/>
      <label htmlFor="profile-nickname">{t('profile-link-nickname', 'In-game nickname')}</label>
      <input id="profile-nickname" name="nickname" dir="auto" maxLength={80} required defaultValue={linked ? link.nickname : ''}
        aria-describedby={message ? 'profile-link-error' : undefined} disabled={busy}/>
      {message && <p className="inline-alert danger" role="alert" id="profile-link-error">{message}</p>}
      <div className="profile-history-actions">
        <button className="button primary" type="submit" disabled={busy}>{t('profile-link-save', 'Save')}</button>
        {linked && <button className="button secondary" type="button" disabled={busy} onClick={() => {
          setInvalid(false); save(null);
        }}>{t('profile-link-remove', 'Unlink SteamID')}</button>}
      </div>
    </form>
  </div>;
}
