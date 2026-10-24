import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.js';

/*
  One section, one thought: a text column (label, heading, one lead paragraph, at most
  one action) beside one large rounded stage holding a single visual. Sides alternate
  with `alt`; `band` paints a full-bleed darker background. `expand` is the uncompressed
  version of the stage, opened from the icon beside the heading. See docs/design-composition.md.
*/
export function Story({ id, label, title, lead, aside, actions, expand, hero = false, alt = false, band = false, className = '', children }: {
  id?: string | undefined; label?: ReactNode; title: ReactNode; lead?: ReactNode; aside?: ReactNode; actions?: ReactNode; expand?: ReactNode;
  hero?: boolean; alt?: boolean; band?: boolean; className?: string; children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Items marked `stagger-item` cascade in the first time the stage enters the viewport.
  const stageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stage.classList.add('stagger-pending');
    // Content must never stay hidden: besides the observer, a plain geometry check on scroll, resize
    // and a slow timer reveals the stage, which also covers pages where observers and scroll events are throttled.
    const reveal = () => {
      if (!stage.classList.contains('stagger-pending')) return;
      stage.classList.replace('stagger-pending', 'is-in');
      cleanup();
    };
    const check = () => {
      const r = stage.getBoundingClientRect();
      const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (visible > Math.min(r.height, window.innerHeight) * 0.15) reveal();
    };
    const poll = window.setInterval(() => check(), 500);
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) reveal(); }, { threshold: 0.15 });
    const cleanup = () => { observer.disconnect(); window.removeEventListener('scroll', check); window.removeEventListener('resize', check); window.clearInterval(poll); };
    observer.observe(stage);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
    return () => { cleanup(); stage.classList.remove('stagger-pending'); };
  }, []);
  const [origin, setOrigin] = useState('50% 50%');
  const heading = hero ? <h1>{title}</h1> : <h2>{title}</h2>;
  return <section id={id} className={`story ${hero ? 'hero' : ''} ${alt ? 'alt' : ''} ${band ? 'band' : ''} ${className}`}>
    <div className="story-copy">
      {expand && <button type="button" className="story-expand" aria-haspopup="dialog" aria-label={t('expand-section', 'Open in full')} title={t('expand-section', 'Open in full')} onClick={(event) => { const b = event.currentTarget.getBoundingClientRect(); setOrigin(`${Math.round(b.left + b.width / 2)}px ${Math.round(b.top + b.height / 2)}px`); setOpen(true); }}><Icon name="expand" size={22}/></button>}
      {label && <span className="story-label">{label}</span>}
      {heading}
      {lead && <p className="story-lead">{lead}</p>}
      {aside}
      {actions && <div className="story-actions">{actions}</div>}
    </div>
    <div className="stage" ref={stageRef}>{children}</div>
    {expand && open && <Sheet title={title} origin={origin} onClose={() => setOpen(false)}>{expand}</Sheet>}
  </section>;
}

/** Modal sheet with the full, uncompressed content of a section. Esc, the close button and the backdrop close it. */
function Sheet({ title, origin, onClose, children }: { title: ReactNode; origin: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Guarded for StrictMode's double effect run; unmounting removes the element, so no close() here
    // (it would fire the close event and loop back into onClose).
    if (!dialog.open) dialog.showModal();
    const box = dialog.getBoundingClientRect();
    const [x = NaN, y = NaN] = origin.split(' ').map((value) => parseFloat(value));
    if (Number.isFinite(x) && Number.isFinite(y)) dialog.style.setProperty('--sheet-origin', `${Math.round(x - box.left)}px ${Math.round(y - box.top)}px`);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [origin]);
  return <dialog ref={ref} className="sheet" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sheet-frame">
      <header className="sheet-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label={t('close-dialog', 'Close')} onClick={onClose}><Icon name="close" size={18}/></button></header>
      <div className="sheet-body">{children}</div>
    </div>
  </dialog>;
}
