/** Decorative, resolution-independent artwork. It never encodes analysis results. */
export function SignalIllustration({ mode = 'scan' }: { mode?: 'scan' | 'empty' | 'lost' | 'ready' }) {
  return <div className={`signal-art signal-${mode}`} aria-hidden="true"><div className="signal-grid"/><div className="signal-orbit orbit-outer"/><div className="signal-orbit orbit-inner"/><div className="signal-sweep"/>
    <svg viewBox="0 0 240 200" fill="none"><path className="signal-path" d="M16 145h42l20-39 28 20 25-58 34 21 24-44h35" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 7"/><circle cx="78" cy="106" r="4" fill="currentColor"/><circle cx="165" cy="89" r="4" fill="currentColor"/><path d="M108 100h24m-12-12v24" stroke="currentColor" strokeWidth="2"/><rect x="104" y="84" width="32" height="32" rx="7" stroke="currentColor"/></svg>
    <i className="signal-point point-one"/><i className="signal-point point-two"/><i className="signal-point point-three"/>
  </div>;
}
