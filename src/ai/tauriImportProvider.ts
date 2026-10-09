import {
  candidateFromExtraction,
  parseAiExtraction,
  type ComponentImportProvider,
  type ImportSource,
} from "../domain";

/**
 * Tauri 侧的 AI 元件导入供应商实现。
 *
 * 该文件是"领域层接口"与"原生能力"之间的桥：
 * - 真正的模型调用发生在 Rust 侧，API Key 保存后只存在于 Windows 凭据管理器；用户在输入框录入密钥时，
 *   密钥会短暂经过本层内存，随即通过 Tauri 调用交给 Rust 并清空输入框，前端不再持有明文。
 * - 本层只负责：组装请求 → 交由 Rust → 解析模型输出 → 映射为候选（来源固定 ai-suggestion）。
 * - 未配置密钥、不在 Tauri 环境或调用失败时，绝不伪造结果；上层会据此明确呈现"AI 不可用"。
 */

/** 注入式调用器，便于在测试中替换 Tauri 的 invoke。 */
export interface AiImportInvoker {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

/** AI 导入配置。这些值都不是密钥，可以明文保存在本地存储中。 */
export interface AiImportSettings {
  /** OpenAI 兼容接口的基址，必须为 https（本机回环地址可用 http）。 */
  baseUrl: string;
  /** 文字/型号/资料链接所使用的模型。 */
  textModel: string;
  /** 图片识别所使用的视觉模型。 */
  visionModel: string;
}

/**
 * 默认指向 DeepSeek 的 OpenAI 兼容端点：文字与视觉模型同名，同一把密钥覆盖两种用途。
 * 用户可以在设置中改为任意 OpenAI 兼容端点。
 */
export const DEFAULT_AI_SETTINGS: AiImportSettings = {
  baseUrl: "https://api.deepseek.com",
  textModel: "deepseek-v4.1-flash-expires-on-0910",
  visionModel: "deepseek-v4.1-flash-expires-on-0910",
};

export const AI_SETTINGS_STORAGE_KEY = "aiws.ai-settings";

/** 存储后端抽象，与元件库保持一致的注入风格，便于测试。 */
export interface AiSettingsStorage {
  load(): string | null;
  save(text: string): void;
}

export function createLocalStorageAiSettingsStorage(key = AI_SETTINGS_STORAGE_KEY): AiSettingsStorage {
  return {
    load: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
    save: (text) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, text); },
  };
}

export function createMemoryAiSettingsStorage(initial: string | null = null): AiSettingsStorage {
  let current = initial;
  return { load: () => current, save: (text) => { current = text; } };
}

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** 校验设置：三个字段都必须是非空字符串；不合格就抛中文错误，不猜测、不修补。 */
export function validateAiSettings(value: unknown): asserts value is AiImportSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 设置必须是一个对象");
  const settings = value as Partial<Record<keyof AiImportSettings, unknown>>;
  if (!isFilledString(settings.baseUrl)) throw new Error("接口地址不能为空");
  if (!isFilledString(settings.textModel)) throw new Error("文字模型不能为空");
  if (!isFilledString(settings.visionModel)) throw new Error("视觉模型不能为空");
}

/** 按白名单重建设置，任何未声明的字段（例如被误塞进来的密钥）都会被丢弃。 */
export function normalizeAiSettings(value: unknown): AiImportSettings {
  validateAiSettings(value);
  const settings = value as AiImportSettings;
  return { baseUrl: settings.baseUrl.trim(), textModel: settings.textModel.trim(), visionModel: settings.visionModel.trim() };
}

export function serializeAiSettings(settings: AiImportSettings): string {
  return JSON.stringify(normalizeAiSettings(settings), null, 2);
}

