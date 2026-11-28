import { useId, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export type ProfileTab = 'stats' | 'matches' | 'about';

export function useProfileTabs(personal: boolean, linked: boolean) {
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab');
  const tab: ProfileTab = requested === 'stats' || requested === 'matches' || (personal && requested === 'about')
    ? requested : personal && !linked ? 'about' : 'stats';
  const select = (next: ProfileTab, replace = false) => {
    const params = new URLSearchParams(search);
    params.set('tab', next);
    setSearch(params, { preventScrollReset: true, replace });
  };
  return { tab, select, id: useId() };
}

export function ProfileTabs({ id, personal, tab, select }: {
  id: string; personal: boolean; tab: ProfileTab; select: (tab: ProfileTab) => void;
}) {
  const { t, i18n } = useTranslation('player');
  const options = [
    { tab: 'stats', label: t('profile-tab-stats', 'Statistics') },
    { tab: 'matches', label: t('profile-tab-matches', 'All matches') },
    ...(personal ? [{ tab: 'about' as const, label: t('profile-tab-about', 'About me') }] : []),
  ] as const;
  function focusTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const key = event.key;
    if (key !== 'Home' && key !== 'End' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();
    const forward = key === (i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : (index + (forward ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    document.getElementById(`${id}-tab-${option.tab}`)?.focus();
    select(option.tab);
  }

  return <div className="profile-tabs" role="tablist" aria-label={t('persistent-profile', 'Player profile')}>
    {options.map((option, index) => <button key={option.tab} type="button" role="tab" id={`${id}-tab-${option.tab}`}
      aria-selected={tab === option.tab} aria-controls={`${id}-panel-${option.tab}`}
      tabIndex={tab === option.tab ? 0 : -1} onClick={() => select(option.tab)} onKeyDown={event => focusTab(event, index)}>
      {option.label}
    </button>)}
  </div>;
}
