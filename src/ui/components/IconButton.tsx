import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

export type IconButtonVariant = 'default' | 'ghost' | 'danger';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** 无障碍名称（必填）：图标按钮没有可见文字，读屏与悬浮提示都靠它。 */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  /** 开关型按钮的激活态：加青色选中底，并同步 aria-pressed。 */
  active?: boolean;
}

/** 32×32 图标按钮薄封装；label 同时用作 aria-label 与 title。 */
export function IconButton({ label, icon, variant = 'default', active = false, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      className={cx('aiws-icon-btn', `aiws-icon-btn--${variant}`, active && 'is-active', className)}
    >
      {icon}
    </button>
  );
}