import * as RadixDialog from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cx } from './cx';

/**
 * Dialog：行为（焦点陷阱、Escape 关闭、滚动锁定、aria-modal）全部交给 Radix，
 * 我们只提供视觉类名。用法：
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent className="editor">…<DialogTitle>标题</DialogTitle>…</DialogContent>
 *   </Dialog>
 *
 * 重要：DialogContent 经 Portal 挂到 document.body，因此 `.aiws-dialog*` 必须是**全局类名**，
 * 不能作用域在业务容器下（否则样式不生效）。同时它不写死内边距/布局，
 * 由调用方的类（如 .editor 的 head/body/foot）决定内部结构。
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

export function DialogContent({ className, children, ...rest }: ComponentProps<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="aiws-dialog-overlay" />
      <RadixDialog.Content className={cx('aiws-dialog', className)} {...rest}>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}