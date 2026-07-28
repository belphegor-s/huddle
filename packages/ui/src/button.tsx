import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx.js';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/*
 * Every interactive element clears 44px on touch, which is why even the small
 * size is 2.75rem tall on coarse pointers. Desktop gets the tighter box back
 * through the media query in base.css.
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
  'transition-colors duration-(--duration-instant) select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-border-strong bg-surface-raised hover:bg-surface-hover',
  ghost: 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 w-full px-5 text-base',
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return <button className={cx(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
