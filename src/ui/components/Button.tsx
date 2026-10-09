import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** primary＝全界面同屏唯一的"张扬"主操作（渐变底+深色字），其余一律安静。 */
  variant?: ButtonVariant;
  /** md＝32px（紧凑，默认），lg＝36px（常规）。 */
  size?: ButtonSize;
  /** 16px 图标（如 lucide 图标），渲染在文字之前。 */
  icon?: ReactNode;
  children?: ReactNode;
}

/** 原生 <button> 的统一薄封装：只统一外观类名，行为（type/事件/禁用）全部透传。 */
export function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('aiws-btn', `aiws-btn--${variant}`, size === 'lg' && 'aiws-btn--lg', className)}
    >
      {icon ? <span className="aiws-btn__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}