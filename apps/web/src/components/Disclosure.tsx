import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';
import { demoBuild } from '../shared/env.js';

const REVEAL_EVENT = 'wrc:reveal';

/** Opens the disclosure with this id, e.g. from in-page navigation. */
export function revealSection(id: string) {
  window.dispatchEvent(new CustomEvent<string>(REVEAL_EVENT, { detail: id }));
}

/**
 * Summary-first container: the trigger shows what is inside, the body expands
 * from the trigger downwards and collapses back into it.
 */
export function Disclosure({ id, title, caption, summary, icon, variant = 'panel', className = '', defaultOpen = false, level = 2, children }: {
  id?: string | undefined; title: ReactNode; caption?: ReactNode; summary?: ReactNode; icon?: IconName | undefined;
  variant?: 'panel' | 'quiet' | 'notice'; className?: string; defaultOpen?: boolean; level?: 2 | 3; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => defaultOpen || (!demoBuild && !!id && window.location.hash === '#' + id));
  const panelId = useId();
  useEffect(() => {
    if (!id) return;
    const reveal = (event: Event) => { if ((event as CustomEvent<string>).detail === id) setOpen(true); };
    const hash = () => { if (window.location.hash === '#' + id) setOpen(true); };
    window.addEventListener(REVEAL_EVENT, reveal);
    window.addEventListener('hashchange', hash);
    return () => { window.removeEventListener(REVEAL_EVENT, reveal); window.removeEventListener('hashchange', hash); };
  }, [id]);
  const Heading = level === 2 ? 'h2' : 'h3';
  return <section id={id} className={`disclosure ${variant === 'panel' ? 'panel' : variant === 'notice' ? 'panel notice' : 'quiet'} ${open ? 'is-open' : ''} ${className}`}>
    <Heading className="disclosure-heading">
      <button type="button" className="disclosure-trigger" id={panelId + '-trigger'} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        {icon && <span className="disclosure-icon"><Icon name={icon} size={18}/></span>}
        <span className="disclosure-title">{title}{caption && <small>{caption}</small>}</span>
        {summary !== undefined && summary !== null && <span className="disclosure-summary">{summary}</span>}
        <span className="disclosure-chevron"><Icon name="chevron" size={18}/></span>
      </button>
    </Heading>
    <div className="disclosure-panel" id={panelId} role="region" aria-labelledby={panelId + '-trigger'} inert={!open}>
      <div className="disclosure-inner"><div className="disclosure-body">{children}</div></div>
    </div>
  </section>;
}

/** Keeps content mounted for a short exit transition after `shown` turns false. */
export function usePresence(shown: boolean, exitMs = 120) {
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (shown) { setMounted(true); return; }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [shown, exitMs]);
  return { mounted: shown || mounted, leaving: !shown && mounted };
}
