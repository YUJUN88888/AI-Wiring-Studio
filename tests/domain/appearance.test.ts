import { describe, expect, it } from "vitest";
import {
  APPEARANCE_CSS_VARIABLES,
  APPEARANCE_STORAGE_KEY,
  appearanceCssVariables,
  createLocalStorageAppearanceStorage,
  createMemoryAppearanceStorage,
  defaultAppearance,
  deserializeAppearance,
  isHexColor,
  loadAppearance,
  readableTextColor,
  saveAppearance,
  serializeAppearance,
  validateAppearance,
} from "../../src/domain";

describe("appearance", () => {
  it("默认外观用的就是当前深色配色，且能原样存取", () => {
    const appearance = defaultAppearance();
    expect(appearance).toMatchObject({ uiColor: "#56d7fd", canvasColor: "#08090a", background: "grid", wireColor: "#57d4ff", componentColor: "#1a2739" });
    expect(deserializeAppearance(serializeAppearance(appearance))).toEqual(appearance);
  });

  it("只接受 #rrggbb 颜色与三种背景", () => {
    expect(isHexColor("#A1b2C3")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#abc")).toBe(false);
    expect(() => validateAppearance({ ...defaultAppearance(), uiColor: "#abc" })).toThrow("全局 UI 颜色必须是 #rrggbb 形式");
    expect(() => validateAppearance({ ...defaultAppearance(), canvasColor: "rgb(0,0,0)" })).toThrow("画布颜色必须是 #rrggbb 形式");
    // 背景只认三种，写别的（哪怕看起来合理）也直接拒绝，不猜用户想表达什么。
    expect(() => validateAppearance({ ...defaultAppearance(), background: "checker" })).toThrow("画布背景只能是 grid / dots / solid");
    expect(() => deserializeAppearance('{"appearanceSchemaVersion":2}')).toThrow("不支持的外观设置版本");
    expect(() => deserializeAppearance("not json")).toThrow("外观设置不是合法的 JSON");
  });

  it("损坏的存档退回默认配色并显式报告，而不是静默清空", () => {
    const corrupt = createMemoryAppearanceStorage('{"appearanceSchemaVersion":1,"uiColor":"nope"}');
    const result = loadAppearance(corrupt);
    expect(result.kind).toBe("corrupt");
    if (result.kind === "corrupt") expect(result.message).toContain("必须是 #rrggbb 形式");
    expect(loadAppearance(createMemoryAppearanceStorage(null)).kind).toBe("empty");
    const ok = createMemoryAppearanceStorage();
    saveAppearance(ok, defaultAppearance());
    expect(loadAppearance(ok)).toEqual({ kind: "ok", appearance: defaultAppearance() });
  });

  it("外观独立于项目文件保存，键名与元件库不同", () => {
    expect(APPEARANCE_STORAGE_KEY).toBe("aiws.appearance");
    expect(createLocalStorageAppearanceStorage()).toBeTruthy();
  });

  it("CSS 变量名固定，颜色都能映射出来，标题文字色按底色亮度派生", () => {
    expect(APPEARANCE_CSS_VARIABLES).toEqual({ uiColor: "--aiws-ui-color", canvasColor: "--aiws-canvas-color", wireColor: "--aiws-wire-color", componentColor: "--aiws-component-color", chromeColor: "--aiws-chrome-color" });
    const variables = appearanceCssVariables({ ...defaultAppearance(), uiColor: "#112233", chromeColor: "#121927" });
    expect(variables["--aiws-ui-color"]).toBe("#112233");
    // 深底 → 浅字；浅底 → 深字。标题文字色不是用户选的，永远由 chromeColor 决定。
    expect(variables["--aiws-chrome-color"]).toBe("#121927");
    expect(variables["--aiws-chrome-text"]).toBe("#e6edf7");
    expect(appearanceCssVariables({ ...defaultAppearance(), chromeColor: "#f2f5fa" })["--aiws-chrome-text"]).toBe("#10151f");
  });

  it("界面底色缺省放行（旧存档兼容），有值才校验格式", () => {
    const { chromeColor: _omit, ...legacy } = defaultAppearance();
    // 旧存档没有 chromeColor：仍能载入，并按默认底色补上。
    expect(deserializeAppearance(JSON.stringify(legacy)).chromeColor).toBe("#0b0d0e");
    expect(() => validateAppearance(legacy)).not.toThrow();
    expect(() => validateAppearance({ ...defaultAppearance(), chromeColor: "red" })).toThrow("界面底色必须是 #rrggbb 形式");
  });

  it("按亮度选可读文字色，非法颜色不武断但仍给出可读兜底", () => {
    expect(readableTextColor("#121927")).toBe("#e6edf7");
    expect(readableTextColor("#000000")).toBe("#e6edf7");
    expect(readableTextColor("#ffffff")).toBe("#10151f");
    expect(readableTextColor("#f2f5fa")).toBe("#10151f");
    expect(readableTextColor("not-a-color")).toBe("#e6edf7");
  });
});