/**
 * 应用外观（菜单栏【设置】-【外观】）。它与项目文件、用户元件库都分开保存：
 * 换一个项目不该把自己的配色一起带走，所以放在独立的本地存储键下。
 * 这里只做确定性校验与白名单重建，绝不接受无法解析的颜色值，也绝不猜测字段含义。
 */
export const APPEARANCE_STORAGE_KEY = "aiws.appearance";
export const CURRENT_APPEARANCE_SCHEMA_VERSION = 1 as const;

/** 画布背景三种：工程网格（横竖线）/ 点状 / 纯色。 */
export type CanvasBackground = "grid" | "dots" | "solid";

export interface Appearance {
  appearanceSchemaVersion: typeof CURRENT_APPEARANCE_SCHEMA_VERSION;
  /** 全局 UI 强调色：选中轮廓、激活态边框等。 */
  uiColor: string;
  /** 画布底色。 */
  canvasColor: string;
  /** 画布背景花纹。 */
  background: CanvasBackground;
  /** 新建连线的默认颜色；已有连线各自的 `Wire.color` 不受影响。 */
  wireColor: string;
  /** 元件盒子的默认底色；有图元件仍以图片为准。 */
  componentColor: string;
  /**
   * 窗口外壳底色：自定义标题栏与顶部菜单栏共用它。
   * 选深色就得到与旧版一致的深色顶栏，选浅色则标题文字自动转成深色（见 readableTextColor）。
   */
  chromeColor: string;
}

/** 旧存档没有 chromeColor 时补上的默认值，与 tokens.css 的 L3（标题栏/工具栏）一致。 */
export const DEFAULT_CHROME_COLOR = "#0b0d0e";

/**
 * 默认外观＝Ardentis 深黑底 + 青色强调（DESIGN.md 第 8 节）。
 * 这只是"用户从未自定义过"时的兜底观感：一旦 `aiws.appearance` 里存了值，就以用户值为准，
 * 本函数不会覆盖已保存的设置。线路/元件语义色（wireColor/componentColor）保持不变。
 */
export function defaultAppearance(): Appearance {
  return {
    appearanceSchemaVersion: CURRENT_APPEARANCE_SCHEMA_VERSION,
    uiColor: "#56d7fd",
    canvasColor: "#08090a",
    background: "grid",
    wireColor: "#57d4ff",
    componentColor: "#1a2739",
    chromeColor: DEFAULT_CHROME_COLOR,
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const BACKGROUNDS: readonly CanvasBackground[] = ["grid", "dots", "solid"];

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** 颜色字段与显示名，用于把"哪个字段不合法"说清楚。 */
const COLOR_FIELDS: readonly (readonly [keyof Appearance, string])[] = [
  ["uiColor", "全局 UI 颜色"],
  ["canvasColor", "画布颜色"],
  ["wireColor", "默认连线颜色"],
  ["componentColor", "默认元件颜色"],
];

export function validateAppearance(value: unknown): asserts value is Appearance {
  if (!value || typeof value !== "object") throw new Error("外观设置必须是一个对象");
  const appearance = value as Partial<Appearance>;
  if (appearance.appearanceSchemaVersion !== CURRENT_APPEARANCE_SCHEMA_VERSION) throw new Error(`不支持的外观设置版本：${String(appearance.appearanceSchemaVersion)}`);
  for (const [key, label] of COLOR_FIELDS) {
    if (!isHexColor(appearance[key])) throw new Error(`${label}必须是 #rrggbb 形式`);
  }
  // 窗口外壳底色是后加的字段：旧存档没有它必须仍能打开，所以缺省放行，只在给了值时校验格式。
  if (appearance.chromeColor !== undefined && !isHexColor(appearance.chromeColor)) throw new Error("界面底色必须是 #rrggbb 形式");
  if (!appearance.background || !BACKGROUNDS.includes(appearance.background)) throw new Error("画布背景只能是 grid / dots / solid");
}

/**
 * 依据底色亮度选一个读得清的文字颜色：深底给浅字、浅底给深字。
 * 只看相对亮度，同一底色永远得到同一结果（确定性），颜色非法时退回浅色。
 */
export function readableTextColor(hex: string): string {
  const full = String(hex).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#e6edf7";
  const channel = (index: number) => parseInt(full.slice(index, index + 2), 16) / 255;
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * linear(channel(0)) + 0.7152 * linear(channel(2)) + 0.0722 * linear(channel(4));
  return luminance > 0.5 ? "#10151f" : "#e6edf7";
}

export function serializeAppearance(appearance: Appearance): string {
  validateAppearance(appearance);
  return JSON.stringify(appearance, null, 2);
}

/** 白名单重建：只保留已知字段，避免坏数据夹带其它内容进来。 */
export function deserializeAppearance(json: string): Appearance {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("外观设置不是合法的 JSON"); }
  validateAppearance(value);
  return {
    appearanceSchemaVersion: CURRENT_APPEARANCE_SCHEMA_VERSION,
    uiColor: value.uiColor,
    canvasColor: value.canvasColor,
    background: value.background,
    wireColor: value.wireColor,
    componentColor: value.componentColor,
    // 旧存档没有该字段：白名单重建时补默认值，绝不因为一个新增字段被判成"损坏"。
    chromeColor: value.chromeColor ?? DEFAULT_CHROME_COLOR,
  };
}

/** 存储后端抽象，便于在测试中注入内存实现、在浏览器/Tauri 中使用本地存储。 */
export interface AppearanceStorage {
  load(): string | null;
  save(text: string): void;
}

export function createLocalStorageAppearanceStorage(key = APPEARANCE_STORAGE_KEY): AppearanceStorage {
  return {
    load: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
    save: (text) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, text); },
  };
}

