import { useEffect, useState } from 'react';
import type { Window as TauriWindow } from '@tauri-apps/api/window';

/**
 * A 无边框窗口的自定义标题栏。
 *
 * - 整条标题栏与标题文字都标了 `data-tauri-drag-region`，拖动窗口、双击最大化/还原由 Tauri 内核处理；
 *   三个窗口按钮**不带**这个标记，否则按钮自己会变成拖动区、点不动。
 * - 只有在真正的 Tauri 里运行时才渲染窗口按钮：浏览器 / Playwright 下只渲染标题条，
 *   这样 e2e 既看不到也点不到窗口按钮，不会把"窗口操作"误当成网页功能。
 * - 最大化/还原图标与"激活/未激活"外观都跟着真实窗口事件走，不靠猜测。
 */
export function TitleBar() {
  /** null＝非 Tauri 环境（浏览器 / e2e）：不渲染窗口按钮。 */
  const [win, setWin] = useState<TauriWindow | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const current = getCurrentWindow();
        if (cancelled) return;
        setWin(current);
        setMaximized(await current.isMaximized());
        unlisteners.push(await current.onResized(() => {
          void current.isMaximized().then((value) => { if (!cancelled) setMaximized(value); });
        }));
        unlisteners.push(await current.onFocusChanged((event) => { if (!cancelled) setFocused(event.payload); }));
      } catch {
        // 非 Tauri 环境或权限不足：保留纯标题条，绝不因为它影响其余功能。
      }
    })();
    return () => { cancelled = true; for (const off of unlisteners) off(); };
  }, []);

  return <div className="titlebar" data-focused={focused ? 'true' : 'false'}>
    <span className="titlebar-mark" aria-hidden="true">●</span>
    <span className="titlebar-title" data-tauri-drag-region>AI Wiring Studio</span>
    <span className="titlebar-fill" data-tauri-drag-region aria-hidden="true" />
    {win && <div className="titlebar-buttons">
      <button type="button" className="titlebar-button" aria-label="最小化" title="最小化" onClick={() => void win.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0 5h10" /></svg>
      </button>
      <button type="button" className="titlebar-button" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} onClick={() => void win.toggleMaximize()}>
        {maximized
          ? <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5V0.5h7v7h-2" /></svg>
          : <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="9" height="9" /></svg>}
      </button>
      <button type="button" className="titlebar-button close" aria-label="关闭" title="关闭" onClick={() => void win.close()}>
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </button>
    </div>}
  </div>;
}