import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  /** 提示文字：窄窗口下工具栏降级为图标时，用它补回文字含义。 */
  label: ReactNode;
  /** 必须恰好一个可接收 ref 的元素（asChild 约束），通常是按钮。 */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Tooltip 薄封装：自带 Provider，调用方无需在外层再包一层。
 * 悬停/焦点触发与延迟由 Radix 管理；内容经 Portal 挂到 body，样式用全局类名 .aiws-tooltip。
 */
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="aiws-tooltip" side={side} sideOffset={6}>
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}