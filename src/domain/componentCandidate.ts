import type { DriveMode, PinRole } from "./types";
import {
  COMPONENT_CATEGORIES,
  CONFIDENCES,
  DRIVE_MODES,
  ELECTRICAL_PROPERTY_KEYS,
  PIN_ROLES,
  PROVENANCE_SOURCES,
  cloneComponentImage,
  normalizeComponentDefinition,
  validateComponentImage,
  type ComponentCategory,
  type ComponentDefinition,
  type ComponentImage,
  type Confidence,
  type ElectricalProperties,
  type PinDefinition,
  type Provenance,
  type ProvenanceSource,
} from "./componentDefinition";
import { createLayoutFromImage, imagePixelToLocal, normalizeCrop } from "./imageMapping";

/**
 * 元件候选（Component Candidate）。
 *
 * AI / 视觉 / OCR / 网页检索只能产出"候选"：每个字段都带来源、置信度与原始证据，
 * 未经用户逐字段确认，一律不得写入可信元件库。这里只做确定性的建模、校验与确认映射，
 * 不包含任何模型调用，因此 AI 不可用时本模块与画布、手工编辑、保存、ERC 完全解耦。
 */

/**
 * 候选字段。只有 unknown 为 false 且带明确 value 时才算"已知"；
 * 其余情况一律未知，绝不以 0、空串或猜测值冒充已知。
 */
export interface CandidateField<T> {
  /** 候选值；unknown 为 true 时必须缺省，避免出现"未知却带值"的矛盾状态。 */
  value?: T;
  /** 是否为未知（未识别到或识别失败）。 */
  unknown: boolean;
  confidence: Confidence;
  source: ProvenanceSource;
  /** 原始证据（用户粘贴的参数文字、链接或图片来源说明），仅供人工复核展示。 */
  evidence?: string;
}

/** 未知候选字段。 */
export function unknownField<T>(source: ProvenanceSource = "ai-suggestion", evidence?: string): CandidateField<T> {
  return { unknown: true, confidence: "unknown", source, ...(evidence !== undefined ? { evidence } : {}) };
}

/** 已知候选字段。已知值不允许标成 unknown 置信度，二者语义互斥。 */
export function knownField<T>(
  value: T,
  source: ProvenanceSource,
  confidence: Confidence,
  evidence?: string,
): CandidateField<T> {
  if (confidence === "unknown") throw new Error("已知的候选字段不能使用 unknown 置信度");
  return { value, unknown: false, confidence, source, ...(evidence !== undefined ? { evidence } : {}) };
}

/** 候选引脚。tempId 只是本次候选内的临时标识，确认后才成为正式引脚 id。 */
export interface CandidatePin {
  tempId: string;
  name: CandidateField<string>;
  role: CandidateField<PinRole>;
  /**
   * 引脚中心在**原图片**中的像素坐标（左上角为原点，单位＝原图像素）。
   *
   * 刻意不叫 localPosition：候选里只允许出现"外部坐标系"的原始数据，
   * 元件本地坐标只能由 definitionFromCandidate 经 imagePixelToLocal 确定性换算得到，
   * 从而杜绝"把图片像素坐标直接当成本地坐标写进定义"。
   */
  imagePixel?: { x: number; y: number };
  polarity?: CandidateField<"positive" | "negative">;
  driveMode?: CandidateField<DriveMode>;
  maxVoltage?: CandidateField<number>;
  maxCurrent?: CandidateField<number>;
  outputVoltage?: CandidateField<number>;
  protocol?: CandidateField<string>;
  note?: CandidateField<string>;
}

export type CandidateElectricalProperties = Partial<Record<keyof ElectricalProperties, CandidateField<number>>>;

/** 候选元件。字段缺省即未知，绝不臆造。 */
export interface ComponentCandidate {
  /** 候选临时 id，仅用于标识本次候选。 */
  id: string;
  displayName: CandidateField<string>;
  manufacturer?: CandidateField<string>;
  model?: CandidateField<string>;
  category?: CandidateField<ComponentCategory>;
  footprint?: CandidateField<{ width: number; height: number }>;
  /**
   * 用户直接上传的图片，属可信输入，不参与 AI 置信度判定。
   * 约束：候选中出现图片，意味着它必定来自用户本人的上传；供应商（Provider）不得凭空生成或替换图片，
   * 否则会把非用户来源的内容"洗白"成已确认。接入真实 Provider 时必须遵守这一约束。
   */
  image?: ComponentImage;
  pins: CandidatePin[];
  electricalProperties?: CandidateElectricalProperties;
}

