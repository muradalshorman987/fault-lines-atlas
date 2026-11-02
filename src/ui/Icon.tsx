import type { CSSProperties } from 'react';
import { ICONS } from '../config';

/** Inline 24×24 stroke icon from config.ICONS (stroke = currentColor). `className` replaces the default `ic`; `style` goes on the <svg>. */
export function Icon({ name, size = 18, className = 'ic', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />
  );
}
