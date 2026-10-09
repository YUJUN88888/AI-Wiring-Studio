import { useMemo, useState } from 'react';
import {
  buildWiringCodeDictionary,
  definitionFromCandidate,
  findMissingComponentKinds,
  importComponentCandidate,
  parseWiringCode,
  runErc,
  type ComponentCandidate,
  type ComponentDefinition,
  type MissingComponentKind,
  type Project,
} from '../domain';
import {
  createConfiguredAiProviders,
  createLocalStorageAiSettingsStorage,
  createTauriInvoker,
  loadAiSettings,
  type AiImportInvoker,
} from '../ai/tauriImportProvider';
import { CandidateReview, knownFieldPaths } from './CandidateReview';
import { Dialog, DialogContent, DialogTitle } from './components';

/**
 * 接线代码面板（M5）。
 *
 * 职责边界：
 * - 「导入代码」把外部 AI 写的接线代码**确定性地**解析成接线图；解析失败给出带行号的中文错误，绝不猜测修改。
 * - 「字典」把格式规范 + 当前可用元件与引脚导出成一段文本，供用户复制给自己的 AI 查阅。
 * - 代码里出现、但元件库里没有的元件类型会被**确定性扫描**出来（findMissingComponentKinds）；
 *   面板可请 AI 按型号补查参数，但补查结果同样只是"候选"，必须由用户逐字段确认后才写入用户元件库。
 * - 面板不接触密钥：密钥只由 Rust 侧从 Windows 凭据管理器读写。
 */

/**
 * 导入到画布的方式：
 * - replace：用代码替换整个画布（破坏性，非空时要二次确认）；
 * - append：把代码内容并入当前画布，已有内容不动；
 * - update（A8）：以代码为准**更新**当前画布，但先只显示差异预览，用户确认后才真正写入。
 */
export type WiringCodeApplyMode = 'replace' | 'append' | 'update';

export interface WiringCodePanelProps {
  /** 当前用户元件库中的定义：既用于解析 user.* 类型，也用于生成字典与扫描缺失元件。 */
  definitions: readonly ComponentDefinition[];
  /** 画布上是否已有内容；替换模式下非空画布需要二次确认，避免误清空。 */
  hasCanvasContent: boolean;
  /** 用户显式点击「应用到画布」。 */
  onApply: (project: Project, mode: WiringCodeApplyMode) => void;
  /** A8：用户点击「对比差异」——只把解析结果交上去算差异并进入预览态，不直接写入。 */
  onPreviewUpdate: (project: Project) => void;
  /** 用户确认补查结果后写入用户元件库；由上层持久化。 */
  onRegisterDefinition: (definition: ComponentDefinition) => void;
  onCancel: () => void;
}

const EXAMPLE = `version 1
# 让 AI 按字典写这种代码，粘贴到这里即可生成接线图
component u1 esp32-devkit-demo "主控" at 120,80
component r1 resistor-220r "限流电阻" at 400,80
component d1 red-led "指示灯" at 620,80
wire u1.GPIO21 r1.A
wire r1.B d1.A color #e34b4b
`;