/** 读取设置。缺失或损坏时回退到默认值；默认值本身是安全的公开端点，不含任何凭据。 */
export function loadAiSettings(storage: AiSettingsStorage): AiImportSettings {
  const raw = storage.load();
  if (raw === null || raw === "") return { ...DEFAULT_AI_SETTINGS };
  try {
    return normalizeAiSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(storage: AiSettingsStorage, settings: AiImportSettings): void {
  storage.save(serializeAiSettings(settings));
}

/** 把领域层的导入输入转换为 Rust 命令所需的载荷。 */
function toRustSource(source: ImportSource): Record<string, unknown> {
  switch (source.kind) {
    case "text":
      return { kind: "text", text: source.text };
    case "model":
      return { kind: "model", model: source.model };
    case "url":
      return { kind: "url", url: source.url };
    case "component-lookup":
      // 只传标识、显示名与被引用的引脚 ID；这三项都是用户代码里已有的内容，不含凭据。
      return {
        kind: "component-lookup",
        token: source.token,
        displayName: source.displayName,
        referencedPins: [...source.referencedPins],
      };
    case "image": {
      // AI 识别需要图片像素数据；仅有相对路径的图片无法走 AI 通道，明确拒绝而不是硬猜。
      if (source.image.dataUrl === undefined) {
        throw new Error("该图片只有文件路径、缺少图片数据，无法进行 AI 识别");
      }
      // 只传图片像素数据。尺寸对模型识别没有意义，不作为载荷的一部分。
      return { kind: "image", image: { dataUrl: source.image.dataUrl } };
    }
  }
}

/** 生成证据文本：说明模型是从哪种材料抽取的。不含任何凭据。 */
function describeSource(source: ImportSource): string {
  switch (source.kind) {
    case "text":
      return "模型依据用户粘贴的参数文字抽取";
    case "model":
      return `模型依据元件型号「${source.model}」抽取`;
    case "url":
      return `模型依据资料链接 ${source.url} 的正文抽取`;
    case "component-lookup":
      return `接线代码缺少元件「${source.displayName}」，模型依据对该型号的了解补查`;
    case "image":
      return "模型依据用户上传的元件图片抽取";
  }
}

/** 由注入的调用器与设置构造供应商。 */
export function createAiImportProvider(invoker: AiImportInvoker, settings: AiImportSettings): ComponentImportProvider {
  const normalized = normalizeAiSettings(settings);
  return {
    id: "ai.openai-compatible",
    displayName: "AI 元件导入（OpenAI 兼容接口）",
    capabilities: ["text", "vision", "web-search"],
    extract: async (source) => {
      const request = {
        baseUrl: normalized.baseUrl,
        model: source.kind === "image" ? normalized.visionModel : normalized.textModel,
        source: toRustSource(source),
      };
      const response = await invoker.invoke<{ extraction?: unknown }>("ai_import_extract", { request });
      const extraction = parseAiExtraction(response?.extraction);
      return candidateFromExtraction(extraction, {
        // 候选 id 只是本次抽取的临时标识；正式元件 id 由用户在确认时决定。
        id: `ai-candidate-${source.kind}`,
        evidence: describeSource(source),
      });
    },
  };
}

/**
 * 构造真实的 Tauri 调用器。不在 Tauri 环境（如浏览器、E2E）或原生模块不可用时返回 null，
 * 上层据此明确呈现"AI 不可用"，绝不伪造可用状态。
 */
export async function createTauriInvoker(): Promise<AiImportInvoker | null> {
  try {
    const core = await import("@tauri-apps/api/core");
    if (!core.isTauri()) return null;
    return { invoke: <T>(command: string, args?: Record<string, unknown>) => core.invoke<T>(command, args) };
  } catch {
    return null;
  }
}

/** 查询是否已配置 API Key。任何异常都按"未配置"处理，绝不假装可用。 */
export async function isAiApiKeyConfigured(invoker: AiImportInvoker): Promise<boolean> {
  try {
    const status = await invoker.invoke<{ configured?: unknown }>("ai_api_key_status");
    return status?.configured === true;
  } catch {
    return false;
  }
}

/**
 * 构造当前环境实际可用的供应商列表。
 * 未配置密钥或不在 Tauri 环境时返回空列表，上层据此明确呈现"AI 不可用"，手工流程不受影响。
 */
export async function createConfiguredAiProviders(
  invoker: AiImportInvoker,
  settings: AiImportSettings,
): Promise<ComponentImportProvider[]> {
  return (await isAiApiKeyConfigured(invoker)) ? [createAiImportProvider(invoker, settings)] : [];
}

/** 写入 API Key。密钥随后只存在于 Windows 凭据管理器，本层不保存、不回显。 */
export async function setAiApiKey(invoker: AiImportInvoker, apiKey: string): Promise<void> {
  if (!isFilledString(apiKey)) throw new Error("API Key 不能为空");
  await invoker.invoke("ai_set_api_key", { apiKey });
}

export async function clearAiApiKey(invoker: AiImportInvoker): Promise<void> {
  await invoker.invoke("ai_clear_api_key");
}