/** 用户确认结果：只有被显式列入的字段/引脚才会写入可信元件定义。 */
export interface CandidateConfirmation {
  /** 正式元件 id，由用户/调用方决定，AI 不得决定。 */
  id: string;
  /** 用户最终确认的名称；缺省时回退到候选名称。 */
  displayName?: string;
  /** 用户逐字段确认采用的候选路径集合。未列出的路径一律不写入。 */
  acceptedFields: readonly string[];
  /** 用户确认写入的候选引脚 tempId；未列出的引脚不写入。 */
  acceptedPinTempIds: readonly string[];
}

/** 供界面逐字段展示与勾选的引用。 */
export interface CandidateFieldRef {
  path: string;
  label: string;
  field: CandidateField<unknown>;
}

/** 引脚临时 ID 只要求非空、不含点、不含空白（与接线代码的引脚 ID 规则一致，允许 `+` / `-`）。 */
const TEMP_ID_PATTERN = /^[^.\s]+$/;

/** 候选未给出尺寸时的兜底尺寸。 */
const DEFAULT_FOOTPRINT = { width: 180, height: 80 } as const;

/** 默认排布下同侧每个引脚所需的纵向空间，避免引脚标签互相重叠而看不清。 */
const PIN_LINE_HEIGHT = 28;

/** 依据同侧最多引脚数推导兜底尺寸：引脚多时自动加高，保证标签不挤在一起。 */
function defaultFootprint(maxPinsPerSide: number): { width: number; height: number } {
  return {
    width: DEFAULT_FOOTPRINT.width,
    height: Math.max(DEFAULT_FOOTPRINT.height, maxPinsPerSide * PIN_LINE_HEIGHT),
  };
}

/** 由图片推导盒子高度时的上限，避免超长图片把画布撑爆。 */
const MAX_DERIVED_HEIGHT = 480;

/**
 * 确定性推导元件在画布上的盒子尺寸。
 *
 * 外部（AI / 网页）给出的尺寸数值其**单位不可知**，因此一律不采用：
 * 一个写成"毫米"的 20.4×15.6 一旦被当作画布本地单位，元件会小到引脚全挤成一团
 * （这正是"元件过小、引脚重叠"的根因）。改为：
 * - 有图片时按图片（含裁剪与旋转）的长宽比取高，图片无需留白即可铺满盒子；
 * - 没有图片时按同侧引脚数保证标签不重叠。
 */
function deriveFootprint(image: ComponentImage | undefined, maxPinsPerSide: number): { width: number; height: number } {
  const byPins = defaultFootprint(maxPinsPerSide);
  const naturalWidth = image?.naturalWidth;
  const naturalHeight = image?.naturalHeight;
  if (image === undefined || naturalWidth === undefined || naturalHeight === undefined || naturalWidth <= 0 || naturalHeight <= 0) {
    return byPins;
  }
  const crop = normalizeCrop(image.crop);
  const croppedWidth = crop.width * naturalWidth;
  const croppedHeight = crop.height * naturalHeight;
  const swapped = image.rotation === 90 || image.rotation === 270;
  const displayWidth = swapped ? croppedHeight : croppedWidth;
  const displayHeight = swapped ? croppedWidth : croppedHeight;
  if (displayWidth <= 0 || displayHeight <= 0) return byPins;
  const height = Math.min(
    Math.max(DEFAULT_FOOTPRINT.width * (displayHeight / displayWidth), byPins.height),
    MAX_DERIVED_HEIGHT,
  );
  return { width: DEFAULT_FOOTPRINT.width, height };
}

/** 视作"输入侧"的引脚角色；未定位的引脚据此排到左边，其余排到右边。 */
const INPUT_SIDE_ROLES: readonly PinRole[] = ["POWER_INPUT", "INPUT", "GND"];

