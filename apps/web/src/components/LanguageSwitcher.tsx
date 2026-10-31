import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localeCatalog, type SupportedLanguage } from '../shared/i18n/locale-catalog.js';
import { prepareLanguage, rememberLanguagePreference } from '../shared/i18n/client.js';
import { Icon } from './Icon.js';

const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });
function searchable(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/['’‘ʻʼ]/gu, '').toLowerCase();
}

function LanguageBadge({ code }: { code: SupportedLanguage }) {
  return <span className="language-badge" dir="ltr" aria-hidden="true">{code.toUpperCase()}</span>;
}

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCode, setActiveCode] = useState<SupportedLanguage | null>(null);
  const [pending, setPending] = useState<SupportedLanguage | null>(null);
  const [error, setError] = useState(false);
  const current = localeCatalog.find(({ code }) => code === i18n.resolvedLanguage) ?? localeCatalog[0];
  const entries = useMemo(() => {
    const names = new Intl.DisplayNames([current.code], { type: 'language' });
    return localeCatalog.map((locale) => {
      const english = englishNames.of(locale.code) ?? locale.name;
      const local = names.of(locale.code) ?? english;
      return { ...locale, secondary: local !== locale.name ? local : english !== locale.name ? english : '', searchText: searchable([locale.code, locale.name, english, local].join(' ')) };
    });
  }, [current.code]);
  const query = searchable(search).trim();
  const terms = query.split(/\s+/u).filter(Boolean);
  const matches = entries.filter(({ searchText }) => terms.every((term) => searchText.includes(term)))
    .sort((a, b) => Number(b.code === query) - Number(a.code === query));
  const active = matches.find(({ code }) => code === activeCode) ?? matches[0];
  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeMenu(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, closeMenu]);
  useEffect(() => {
    if (open && active) document.getElementById(`${id}-${active.code}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [open, active?.code, id]);

  function openMenu() {
    if (busy.current) return;
    setSearch(''); setActiveCode(current.code); setOpen(true);
  }
  async function select(code: SupportedLanguage) {
    if (busy.current) return;
    if (code === current.code) { setError(false); closeMenu(true); return; }
    busy.current = true; setPending(code);
    try {
      setError(false);
      await prepareLanguage(code);
      if (!mounted.current) return;
      await i18n.changeLanguage(code);
      rememberLanguagePreference(code);
      if (mounted.current) closeMenu(!!root.current?.contains(document.activeElement));
    } catch {
      if (mounted.current) setError(true);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return <div className="language-switch" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
  }}>
    <button type="button" className="language-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-dialog` : undefined} aria-labelledby={`${id}-label ${id}-current`} aria-busy={!!pending} aria-disabled={!!pending} onClick={() => open ? closeMenu(true) : openMenu()} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); }
    }}>
      <span id={`${id}-label`} className="sr-only">{t('language', 'Language')}</span>
      <LanguageBadge code={current.code}/><span className="language-current" id={`${id}-current`} lang={current.code} dir={current.direction} title={current.name}>{current.name}</span>
      {pending ? <span className="spinner"/> : <Icon name="chevron" size={14}/>}
    </button>
    {open && <div className="language-menu" id={`${id}-dialog`} role="dialog" aria-labelledby={`${id}-title`}>
      <div className="language-menu-heading"><strong id={`${id}-title`}>{t('language', 'Language')}</strong><button type="button" className="language-close" aria-label={t('language-close', 'Close language menu')} onClick={() => closeMenu(true)}><Icon name="close" size={18}/></button></div>
      <div className="language-search"><Icon name="search" size={18}/><input ref={input} type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={active ? `${id}-${active.code}` : undefined} aria-label={t('language-search', 'Search languages')} placeholder={t('language-search', 'Search languages')} value={search} readOnly={!!pending} autoComplete="off" spellCheck={false} onChange={(event) => { setSearch(event.target.value); setActiveCode(null); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || busy.current) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!matches.length) return;
          const index = matches.findIndex(({ code }) => code === active?.code);
          const next = matches[(index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length];
          if (next) setActiveCode(next.code);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (active) void select(active.code);
        }
      }}/></div>
      {error && <p className="language-error" role="alert">{t('language-change-error', 'Could not switch language. Try again.')}</p>}
      <div className="language-options" id={`${id}-list`} role="listbox" tabIndex={-1} aria-label={t('language', 'Language')} aria-busy={!!pending}>
        {matches.map((locale) => <div className={`language-option ${active?.code === locale.code ? 'is-active' : ''}`} role="option" id={`${id}-${locale.code}`} key={locale.code} aria-selected={locale.code === current.code} aria-disabled={!!pending} onMouseDown={(event) => event.preventDefault()} onPointerMove={(event) => { if (event.pointerType === 'mouse' && !busy.current) setActiveCode(locale.code); }} onClick={() => void select(locale.code)}>
          <LanguageBadge code={locale.code}/><span className="language-option-name"><strong lang={locale.code} dir={locale.direction}>{locale.name}</strong>{locale.secondary && <small>{locale.secondary}</small>}</span>{pending === locale.code ? <span className="spinner"/> : locale.code === current.code && <Icon name="check" size={17}/>}
        </div>)}
      </div>
      {!matches.length && <p className="language-empty" role="status">{t('language-no-results', 'No languages found')}</p>}
    </div>}
  </div>;
}
