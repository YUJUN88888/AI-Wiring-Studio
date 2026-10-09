import type { ComponentInstance, DriveMode, Pin, PinRole, Project, VoltageRange, VoltageTransform } from "./types";

/** 用户元件库的数据版本。与项目文件 (.aiws) 的 schemaVersion 相互独立。 */
export const CURRENT_LIBRARY_SCHEMA_VERSION = 1 as const;

/** 数据可信度。只有内置事实、用户手工确认或权威证据才能是 confirmed。 */
export type Confidence = "confirmed" | "estimated" | "unknown";

/** 数据来源。AI 建议永远不能直接成为 confirmed，必须先经用户确认。 */
export type ProvenanceSource = "builtin" | "user" | "datasheet" | "official-web" | "ai-suggestion";

export interface Provenance {
  confidence: Confidence;
  source: ProvenanceSource;
  /** 原始证据（用户粘贴的参数文字、链接或图片来源说明），用于人工复核。 */
  evidence?: string;
}

export type ComponentCategory =
  | "power" | "ground" | "mcu" | "passive" | "diode" | "capacitor" | "regulator" | "switch" | "other";

/**
 * 可编辑的电气参数集合。字段缺省即为未知，绝不以 0 或猜测值代替。
 * 单位约定：电压 V、电流 A、电阻 Ω、电容 F。
 */
export interface ElectricalProperties {
  maxVoltage?: number;
  maxCurrent?: number;
  outputVoltage?: number;
  resistance?: number;
  capacitance?: number;
  forwardVoltage?: number;
}

/** 元件的一个引脚定义。localPosition 是未旋转的元件本地坐标（画布单位）。 */
export interface PinDefinition {
  id: string;
  name: string;
  role: PinRole;
  localPosition: { x: number; y: number };
  driveMode?: DriveMode;
  polarity?: "positive" | "negative";
  required?: boolean;
  maxVoltage?: number;
  outputVoltage?: number;
  /** 已确认的电流上限（A）。缺省即未知，绝不以猜测值填充。 */
  maxCurrent?: number;
  /** 已确认的接口协议（如 I2C / SPI / UART）；用户未填写即未知。 */
  protocol?: string;
  /** 引脚备注文本，仅作说明，不参与电气判断。 */
  note?: string;
  voltageRange?: VoltageRange;
}

/** 图片裁剪区域，用相对原图的归一化比例（0..1）表示，与分辨率无关且可移植。 */
export interface ImageCrop { x: number; y: number; width: number; height: number; }

/**
 * 元件本地图片。dataUrl（自包含图片数据）与 path（相对路径）至少提供一个：
 * dataUrl 让元件库可以整体搬移而不丢图，path 兼容早期只记录相对路径的元件库。
 */
export interface ComponentImage {
  /** 相对路径引用；早期元件库仅含此字段时仍然兼容。 */
  path?: string;
  /** 自包含图片数据，形如 data:image/png;base64,...。 */
  dataUrl?: string;
  /** 原图像素宽高，用于图片坐标与元件本地坐标互算。 */
  naturalWidth?: number;
  naturalHeight?: number;
  /** 归一化裁剪区域；缺省表示使用完整原图。 */
  crop?: ImageCrop;
  /** 顺时针显示旋转角度（度）。 */
  rotation?: 0 | 90 | 180 | 270;
}

/**
 * 用户元件定义：可复用、可编辑、可存入用户库，与画布上的 ComponentInstance 分离。
 * 画布实例自带引脚副本，因此即使缺少用户库，已保存的 .aiws 依然可以打开并做 ERC。
 */
export interface ComponentDefinition {
  id: string;
  displayName: string;
  manufacturer?: string;
  model?: string;
  category: ComponentCategory;
  /** 元件本地尺寸（画布单位）。 */
  footprint: { width: number; height: number };
  /** 元件本地图片；相对路径或自包含数据至少一种，保证元件库可整体搬移。 */
  image?: ComponentImage;
  pins: PinDefinition[];
  electricalProperties: ElectricalProperties;
  metadata: Record<string, string>;
  /** 字段路径 → 来源与置信度；缺失即视为 unknown。 */
  provenance: Record<string, Provenance>;
  /** 用户手工修改过的字段路径，AI 结果不得静默覆盖。 */
  userOverrides: string[];
  /** 元件内部已确认的电压变换（如稳压器），缺省时 ERC 不得推断输出。 */
  voltageTransforms?: VoltageTransform[];
}

