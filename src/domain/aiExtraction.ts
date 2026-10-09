import type { DriveMode, PinRole } from "./types";
import {
  COMPONENT_CATEGORIES,
  DRIVE_MODES,
  ELECTRICAL_PROPERTY_KEYS,
  PIN_ROLES,
  type ComponentCategory,
  type ElectricalProperties,
} from "./componentDefinition";
import {
  knownField,
  unknownField,
  type CandidateElectricalProperties,
  type CandidateField,
  type CandidatePin,
  type ComponentCandidate,
} from "./componentCandidate";

/**
 * AI 抽取结果 → 元件候选的确定性映射。
 *
 * 这一层是"模型输出"与"可信数据"之间的闸门，只做纯计算、不含任何网络调用：
 * - 模型输出的一切字段一律标记为来源 ai-suggestion、置信度 estimated；已知值永远不会被标成 confirmed。
 * - 模型返回 null（无法确认）的字段一律保持未知，绝不以 0、空串或猜测值填充。
 * - 结构不可解析时抛错；单个字段非法时按"未知"处理，绝不修补成看似可信的值。
 *
 * 因此"AI 只能产出候选、不能产出可信定义"这一约束在类型与代码两层同时成立。
 */

/** 图片像素坐标：以原图左上角为原点、单位为原图像素。与元件本地坐标是两个不同的坐标系。 */
export interface ImagePixel { x: number; y: number; }

/** 模型对单个引脚的抽取结果；每个叶子字段都可能为 null（=未能确认）。 */
export interface AiExtractionPin {
  tempId: string;
  name: string | null;
  role: PinRole | null;
  polarity: "positive" | "negative" | null;
  driveMode: DriveMode | null;
  maxVoltage: number | null;
  maxCurrent: number | null;
  outputVoltage: number | null;
  protocol: string | null;
  note: string | null;
  /**
   * 引脚中心在原图片中的像素坐标；仅图片来源可能给出。
   * 这不是元件本地坐标，必须经 imagePixelToLocal 换算后才能写入引脚定义。
   */
  imagePixel: ImagePixel | null;
}

/** 模型抽取结果；全部叶子字段都可能为 null，表示"材料里没有或无法确认"。 */
export interface AiExtraction {
  displayName: string | null;
  manufacturer: string | null;
  model: string | null;
  category: ComponentCategory | null;
  footprint: { width: number; height: number } | null;
  pins: AiExtractionPin[];
  electricalProperties: Partial<Record<keyof ElectricalProperties, number>>;
  notes: string | null;
}

/** 模型输出一律记为该来源，模型无权自称来自用户、内置库或数据手册。 */
const MODEL_SOURCE = "ai-suggestion" as const;
/** 模型输出的置信度上限：最高只能是 estimated，绝不可能是 confirmed。 */
const MODEL_CONFIDENCE = "estimated" as const;

/** 模型备注并入证据时的长度上限，避免证据文本无限膨胀。 */
const MAX_NOTES_CHARS = 500;

/**
 * 引脚临时 ID 只要求非空、不含点、不含空白；其余字符一律允许。
 * 与接线代码的引脚 ID 规则保持一致，否则 `B+` / `P-` / `OUT+` 这类引脚会被静默改写成 P1，
 * 导致 AI 补查出来的元件无法被原代码引用。
 */
const TEMP_ID_PATTERN = /^[^.\s]+$/;
/** 只接受真正的十进制数字字符串（含正负号与科学计数），"6V" 之类带单位的文本一律不猜。 */
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** 数值只接受有限数字或纯数字字符串；带单位、空串、布尔与 NaN 一律视为未知。 */
const asNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return NUMERIC_TEXT.test(trimmed) && Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
  }
  return null;
};

/** 枚举按大小写不敏感匹配已知取值；匹配不到一律视为未知，绝不映射到近似项。 */
const asEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
  const text = asText(value);
  if (text === null) return null;
  const lower = text.toLowerCase();
  return allowed.find((item) => item.toLowerCase() === lower) ?? null;
};

/**
 * 图片像素坐标：两个分量都必须是有限且非负的数字，否则视为"未给出"。
 * 负坐标不可能出现在图片里，出现即说明模型在编，按未给处理而不是照单全收。
 */
const asPixel = (value: unknown): ImagePixel | null => {
  const record = asRecord(value);
  if (!record) return null;
  const x = asNumber(record.x);
  const y = asNumber(record.y);
  if (x === null || y === null || x < 0 || y < 0) return null;
  return { x, y };
};

/**
 * 解析并规范化模型抽取结果。
 *
 * - 结构不可用（不是对象、引脚列表不是数组、尺寸/电气参数不是对象） → 抛中文错误。
 * - 单个字段类型非法或取值不在枚举内 → 该字段记为 null（未知），绝不做近似映射。
 * - 引脚临时 ID 缺失或非法时按出现顺序生成 P1、P2…；重复时追加序号，保证候选内唯一。
 */
