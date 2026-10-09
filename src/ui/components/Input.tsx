import type { ComponentProps } from 'react';
import { cx } from './cx';

export type InputProps = ComponentProps<'input'>;

/** 原生 <input> 的统一薄封装：只加外观类名，校验/受控状态由调用方负责。 */
export function Input({ className, ...rest }: InputProps) {
  return <input {...rest} className={cx('aiws-input', className)} />;
}