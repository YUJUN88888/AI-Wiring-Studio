import {
  cloneComponentImage,
  validateComponentImage,
  type ComponentImage,
} from "./componentDefinition";
import { normalizeComponentCandidate, type ComponentCandidate } from "./componentCandidate";

/**
 * 元件导入供应商（Provider）抽象层。
 *
 * 本模块只定义"输入 → 候选"的接口与编排逻辑，不包含任何模型、网络或密钥处理：
 * - 领域层与具体的 LLM（大语言模型）、Vision（图像识别）、OCR（图片文字识别）、WebSearch（资料检索）
 *   实现完全解耦，具体实现在更外层注入。
 * - 任何供应商都只能产出"元件候选"（ComponentCandidate），必须经用户逐字段确认后才写入可信元件库。
 * - 没有可用供应商时，本模块确定性地返回明确的"AI 不可用"结果，绝不伪造网络或 AI 响应；
 *   画布、手工创建元件、保存、ERC 均不依赖本模块，因此 AI 不可用时它们依旧完全可用。
 * - 安全约束：供应商自行持有凭据，凭据既不出现在输入模型里，也不写入候选、更不进入任何日志。
 */

/**
 * 供应商可提供的能力。用于把 LLM / Vision / OCR / WebSearch 等实现按需解耦。
 *
 * 说明：`ocr` 只用于供应商自述其内部依赖与界面展示，本编排不会以 `ocr` 能力直接发起导入
 * （图片导入统一要求 `vision`，由视觉供应商内部按需编排 OCR），因此单独声明 `ocr` 的供应商
 * 不会被执行入口选中。
 */
export type ImportCapability = "text" | "vision" | "ocr" | "web-search";

/** 导入输入的来源类型。 */
export type ImportSourceKind = "text" | "model" | "image" | "url" | "component-lookup";

/**
 * 元件导入输入。只承载用户主动提供的内容，绝不包含任何凭据。
 * - text：用户粘贴的参数文字
 * - model：用户输入的元件型号
 * - image：用户上传的元件图片（可信输入，见 ComponentCandidate.image 的不变量）
 * - url：用户提供的 datasheet（数据手册）或资料链接
 * - component-lookup：接线代码里出现、但当前元件库没有的元件类型；要求模型按型号/名称补齐参数，
 *   并逐字沿用代码里已经用到的引脚 ID（referencedPins），否则补查结果仍无法被代码引用。
 */
export type ImportSource =
  | { kind: "text"; text: string }
  | { kind: "model"; model: string }
  | { kind: "image"; image: ComponentImage }
  | { kind: "url"; url: string }
  | { kind: "component-lookup"; token: string; displayName: string; referencedPins: readonly string[] };

/**
 * 元件导入供应商。由外层注入具体实现，领域层不感知其技术细节。
 */
export interface ComponentImportProvider {
  /** 稳定标识，用于结果溯源，不得包含凭据。 */
  readonly id: string;
  /** 面向用户的名称。 */
  readonly displayName: string;
  /** 该供应商支持的能力集合。 */
  readonly capabilities: readonly ImportCapability[];
  /**
   * 依据输入产出元件候选。约定：
   * - 只返回候选，绝不放行"已确认"的可信定义；可信化只能由用户逐字段确认完成。
   * - 不得凭空生成或替换元件图片。
   * - 无法识别的字段一律标为未知，绝不以猜测值、0 或空串冒充已知。
   * - 抛出的错误信息会被转成面向用户的 reason，因此绝不得包含令牌、密钥等任何凭据。
   */
  extract(source: ImportSource): Promise<ComponentCandidate>;
}

/** 导入结果。unavailable 表示没有可用供应商（AI 不可用），error 表示调用或返回内容不合格。 */
export type ImportResult =
  | { status: "ok"; providerId: string; candidate: ComponentCandidate }
  | { status: "unavailable"; reason: string }
  | { status: "error"; providerId?: string; reason: string };

/** 面向用户展示的能力名称。 */
const CAPABILITY_LABELS: Record<ImportCapability, string> = {
  text: "文字/型号识别",
  vision: "图片识别",
  ocr: "图片文字识别",
  "web-search": "资料检索",
};

/** 输入类型 → 所需的供应商能力。图片导入需要视觉能力；纯 OCR 供应商由视觉供应商内部编排，不直接满足图片导入。 */
export function capabilityForSource(kind: ImportSourceKind): ImportCapability {
  switch (kind) {
    case "text":
    case "model":
    case "component-lookup":
      return "text";
    case "image":
      return "vision";
    case "url":
      return "web-search";
  }
}

