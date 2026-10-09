import { useEffect, useState, type DragEvent } from 'react';
import {
  clearAiApiKey,
  createConfiguredAiProviders,
  createLocalStorageAiSettingsStorage,
  createTauriInvoker,
  isAiApiKeyConfigured,
  loadAiSettings,
  saveAiSettings,
  setAiApiKey,
  type AiImportInvoker,
  type AiImportSettings,
} from '../ai/tauriImportProvider';
import {
  definitionFromCandidate,
  importComponentCandidate,
  type ComponentCandidate,
  type ComponentDefinition,
  type ComponentImage,
  type ImportSource,
  type ImportSourceKind,
} from '../domain';
import { readFileAsDataUrl, readImageSize } from './ComponentImageEditor';
import { CandidateReview, knownFieldPaths } from './CandidateReview';
import { Dialog, DialogContent, DialogTitle } from './components';

/**
 * AI 元件导入面板（M4-D）。
 *
 * 职责边界：
 * - 只呈现"候选"并让用户逐字段确认；AI 建议永远不会自动成为已确认，写入用户元件库必须由用户显式点击确认。
 * - 面板不接触任何密钥：密钥只由 Rust 侧从 Windows 凭据管理器读写，输入框写入后立即清空、绝不回显。
 * - 无可用 AI（未配置密钥或非桌面环境）时明确提示"AI 不可用"，手工创建元件流程完全不受影响。
 */

const sourceKinds: { kind: ImportSourceKind; label: string; hint: string }[] = [
  { kind: 'text', label: '参数文字', hint: '粘贴数据手册或网页中的元件参数文字' },
  { kind: 'model', label: '元件型号', hint: '只输入型号，由模型依据其掌握的资料抽取' },
  { kind: 'image', label: '元件图片', hint: '上传丝印、引脚标注或参数表格的图片（也可直接把图片拖进这里）' },
  { kind: 'url', label: '资料链接', hint: '提供数据手册或资料网页地址' },
];

export interface AiImportPanelProps {
  /** 用户确认后写入用户元件库。 */
  onConfirm: (definition: ComponentDefinition) => void;
  onCancel: () => void;
}