export function parseAiExtraction(value: unknown): AiExtraction {
  const record = asRecord(value);
  if (!record) throw new Error("模型抽取结果必须是一个对象");

  const rawPins = record.pins;
  if (rawPins !== undefined && rawPins !== null && !Array.isArray(rawPins)) {
    throw new Error("模型抽取结果的引脚列表必须是数组");
  }
  const rawFootprint = record.footprint;
  if (rawFootprint !== undefined && rawFootprint !== null && !asRecord(rawFootprint)) {
    throw new Error("模型抽取结果的尺寸必须是对象");
  }
  const rawElectrical = record.electricalProperties;
  if (rawElectrical !== undefined && rawElectrical !== null && !asRecord(rawElectrical)) {
    throw new Error("模型抽取结果的电气参数必须是对象");
  }

  const used = new Set<string>();
  const pins: AiExtractionPin[] = (Array.isArray(rawPins) ? rawPins : []).map((rawPin, index) => {
    const pin = asRecord(rawPin);
    if (!pin) throw new Error("模型抽取结果的引脚必须是对象");
    const declared = asText(pin.tempId);
    const base = declared !== null && TEMP_ID_PATTERN.test(declared) ? declared : `P${index + 1}`;
    let tempId = base;
    let suffix = 2;
    while (used.has(tempId)) tempId = `${base}-${suffix++}`;
    used.add(tempId);
    return {
      tempId,
      name: asText(pin.name),
      role: asEnum(pin.role, PIN_ROLES),
      polarity: asEnum(pin.polarity, ["positive", "negative"] as const),
      driveMode: asEnum(pin.driveMode, DRIVE_MODES),
      maxVoltage: asNumber(pin.maxVoltage),
      maxCurrent: asNumber(pin.maxCurrent),
      outputVoltage: asNumber(pin.outputVoltage),
      protocol: asText(pin.protocol),
      note: asText(pin.note),
      imagePixel: asPixel(pin.imagePixel),
    };
  });

  const electrical: Partial<Record<keyof ElectricalProperties, number>> = {};
  const electricalRecord = asRecord(rawElectrical);
  if (electricalRecord) {
    for (const key of ELECTRICAL_PROPERTY_KEYS) {
      const parsed = asNumber(electricalRecord[key]);
      if (parsed !== null) electrical[key] = parsed;
    }
  }

  const footprintRecord = asRecord(rawFootprint);
  const width = footprintRecord ? asNumber(footprintRecord.width) : null;
  const height = footprintRecord ? asNumber(footprintRecord.height) : null;

  return {
    displayName: asText(record.displayName),
    manufacturer: asText(record.manufacturer),
    model: asText(record.model),
    category: asEnum(record.category, COMPONENT_CATEGORIES),
    footprint: width !== null && width > 0 && height !== null && height > 0 ? { width, height } : null,
    pins,
    electricalProperties: electrical,
    notes: asText(record.notes),
  };
}

/** 组装证据文本：说明信息来自何处，并附上模型备注（截断），供人工复核。 */
function buildEvidence(base: string | undefined, notes: string | null): string | undefined {
  const parts: string[] = [];
  if (base !== undefined && base.length > 0) parts.push(base);
  if (notes !== null) parts.push(`模型备注：${notes.slice(0, MAX_NOTES_CHARS)}`);
  return parts.length > 0 ? parts.join("；") : undefined;
}

/** 已知值记 estimated/ai-suggestion；null 记未知。绝不存在第三条路径。 */
function modelField<T>(value: T | null, evidence?: string): CandidateField<T> {
  return value === null || value === undefined
    ? unknownField<T>(MODEL_SOURCE, evidence)
    : knownField(value, MODEL_SOURCE, MODEL_CONFIDENCE, evidence);
}

/**
 * 把抽取结果确定性地映射为元件候选。
 *
 * 注意：
 * - 候选中的图片只由用户上传提供（见 ComponentCandidate.image 的不变量），此处绝不生成图片。
 * - 所有字段来源固定为 ai-suggestion、置信度固定为 estimated/unknown，模型无法自我升级。
 * - 顶层字段一律给出（未知即显式标未知）；引脚条目数量多，故只固定给出名称与类型，
 *   其余子字段仅在模型确实给出值时出现，避免每个引脚都堆出九行"未知"。
 */
export function candidateFromExtraction(
  extraction: AiExtraction,
  options: { id: string; evidence?: string },
): ComponentCandidate {
  const evidence = buildEvidence(options.evidence, extraction.notes);

  const pins: CandidatePin[] = extraction.pins.map((pin) => ({
    tempId: pin.tempId,
    name: modelField(pin.name, evidence),
    role: modelField(pin.role, evidence),
    ...(pin.polarity !== null ? { polarity: modelField(pin.polarity, evidence) } : {}),
    ...(pin.driveMode !== null ? { driveMode: modelField(pin.driveMode, evidence) } : {}),
    ...(pin.maxVoltage !== null ? { maxVoltage: modelField(pin.maxVoltage, evidence) } : {}),
    ...(pin.maxCurrent !== null ? { maxCurrent: modelField(pin.maxCurrent, evidence) } : {}),
    ...(pin.outputVoltage !== null ? { outputVoltage: modelField(pin.outputVoltage, evidence) } : {}),
    ...(pin.protocol !== null ? { protocol: modelField(pin.protocol, evidence) } : {}),
    ...(pin.note !== null ? { note: modelField(pin.note, evidence) } : {}),
    // 像素坐标原样带进候选，供确认后确定性地换算成元件本地坐标；此处不做任何换算。
    ...(pin.imagePixel !== null ? { imagePixel: { x: pin.imagePixel.x, y: pin.imagePixel.y } } : {}),
  }));

  const electricalProperties: CandidateElectricalProperties = {};
  for (const key of ELECTRICAL_PROPERTY_KEYS) {
    electricalProperties[key] = modelField(extraction.electricalProperties[key] ?? null, evidence);
  }

  return {
    id: options.id,
    displayName: modelField(extraction.displayName, evidence),
    manufacturer: modelField(extraction.manufacturer, evidence),
    model: modelField(extraction.model, evidence),
    category: modelField(extraction.category, evidence),
    footprint: modelField(extraction.footprint, evidence),
    pins,
    electricalProperties,
  };
}