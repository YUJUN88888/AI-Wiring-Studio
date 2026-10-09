import { WIRE_FILTER_ORDER, type WireFilter } from "./wireFocus";

/**
 * 界面外壳的显示设置持久化（左右侧栏 / 底边栏 / 线路筛选的收起态与筛选维度）。
 *
 * 与项目文件、外观设置一样**分开保存**：它是"这台机器的界面偏好"，换一个项目不该把它一起带走，
 * 所以单独放在一个本地存储键下。这里只做确定性校验与白名单重建，
 * 绝不接受非法维度、也绝不猜测字段含义——坏数据一律当"读出失败"，由界面用默认值兜底并提示。
 */
export const SHELL_LAYOUT_STORAGE_KEY = "aiws.shell";
export const CURRENT_SHELL_SCHEMA_VERSION = 1 as const;

export interface ShellLayout {
  shellSchemaVersion: typeof CURRENT_SHELL_SCHEMA_VERSION;
  /** 左侧【组件库】是否收起。 */
  leftCollapsed: boolean;
  /** 右侧【检查器】是否收起。 */
  rightCollapsed: boolean;
  /** 底部【检查摘要】是否收起。 */
  summaryCollapsed: boolean;
  /** 画布内的【线路筛选】条是否最小化成左下角按钮。 */
  wireFilterCollapsed: boolean;
  /** 线路筛选当前维度；重启后恢复用户上次选的维度。 */
  wireFilter: WireFilter;
}

/** 默认＝全部展开、筛选为「全部」：与"没设置过"看起来完全一样。 */
export function defaultShellLayout(): ShellLayout {
  return {
    shellSchemaVersion: CURRENT_SHELL_SCHEMA_VERSION,
    leftCollapsed: false,
    rightCollapsed: false,
    summaryCollapsed: false,
    wireFilterCollapsed: false,
    wireFilter: "all",
  };
}

/** 布尔字段与显示名，用于把"哪个字段不合法"说清楚。 */
const BOOLEAN_FIELDS: readonly (readonly [keyof ShellLayout, string])[] = [
  ["leftCollapsed", "左侧栏收起状态"],
  ["rightCollapsed", "右侧栏收起状态"],
  ["summaryCollapsed", "底边栏收起状态"],
  ["wireFilterCollapsed", "线路筛选收起状态"],
];

export function validateShellLayout(value: unknown): asserts value is ShellLayout {
  if (!value || typeof value !== "object") throw new Error("界面布局设置必须是一个对象");
  const layout = value as Partial<ShellLayout>;
  if (layout.shellSchemaVersion !== CURRENT_SHELL_SCHEMA_VERSION) throw new Error(`不支持的界面布局版本：${String(layout.shellSchemaVersion)}`);
  for (const [key, label] of BOOLEAN_FIELDS) {
    if (typeof layout[key] !== "boolean") throw new Error(`${label}必须是布尔值`);
  }
  if (!layout.wireFilter || !WIRE_FILTER_ORDER.includes(layout.wireFilter)) throw new Error("线路筛选维度无效");
}

export function serializeShellLayout(layout: ShellLayout): string {
  validateShellLayout(layout);
  return JSON.stringify(layout, null, 2);
}

/** 白名单重建：只保留已知字段，避免坏数据夹带其它内容进来。 */
export function deserializeShellLayout(json: string): ShellLayout {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("界面布局设置不是合法的 JSON"); }
  validateShellLayout(value);
  return {
    shellSchemaVersion: CURRENT_SHELL_SCHEMA_VERSION,
    leftCollapsed: value.leftCollapsed,
    rightCollapsed: value.rightCollapsed,
    summaryCollapsed: value.summaryCollapsed,
    wireFilterCollapsed: value.wireFilterCollapsed,
    wireFilter: value.wireFilter,
  };
}

/** 存储后端抽象，便于在测试中注入内存实现、在浏览器/Tauri 中使用本地存储。 */
export interface ShellLayoutStorage {
  load(): string | null;
  save(text: string): void;
}

export function createLocalStorageShellStorage(key = SHELL_LAYOUT_STORAGE_KEY): ShellLayoutStorage {
  return {
    load: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
    save: (text) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, text); },
  };
}

export function createMemoryShellStorage(initial: string | null = null): ShellLayoutStorage {
  let current = initial;
  return {
    load: () => current,
    save: (text) => { current = text; },
  };
}

/** 与外观/元件库一致：显式区分"还没设置过"与"设置损坏"，损坏时用默认值但要能提示用户。 */
export type ShellLayoutLoadResult =
  | { kind: "ok"; layout: ShellLayout }
  | { kind: "empty" }
  | { kind: "corrupt"; message: string };

export function loadShellLayout(storage: ShellLayoutStorage): ShellLayoutLoadResult {
  const raw = storage.load();
  if (raw === null || raw === "") return { kind: "empty" };
  try {
    return { kind: "ok", layout: deserializeShellLayout(raw) };
  } catch (error) {
    return { kind: "corrupt", message: error instanceof Error ? error.message : "界面布局设置读取失败" };
  }
}

export function saveShellLayout(storage: ShellLayoutStorage, layout: ShellLayout): void {
  storage.save(serializeShellLayout(layout));
}