export function WiringCodePanel({ definitions, hasCanvasContent, onApply, onPreviewUpdate, onRegisterDefinition, onCancel }: WiringCodePanelProps) {
  const [tab, setTab] = useState<'import' | 'dictionary'>('import');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<WiringCodeApplyMode>('replace');
  // 替换会清空画布，属于破坏性操作：画布非空时必须再点一次"确认替换"才真正执行。
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 补查缺失元件：token 表示当前正在复核哪一个元件；候选与勾选状态都只属于这一个 token。
  const [lookupToken, setLookupToken] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupCandidate, setLookupCandidate] = useState<ComponentCandidate | null>(null);
  const [lookupAccepted, setLookupAccepted] = useState<string[]>([]);
  const [lookupAcceptedPins, setLookupAcceptedPins] = useState<string[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() === '' ? null : parseWiringCode(text, { definitions })), [text, definitions]);
  const dictionary = useMemo(() => buildWiringCodeDictionary(definitions), [definitions]);
  const missing = useMemo(() => (text.trim() === '' ? [] : findMissingComponentKinds(text, definitions)), [text, definitions]);
  const preview = useMemo(() => {
    if (!parsed || parsed.status !== 'ok') return null;
    return { summary: parsed.summary, problems: runErc(parsed.project).problems.length };
  }, [parsed]);

  const pickFile = (file: File) => {
    setError(null); setNotice(null);
    void file.text().then((content) => setText(content)).catch(() => setError('无法读取该文件。'));
  };

  const apply = () => {
    setError(null); setNotice(null);
    // 追加模式用随机前缀，避免并入既有画布时实例 ID / 连线 ID 撞车；更新与替换沿用代码里的 ID。
    const options = mode === 'append'
      ? { definitions, idPrefix: `${crypto.randomUUID().slice(0, 8)}-` }
      : { definitions };
    const result = parseWiringCode(text, options);
    // 解析失败时行内已用 aria-live 提示同一错误，这里不再重复弹一条 role=alert。
    if (result.status === 'error') return;
    // 更新模式不直接写入：先把解析结果交上去算差异、进预览态，由用户「应用更新 / 取消」定夺。
    if (mode === 'update') { setConfirmingReplace(false); return onPreviewUpdate(result.project); }
    // 破坏性操作二次确认：替换模式下画布非空时，先停在确认态，等用户再点一次。
    if (mode === 'replace' && hasCanvasContent && !confirmingReplace) return setConfirmingReplace(true);
    setConfirmingReplace(false);
    onApply(result.project, mode);
  };

  const copyDictionary = () => {
    setError(null); setNotice(null);
    void navigator.clipboard.writeText(dictionary)
      .then(() => setNotice('字典已复制到剪贴板，粘贴给你的 AI 即可。'))
      .catch(() => setNotice('当前环境不允许自动复制，请手动全选字典文本后复制。'));
  };

  const resetLookup = () => {
    setLookupToken(null); setLookupBusy(false); setLookupCandidate(null);
    setLookupAccepted([]); setLookupAcceptedPins([]); setLookupError(null); setLookupNotice(null);
  };

  /** 请 AI 补查一个缺失元件：结果只是候选，必须由用户逐字段确认后才写入元件库。 */
  const runLookup = (item: MissingComponentKind) => {
    resetLookup();
    setLookupToken(item.token);
    setLookupBusy(true);
    void (async () => {
      try {
        const invoker: AiImportInvoker | null = await createTauriInvoker();
        if (invoker === null) {
          setLookupError('AI 不可用：当前环境没有可用的原生能力（非桌面版），可继续手工新建元件。');
          return;
        }
        const providers = await createConfiguredAiProviders(invoker, loadAiSettings(createLocalStorageAiSettingsStorage()));
        const result = await importComponentCandidate(providers, {
          kind: 'component-lookup',
          token: item.token,
          displayName: item.displayName,
          referencedPins: item.referencedPins,
        });
        if (result.status === 'unavailable') return setLookupError(result.reason);
        if (result.status === 'error') return setLookupError(result.reason);
        setLookupCandidate(result.candidate);
        setLookupAccepted(knownFieldPaths(result.candidate));
        setLookupAcceptedPins(result.candidate.pins.map((pin) => pin.tempId));
        setLookupNotice('已获得 AI 候选。请逐项确认要写入的字段——AI 建议不会自动成为已确认。');
      } catch (thrown) {
        setLookupError(thrown instanceof Error ? thrown.message : 'AI 补查失败');
      } finally {
        setLookupBusy(false);
      }
    })();
  };

  const confirmLookup = (item: MissingComponentKind) => {
    if (!lookupCandidate) return;
    setLookupError(null); setLookupNotice(null);
    try {
      const definition = definitionFromCandidate(lookupCandidate, {
        // 定义 id 必须逐字等于代码里的元件类型，否则这份代码重新导入仍会报"未知元件类型"。
        id: item.token,
        displayName: item.displayName,
        acceptedFields: lookupAccepted,
        acceptedPinTempIds: lookupAcceptedPins,
      });
      onRegisterDefinition(definition);
      resetLookup();
    } catch (thrown) {
      setLookupError(thrown instanceof Error ? `无法写入用户元件库：${thrown.message}` : '无法写入用户元件库');
    }
  };

  const toggleField = (path: string) => setLookupAccepted((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  const togglePin = (tempId: string) => setLookupAcceptedPins((current) => (current.includes(tempId) ? current.filter((item) => item !== tempId) : [...current, tempId]));

  /** 代码里引用了、但候选没有给出的引脚：补查不完整时明确提示，绝不假装能直接用。 */
  const missingPinsOf = (item: MissingComponentKind): string[] =>
    lookupCandidate === null ? [] : item.referencedPins.filter((pin) => !lookupCandidate.pins.some((candidatePin) => candidatePin.tempId === pin));

  return <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
    <DialogContent className="editor wiring-code" aria-label="接线代码导入">
      <header className="editor-head">
        <DialogTitle asChild><strong>接线代码导入</strong></DialogTitle>
        <span>让 AI 按「字典」里的格式写接线代码，粘贴进来即可确定性地生成接线图。解析本身只创建画布元件与连线；只有你显式确认的补查元件才会写入用户元件库。</span>
      </header>
      <div className="editor-body">
        <div className="ai-kind-row">
          <button type="button" aria-pressed={tab === 'import'} className={tab === 'import' ? 'active' : ''} onClick={() => { setTab('import'); setError(null); setNotice(null); }}>导入代码</button>
          <button type="button" aria-pressed={tab === 'dictionary'} className={tab === 'dictionary' ? 'active' : ''} onClick={() => { setTab('dictionary'); setError(null); setNotice(null); }}>字典</button>
        </div>

        {tab === 'import' && <section className="editor-section">
          <h3>接线代码</h3>
          <p className="hint">格式见「字典」页签。裸的 <code>#</code> 起整行或行尾注释；引脚一律写引脚 ID。</p>
          <textarea className="code-input" aria-label="接线代码" rows={12} spellCheck={false} value={text} onChange={(event) => { setText(event.target.value); setError(null); setNotice(null); setConfirmingReplace(false); resetLookup(); }} placeholder={'version 1\ncomponent u1 esp32-devkit-demo "主控" at 120,80\ncomponent d1 red-led\nwire u1.GPIO21 d1.A'} />
          <div className="ai-actions">
            <label className="image-upload">选择代码文件<input aria-label="选择接线代码文件" type="file" accept=".txt,.wiring,.md,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) pickFile(file); event.target.value = ''; }} /></label>
            <button type="button" onClick={() => { setText(EXAMPLE); setError(null); setNotice(null); setConfirmingReplace(false); resetLookup(); }}>填入示例</button>
            <button type="button" onClick={() => { setText(''); setError(null); setNotice(null); setConfirmingReplace(false); resetLookup(); }}>清空</button>
          </div>

          {parsed?.status === 'error' && <p className="editor-error" aria-live="polite">第 {parsed.line} 行：{parsed.message}</p>}
          {preview && <p className="ai-notice" role="status">可以导入：{preview.summary.components} 个元件、{preview.summary.wires} 根连线；导入后 ERC 会报 {preview.problems} 个问题。</p>}

          {missing.length > 0 && <div className="missing-box">
            <h3>未收录元件 · {missing.length}</h3>
            <p className="hint">这些元件类型不在你的元件库里，代码暂时无法导入。可以让 AI 依据型号补齐参数，逐字段确认后写入用户元件库。</p>
            {missing.map((item) => <div className="missing-item" key={item.token}>
              <div className="missing-head">
                <div className="missing-meta">
                  <b>{item.displayName}</b>
                  <code>{item.token}</code>
                  <span className="hint">第 {item.lines.join('、')} 行{item.referencedPins.length > 0 ? `；代码已引用引脚：${item.referencedPins.join(' / ')}` : '；代码未引用任何引脚'}</span>
                </div>
                <button type="button" className="primary" aria-label={`用 AI 补查 ${item.token}`} disabled={lookupBusy} onClick={() => runLookup(item)}>
                  {lookupToken === item.token && lookupBusy ? '正在补查…' : '用 AI 补查并收录'}
                </button>
              </div>

              {lookupToken === item.token && lookupBusy && lookupCandidate === null && <p className="ai-notice" role="status">正在请 AI 补查「{item.displayName}」…</p>}
              {lookupToken === item.token && lookupError && <p className="editor-error" role="alert">{lookupError}</p>}
              {lookupToken === item.token && lookupNotice && <p className="ai-notice" role="status">{lookupNotice}</p>}
              {lookupToken === item.token && lookupCandidate && <div className="missing-review">
                {missingPinsOf(item).length > 0 && <p className="editor-warning" role="status">
                  AI 未给出代码引用的引脚：{missingPinsOf(item).join(' / ')}。写入后这些连线仍会报"没有引脚"，请在元件编辑器里补齐或改代码。
                </p>}
                <CandidateReview
                  candidate={lookupCandidate}
                  accepted={lookupAccepted}
                  acceptedPins={lookupAcceptedPins}
                  onToggleField={toggleField}
                  onTogglePin={togglePin}
                  onAcceptAllKnown={() => setLookupAccepted(knownFieldPaths(lookupCandidate))}
                  onClearAccepted={() => setLookupAccepted([])}
                />
                <div className="ai-actions">
                  <button type="button" className="primary" onClick={() => confirmLookup(item)}>确认写入元件库（id：{item.token}）</button>
                  <button type="button" onClick={resetLookup}>放弃这次补查</button>
                </div>
              </div>}
            </div>)}
          </div>}

          <h3>导入方式</h3>
          <div className="ai-kind-row">
            <button type="button" aria-pressed={mode === 'replace'} className={mode === 'replace' ? 'active' : ''} onClick={() => { setMode('replace'); setConfirmingReplace(false); }}>替换当前画布</button>
            <button type="button" aria-pressed={mode === 'append'} className={mode === 'append' ? 'active' : ''} onClick={() => { setMode('append'); setConfirmingReplace(false); }}>追加到当前画布</button>
            <button type="button" aria-pressed={mode === 'update'} className={mode === 'update' ? 'active' : ''} onClick={() => { setMode('update'); setConfirmingReplace(false); }}>更新并对比差异</button>
          </div>
          <p className="hint">{mode === 'replace'
            ? '用代码生成的接线图替换画布上的全部元件与连线（可撤销）。'
            : mode === 'append'
              ? '把代码生成的元件与连线并入当前画布，已有的内容保持不变。'
              : '以这份代码为准更新当前画布：先显示差异预览（灰色＝将被删除，绿色＝新增，黄色＝改写），你点「应用更新」后才真正写入。代码里没提到的元件与连线会被删除。'}</p>
          {confirmingReplace && <p className="editor-warning" role="status">替换会先清空画布上的全部元件与连线（可撤销）。确认要继续吗？点击下方「确认替换」执行，或切换导入方式放弃。</p>}
        </section>}

        {tab === 'dictionary' && <section className="editor-section">
          <h3>给 AI 看的字典</h3>
          <p className="hint">复制下面这段文字，连同你的需求一起发给 AI，它就能知道有哪些元件、哪些引脚、以及怎样写才被本软件接受。</p>
          <pre className="code-block" aria-label="接线代码字典">{dictionary}</pre>
          <div className="ai-actions">
            <button type="button" className="primary" onClick={copyDictionary}>复制字典</button>
          </div>
        </section>}

        {notice && <p className="ai-notice" role="status">{notice}</p>}
      </div>
      {error && <p className="editor-error" role="alert">{error}</p>}
      <footer className="editor-foot">
        <span className="hint">解析是确定性代码，不调用任何模型；代码里引用不存在的元件或引脚会直接报错并指出行号。</span>
        <div>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="primary" onClick={apply} disabled={tab !== 'import' || text.trim() === ''}>{mode === 'update' ? '对比差异' : confirmingReplace ? '确认替换' : '应用到画布'}</button>
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}