const isString = (value: unknown): boolean => typeof value === "string";
const isNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
const isRole = (value: unknown): boolean => typeof value === "string" && PIN_ROLES.includes(value as PinRole);
const isCategory = (value: unknown): boolean => typeof value === "string" && COMPONENT_CATEGORIES.includes(value as ComponentCategory);
const isDriveMode = (value: unknown): boolean => typeof value === "string" && DRIVE_MODES.includes(value as DriveMode);
const isPolarity = (value: unknown): boolean => value === "positive" || value === "negative";
const isPoint = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const p = value as { x?: unknown; y?: unknown };
  return isNumber(p.x) && isNumber(p.y);
};
/** 图片像素坐标必须是非负的有限数：负坐标不可能来自真实图片。 */
const isImagePixel = (value: unknown): boolean => {
  if (!isPoint(value)) return false;
  const p = value as { x: number; y: number };
  return p.x >= 0 && p.y >= 0;
};
const isFootprint = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const f = value as { width?: unknown; height?: unknown };
  return isNumber(f.width) && (f.width as number) > 0 && isNumber(f.height) && (f.height as number) > 0;
};

/**
 * 校验单个候选字段。unknown 与 value 必须自洽：未知不得带值，已知必须有有效值。
 * 这样从源头消除"已确认却没有值"的矛盾状态。
 */
