import type { Appearance, CanvasBackground } from '../domain';
import { Dialog, DialogContent, DialogTitle } from './components';

/** 画布背景三态：工程网格 / 点状 / 纯色。顺序固定，界面与提示文案都由它派生。 */
const BACKGROUND_CHOICES: readonly { value: CanvasBackground; label: string }[] = [
  { value: 'grid', label: '工程网格' },
  { value: 'dots', label: '点状' },
  { value: 'solid', label: '纯色' },
];

/** 一个颜色设置项：色块选择器 + 可读的十六进制值。 */
function ColorField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return <label className="appearance-field">
    <span className="editor-field-name">{label}</span>
    <span className="appearance-color-row">
      <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      <code>{value}</code>
    </span>
    <span className="hint">{hint}</span>
  </label>;
}

/**
 * 【设置】-【外观】面板。改动即时生效并立刻写入本地存储（改一层就存一层），
 * 所以这里没有"保存/取消"按钮，只有「恢复默认」与「关闭」。
 */
export function AppearancePanel({ appearance, onChange, onReset, onClose }: {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const patch = (changes: Partial<Appearance>) => onChange({ ...appearance, ...changes });
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="editor appearance" aria-label="设置">
      <header className="editor-head"><DialogTitle asChild><strong>设置 · 外观</strong></DialogTitle><span>只影响界面显示，不改动画布上的元件与接线数据。</span></header>
      <div className="editor-body">
        <section className="editor-section">
          <h3>颜色</h3>
          <p className="hint">「默认」颜色只作为新建时的兜底：已经指定过颜色的连线与元件不会被覆盖。</p>
          <div className="appearance-grid">
            <ColorField label="全局 UI 颜色" hint="选中轮廓、激活态边框。" value={appearance.uiColor} onChange={(uiColor) => patch({ uiColor })} />
            <ColorField label="画布颜色" hint="画布底色。" value={appearance.canvasColor} onChange={(canvasColor) => patch({ canvasColor })} />
            <ColorField label="默认连线颜色" hint="新建连线时用；已有连线各自保留自己的颜色。" value={appearance.wireColor} onChange={(wireColor) => patch({ wireColor })} />
            <ColorField label="默认元件颜色" hint="元件盒子的底色；上传过图片的元件仍以图片为准。" value={appearance.componentColor} onChange={(componentColor) => patch({ componentColor })} />
            <ColorField label="界面底色" hint="自定义标题栏与顶部菜单栏共用；标题文字按底色亮度自动取深色或浅色。" value={appearance.chromeColor} onChange={(chromeColor) => patch({ chromeColor })} />
          </div>
        </section>
        <section className="editor-section">
          <h3>画布背景</h3>
          <div className="appearance-choices" role="group" aria-label="画布背景">
            {BACKGROUND_CHOICES.map((choice) => <button key={choice.value} type="button" aria-pressed={appearance.background === choice.value} className={appearance.background === choice.value ? 'active' : ''} onClick={() => patch({ background: choice.value })}>{choice.label}</button>)}
          </div>
        </section>
      </div>
      <footer className="editor-foot">
        <span className="hint">外观存在本地，随应用打开自动恢复。</span>
        <div><button onClick={onReset}>恢复默认</button><button className="primary" onClick={onClose}>关闭</button></div>
      </footer>
    </DialogContent>
  </Dialog>;
}