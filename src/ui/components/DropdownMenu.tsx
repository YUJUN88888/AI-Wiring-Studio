import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cx } from './cx';

/**
 * DropdownMenu：菜单键盘导航、Escape、点击外部关闭、Portal 层级交给 Radix，
 * 我们只补视觉类名。Item 通过 data-highlighted 表达"当前高亮项"。
 *
 * 与画布快捷键的隔离：Radix 只在菜单打开且焦点在菜单内时接管方向键/Escape，
 * 关闭后不会残留全局监听，因此不影响画布的方向键平移与 Delete 等快捷键。
 */
export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;
export const DropdownMenuLabel = RadixMenu.Label;
export const DropdownMenuSeparator = RadixMenu.Separator;
export const DropdownMenuSub = RadixMenu.Sub;
export const DropdownMenuSubTrigger = RadixMenu.SubTrigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...rest }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content sideOffset={sideOffset} className={cx('aiws-menu', className)} {...rest} />
    </RadixMenu.Portal>
  );
}

export function DropdownMenuItem({ className, ...rest }: ComponentProps<typeof RadixMenu.Item>) {
  return <RadixMenu.Item className={cx('aiws-menu__item', className)} {...rest} />;
}

export function DropdownMenuSubContent({ className, ...rest }: ComponentProps<typeof RadixMenu.SubContent>) {
  return <RadixMenu.Portal><RadixMenu.SubContent className={cx('aiws-menu', className)} {...rest} /></RadixMenu.Portal>;
}