function validateField(value: unknown, guard: (value: unknown) => boolean, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}候选字段无效`);
  const field = value as Partial<CandidateField<unknown>>;
  if (typeof field.unknown !== "boolean") throw new Error(`${label}候选字段缺少 unknown 标记`);
  if (!field.confidence || !CONFIDENCES.includes(field.confidence)) throw new Error(`${label}候选字段置信度无效`);
  if (!field.source || !PROVENANCE_SOURCES.includes(field.source)) throw new Error(`${label}候选字段来源无效`);
  if (field.evidence !== undefined && typeof field.evidence !== "string") throw new Error(`${label}候选字段证据无效`);
  if (field.unknown) {
    if (field.value !== undefined) throw new Error(`${label}是未知候选字段，不得携带值`);
  } else if (field.confidence === "unknown") {
    throw new Error(`${label}候选字段置信度无效`);
  } else if (field.value === undefined || !guard(field.value)) {
    throw new Error(`${label}已确认候选字段缺少有效值`);
  }
}

function validateCandidatePin(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("候选引脚无效");
  const pin = value as Partial<CandidatePin>;
  if (typeof pin.tempId !== "string" || !TEMP_ID_PATTERN.test(pin.tempId)) throw new Error("候选引脚缺少合法的临时 ID");
  validateField(pin.name, isString, "引脚名称");
  validateField(pin.role, isRole, "引脚类型");
  if (pin.imagePixel !== undefined && !isImagePixel(pin.imagePixel)) throw new Error("候选引脚图片像素坐标无效");
  if (pin.polarity !== undefined) validateField(pin.polarity, isPolarity, "引脚极性");
  if (pin.driveMode !== undefined) validateField(pin.driveMode, isDriveMode, "引脚驱动模式");
  if (pin.maxVoltage !== undefined) validateField(pin.maxVoltage, isNumber, "引脚最大电压");
  if (pin.maxCurrent !== undefined) validateField(pin.maxCurrent, isNumber, "引脚最大电流");
  if (pin.outputVoltage !== undefined) validateField(pin.outputVoltage, isNumber, "引脚输出电压");
  if (pin.protocol !== undefined) validateField(pin.protocol, isString, "引脚协议");
  if (pin.note !== undefined) validateField(pin.note, isString, "引脚备注");
}

/** 校验外部/持久化的元件候选。不合格就抛中文错误，不猜测、不修补。 */
export function validateComponentCandidate(value: unknown): asserts value is ComponentCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("元件候选必须是一个对象");
  const candidate = value as Partial<ComponentCandidate>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) throw new Error("元件候选缺少 id");
  validateField(candidate.displayName, isString, "名称");
  if (candidate.manufacturer !== undefined) validateField(candidate.manufacturer, isString, "厂商");
  if (candidate.model !== undefined) validateField(candidate.model, isString, "型号");
  if (candidate.category !== undefined) validateField(candidate.category, isCategory, "分类");
  if (candidate.footprint !== undefined) validateField(candidate.footprint, isFootprint, "尺寸");
  if (candidate.image !== undefined) validateComponentImage(candidate.image);
  if (!Array.isArray(candidate.pins)) throw new Error("元件候选缺少引脚列表");
  const tempIds = new Set<string>();
  for (const pin of candidate.pins) {
    validateCandidatePin(pin);
    const tempId = (pin as CandidatePin).tempId;
    if (tempIds.has(tempId)) throw new Error(`候选引脚临时 ID 重复：${tempId}`);
    tempIds.add(tempId);
  }
  if (candidate.electricalProperties !== undefined) {
    const electrical = candidate.electricalProperties;
    if (!electrical || typeof electrical !== "object" || Array.isArray(electrical)) throw new Error("候选电气参数无效");
    for (const key of ELECTRICAL_PROPERTY_KEYS) {
      const field = (electrical as Record<string, unknown>)[key];
      if (field !== undefined) validateField(field, isNumber, `电气参数 ${key}`);
    }
  }
}

type FieldCloner<T> = (value: unknown) => T;

/** 按白名单重建单个候选字段，丢弃任何未声明的额外键。 */
function cloneField<T>(field: CandidateField<T>, cloneValue: FieldCloner<T>): CandidateField<T> {
  const base = {
    unknown: field.unknown,
    confidence: field.confidence,
    source: field.source,
    ...(field.evidence !== undefined ? { evidence: field.evidence } : {}),
  };
  if (field.unknown || field.value === undefined) return base as CandidateField<T>;
  return { ...base, value: cloneValue(field.value) } as CandidateField<T>;
}

const cloneString = (value: unknown): string => value as string;
const cloneNumber = (value: unknown): number => value as number;
const cloneRole = (value: unknown): PinRole => value as PinRole;
const cloneCategory = (value: unknown): ComponentCategory => value as ComponentCategory;
const cloneDriveMode = (value: unknown): DriveMode => value as DriveMode;
const clonePolarity = (value: unknown): "positive" | "negative" => value as "positive" | "negative";
const cloneFootprint = (value: unknown): { width: number; height: number } => {
  const f = value as { width: number; height: number };
  return { width: f.width, height: f.height };
};

function cloneCandidatePin(pin: CandidatePin): CandidatePin {
  return {
    tempId: pin.tempId,
    name: cloneField(pin.name, cloneString),
    role: cloneField(pin.role, cloneRole),
    ...(pin.imagePixel !== undefined ? { imagePixel: { x: pin.imagePixel.x, y: pin.imagePixel.y } } : {}),
    ...(pin.polarity !== undefined ? { polarity: cloneField(pin.polarity, clonePolarity) } : {}),
    ...(pin.driveMode !== undefined ? { driveMode: cloneField(pin.driveMode, cloneDriveMode) } : {}),
    ...(pin.maxVoltage !== undefined ? { maxVoltage: cloneField(pin.maxVoltage, cloneNumber) } : {}),
    ...(pin.maxCurrent !== undefined ? { maxCurrent: cloneField(pin.maxCurrent, cloneNumber) } : {}),
    ...(pin.outputVoltage !== undefined ? { outputVoltage: cloneField(pin.outputVoltage, cloneNumber) } : {}),
    ...(pin.protocol !== undefined ? { protocol: cloneField(pin.protocol, cloneString) } : {}),
    ...(pin.note !== undefined ? { note: cloneField(pin.note, cloneString) } : {}),
  };
}

function cloneElectricalProperties(value: CandidateElectricalProperties): CandidateElectricalProperties {
  const out: CandidateElectricalProperties = {};
  for (const key of ELECTRICAL_PROPERTY_KEYS) {
    const field = value[key];
    if (field !== undefined) out[key] = cloneField(field, cloneNumber);
  }
  return out;
}

/**
 * 校验并按白名单重建元件候选：任何未声明的字段（例如误塞进来的密钥）都会被丢弃。
 * 供应商（Provider）返回的内容必须先经此处，保证候选是闭集，不会把多余数据带进后续流程。
 */
export function normalizeComponentCandidate(value: unknown): ComponentCandidate {
  validateComponentCandidate(value);
  const candidate = value as ComponentCandidate;
  return {
    id: candidate.id,
    displayName: cloneField(candidate.displayName, cloneString),
    ...(candidate.manufacturer !== undefined ? { manufacturer: cloneField(candidate.manufacturer, cloneString) } : {}),
    ...(candidate.model !== undefined ? { model: cloneField(candidate.model, cloneString) } : {}),
    ...(candidate.category !== undefined ? { category: cloneField(candidate.category, cloneCategory) } : {}),
    ...(candidate.footprint !== undefined ? { footprint: cloneField(candidate.footprint, cloneFootprint) } : {}),
    ...(candidate.image !== undefined ? { image: cloneComponentImage(candidate.image) } : {}),
    pins: candidate.pins.map(cloneCandidatePin),
    ...(candidate.electricalProperties !== undefined ? { electricalProperties: cloneElectricalProperties(candidate.electricalProperties) } : {}),
  };
}

/** 新建一个"全未知"的候选作为起点：不预设任何引脚与电气数值。 */
export function createEmptyCandidate(id: string, displayName?: string): ComponentCandidate {
  return {
    id,
    displayName: displayName !== undefined && displayName.length > 0
      ? knownField(displayName, "user", "confirmed")
      : unknownField<string>("user"),
    pins: [],
  };
}

/** 候选字段路径。确认时使用的路径与此处完全一致，避免界面与领域层路径漂移。 */
const pinFieldPath = (tempId: string, field: string): string => `pins.${tempId}.${field}`;
const electricalPath = (key: keyof ElectricalProperties): string => `electricalProperties.${key}`;

/** 枚举候选中所有存在的字段，供界面逐字段展示来源、置信度与证据。 */
export function listCandidateFields(candidate: ComponentCandidate): CandidateFieldRef[] {
  const refs: CandidateFieldRef[] = [];
  const push = (path: string, label: string, field: CandidateField<unknown> | undefined): void => {
    if (field) refs.push({ path, label, field });
  };
  push("displayName", "名称", candidate.displayName);
  push("manufacturer", "厂商", candidate.manufacturer);
  push("model", "型号", candidate.model);
  push("category", "分类", candidate.category);
  // 尺寸只作参考：外部给出的数值单位不可知，不会写进定义（盒子尺寸由确定性规则推导）。
  push("footprint", "尺寸（仅供参考，单位未知）", candidate.footprint);
  for (const key of ELECTRICAL_PROPERTY_KEYS) {
    push(electricalPath(key), `元件参数 ${key}`, candidate.electricalProperties?.[key]);
  }
  for (const pin of candidate.pins) {
    const who = `引脚 ${pin.tempId}`;
    push(pinFieldPath(pin.tempId, "name"), `${who} 名称`, pin.name);
    push(pinFieldPath(pin.tempId, "role"), `${who} 类型`, pin.role);
    push(pinFieldPath(pin.tempId, "polarity"), `${who} 极性`, pin.polarity);
    push(pinFieldPath(pin.tempId, "driveMode"), `${who} 驱动模式`, pin.driveMode);
    push(pinFieldPath(pin.tempId, "maxVoltage"), `${who} 最大电压`, pin.maxVoltage);
    push(pinFieldPath(pin.tempId, "maxCurrent"), `${who} 最大电流`, pin.maxCurrent);
    push(pinFieldPath(pin.tempId, "outputVoltage"), `${who} 输出电压`, pin.outputVoltage);
    push(pinFieldPath(pin.tempId, "protocol"), `${who} 协议`, pin.protocol);
    push(pinFieldPath(pin.tempId, "note"), `${who} 备注`, pin.note);
  }
  return refs;
}

/** 仅当字段已知且被用户确认采用时才取值；否则一律 undefined。 */
function takeAccepted<T>(field: CandidateField<T> | undefined, accepted: Set<string>, path: string): T | undefined {
  if (!field || field.unknown || field.value === undefined) return undefined;
  return accepted.has(path) ? field.value : undefined;
}

function toProvenance<T>(field: CandidateField<T>): Provenance {
  return {
    confidence: field.confidence,
    source: field.source,
    ...(field.evidence !== undefined ? { evidence: field.evidence } : {}),
  };
}

/**
 * 把候选与用户确认结果确定性地映射为可信元件定义。
 *
 * 规则：
 * - 只有出现在 acceptedFields 中的候选字段才会写入；未确认的字段保持未知，绝不臆造。
 * - 只有出现在 acceptedPinTempIds 中的候选引脚才会写入；引脚类型未确认时记为 UNKNOWN。
 * - 每个写入字段的来源与置信度照抄候选，不因用户确认而升级成 confirmed。
 * - 用户显式给出的名称优先于候选名称。
 * - 坐标系在此收敛：候选只带"图片像素坐标"，元件本地坐标只能由 imagePixelToLocal 换算得到；
 *   外部给出的尺寸数值因单位不可知一律不采用，盒子尺寸由确定性规则推导。
 * - 结果最终经 normalizeComponentDefinition 校验与白名单重建，多余的键不会进入可信库。
 */
export function definitionFromCandidate(
  candidate: ComponentCandidate,
  confirmation: CandidateConfirmation,
): ComponentDefinition {
  const normalized = normalizeComponentCandidate(candidate);
  const accepted = new Set(confirmation.acceptedFields);
  const acceptedPins = new Set(confirmation.acceptedPinTempIds);
  const provenance: Record<string, Provenance> = {};

  // 名称：用户显式命名优先，其次候选已确认名称。两者皆无则拒绝入库，而不是拿 id 冒充名称。
  let displayName: string;
  if (confirmation.displayName !== undefined && confirmation.displayName.length > 0) {
    displayName = confirmation.displayName;
    provenance.displayName = { confidence: "confirmed", source: "user" };
  } else {
    const candidateName = takeAccepted(normalized.displayName, accepted, "displayName");
    if (candidateName === undefined) throw new Error("元件名称缺失：请在确认时提供名称");
    displayName = candidateName;
    provenance.displayName = toProvenance(normalized.displayName);
  }

  const manufacturer = takeAccepted(normalized.manufacturer, accepted, "manufacturer");
  if (manufacturer !== undefined && normalized.manufacturer) provenance.manufacturer = toProvenance(normalized.manufacturer);
  const model = takeAccepted(normalized.model, accepted, "model");
  if (model !== undefined && normalized.model) provenance.model = toProvenance(normalized.model);

  const categoryValue = takeAccepted(normalized.category, accepted, "category");
  if (categoryValue !== undefined && normalized.category) provenance.category = toProvenance(normalized.category);
  else provenance.category = { confidence: "unknown", source: "user" };

  // 先给引脚分组：兜底尺寸要按同侧引脚数推导，否则引脚会挤在一起看不清。
  // 此处只能依据"有没有像素坐标"分组——盒子尺寸必须在建立图片映射之前先定下来。
  const acceptedCandidatePins = normalized.pins.filter((pin) => acceptedPins.has(pin.tempId));
  const roleOf = (pin: CandidatePin): PinRole =>
    takeAccepted(pin.role, accepted, pinFieldPath(pin.tempId, "role")) ?? "UNKNOWN";
  const withoutPixel = acceptedCandidatePins.filter((pin) => pin.imagePixel === undefined);
  const needsColumn = (pin: CandidatePin): boolean => INPUT_SIDE_ROLES.includes(roleOf(pin));

  // 外部给出的尺寸一律不写入定义：其单位不可知，直接当画布本地单位会让元件小到引脚挤成一团。
  // 尺寸改由确定性规则推导；acceptance 只影响界面勾选，不再影响定义里的真实尺寸。
  void takeAccepted(normalized.footprint, accepted, "footprint");
  const footprint = deriveFootprint(
    normalized.image,
    Math.max(withoutPixel.filter(needsColumn).length, withoutPixel.filter((pin) => !needsColumn(pin)).length),
  );
  provenance.footprint = { confidence: "unknown", source: "user" };

  const electrical: ElectricalProperties = {};
  for (const key of ELECTRICAL_PROPERTY_KEYS) {
    const field = normalized.electricalProperties?.[key];
    const value = takeAccepted(field, accepted, electricalPath(key));
    if (value !== undefined) {
      electrical[key] = value;
      if (field) provenance[electricalPath(key)] = toProvenance(field);
    }
  }

  // 有像素坐标的引脚必须经 imagePixelToLocal 换算成本地坐标——这是唯一的坐标系转换点。
  // 没有图片（无法建立映射）时宁可退回兜底排布，也绝不把像素坐标当成本地坐标写进定义。
  const layout = normalized.image ? createLayoutFromImage(footprint, normalized.image) : undefined;
  const localize = (pin: CandidatePin): { x: number; y: number } | undefined =>
    pin.imagePixel !== undefined && layout !== undefined ? imagePixelToLocal(layout, pin.imagePixel) : undefined;

  // 兜底排布覆盖"最终仍拿不到本地坐标"的引脚（没有像素坐标，或没有图片、无法换算）。
  const fallbackPins = acceptedCandidatePins.filter((pin) => localize(pin) === undefined);
  const defaultPositions = new Map<string, { x: number; y: number }>();
  const placeColumn = (list: CandidatePin[], x: number): void => {
    list.forEach((pin, index) => {
      // 保留精确分数而非取整：尺寸很小时取整仍可能让相邻引脚落到同一 y，造成重叠。
      defaultPositions.set(pin.tempId, { x, y: (footprint.height * (index + 1)) / (list.length + 1) });
    });
  };
  placeColumn(fallbackPins.filter(needsColumn), 0);
  placeColumn(fallbackPins.filter((pin) => !needsColumn(pin)), footprint.width);

  const pins: PinDefinition[] = [];
  for (const candidatePin of normalized.pins) {
    if (!acceptedPins.has(candidatePin.tempId)) continue;
    const path = (field: string): string => pinFieldPath(candidatePin.tempId, field);
    const roleValue = takeAccepted(candidatePin.role, accepted, path("role"));
    const nameValue = takeAccepted(candidatePin.name, accepted, path("name"));
    const placedPixel = localize(candidatePin);
    const pin: PinDefinition = {
      id: candidatePin.tempId,
      name: nameValue ?? "",
      role: roleValue ?? "UNKNOWN",
      localPosition: placedPixel
        ? { x: placedPixel.x, y: placedPixel.y }
        : defaultPositions.get(candidatePin.tempId) ?? { x: 0, y: 0 },
    };
    if (placedPixel) {
      // 位置由"AI 给出的像素坐标"确定性换算而来：来源与置信度照抄候选，不升级为已确认。
      provenance[path("x")] = { confidence: "estimated", source: "ai-suggestion" };
      provenance[path("y")] = { confidence: "estimated", source: "ai-suggestion" };
    }
    if (roleValue !== undefined) provenance[path("role")] = toProvenance(candidatePin.role);
    if (nameValue !== undefined) provenance[path("name")] = toProvenance(candidatePin.name);

    const polarity = takeAccepted(candidatePin.polarity, accepted, path("polarity"));
    if (polarity !== undefined && candidatePin.polarity) { pin.polarity = polarity; provenance[path("polarity")] = toProvenance(candidatePin.polarity); }
    const driveMode = takeAccepted(candidatePin.driveMode, accepted, path("driveMode"));
    if (driveMode !== undefined && candidatePin.driveMode) { pin.driveMode = driveMode; provenance[path("driveMode")] = toProvenance(candidatePin.driveMode); }
    const maxVoltage = takeAccepted(candidatePin.maxVoltage, accepted, path("maxVoltage"));
    if (maxVoltage !== undefined && candidatePin.maxVoltage) { pin.maxVoltage = maxVoltage; provenance[path("maxVoltage")] = toProvenance(candidatePin.maxVoltage); }
    const maxCurrent = takeAccepted(candidatePin.maxCurrent, accepted, path("maxCurrent"));
    if (maxCurrent !== undefined && candidatePin.maxCurrent) { pin.maxCurrent = maxCurrent; provenance[path("maxCurrent")] = toProvenance(candidatePin.maxCurrent); }
    const outputVoltage = takeAccepted(candidatePin.outputVoltage, accepted, path("outputVoltage"));
    if (outputVoltage !== undefined && candidatePin.outputVoltage) { pin.outputVoltage = outputVoltage; provenance[path("outputVoltage")] = toProvenance(candidatePin.outputVoltage); }
    const protocol = takeAccepted(candidatePin.protocol, accepted, path("protocol"));
    if (protocol !== undefined && candidatePin.protocol) { pin.protocol = protocol; provenance[path("protocol")] = toProvenance(candidatePin.protocol); }
    const note = takeAccepted(candidatePin.note, accepted, path("note"));
    if (note !== undefined && candidatePin.note) { pin.note = note; provenance[path("note")] = toProvenance(candidatePin.note); }

    pins.push(pin);
  }

  // 用户直接上传的图片属可信输入（见 ComponentCandidate.image 的约束），随确认一并写入。
  if (normalized.image !== undefined) provenance.image = { confidence: "confirmed", source: "user" };

  const definition: ComponentDefinition = {
    id: confirmation.id,
    displayName,
    ...(manufacturer !== undefined ? { manufacturer } : {}),
    ...(model !== undefined ? { model } : {}),
    category: categoryValue ?? "other",
    footprint,
    ...(normalized.image !== undefined ? { image: normalized.image } : {}),
    pins,
    electricalProperties: electrical,
    metadata: {},
    provenance,
    userOverrides: confirmation.displayName !== undefined && confirmation.displayName.length > 0 ? ["displayName"] : [],
  };
  // 最终仍按元件定义的闭集规则校验与重建：未声明的键到此为止，绝不进入可信库。
  return normalizeComponentDefinition(definition);
}