/** 找到第一个支持指定能力的供应商；没有则返回 undefined。 */
export function findProvider(
  providers: readonly ComponentImportProvider[],
  capability: ImportCapability,
): ComponentImportProvider | undefined {
  return providers.find((provider) => provider.capabilities.includes(capability));
}

/** 汇总当前可用的能力（去重），供界面判断哪些 AI 功能可用。 */
export function availableCapabilities(providers: readonly ComponentImportProvider[]): ImportCapability[] {
  const order: readonly ImportCapability[] = ["text", "vision", "ocr", "web-search"];
  const available = new Set<ImportCapability>();
  for (const provider of providers) for (const capability of provider.capabilities) available.add(capability);
  return order.filter((capability) => available.has(capability));
}

/** AI 不可用时面向用户的说明。明确告知不可用，并指出仍可手工完成。 */
export function unavailableReason(capability: ImportCapability): string {
  return `AI 不可用：未配置可用于「${CAPABILITY_LABELS[capability]}」的元件导入服务，可继续手工创建元件。`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 校验资料链接：仅接受 http / https，拒绝 file、javascript 等可能带来风险的协议，并拒绝内嵌凭据。 */
function validateUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return "请输入资料链接";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "资料链接格式无效";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "资料链接必须是 http 或 https 地址";
  if (parsed.username.length > 0 || parsed.password.length > 0) return "资料链接不得包含用户名或密码";
  return undefined;
}

/** 校验导入输入。返回中文错误说明；合格时返回 undefined。 */
function validateImportSource(source: ImportSource): string | undefined {
  if (!source || typeof source !== "object") return "导入输入无效";
  switch (source.kind) {
    case "text":
      return typeof source.text === "string" && source.text.trim().length > 0 ? undefined : "请输入元件参数文字";
    case "model":
      return typeof source.model === "string" && source.model.trim().length > 0 ? undefined : "请输入元件型号";
    case "url":
      return validateUrl(source.url);
    case "component-lookup": {
      if (typeof source.token !== "string" || source.token.trim().length === 0) return "缺少要补查的元件类型标识";
      if (typeof source.displayName !== "string" || source.displayName.trim().length === 0) return "缺少要补查的元件显示名";
      if (!Array.isArray(source.referencedPins)) return "被引用的引脚清单无效";
      // 引脚 ID 必须是非空、不含点与空白的字符串（与接线代码的引脚 ID 规则一致）。
      if (source.referencedPins.some((pin) => typeof pin !== "string" || !/^[^.\s]+$/.test(pin))) return "被引用的引脚 ID 不合法";
      return undefined;
    }
    case "image":
      try {
        validateComponentImage(source.image);
        return undefined;
      } catch (error) {
        return `元件图片无效：${messageOf(error)}`;
      }
    default:
      return "导入输入类型无效";
  }
}

/**
 * 编排一次元件导入：按输入类型选择具备相应能力的供应商，调用其产出候选并校验。
 *
 * 确定性行为：
 * - 没有匹配能力的供应商时返回 unavailable，并给出"AI 不可用"的明确说明，不伪造任何结果。
 * - 供应商抛错或返回不合格内容时返回 error，不合格内容一律不进入后续流程。
 * - 图片导入时，候选图片强制取自用户上传的可信图片；供应商若在非图片输入下自行带图，直接判为不合格。
 */
export async function importComponentCandidate(
  providers: readonly ComponentImportProvider[],
  source: ImportSource,
): Promise<ImportResult> {
  const sourceError = validateImportSource(source);
  if (sourceError) return { status: "error", reason: sourceError };

  const capability = capabilityForSource(source.kind);
  const provider = findProvider(providers, capability);
  if (!provider) return { status: "unavailable", reason: unavailableReason(capability) };

  let raw: unknown;
  try {
    raw = await provider.extract(source);
  } catch (error) {
    return { status: "error", providerId: provider.id, reason: `元件导入服务调用失败：${messageOf(error)}` };
  }

  let candidate: ComponentCandidate;
  try {
    candidate = normalizeComponentCandidate(raw);
  } catch (error) {
    return { status: "error", providerId: provider.id, reason: `元件导入服务返回的内容无效：${messageOf(error)}` };
  }

  // 图片不变量：候选中的图片必须来自用户本人上传，供应商不得凭空生成或替换。
  // 这里按白名单重建，保证返回结果在 image 字段上同样是闭集。
  if (source.kind === "image") {
    candidate = { ...candidate, image: cloneComponentImage(source.image) };
  } else if (candidate.image !== undefined) {
    return { status: "error", providerId: provider.id, reason: "元件导入服务不得自行生成或替换元件图片" };
  }

  return { status: "ok", providerId: provider.id, candidate };
}
