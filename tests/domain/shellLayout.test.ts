import { describe, expect, it } from "vitest";
import {
  createLocalStorageShellStorage,
  createMemoryShellStorage,
  defaultShellLayout,
  deserializeShellLayout,
  loadShellLayout,
  saveShellLayout,
  serializeShellLayout,
  SHELL_LAYOUT_STORAGE_KEY,
  validateShellLayout,
} from "../../src/domain";

describe("界面外壳显示设置持久化", () => {
  it("默认全部展开、筛选为「全部」，且能原样存取", () => {
    const layout = defaultShellLayout();
    expect(layout).toMatchObject({ leftCollapsed: false, rightCollapsed: false, summaryCollapsed: false, wireFilterCollapsed: false, wireFilter: "all" });
    expect(deserializeShellLayout(serializeShellLayout(layout))).toEqual(layout);
  });

  it("布尔字段与筛选维度都必须合法，坏数据直接拒绝", () => {
    expect(() => validateShellLayout({ ...defaultShellLayout(), leftCollapsed: "yes" })).toThrow("左侧栏收起状态必须是布尔值");
    expect(() => validateShellLayout({ ...defaultShellLayout(), wireFilter: "motor" })).toThrow("线路筛选维度无效");
    expect(() => deserializeShellLayout('{"shellSchemaVersion":2}')).toThrow("不支持的界面布局版本");
    expect(() => deserializeShellLayout("not json")).toThrow("界面布局设置不是合法的 JSON");
  });

  it("白名单重建只保留已知字段，坏数据夹带的内容不会混进来", () => {
    const rebuilt = deserializeShellLayout(JSON.stringify({ ...defaultShellLayout(), evil: "x" }));
    expect("evil" in rebuilt).toBe(false);
    expect(rebuilt).toEqual(defaultShellLayout());
  });

  it("损坏的存档退回默认布局并显式报告，而不是静默清空", () => {
    const corrupt = createMemoryShellStorage('{"shellSchemaVersion":1,"rightCollapsed":1}');
    const result = loadShellLayout(corrupt);
    expect(result.kind).toBe("corrupt");
    if (result.kind === "corrupt") expect(result.message).toContain("必须是布尔值");
    expect(loadShellLayout(createMemoryShellStorage(null)).kind).toBe("empty");
    const ok = createMemoryShellStorage();
    const saved = { ...defaultShellLayout(), rightCollapsed: true, wireFilter: "unclassified" as const };
    saveShellLayout(ok, saved);
    expect(loadShellLayout(ok)).toEqual({ kind: "ok", layout: saved });
  });

  it("界面偏好独立于项目与外观保存，键名互不相同", () => {
    expect(SHELL_LAYOUT_STORAGE_KEY).toBe("aiws.shell");
    expect(createLocalStorageShellStorage()).toBeTruthy();
  });
});