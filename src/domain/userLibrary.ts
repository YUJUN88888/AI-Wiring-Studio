import {
  CURRENT_LIBRARY_SCHEMA_VERSION,
  normalizeComponentDefinition,
  validateComponentDefinition,
  type ComponentDefinition,
} from "./componentDefinition";

/**
 * 用户元件库文档。它独立于 .aiws 项目文件保存，可在不同项目间共享。
 * 版本号与项目 schemaVersion 解耦，便于各自演进。
 * 该文档只保存元件定义，绝不保存任何密钥或凭据。
 */
export interface UserLibrary {
  librarySchemaVersion: typeof CURRENT_LIBRARY_SCHEMA_VERSION;
  definitions: ComponentDefinition[];
}

export function emptyLibrary(): UserLibrary {
  return { librarySchemaVersion: CURRENT_LIBRARY_SCHEMA_VERSION, definitions: [] };
}

export function findDefinition(library: UserLibrary, id: string): ComponentDefinition | undefined {
  return library.definitions.find((definition) => definition.id === id);
}

export function listDefinitions(library: UserLibrary): ComponentDefinition[] {
  return [...library.definitions];
}

/** 新增或替换一个元件定义。写入前先校验并按白名单重建，避免无效或多余字段进入库中。 */
export function upsertDefinition(library: UserLibrary, definition: ComponentDefinition): UserLibrary {
  const copy = normalizeComponentDefinition(definition);
  const index = library.definitions.findIndex((item) => item.id === copy.id);
  const definitions = index === -1
    ? [...library.definitions, copy]
    : library.definitions.map((item, i) => (i === index ? copy : item));
  return { ...library, definitions };
}

export function removeDefinition(library: UserLibrary, id: string): UserLibrary {
  if (!library.definitions.some((item) => item.id === id)) return library;
  return { ...library, definitions: library.definitions.filter((item) => item.id !== id) };
}

export function serializeLibrary(library: UserLibrary): string {
  for (const definition of library.definitions) validateComponentDefinition(definition);
  return JSON.stringify(library, null, 2);
}

/**
 * 版本迁移。当前只有 v1；遇到未知版本一律拒绝，绝不猜测字段含义。
 * 将来新增版本时在此处追加迁移分支。
 */
function migrateLibrary(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const version = raw.librarySchemaVersion;
  if (version === CURRENT_LIBRARY_SCHEMA_VERSION) return value;
  throw new Error(`不支持的元件库版本：${String(version)}`);
}

export function deserializeLibrary(json: string): UserLibrary {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("元件库不是合法的 JSON");
  }
  const migrated = migrateLibrary(value) as Partial<UserLibrary>;
  if (!migrated || typeof migrated !== "object" || !Array.isArray(migrated.definitions)) throw new Error("元件库缺少必要字段");
  const seen = new Set<string>();
  const definitions: ComponentDefinition[] = [];
  for (const raw of migrated.definitions) {
    validateComponentDefinition(raw);
    if (seen.has(raw.id)) throw new Error(`元件定义 ID 重复：${raw.id}`);
    seen.add(raw.id);
    // 闭集重建：定义内部任何未声明的字段（例如被误塞进来的密钥）都会被丢弃。
    definitions.push(normalizeComponentDefinition(raw));
  }
  return { librarySchemaVersion: CURRENT_LIBRARY_SCHEMA_VERSION, definitions };
}

/** 存储后端抽象，便于在测试中注入内存实现、在浏览器/Tauri 中使用本地存储。 */
export interface LibraryStorage {
  load(): string | null;
  save(text: string): void;
}

export const USER_LIBRARY_STORAGE_KEY = "aiws.user-library";

export function createLocalStorageLibraryStorage(key = USER_LIBRARY_STORAGE_KEY): LibraryStorage {
  return {
    load: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
    save: (text) => { if (typeof localStorage !== "undefined") localStorage.setItem(key, text); },
  };
}

/** 内存实现，供单元测试与无存储环境使用。 */
export function createMemoryLibraryStorage(initial: string | null = null): LibraryStorage {
  let current = initial;
  return {
    load: () => current,
    save: (text) => { current = text; },
  };
}

/**
 * 加载结果显式区分"空库"与"损坏"，以免在数据损坏时静默清空用户元件。
 */
export type LibraryLoadResult =
  | { kind: "ok"; library: UserLibrary }
  | { kind: "empty" }
  | { kind: "corrupt"; message: string };

export function loadLibrary(storage: LibraryStorage): LibraryLoadResult {
  const raw = storage.load();
  if (raw === null || raw === "") return { kind: "empty" };
  try {
    return { kind: "ok", library: deserializeLibrary(raw) };
  } catch (error) {
    return { kind: "corrupt", message: error instanceof Error ? error.message : "元件库读取失败" };
  }
}

export function saveLibrary(storage: LibraryStorage, library: UserLibrary): void {
  storage.save(serializeLibrary(library));
}