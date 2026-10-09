import { useState, type ReactNode } from 'react';
import {
  validateComponentDefinition,
  type ComponentCategory,
  type ComponentDefinition,
  type ComponentImage,
  type Confidence,
  type DriveMode,
  type PinDefinition,
  type PinRole,
  type Provenance,
  type ProvenanceSource,
  type VoltageRange,
} from '../domain';
import { ComponentImageEditor } from './ComponentImageEditor';
import { Dialog, DialogContent, DialogTitle } from './components';

/** 分类的中文名。组件库分组与元件编辑器共用同一套标签，避免两处漂移。 */
export const categoryLabels: Record<ComponentCategory, string> = {
  power: '电源', ground: '地（GND）', mcu: '主控（MCU）', passive: '无源器件（电阻等）',
  diode: '二极管', capacitor: '电容', regulator: '稳压器', switch: '开关', other: '其他',
};
const categories = Object.keys(categoryLabels) as ComponentCategory[];

const roleLabels: Record<PinRole, string> = {
  POWER_OUTPUT: '电源输出', POWER_INPUT: '电源输入', GND: '地（GND）', GPIO: '通用输入输出（GPIO）',
  INPUT: '输入', OUTPUT: '输出', PASSIVE: '无源（PASSIVE）', UNKNOWN: '未知',
};
const roles = Object.keys(roleLabels) as PinRole[];

const driveModeLabels: Record<DriveMode, string> = { 'push-pull': '推挽', 'open-drain': '开漏', none: '不驱动', unknown: '未知' };
const driveModes = Object.keys(driveModeLabels) as DriveMode[];

const confidenceLabels: Record<Confidence, string> = { confirmed: '已确认', estimated: '估算', unknown: '未知' };
const sourceLabels: Record<ProvenanceSource, string> = {
  builtin: '内置', user: '用户录入', datasheet: '数据手册', 'official-web': '官方网页', 'ai-suggestion': 'AI 建议',
};

/** 编辑器内部的引脚状态：所有数值都先用字符串保存，空串明确表示"未知"而不是 0。 */
interface EditablePin {
  id: string;
  name: string;
  role: PinRole;
  x: string;
  y: string;
  maxVoltage: string;
  voltageMin: string;
  voltageMax: string;
  outputVoltage: string;
  maxCurrent: string;
  driveMode: DriveMode;
  protocol: string;
  polarity: '' | 'positive' | 'negative';
  note: string;
}

export interface ComponentEditorProps {
  definition: ComponentDefinition;
  onSave: (definition: ComponentDefinition) => void;
  onCancel: () => void;
}

function toEditablePin(pin: PinDefinition): EditablePin {
  const text = (value: number | string | undefined) => (value === undefined ? '' : String(value));
  return {
    id: pin.id,
    name: pin.name,
    role: pin.role,
    x: text(pin.localPosition.x),
    y: text(pin.localPosition.y),
    maxVoltage: text(pin.maxVoltage),
    voltageMin: text(pin.voltageRange?.min),
    voltageMax: text(pin.voltageRange?.max),
    outputVoltage: text(pin.outputVoltage),
    maxCurrent: text(pin.maxCurrent),
    driveMode: pin.driveMode ?? 'unknown',
    protocol: pin.protocol ?? '',
    polarity: pin.polarity ?? '',
    note: pin.note ?? '',
  };
}

