import * as RadixTabs from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cx } from './cx';

/**
 * Tabs：方向键切换、roving tabindex、aria 关联由 Radix 处理，
 * 我们只负责视觉类名；激活态用 data-state="active" 表达。
 */
export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...rest }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cx('aiws-tabs__list', className)} {...rest} />;
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RadixTabs.Trigger>) {
  return <RadixTabs.Trigger className={cx('aiws-tabs__trigger', className)} {...rest} />;
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cx('aiws-tabs__content', className)} {...rest} />;
}