export function AiImportPanel({ onConfirm, onCancel }: AiImportPanelProps) {
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>('text');
  const [text, setText] = useState('');
  const [model, setModel] = useState('');
  const [url, setUrl] = useState('');
  // 上传的元件图片必须带原图像素尺寸，否则画布无法建立坐标映射、无法显示。
  const [image, setImage] = useState<ComponentImage | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [invoker, setInvoker] = useState<AiImportInvoker | null>(null);
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [settings, setSettings] = useState<AiImportSettings>(() => loadAiSettings(createLocalStorageAiSettingsStorage()));
  const [keyInput, setKeyInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [candidate, setCandidate] = useState<ComponentCandidate | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [acceptedPins, setAcceptedPins] = useState<string[]>([]);
  const [nameOverride, setNameOverride] = useState('');

  // 启动时确定当前环境是否有原生能力：非桌面版（浏览器）时明确呈现"AI 不可用"，而不是假装可用。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await createTauriInvoker();
      if (cancelled) return;
      setInvoker(next);
      setNativeUnavailable(next === null);
      if (next) setKeyConfigured(await isAiApiKeyConfigured(next));
    })();
    return () => { cancelled = true; };
  }, []);

  const buildSource = (): ImportSource | null => {
    switch (sourceKind) {
      case 'text':
        return text.trim() === '' ? null : { kind: 'text', text };
      case 'model':
        return model.trim() === '' ? null : { kind: 'model', model };
      case 'url':
        return url.trim() === '' ? null : { kind: 'url', url };
      case 'image':
        return image === undefined ? null : { kind: 'image', image };
      case 'component-lookup':
        // 该来源由「导入接线代码」面板在缺元件时发起，本面板不涉及。
        return null;
    }
  };

  /**
   * 接受一张用户选入/拖入的图片：先校验类型，再读成 data URL 并取原图像素尺寸。
   * 失败时清空旧图并明确报错，绝不保留"看起来可用"的残留图片。
   */
  const applyImageFile = (file: File) => {
    // 先清掉旧图：避免选了合法图后又选到非法文件时，残留的旧图仍显示为“可导入”。
    setImage(undefined);
    setCandidate(null);
    if (!file.type.startsWith('image/')) return setError('请选择图片文件。');
    void (async () => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const size = await readImageSize(dataUrl);
        // 与手工编辑器一致：带上原图像素尺寸与初始旋转，画布才能等比摆放并显示图片。
        setImage({ dataUrl, naturalWidth: size.width, naturalHeight: size.height, rotation: 0 });
        setError(null);
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : '无法读取图片');
      }
    })();
  };

  const onImageDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) applyImageFile(file);
    else setError('请拖入一张图片文件。');
  };

  const runImport = async () => {
    setError(null); setNotice(null); setCandidate(null);
    const source = buildSource();
    if (source === null) return setError('请先填写或选择要导入的内容。');
    if (invoker === null) return setError(`AI 不可用：当前环境没有可用的原生能力，可继续手工创建元件。`);
    setBusy(true);
    try {
      // 是否可用以原生侧的真实状态为准：未配置密钥时这里是空列表，结果必然是"AI 不可用"。
      const providers = await createConfiguredAiProviders(invoker, settings);
      const result = await importComponentCandidate(providers, source);
      if (result.status === 'unavailable') return setError(result.reason);
      if (result.status === 'error') return setError(result.reason);
      setCandidate(result.candidate);
      // 默认勾选已识别的字段与引脚；未识别字段保持未知、不可勾选。写入仍需用户显式点击确认。
      setAccepted(knownFieldPaths(result.candidate));
      setAcceptedPins(result.candidate.pins.map((pin) => pin.tempId));
      setNameOverride('');
      setNotice('已获得 AI 候选。请逐项确认要写入用户元件库的字段——AI 建议不会自动成为已确认。');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'AI 导入失败');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) => setAccepted((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  const togglePin = (tempId: string) => setAcceptedPins((current) => (current.includes(tempId) ? current.filter((item) => item !== tempId) : [...current, tempId]));

  const confirm = () => {
    if (!candidate) return;
    setError(null);
    try {
      const definition = definitionFromCandidate(candidate, {
        id: `user.${crypto.randomUUID().slice(0, 8)}`,
        ...(nameOverride.trim() !== '' ? { displayName: nameOverride.trim() } : {}),
        acceptedFields: accepted,
        acceptedPinTempIds: acceptedPins,
      });
      onConfirm(definition);
    } catch (thrown) {
      setError(thrown instanceof Error ? `无法写入用户元件库：${thrown.message}` : '无法写入用户元件库');
    }
  };

  const saveSettings = () => {
    setError(null); setNotice(null);
    try {
      const next = { baseUrl: settings.baseUrl, textModel: settings.textModel, visionModel: settings.visionModel };
      saveAiSettings(createLocalStorageAiSettingsStorage(), next);
      setSettings(next);
      setNotice('已保存接口设置（不含密钥）。');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : '设置无效');
    }
  };

  const saveKey = async () => {
    setError(null); setNotice(null);
    if (invoker === null) return setError('当前环境不支持保存 API Key，可继续手工创建元件。');
    try {
      await setAiApiKey(invoker, keyInput);
      setKeyInput('');
      setKeyConfigured(await isAiApiKeyConfigured(invoker));
      setNotice('API Key 已写入 Windows 凭据管理器，密钥不会保存在本应用文件中。');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : '保存 API Key 失败');
    }
  };

  const clearKey = async () => {
    setError(null); setNotice(null);
    if (invoker === null) return;
    try {
      await clearAiApiKey(invoker);
      setKeyConfigured(false);
      setNotice('已从 Windows 凭据管理器清除 API Key。');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : '清除 API Key 失败');
    }
  };

  const activeKind = sourceKinds.find((item) => item.kind === sourceKind)!;

  return <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
    <DialogContent className="editor ai-import" aria-label="AI 元件导入">
      <header className="editor-head">
        <DialogTitle asChild><strong>AI 元件导入</strong></DialogTitle>
        <span>AI 只产出“候选”；必须由你逐字段确认后才会写入用户元件库，AI 建议不会自动成为已确认。</span>
      </header>
      <div className="editor-body">
        <section className="editor-section">
          <div className="editor-section-head">
            <h3>AI 连接状态</h3>
            <button type="button" className="ghost" onClick={() => setSettingsOpen((open) => !open)}>{settingsOpen ? '收起设置' : '接口与密钥设置'}</button>
          </div>
          <p className="hint" role="status">
            {nativeUnavailable
              ? 'AI 不可用：当前环境没有可用的原生能力（非桌面版），可继续手工创建元件。'
              : keyConfigured
                ? '已配置 API Key（存放于 Windows 凭据管理器，本应用不保存、不回显）。'
                : '尚未配置 API Key，AI 暂不可用；可继续手工创建元件。'}
          </p>
          {settingsOpen && <div className="ai-settings">
            <label className="editor-field"><span className="editor-field-name">接口地址（https）</span>
              <input aria-label="AI 接口地址" value={settings.baseUrl} onChange={(event) => setSettings((current) => ({ ...current, baseUrl: event.target.value }))} />
            </label>
            <label className="editor-field"><span className="editor-field-name">文字模型</span>
              <input aria-label="AI 文字模型" value={settings.textModel} onChange={(event) => setSettings((current) => ({ ...current, textModel: event.target.value }))} />
            </label>
            <label className="editor-field"><span className="editor-field-name">视觉模型</span>
              <input aria-label="AI 视觉模型" value={settings.visionModel} onChange={(event) => setSettings((current) => ({ ...current, visionModel: event.target.value }))} />
            </label>
            <div className="ai-key-row">
              <button type="button" onClick={saveSettings}>保存接口设置</button>
              <input aria-label="API Key" type="password" autoComplete="off" placeholder="粘贴 API Key（写入后立即清空）" value={keyInput} disabled={nativeUnavailable} onChange={(event) => setKeyInput(event.target.value)} />
              <button type="button" className="primary" onClick={saveKey} disabled={nativeUnavailable}>保存密钥</button>
              <button type="button" className="ghost danger" onClick={clearKey} disabled={nativeUnavailable}>清除密钥</button>
            </div>
            <p className="hint">密钥只交由系统凭据管理器保管；接口地址与模型名不是密钥，保存在本机设置中。</p>
          </div>}
        </section>

        <section className="editor-section">
          <h3>导入来源</h3>
          <div className="ai-kind-row">
            {sourceKinds.map((item) => <button type="button" key={item.kind} aria-pressed={sourceKind === item.kind} className={sourceKind === item.kind ? 'active' : ''} onClick={() => { setSourceKind(item.kind); setCandidate(null); setError(null); setNotice(null); }}>{item.label}</button>)}
          </div>
          <p className="hint">{activeKind.hint}</p>
          {sourceKind === 'text' && <textarea aria-label="元件参数文字" rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：TPS62160，输入电压 3–17 V，输出电流 1 A，SW 引脚最大 6 V…" />}
          {sourceKind === 'model' && <input aria-label="元件型号" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如：TPS62160" />}
          {sourceKind === 'url' && <input aria-label="资料链接" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />}
          {sourceKind === 'image' && <label className="image-upload" onDragOver={(event) => event.preventDefault()} onDrop={onImageDrop}>选择图片（或把图片拖到这里）<input aria-label="上传元件图片" type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            applyImageFile(file);
          }} /></label>}
          {sourceKind === 'image' && image?.dataUrl && <img className="ai-image-preview" src={image.dataUrl} alt="待导入的元件图片" />}
          <div className="ai-actions">
            <button type="button" className="primary" onClick={runImport} disabled={busy}>{busy ? '正在识别…' : '开始识别'}</button>
          </div>
        </section>

        {notice && <p className="ai-notice" role="status">{notice}</p>}

        {candidate && <section className="editor-section">
          <h3>AI 候选（逐字段确认）</h3>
          <CandidateReview
            candidate={candidate}
            accepted={accepted}
            acceptedPins={acceptedPins}
            onToggleField={toggle}
            onTogglePin={togglePin}
            onAcceptAllKnown={() => setAccepted(knownFieldPaths(candidate))}
            onClearAccepted={() => setAccepted([])}
            nameOverride={{ value: nameOverride, onChange: setNameOverride }}
          />
        </section>}
      </div>
      {error && <p className="editor-error" role="alert">{error}</p>}
      <footer className="editor-foot">
        <span className="hint">写入的字段会保留其来源与置信度（如“估算 · AI 建议”），不会因为确认而升级为“已确认”。</span>
        <div>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="primary" onClick={confirm} disabled={!candidate}>确认写入用户元件库</button>
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}