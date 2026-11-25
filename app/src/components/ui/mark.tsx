import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/** The eight marks, in the order they are offered. Their colours are `--ohm-mark-<key>` in tokens.css. */
export const MARKS = [
  { key: 'navy', name: 'Navy' },
  { key: 'petrol', name: 'Petrol' },
  { key: 'forest', name: 'Forest' },
  { key: 'ochre', name: 'Ochre' },
  { key: 'clay', name: 'Clay' },
  { key: 'burgundy', name: 'Burgundy' },
  { key: 'plum', name: 'Plum' },
  { key: 'ink', name: 'Ink' },
] as const;
export type MarkKey = (typeof MARKS)[number]['key'];

export const markColor = (key: MarkKey) => `var(--ohm-mark-${key})`;

/** A mark as apps keep it: `burgundy` filled, `burgundy:edge` as an edge only, anything else none. */
export function readMark(value: string | null | undefined): { key: MarkKey; name: string; edge: boolean } | null {
  const [key, how] = (value ?? '').split(':');
  const mark = MARKS.find(m => m.key === key);
  return mark ? { key: mark.key, name: mark.name, edge: how === 'edge' } : null;
}

/**
 * The dot a person marks one of their own things with: filled with a mark colour, an edge of it
 * only, or, with no colour, a faint ring that says a mark can go here.
 */
export function Mark({ color, edge, className, style }: { color?: MarkKey | null; edge?: boolean; className?: string; style?: CSSProperties }) {
  const tone = color ? markColor(color) : 'var(--ohm-line)';
  return <span aria-hidden data-slot="mark" className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
    style={{ ...(color && !edge ? { background: tone } : { boxShadow: `inset 0 0 0 1.5px ${tone}` }), ...style }} />;
}