/** 空串返回 undefined，界面上"没填"与领域层"未知"是同一件事。 */
function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPinDefinition(pin: EditablePin, errors: string[]): PinDefinition {
  const maxVoltage = numberOrUndefined(pin.maxVoltage);
  const outputVoltage = numberOrUndefined(pin.outputVoltage);
  const maxCurrent = numberOrUndefined(pin.maxCurrent);
  const x = numberOrUndefined(pin.x) ?? 0;
  const y = numberOrUndefined(pin.y) ?? 0;
  // 输入电平范围必须成对录入：只填一边视为未知，既不写入、也不替用户补齐另一边。
  const voltageMin = numberOrUndefined(pin.voltageMin);
  const voltageMax = numberOrUndefined(pin.voltageMax);
  const label = pin.name.trim() !== '' ? pin.name : pin.id;
  let voltageRange: VoltageRange | undefined;
  if ((voltageMin === undefined) !== (voltageMax === undefined)) {
    errors.push(`${label} 的电平范围必须同时填写下限和上限，否则视为未知。`);
  } else if (voltageMin !== undefined && voltageMax !== undefined) {
    if (voltageMin > voltageMax) errors.push(`${label} 的输入电平下限不能大于上限。`);
    else voltageRange = { min: voltageMin, max: voltageMax, unit: 'V' };
  }
  return {
    id: pin.id,
    name: pin.name,
    role: pin.role,
    localPosition: { x, y },
    ...(pin.driveMode !== 'unknown' ? { driveMode: pin.driveMode } : {}),
    ...(pin.polarity !== '' ? { polarity: pin.polarity } : {}),
    ...(maxVoltage !== undefined ? { maxVoltage } : {}),
    ...(voltageRange !== undefined ? { voltageRange } : {}),
    ...(outputVoltage !== undefined ? { outputVoltage } : {}),
    ...(maxCurrent !== undefined ? { maxCurrent } : {}),
    ...(pin.protocol.trim() !== '' ? { protocol: pin.protocol } : {}),
    ...(pin.note.trim() !== '' ? { note: pin.note } : {}),
  };
}

function ConfidenceTag({ provenance }: { provenance?: Provenance }) {
  if (!provenance || provenance.confidence === 'unknown') return <em className="confidence unknown">未知</em>;
  return <em className={`confidence ${provenance.confidence}`}>{confidenceLabels[provenance.confidence]} · {sourceLabels[provenance.source]}</em>;
}

function EditorField({ label, provenance, children }: { label: string; provenance?: Provenance; children: ReactNode }) {
  return <label className="editor-field"><span className="editor-field-name">{label}</span>{children}<ConfidenceTag provenance={provenance} /></label>;
}