/** 允许的取值集合。导出供候选（Candidate）等其它领域模块复用，避免枚举定义漂移。 */
export const COMPONENT_CATEGORIES: readonly ComponentCategory[] = ["power", "ground", "mcu", "passive", "diode", "capacitor", "regulator", "switch", "other"];
export const CONFIDENCES: readonly Confidence[] = ["confirmed", "estimated", "unknown"];
export const PROVENANCE_SOURCES: readonly ProvenanceSource[] = ["builtin", "user", "datasheet", "official-web", "ai-suggestion"];
export const PIN_ROLES: readonly PinRole[] = ["POWER_OUTPUT", "POWER_INPUT", "GND", "GPIO", "INPUT", "OUTPUT", "PASSIVE", "UNKNOWN"];
export const DRIVE_MODES: readonly DriveMode[] = ["push-pull", "open-drain", "none", "unknown"];
const imageRotations: readonly (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

/** 电气参数允许的键。导出供候选模块复用，保证候选字段与定义字段同名同集。 */
export const ELECTRICAL_PROPERTY_KEYS: readonly (keyof ElectricalProperties)[] = [
  "maxVoltage", "maxCurrent", "outputVoltage", "resistance", "capacitance", "forwardVoltage",
];

const optionalFinite = (value: unknown): boolean => value === undefined || (typeof value === "number" && Number.isFinite(value));
const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
const requiredFinite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
const isPoint = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const p = value as { x?: unknown; y?: unknown };
  return requiredFinite(p.x) && requiredFinite(p.y);
};
/** 只接受相对路径，拒绝盘符、根路径、UNC 与带协议的 URL，保证元件库可以整体搬移。 */
const isRelativeImagePath = (path: string): boolean => path.length > 0
  && !/^([a-zA-Z]:[\\/]|[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(path);

function validRange(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const range = value as { min?: unknown; max?: unknown; unit?: unknown };
  return requiredFinite(range.min) && requiredFinite(range.max) && (range.min as number) <= (range.max as number) && range.unit === "V";
}

function validateElectrical(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const electrical = value as Record<string, unknown>;
  return optionalFinite(electrical.maxVoltage) && optionalFinite(electrical.maxCurrent)
    && optionalFinite(electrical.outputVoltage) && optionalFinite(electrical.resistance)
    && optionalFinite(electrical.capacitance) && optionalFinite(electrical.forwardVoltage);
}

function validatePin(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<PinDefinition>;
  if (typeof p.id !== "string" || p.id.length === 0 || typeof p.name !== "string") return false;
  if (!p.role || !PIN_ROLES.includes(p.role)) return false;
  if (!isPoint(p.localPosition)) return false;
  if (p.driveMode !== undefined && !DRIVE_MODES.includes(p.driveMode)) return false;
  if (p.polarity !== undefined && p.polarity !== "positive" && p.polarity !== "negative") return false;
  if (p.required !== undefined && typeof p.required !== "boolean") return false;
  if (!optionalFinite(p.maxVoltage) || !optionalFinite(p.outputVoltage) || !optionalFinite(p.maxCurrent)) return false;
  if (!optionalString(p.protocol) || !optionalString(p.note)) return false;
  if (p.voltageRange !== undefined && !validRange(p.voltageRange)) return false;
  return true;
}

function validateProvenance(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Partial<Provenance>;
  return !!provenance.confidence && CONFIDENCES.includes(provenance.confidence)
    && !!provenance.source && PROVENANCE_SOURCES.includes(provenance.source)
    && optionalString(provenance.evidence);
}

function validateTransform(value: unknown, pinIds: Set<string>): boolean {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<VoltageTransform>;
  return typeof t.inputPinId === "string" && typeof t.outputPinId === "string"
    && pinIds.has(t.inputPinId) && pinIds.has(t.outputPinId)
    && requiredFinite(t.outputVoltage) && validRange(t.inputVoltageRange);
}

/** 裁剪区域必须是归一化且落在原图范围内的有效矩形。 */
function validCrop(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<ImageCrop>;
  if (!requiredFinite(c.x) || !requiredFinite(c.y) || !requiredFinite(c.width) || !requiredFinite(c.height)) return false;
  const { x, y, width, height } = c as ImageCrop;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001;
}

/**
 * 校验元件图片。dataUrl 或相对路径至少提供一个；相对路径必须可移植，dataUrl 必须是图片类型。
 * 绝不接受 http(s) 外链或本地绝对路径，避免元件库依赖外部资源或泄漏机器信息。
 */
export function validateComponentImage(value: unknown): asserts value is ComponentImage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("元件图片数据无效");
  const image = value as Partial<ComponentImage>;
  const hasPath = image.path !== undefined;
  const hasDataUrl = image.dataUrl !== undefined;
  if (!hasPath && !hasDataUrl) throw new Error("元件图片必须包含图片数据或相对路径");
  if (hasPath && (typeof image.path !== "string" || !isRelativeImagePath(image.path))) throw new Error("元件图片必须使用相对路径");
  if (hasDataUrl && (typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/"))) throw new Error("元件图片数据必须是图片 data URL");
  if (image.naturalWidth !== undefined && !(requiredFinite(image.naturalWidth) && image.naturalWidth > 0)) throw new Error("元件图片尺寸无效");
  if (image.naturalHeight !== undefined && !(requiredFinite(image.naturalHeight) && image.naturalHeight > 0)) throw new Error("元件图片尺寸无效");
  if (image.crop !== undefined && !validCrop(image.crop)) throw new Error("元件图片裁剪区域无效");
  if (image.rotation !== undefined && !imageRotations.includes(image.rotation)) throw new Error("元件图片旋转角度无效");
}

/** 校验外部/持久化的元件定义。不合格就抛中文错误，不猜测、不修补。 */
export function validateComponentDefinition(value: unknown): asserts value is ComponentDefinition {
  if (!value || typeof value !== "object") throw new Error("元件定义必须是一个对象");
  const d = value as Partial<ComponentDefinition>;
  if (typeof d.id !== "string" || d.id.length === 0) throw new Error("元件定义缺少 id");
  if (typeof d.displayName !== "string" || d.displayName.length === 0) throw new Error("元件定义缺少名称");
  if (!d.category || !COMPONENT_CATEGORIES.includes(d.category)) throw new Error("元件分类无效");
  if (!optionalString(d.manufacturer) || !optionalString(d.model)) throw new Error("厂商或型号字段无效");
  if (!d.footprint || typeof d.footprint !== "object" || !requiredFinite(d.footprint.width) || d.footprint.width <= 0
    || !requiredFinite(d.footprint.height) || d.footprint.height <= 0) throw new Error("元件尺寸无效");
  if (d.image !== undefined) validateComponentImage(d.image);
  if (!Array.isArray(d.pins) || d.pins.length === 0) throw new Error("元件至少需要一个引脚");
  const pinIds = new Set<string>();
  for (const pin of d.pins) {
    if (!validatePin(pin)) throw new Error("引脚定义无效");
    const id = (pin as PinDefinition).id;
    if (pinIds.has(id)) throw new Error(`引脚 ID 重复：${id}`);
    pinIds.add(id);
  }
  if (!validateElectrical(d.electricalProperties)) throw new Error("元件电气参数无效");
  if (!d.metadata || typeof d.metadata !== "object" || Array.isArray(d.metadata)) throw new Error("元件元数据无效");
  for (const entry of Object.values(d.metadata)) if (typeof entry !== "string") throw new Error("元件元数据必须是文本");
  if (!d.provenance || typeof d.provenance !== "object" || Array.isArray(d.provenance)) throw new Error("元件来源信息无效");
  for (const entry of Object.values(d.provenance)) if (!validateProvenance(entry)) throw new Error("元件来源信息无效");
  if (!Array.isArray(d.userOverrides) || d.userOverrides.some((field) => typeof field !== "string")) throw new Error("用户覆盖字段记录无效");
  if (d.voltageTransforms !== undefined) {
    if (!Array.isArray(d.voltageTransforms)) throw new Error("电压变换数据无效");
    for (const transform of d.voltageTransforms) if (!validateTransform(transform, pinIds)) throw new Error("电压变换无效");
  }
}

/**
 * 新建一个"全未知"的元件定义作为编辑器起点：所有电气字段留空，来源逐字段记为未知。
 * 尺寸与分类只是画布占位取值，其 confidence 同样是 unknown，不会被当作已确认事实。
 * 注意：此时没有任何引脚，尚未通过校验，只有补上引脚后才允许保存进用户库。
 */
export function createEmptyDefinition(id: string, displayName: string): ComponentDefinition {
  return {
    id,
    displayName,
    category: "other",
    footprint: { width: 120, height: 80 },
    pins: [],
    electricalProperties: {},
    metadata: {},
    provenance: {
      displayName: { confidence: "confirmed", source: "user" },
      category: { confidence: "unknown", source: "user" },
      footprint: { confidence: "unknown", source: "user" },
    },
    userOverrides: ["displayName"],
  };
}

/**
 * 新建一个"全未知"的引脚作为编辑器起点：类型未定、位置在原点、不预设任何电压电流数值。
 * 名称留空是刻意的，由用户在编辑器里显式填写，避免凭空生成看似已确认的标签。
 */
export function createPinDefinition(id: string, name = ""): PinDefinition {
  return { id, name, role: "UNKNOWN", localPosition: { x: 0, y: 0 } };
}

/**
 * 把某个字段标记为"用户已确认"。
 * 只有用户手工录入才走这里；AI 候选必须经此确认后才能升级为 confirmed。
 * 移除字段时调用 removeFieldProvenance，保证不会留下"已确认却没有值"的矛盾状态。
 */
export function confirmProvenanceField(
  definition: ComponentDefinition,
  path: string,
  source: ProvenanceSource = "user",
): ComponentDefinition {
  return {
    ...definition,
    provenance: { ...definition.provenance, [path]: { confidence: "confirmed", source } },
    userOverrides: definition.userOverrides.includes(path) ? definition.userOverrides : [...definition.userOverrides, path],
  };
}

/** 字段被清空时，连带删除它的来源记录与用户覆盖标记，使其重新回到"未知"。 */
export function removeFieldProvenance(definition: ComponentDefinition, path: string): ComponentDefinition {
  const provenance = { ...definition.provenance };
  delete provenance[path];
  return { ...definition, provenance, userOverrides: definition.userOverrides.filter((item) => item !== path) };
}

/** 逐个字段重建引脚，顺带丢弃任何未声明的额外键。 */
function clonePin(pin: PinDefinition): Pin {
  return {
    id: pin.id,
    name: pin.name,
    role: pin.role,
    localPosition: { x: pin.localPosition.x, y: pin.localPosition.y },
    ...(pin.driveMode !== undefined ? { driveMode: pin.driveMode } : {}),
    ...(pin.polarity !== undefined ? { polarity: pin.polarity } : {}),
    ...(pin.required !== undefined ? { required: pin.required } : {}),
    ...(pin.maxVoltage !== undefined ? { maxVoltage: pin.maxVoltage } : {}),
    ...(pin.outputVoltage !== undefined ? { outputVoltage: pin.outputVoltage } : {}),
    ...(pin.maxCurrent !== undefined ? { maxCurrent: pin.maxCurrent } : {}),
    ...(pin.protocol !== undefined ? { protocol: pin.protocol } : {}),
    ...(pin.note !== undefined ? { note: pin.note } : {}),
    ...(pin.voltageRange !== undefined ? { voltageRange: { min: pin.voltageRange.min, max: pin.voltageRange.max, unit: "V" as const } } : {}),
  };
}

function cloneTransform(transform: VoltageTransform): VoltageTransform {
  return {
    inputPinId: transform.inputPinId,
    outputPinId: transform.outputPinId,
    outputVoltage: transform.outputVoltage,
    inputVoltageRange: { min: transform.inputVoltageRange.min, max: transform.inputVoltageRange.max, unit: "V" as const },
  };
}

/** 逐个字段重建图片，顺带丢弃任何未声明的额外键。 */
export function cloneComponentImage(image: ComponentImage): ComponentImage {
  return {
    ...(image.path !== undefined ? { path: image.path } : {}),
    ...(image.dataUrl !== undefined ? { dataUrl: image.dataUrl } : {}),
    ...(image.naturalWidth !== undefined ? { naturalWidth: image.naturalWidth } : {}),
    ...(image.naturalHeight !== undefined ? { naturalHeight: image.naturalHeight } : {}),
    ...(image.crop !== undefined ? { crop: { x: image.crop.x, y: image.crop.y, width: image.crop.width, height: image.crop.height } } : {}),
    ...(image.rotation !== undefined ? { rotation: image.rotation } : {}),
  };
}

/**
 * 校验并按白名单重建元件定义：任何未声明的字段（例如误塞进来的密钥）都会被丢弃。
 * 外部文件与用户库读入时必须经过这里，保证库内容是闭集、可移植、可安全再导出。
 */
export function normalizeComponentDefinition(value: unknown): ComponentDefinition {
  validateComponentDefinition(value);
  const d = value as ComponentDefinition;
  const electrical: ElectricalProperties = {};
  for (const key of ELECTRICAL_PROPERTY_KEYS) {
    const entry = d.electricalProperties[key];
    if (entry !== undefined) electrical[key] = entry;
  }
  return {
    id: d.id,
    displayName: d.displayName,
    ...(d.manufacturer !== undefined ? { manufacturer: d.manufacturer } : {}),
    ...(d.model !== undefined ? { model: d.model } : {}),
    category: d.category,
    footprint: { width: d.footprint.width, height: d.footprint.height },
    ...(d.image !== undefined ? { image: cloneComponentImage(d.image) } : {}),
    pins: d.pins.map(clonePin),
    electricalProperties: electrical,
    metadata: { ...d.metadata },
    provenance: Object.fromEntries(Object.entries(d.provenance).map(([field, provenance]) => [field, {
      confidence: provenance.confidence,
      source: provenance.source,
      ...(provenance.evidence !== undefined ? { evidence: provenance.evidence } : {}),
    }])),
    userOverrides: [...d.userOverrides],
    ...(d.voltageTransforms !== undefined ? { voltageTransforms: d.voltageTransforms.map(cloneTransform) } : {}),
  };
}

/** 引脚上"有值即已确认"的字段名。用于把画布实例里已有的引脚事实按其来源如实回写进定义。 */
const PIN_FACT_FIELDS = ["name", "role", "driveMode", "polarity", "maxVoltage", "outputVoltage", "maxCurrent", "protocol", "note", "voltageRange"] as const;

/**
 * 从画布实例读取引脚事实的来源：内置目录产生的实例记为内置事实，其余记为工程里已有的用户数据。
 * 只有真正有值的字段才登记，绝不替空字段编造一个"已确认"。
 */
function seedPinProvenance(instance: ComponentInstance): Record<string, Provenance> {
  const source: ProvenanceSource = instance.definitionId.startsWith("builtin.") ? "builtin" : "user";
  const provenance: Record<string, Provenance> = {};
  for (const pin of instance.pins) {
    for (const field of PIN_FACT_FIELDS) {
      const value = pin[field];
      if (value === undefined) continue;
      if (typeof value === "string" && value === "") continue;
      provenance[`pins.${pin.id}.${field}`] = { confidence: "confirmed", source };
    }
  }
  return provenance;
}

export interface DefinitionChanges {
  footprint?: { width: number; height: number };
  image?: ComponentImage;
}

/**
 * 以画布实例为蓝本生成可写入用户库的元件定义。
 * - 库里已有同 id 定义时以它为基础（保留电气参数、来源与用户覆盖记录），只覆盖本次改动的字段；
 * - 库里没有时（内置元件等）按实例引脚重建，只把已经存在的事实按内置/用户来源登记，绝不补写额定值。
 * 只有本次真正改动的 footprint / image 才被标为"已确认 · 用户录入"。
 * 沿用实例原有的 definitionId，因此同型号的其它画布元件会一起解析到这份定义。
 */
export function definitionFromInstance(
  instance: ComponentInstance,
  base: ComponentDefinition | undefined,
  changes: DefinitionChanges,
): ComponentDefinition {
  const seed = base ? normalizeComponentDefinition(base) : {
    id: instance.definitionId,
    displayName: instance.displayName,
    category: "other" as ComponentCategory,
    footprint: { width: 120, height: 80 },
    pins: instance.pins.map((pin) => ({ ...pin, localPosition: { ...pin.localPosition } })),
    electricalProperties: {},
    metadata: {},
    provenance: seedPinProvenance(instance),
    userOverrides: [],
    ...(instance.voltageTransforms ? { voltageTransforms: instance.voltageTransforms.map(cloneTransform) } : {}),
  };
  const provenance = { ...seed.provenance };
  const userOverrides = [...seed.userOverrides];
  const next: ComponentDefinition = { ...seed, provenance, userOverrides };
  const confirmUserField = (path: string) => {
    provenance[path] = { confidence: "confirmed", source: "user" };
    if (!userOverrides.includes(path)) userOverrides.push(path);
  };
  if (changes.footprint) {
    next.footprint = { width: changes.footprint.width, height: changes.footprint.height };
    confirmUserField("footprint");
  }
  if (changes.image) {
    next.image = cloneComponentImage(changes.image);
    confirmUserField("image");
  }
  return next;
}

/** 把元件定义实例化为画布元件。实例自带引脚副本，因此不依赖用户库是否可用。 */
export function instantiateFromDefinition(
  definition: ComponentDefinition,
  id: string,
  position: { x: number; y: number },
  rotation: ComponentInstance["rotation"] = 0,
): ComponentInstance {
  return {
    id,
    definitionId: definition.id,
    displayName: definition.displayName,
    position: { ...position },
    rotation,
    pins: definition.pins.map(clonePin),
    ...(definition.voltageTransforms ? { voltageTransforms: definition.voltageTransforms.map(cloneTransform) } : {}),
  };
}

/**
 * 用最新定义刷新画布上同型号实例的引脚与内部电压变换。
 *
 * 实例只是定义在"放到画布那一刻"的快照（见 instantiateFromDefinition）。编辑器改完引脚位置/名字后
 * 若不刷新实例，画布上就还是旧坐标——这正是"保存成功了但画布上的元件没跟着变"的根因。
 * 显示名只在实例名仍继承自旧定义名时才跟随（previousDisplayName），避免覆盖接线代码给单个实例起的名字。
 * 没有任何实质变化时原样返回，不制造多余的项目对象，免得凭空多出一条撤销记录。
 */
export function applyDefinitionToInstances(
  project: Project,
  definition: ComponentDefinition,
  previousDisplayName?: string,
): Project {
  if (!project.components.some((component) => component.definitionId === definition.id)) return project;
  const components = project.components.map((component): ComponentInstance => {
    if (component.definitionId !== definition.id) return component;
    const next: ComponentInstance = {
      ...component,
      displayName: previousDisplayName !== undefined && component.displayName === previousDisplayName ? definition.displayName : component.displayName,
      pins: definition.pins.map(clonePin),
    };
    if (definition.voltageTransforms) next.voltageTransforms = definition.voltageTransforms.map(cloneTransform);
    else delete next.voltageTransforms;
    return next;
  });
  return JSON.stringify(components) === JSON.stringify(project.components) ? project : { ...project, components };
}