export function createMemoryAppearanceStorage(initial: string | null = null): AppearanceStorage {
  let current = initial;
  return {
    load: () => current,
    save: (text) => { current = text; },
  };
}

/** 与元件库一致：显式区分"还没设置过"与"设置损坏"，损坏时用默认值但要能提示用户。 */
export type AppearanceLoadResult =
  | { kind: "ok"; appearance: Appearance }
  | { kind: "empty" }
  | { kind: "corrupt"; message: string };

export function loadAppearance(storage: AppearanceStorage): AppearanceLoadResult {
  const raw = storage.load();
  if (raw === null || raw === "") return { kind: "empty" };
  try {
    return { kind: "ok", appearance: deserializeAppearance(raw) };
  } catch (error) {
    return { kind: "corrupt", message: error instanceof Error ? error.message : "外观设置读取失败" };
  }
}

export function saveAppearance(storage: AppearanceStorage, appearance: Appearance): void {
  storage.save(serializeAppearance(appearance));
}

/** 外观 → CSS 变量名。颜色以外的选择（如背景三态）由界面按值渲染，不能塞进变量。 */
export const APPEARANCE_CSS_VARIABLES = {
  uiColor: "--aiws-ui-color",
  canvasColor: "--aiws-canvas-color",
  wireColor: "--aiws-wire-color",
  componentColor: "--aiws-component-color",
  chromeColor: "--aiws-chrome-color",
} as const;

/** 标题栏/顶栏文字颜色：不是用户选的颜色，而是按 chromeColor 亮度派生出来的可读色。 */
export const CHROME_TEXT_VARIABLE = "--aiws-chrome-text";

export function appearanceCssVariables(appearance: Appearance): Record<string, string> {
  return {
    [APPEARANCE_CSS_VARIABLES.uiColor]: appearance.uiColor,
    [APPEARANCE_CSS_VARIABLES.canvasColor]: appearance.canvasColor,
    [APPEARANCE_CSS_VARIABLES.wireColor]: appearance.wireColor,
    [APPEARANCE_CSS_VARIABLES.componentColor]: appearance.componentColor,
    [APPEARANCE_CSS_VARIABLES.chromeColor]: appearance.chromeColor,
    [CHROME_TEXT_VARIABLE]: readableTextColor(appearance.chromeColor),
  };
}