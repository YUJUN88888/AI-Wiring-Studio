import { useMemo } from 'react';
import {
  listCandidateFields,
  type CandidateField,
  type CandidateFieldRef,
  type ComponentCandidate,
} from '../domain';

/**
 * 元件候选的逐字段复核区块（共享组件）。
 *
 * 「AI 元件导入」与「导入接线代码 · 补查缺失元件」两处都需要同一套复核界面：
 * 逐字段勾选、逐引脚勾选、只允许勾选"已识别"的字段。把它抽出来复用的同时，
 * 保证两条入口的确认语义完全一致——AI 建议永远不会自动成为已确认。
 */

const confidenceLabels: Record<string, string> = { confirmed: '已确认', estimated: '估算', unknown: '未知' };
const sourceLabels: Record<string, string> = {
  builtin: '内置', user: '用户录入', datasheet: '数据手册', 'official-web': '官方网页', 'ai-suggestion': 'AI 建议',
};

/** 把候选字段值渲染成可读文本；未知一律显示"未知"，绝不用 0 或空串冒充。 */
export function describeValue(field: CandidateField<unknown>): string {
  if (field.unknown || field.value === undefined) return '未知';
  const value = field.value;
  if (typeof value === 'object' && value !== null) {
    const box = value as { width?: number; height?: number };
    if (typeof box.width === 'number' && typeof box.height === 'number') return `${box.width} × ${box.height}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/** 候选里"已识别"的字段路径：只有这些允许被勾选写入。 */
export function knownFieldPaths(candidate: ComponentCandidate): string[] {
  return listCandidateFields(candidate)
    .filter((ref) => !ref.field.unknown && ref.field.value !== undefined)
    .map((ref) => ref.path);
}

export interface CandidateReviewProps {
  candidate: ComponentCandidate;
  accepted: readonly string[];
  acceptedPins: readonly string[];
  onToggleField: (path: string) => void;
  onTogglePin: (tempId: string) => void;
  onAcceptAllKnown: () => void;
  onClearAccepted: () => void;
  /** 名称覆盖输入框；不传则整块不显示（如补查缺失元件时名称直接沿用代码里的用法）。 */
  nameOverride?: { value: string; onChange: (value: string) => void };
}

export function CandidateReview({
  candidate,
  accepted,
  acceptedPins,
  onToggleField,
  onTogglePin,
  onAcceptAllKnown,
  onClearAccepted,
  nameOverride,
}: CandidateReviewProps) {
  const fields = useMemo(() => listCandidateFields(candidate), [candidate]);
  const topFields = useMemo(() => fields.filter((ref) => !ref.path.startsWith('pins.')), [fields]);
  const hasKnown = useMemo(() => fields.some((ref) => !ref.field.unknown && ref.field.value !== undefined), [fields]);

  const renderField = (ref: CandidateFieldRef) => {
    const known = !ref.field.unknown && ref.field.value !== undefined;
    return <label className="ai-field" key={ref.path}>
      <input
        type="checkbox"
        aria-label={`采用 ${ref.label}`}
        checked={accepted.includes(ref.path)}
        disabled={!known}
        onChange={() => onToggleField(ref.path)}
      />
      <span className="ai-field-label">{ref.label}</span>
      <span className="ai-field-value">{describeValue(ref.field)}</span>
      <em className={`confidence ${ref.field.confidence}`}>{confidenceLabels[ref.field.confidence] ?? ref.field.confidence} · {sourceLabels[ref.field.source] ?? ref.field.source}</em>
    </label>;
  };

  return <>
    {candidate.image?.dataUrl && <img className="ai-image-preview" src={candidate.image.dataUrl} alt="候选元件图片" />}
    {nameOverride && <label className="editor-field ai-name">
      <span className="editor-field-name">元件名称（留空则采用下方勾选的候选名称）</span>
      <input aria-label="元件名称" value={nameOverride.value} onChange={(event) => nameOverride.onChange(event.target.value)} placeholder="可在此覆盖候选名称" />
    </label>}
    <div className="ai-fields">{topFields.map(renderField)}</div>
    <h3>引脚 · {candidate.pins.length}</h3>
    {candidate.pins.length === 0 && <p className="hint">AI 未识别到引脚；可先写入元件，之后在元件编辑器中手工补引脚。</p>}
    {candidate.pins.map((pin) => {
      const pinRefs = fields.filter((ref) => ref.path.startsWith(`pins.${pin.tempId}.`));
      return <div className="editor-pin" key={pin.tempId}>
        <div className="editor-pin-head">
          <label className="ai-pin-toggle">
            <input type="checkbox" aria-label={`采用引脚 ${pin.tempId}`} checked={acceptedPins.includes(pin.tempId)} onChange={() => onTogglePin(pin.tempId)} />
            <b>{pin.tempId}</b>
          </label>
          <span className="hint">未勾选则该引脚不写入</span>
        </div>
        <div className="ai-fields">{pinRefs.map(renderField)}</div>
      </div>;
    })}
    <div className="ai-actions">
      <button type="button" disabled={!hasKnown} onClick={onAcceptAllKnown}>全选已识别字段</button>
      <button type="button" onClick={onClearAccepted}>清空勾选</button>
    </div>
  </>;
}