export function ComponentEditor({ definition, onSave, onCancel }: ComponentEditorProps) {
  const [displayName, setDisplayName] = useState(definition.displayName);
  const [manufacturer, setManufacturer] = useState(definition.manufacturer ?? '');
  const [model, setModel] = useState(definition.model ?? '');
  const [category, setCategory] = useState<ComponentCategory>(definition.category);
  const [notes, setNotes] = useState(definition.metadata['备注'] ?? '');
  const [image, setImage] = useState<ComponentImage | undefined>(definition.image);
  const [footprint, setFootprint] = useState(definition.footprint);
  const [pins, setPins] = useState<EditablePin[]>(definition.pins.map(toEditablePin));
  // touched：用户手工录入过的字段路径；cleared：被用户清空的字段路径。二者共同决定来源显示。
  const [touched, setTouched] = useState<string[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recordField = (path: string, hasValue: boolean) => {
    setError(null);
    setTouched((current) => (hasValue ? (current.includes(path) ? current : [...current, path]) : current.filter((item) => item !== path)));
    setCleared((current) => (hasValue ? current.filter((item) => item !== path) : (current.includes(path) ? current : [...current, path])));
  };

  /** 界面上的来源标签：清空 → 未知；用户改过 → 已确认；否则沿用库里原有来源。 */
  const provenanceOf = (path: string): Provenance | undefined => {
    if (cleared.includes(path)) return undefined;
    if (touched.includes(path)) return { confidence: 'confirmed', source: 'user' };
    return definition.provenance[path];
  };

  const changePin = (pinId: string, changes: Partial<EditablePin>) =>
    setPins((current) => current.map((pin) => (pin.id === pinId ? { ...pin, ...changes } : pin)));

  const addPin = () => {
    setError(null);
    let index = pins.length + 1;
    while (pins.some((pin) => pin.id === `PIN${index}`)) index += 1;
    // 新引脚沿左右两侧交替错开摆放。若全部落在 (0,0)，圆点会叠成一个点：既看不清名字，
    // 也没法把压在下面那个拖出来。坐标同样不记入 userOverrides，因此画布上仍按自动排布渲染。
    const slot = pins.length;
    const x = slot % 2 === 0 ? 0 : footprint.width;
    const y = Math.min(15 + Math.floor(slot / 2) * 20, Math.max(footprint.height - 10, 10));
    setPins((current) => [...current, { id: `PIN${index}`, name: '', role: 'UNKNOWN', x: String(x), y: String(y), maxVoltage: '', voltageMin: '', voltageMax: '', outputVoltage: '', maxCurrent: '', driveMode: 'unknown', protocol: '', polarity: '', note: '' }]);
  };

  const removePin = (pinId: string) => {
    setError(null);
    setPins((current) => current.filter((pin) => pin.id !== pinId));
    const prefix = `pins.${pinId}.`;
    setTouched((current) => current.filter((path) => !path.startsWith(prefix)));
    setCleared((current) => current.filter((path) => !path.startsWith(prefix)));
  };

  /** 图片本身作为元件的一个字段记录来源：有图就是用户已确认。 */
  const changeImage = (next: ComponentImage | undefined) => {
    setImage(next);
    recordField('image', next !== undefined && (next.dataUrl !== undefined || next.path !== undefined));
  };

  const changeFootprint = (next: { width: number; height: number }) => {
    setFootprint(next);
    recordField('footprint', true);
  };

  /** 在图片上拖动热点：把本地坐标写回引脚的 X/Y 输入框，并记录为用户已确认。 */
  const movePin = (pinId: string, position: { x: number; y: number }) => {
    changePin(pinId, { x: String(position.x), y: String(position.y) });
    recordField(`pins.${pinId}.x`, true);
    recordField(`pins.${pinId}.y`, true);
  };

  const buildDefinition = (errors: string[]): ComponentDefinition => {
    const metadata = { ...definition.metadata };
    if (notes.trim() === '') delete metadata['备注']; else metadata['备注'] = notes;
    // 引脚被删除后，它遗留的来源记录与用户覆盖标记必须一并清掉，避免出现指向已不存在引脚的孤儿记录。
    const livePinIds = new Set(pins.map((pin) => pin.id));
    const belongsToRemovedPin = (path: string) => path.startsWith('pins.') && !livePinIds.has(path.split('.')[1]);
    const provenance = { ...definition.provenance };
    for (const path of Object.keys(provenance)) if (belongsToRemovedPin(path)) delete provenance[path];
    for (const path of cleared) delete provenance[path];
    for (const path of touched) provenance[path] = { confidence: 'confirmed', source: 'user' };
    const keptOverrides = definition.userOverrides.filter((path) => !cleared.includes(path) && !belongsToRemovedPin(path));
    return {
      id: definition.id,
      displayName,
      ...(manufacturer.trim() !== '' ? { manufacturer } : {}),
      ...(model.trim() !== '' ? { model } : {}),
      category,
      footprint: { width: footprint.width, height: footprint.height },
      ...(image !== undefined ? { image } : {}),
      pins: pins.map((pin) => toPinDefinition(pin, errors)),
      electricalProperties: { ...definition.electricalProperties },
      metadata,
      provenance,
      userOverrides: [...new Set([...keptOverrides, ...touched])],
      ...(definition.voltageTransforms !== undefined ? { voltageTransforms: definition.voltageTransforms.map((item) => ({ ...item, inputVoltageRange: { ...item.inputVoltageRange } })) } : {}),
    };
  };

  const save = () => {
    if (displayName.trim() === '') return setError('请输入元件名称。');
    if (pins.length === 0) return setError('元件至少需要一个引脚。');
    const unnamed = pins.find((pin) => pin.name.trim() === '');
    if (unnamed) return setError(`请为引脚 ${unnamed.id} 填写名称。`);
    const fieldErrors: string[] = [];
    const candidate = buildDefinition(fieldErrors);
    if (fieldErrors.length) return setError(fieldErrors[0]);
    try {
      validateComponentDefinition(candidate);
    } catch (validationError) {
      return setError(validationError instanceof Error ? validationError.message : '元件数据无效');
    }
    setError(null);
    onSave(candidate);
  };

  const pinPath = (pin: EditablePin, field: keyof EditablePin | 'voltageRange') => `pins.${pin.id}.${field}`;

  return <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
    <DialogContent className="editor" aria-label="元件编辑器">
      <header className="editor-head">
        <DialogTitle asChild><strong>元件编辑器</strong></DialogTitle>
        <span>未填写的字段会保持“未知”，不会被当作已确认值；确认过的字段会显示来源。</span>
      </header>
      <div className="editor-body">
        <section className="editor-section">
          <h3>基本信息</h3>
          <div className="editor-grid">
            <EditorField label="名称" provenance={provenanceOf('displayName')}>
              <input aria-label="元件名称" value={displayName} onChange={(event) => { const value = event.target.value; setDisplayName(value); recordField('displayName', value.trim() !== ''); }} />
            </EditorField>
            <EditorField label="厂商" provenance={provenanceOf('manufacturer')}>
              <input aria-label="厂商" placeholder="未知" value={manufacturer} onChange={(event) => { const value = event.target.value; setManufacturer(value); recordField('manufacturer', value.trim() !== ''); }} />
            </EditorField>
            <EditorField label="型号" provenance={provenanceOf('model')}>
              <input aria-label="型号" placeholder="未知" value={model} onChange={(event) => { const value = event.target.value; setModel(value); recordField('model', value.trim() !== ''); }} />
            </EditorField>
            <EditorField label="分类" provenance={provenanceOf('category')}>
              <select aria-label="分类" value={category} onChange={(event) => { const value = event.target.value as ComponentCategory; setCategory(value); recordField('category', true); }}>
                {categories.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}
              </select>
            </EditorField>
            <EditorField label="备注" provenance={provenanceOf('metadata.备注')}>
              <input aria-label="备注" placeholder="未知" value={notes} onChange={(event) => { const value = event.target.value; setNotes(value); recordField('metadata.备注', value.trim() !== ''); }} />
            </EditorField>
          </div>
        </section>
        <section className="editor-section">
          <h3>元件图片与引脚布局（拖动圆点摆放引脚）</h3>
          <ComponentImageEditor
            image={image}
            footprint={footprint}
            pins={pins.map((pin) => ({ id: pin.id, name: pin.name, localPosition: { x: numberOrUndefined(pin.x) ?? 0, y: numberOrUndefined(pin.y) ?? 0 } }))}
            onImageChange={changeImage}
            onFootprintChange={changeFootprint}
            onPinMove={movePin}
          />
        </section>
        <section className="editor-section">
          <div className="editor-section-head"><h3>引脚 · {pins.length}</h3><button type="button" onClick={addPin}>＋ 添加引脚</button></div>
          {pins.length === 0 && <p className="hint">还没有引脚。元件至少要有一个引脚才能保存；新增的引脚默认全部为“未知”。</p>}
          {pins.map((pin, index) => <div className="editor-pin" key={pin.id}>
            <div className="editor-pin-head"><b>引脚 {index + 1} · {pin.id}</b><button type="button" className="ghost danger" aria-label={`删除引脚 ${pin.id}`} onClick={() => removePin(pin.id)}>删除引脚</button></div>
            <div className="editor-grid">
              <EditorField label="名称" provenance={provenanceOf(pinPath(pin, 'name'))}>
                <input aria-label={`引脚 ${index + 1} 名称`} placeholder="必填" value={pin.name} onChange={(event) => { const value = event.target.value; changePin(pin.id, { name: value }); recordField(pinPath(pin, 'name'), value.trim() !== ''); }} />
              </EditorField>
              <EditorField label="类型" provenance={provenanceOf(pinPath(pin, 'role'))}>
                <select aria-label={`引脚 ${index + 1} 类型`} value={pin.role} onChange={(event) => { const value = event.target.value as PinRole; changePin(pin.id, { role: value }); recordField(pinPath(pin, 'role'), value !== 'UNKNOWN'); }}>
                  {roles.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}
                </select>
              </EditorField>
              <EditorField label="方向" provenance={provenanceOf(pinPath(pin, 'driveMode'))}>
                <select aria-label={`引脚 ${index + 1} 方向`} value={pin.driveMode} onChange={(event) => { const value = event.target.value as DriveMode; changePin(pin.id, { driveMode: value }); recordField(pinPath(pin, 'driveMode'), value !== 'unknown'); }}>
                  {driveModes.map((item) => <option key={item} value={item}>{driveModeLabels[item]}</option>)}
                </select>
              </EditorField>
              <EditorField label="极性" provenance={provenanceOf(pinPath(pin, 'polarity'))}>
                <select aria-label={`引脚 ${index + 1} 极性`} value={pin.polarity} onChange={(event) => { const value = event.target.value as EditablePin['polarity']; changePin(pin.id, { polarity: value }); recordField(pinPath(pin, 'polarity'), value !== ''); }}>
                  <option value="">未知</option><option value="positive">正极（+）</option><option value="negative">负极（−）</option>
                </select>
              </EditorField>
              <EditorField label="位置 X" provenance={provenanceOf(pinPath(pin, 'x'))}>
                <input aria-label={`引脚 ${index + 1} 位置 X`} type="number" value={pin.x} onChange={(event) => { const value = event.target.value; changePin(pin.id, { x: value }); recordField(pinPath(pin, 'x'), numberOrUndefined(value) !== undefined); }} />
              </EditorField>
              <EditorField label="位置 Y" provenance={provenanceOf(pinPath(pin, 'y'))}>
                <input aria-label={`引脚 ${index + 1} 位置 Y`} type="number" value={pin.y} onChange={(event) => { const value = event.target.value; changePin(pin.id, { y: value }); recordField(pinPath(pin, 'y'), numberOrUndefined(value) !== undefined); }} />
              </EditorField>
              <EditorField label="最大电压（V）" provenance={provenanceOf(pinPath(pin, 'maxVoltage'))}>
                <input aria-label={`引脚 ${index + 1} 最大电压`} type="number" step="any" placeholder="未知" value={pin.maxVoltage} onChange={(event) => { const value = event.target.value; changePin(pin.id, { maxVoltage: value }); recordField(pinPath(pin, 'maxVoltage'), numberOrUndefined(value) !== undefined); }} />
              </EditorField>
              <EditorField label="输入电平下限（V）" provenance={provenanceOf(pinPath(pin, 'voltageRange'))}>
                <input aria-label={`引脚 ${index + 1} 输入电平下限`} type="number" step="any" placeholder="未知" value={pin.voltageMin} onChange={(event) => { const value = event.target.value; changePin(pin.id, { voltageMin: value }); recordField(pinPath(pin, 'voltageRange'), numberOrUndefined(value) !== undefined && numberOrUndefined(pin.voltageMax) !== undefined); }} />
              </EditorField>
              <EditorField label="输入电平上限（V）" provenance={provenanceOf(pinPath(pin, 'voltageRange'))}>
                <input aria-label={`引脚 ${index + 1} 输入电平上限`} type="number" step="any" placeholder="未知" value={pin.voltageMax} onChange={(event) => { const value = event.target.value; changePin(pin.id, { voltageMax: value }); recordField(pinPath(pin, 'voltageRange'), numberOrUndefined(value) !== undefined && numberOrUndefined(pin.voltageMin) !== undefined); }} />
              </EditorField>
              <EditorField label="输出电压（V）" provenance={provenanceOf(pinPath(pin, 'outputVoltage'))}>
                <input aria-label={`引脚 ${index + 1} 输出电压`} type="number" step="any" placeholder="未知" value={pin.outputVoltage} onChange={(event) => { const value = event.target.value; changePin(pin.id, { outputVoltage: value }); recordField(pinPath(pin, 'outputVoltage'), numberOrUndefined(value) !== undefined); }} />
              </EditorField>
              <EditorField label="最大电流（A）" provenance={provenanceOf(pinPath(pin, 'maxCurrent'))}>
                <input aria-label={`引脚 ${index + 1} 最大电流`} type="number" step="any" placeholder="未知" value={pin.maxCurrent} onChange={(event) => { const value = event.target.value; changePin(pin.id, { maxCurrent: value }); recordField(pinPath(pin, 'maxCurrent'), numberOrUndefined(value) !== undefined); }} />
              </EditorField>
              <EditorField label="协议" provenance={provenanceOf(pinPath(pin, 'protocol'))}>
                <input aria-label={`引脚 ${index + 1} 协议`} placeholder="未知" value={pin.protocol} onChange={(event) => { const value = event.target.value; changePin(pin.id, { protocol: value }); recordField(pinPath(pin, 'protocol'), value.trim() !== ''); }} />
              </EditorField>
              <EditorField label="备注" provenance={provenanceOf(pinPath(pin, 'note'))}>
                <input aria-label={`引脚 ${index + 1} 备注`} placeholder="未知" value={pin.note} onChange={(event) => { const value = event.target.value; changePin(pin.id, { note: value }); recordField(pinPath(pin, 'note'), value.trim() !== ''); }} />
              </EditorField>
            </div>
          </div>)}
        </section>
      </div>
      {error && <p className="editor-error" role="alert">{error}</p>}
      <footer className="editor-foot">
        <span className="hint">保存后会写入本地用户元件库，可随时拖入画布；未知参数不会推动 ERC 做推断。</span>
        <div><button type="button" onClick={onCancel}>取消</button><button type="button" className="primary" onClick={save}>保存到用户元件库</button></div>
      </footer>
    </DialogContent>
  </Dialog>;
}