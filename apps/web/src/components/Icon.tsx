import type { CSSProperties } from 'react';

const paths = {
  crosshair: 'M12 2v4m0 12v4M2 12h4m12 0h4M8 8h8v8H8z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  chart: 'M4 20V4m0 16h16M8 16v-4m4 4V8m4 8V5',
  rounds: 'M5 4h14v16H5zM9 4v16M5 9h14M5 14h14',
  check: 'm5 12 4 4L19 6',
  warning: 'm12 3 10 18H2L12 3Zm0 5v5m0 3v1',
  trophy: 'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 0h8',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  link: 'M9 15l6-6m-7 3-3 3a3 3 0 0 0 4 4l3-3m0-8 3-3a3 3 0 0 1 4 4l-3 3',
  external: 'M14 3h7v7m0-7L10 14M9 3H3v18h18v-6',
  back: 'M19 12H5m6-6-6 6 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm6 9 6 6 6-6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  offline: 'm3 3 18 18M2 8a16 16 0 0 1 4-2m4-1a16 16 0 0 1 12 3M5 12a11 11 0 0 1 5-2m5 1 4 1m-11 4a5 5 0 0 1 7 0m-3 4h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  info: 'M12 16v-5m0-3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  expand: 'M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]}/></svg>;
}
