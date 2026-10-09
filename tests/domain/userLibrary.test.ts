import { describe, expect, it } from "vitest";
import {
  CURRENT_LIBRARY_SCHEMA_VERSION,
  createMemoryLibraryStorage,
  deserializeLibrary,
  emptyLibrary,
  findDefinition,
  loadLibrary,
  listDefinitions,
  removeDefinition,
  saveLibrary,
  serializeLibrary,
  upsertDefinition,
  type ComponentDefinition,
} from "../../src/domain";

const definition = (id: string, displayName = id): ComponentDefinition => ({
  id,
  displayName,
  category: "passive",
  footprint: { width: 80, height: 40 },
  pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 } }],
  electricalProperties: {},
  metadata: {},
  provenance: { displayName: { confidence: "confirmed", source: "user" } },
  userOverrides: [],
});

describe("user library", () => {
  it("新增、查找、列出与删除元件定义", () => {
    let library = emptyLibrary();
    library = upsertDefinition(library, definition("user.a", "元件甲"));
    library = upsertDefinition(library, definition("user.b", "元件乙"));
    expect(listDefinitions(library).map((item) => item.id)).toEqual(["user.a", "user.b"]);
    expect(findDefinition(library, "user.b")?.displayName).toBe("元件乙");

    library = removeDefinition(library, "user.a");
    expect(findDefinition(library, "user.a")).toBeUndefined();
    expect(removeDefinition(library, "missing")).toBe(library);
  });

  it("按 id 覆盖已有定义而不是重复追加", () => {
    let library = upsertDefinition(emptyLibrary(), definition("user.a", "旧名"));
    library = upsertDefinition(library, definition("user.a", "新名"));
    expect(library.definitions).toHaveLength(1);
    expect(findDefinition(library, "user.a")?.displayName).toBe("新名");
  });

  it("拒绝把无效定义写入库中", () => {
    expect(() => upsertDefinition(emptyLibrary(), { ...definition("user.bad"), pins: [] })).toThrow("元件至少需要一个引脚");
  });

  it("写入库的定义与外部对象解耦，后续修改不会污染库内容", () => {
    const external = definition("user.a", "元件甲");
    const library = upsertDefinition(emptyLibrary(), external);
    external.displayName = "被改坏";
    external.pins[0].name = "被改坏";
    expect(findDefinition(library, "user.a")?.displayName).toBe("元件甲");
    expect(findDefinition(library, "user.a")?.pins[0].name).toBe("A");
  });

  it("序列化后可以完整还原", () => {
    let library = upsertDefinition(emptyLibrary(), definition("user.a", "元件甲"));
    library = upsertDefinition(library, definition("user.b", "元件乙"));
    expect(deserializeLibrary(serializeLibrary(library))).toEqual(library);
    expect(deserializeLibrary(serializeLibrary(library)).librarySchemaVersion).toBe(CURRENT_LIBRARY_SCHEMA_VERSION);
  });

  it("拒绝非法 JSON、未知版本、缺失字段、重复 id 与非法定义", () => {
    expect(() => deserializeLibrary("not json")).toThrow("元件库不是合法的 JSON");
    expect(() => deserializeLibrary('{"librarySchemaVersion":99,"definitions":[]}')).toThrow("不支持的元件库版本");
    expect(() => deserializeLibrary('{"librarySchemaVersion":1}')).toThrow("元件库缺少必要字段");
    const duplicated = JSON.stringify({ librarySchemaVersion: 1, definitions: [definition("user.a"), definition("user.a")] });
    expect(() => deserializeLibrary(duplicated)).toThrow("元件定义 ID 重复");
    const invalid = JSON.stringify({ librarySchemaVersion: 1, definitions: [{ ...definition("user.a"), category: "banana" }] });
    expect(() => deserializeLibrary(invalid)).toThrow("元件分类无效");
  });

  it("读取时丢弃未声明的额外字段，包括定义内部被误塞入的凭据", () => {
    const raw = JSON.stringify({
      librarySchemaVersion: 1,
      definitions: [{ ...definition("user.a"), apiKey: "LEAK-DEFINITION", nested: { token: "LEAK-NESTED" } }],
      apiKey: "LEAK-TOP",
      nested: { token: "LEAK-TOP-NESTED" },
    });
    const library = deserializeLibrary(raw);
    expect(Object.keys(library)).toEqual(["librarySchemaVersion", "definitions"]);

    const stored = findDefinition(library, "user.a")!;
    expect(Object.keys(stored).sort()).toEqual([
      "category", "displayName", "electricalProperties", "footprint", "id",
      "metadata", "pins", "provenance", "userOverrides",
    ]);
    expect(Object.keys(stored.pins[0]).sort()).toEqual(["id", "localPosition", "name", "role"]);
    expect(JSON.stringify(library)).not.toContain("LEAK");
  });

  it("重新导出已加载的库时不会带出任何额外字段", () => {
    const raw = JSON.stringify({ librarySchemaVersion: 1, definitions: [{ ...definition("user.a"), apiKey: "LEAK" }] });
    expect(serializeLibrary(deserializeLibrary(raw))).not.toContain("LEAK");
  });

  it("写入库时同样按白名单裁剪，多余字段不会进入库中", () => {
    const library = upsertDefinition(emptyLibrary(), { ...definition("user.a"), apiKey: "LEAK" } as never);
    expect(JSON.stringify(library)).not.toContain("LEAK");
  });

  it("区分空库、正常与损坏三种加载结果，避免损坏时静默清空", () => {
    const empty = createMemoryLibraryStorage();
    expect(loadLibrary(empty)).toEqual({ kind: "empty" });

    const good = createMemoryLibraryStorage(serializeLibrary(upsertDefinition(emptyLibrary(), definition("user.a"))));
    const loaded = loadLibrary(good);
    expect(loaded.kind).toBe("ok");
    expect(loaded.kind === "ok" && loaded.library.definitions).toHaveLength(1);

    const corrupt = createMemoryLibraryStorage("{ broken");
    const result = loadLibrary(corrupt);
    expect(result.kind).toBe("corrupt");
    expect(result.kind === "corrupt" && result.message).toBe("元件库不是合法的 JSON");
  });

  it("保存后再次加载仍能检索到元件，且引脚坐标保持一致", () => {
    const storage = createMemoryLibraryStorage();
    const placed = { ...definition("user.a", "元件甲") };
    placed.pins = [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 12.5, y: -3.25 } }];
    saveLibrary(storage, upsertDefinition(emptyLibrary(), placed));

    const reloaded = loadLibrary(storage);
    expect(reloaded.kind).toBe("ok");
    expect(reloaded.kind === "ok" && findDefinition(reloaded.library, "user.a")?.pins[0].localPosition).toEqual({ x: 12.5, y: -3.25 });
  });

  it("引脚的电流上限、协议、备注与来源信息可跨序列化完整还原", () => {
    const detailed: ComponentDefinition = {
      id: "user.detailed",
      displayName: "带说明的元件",
      category: "mcu",
      footprint: { width: 120, height: 60 },
      pins: [
        { id: "SDA", name: "SDA", role: "GPIO", localPosition: { x: 0, y: 0 }, maxVoltage: 3.3, maxCurrent: 0.003, protocol: "I2C", note: "上拉 4.7k" },
        { id: "VCC", name: "VCC", role: "POWER_INPUT", localPosition: { x: 0, y: 20 }, maxVoltage: 5 },
      ],
      electricalProperties: { maxVoltage: 5 },
      metadata: { 备注: "开发板" },
      provenance: {
        displayName: { confidence: "confirmed", source: "user" },
        "pins.SDA.protocol": { confidence: "confirmed", source: "datasheet", evidence: "第 3 页时序表" },
        "pins.VCC.maxVoltage": { confidence: "estimated", source: "ai-suggestion" },
      },
      userOverrides: ["displayName", "pins.SDA.protocol"],
    };
    const library = upsertDefinition(emptyLibrary(), detailed);
    const restored = deserializeLibrary(serializeLibrary(library));
    const stored = findDefinition(restored, "user.detailed")!;
    expect(stored.pins[0]).toMatchObject({ maxCurrent: 0.003, protocol: "I2C", note: "上拉 4.7k" });
    expect(stored.provenance["pins.SDA.protocol"]).toEqual({ confidence: "confirmed", source: "datasheet", evidence: "第 3 页时序表" });
    // 估算来源不会被读取过程悄悄升级成已确认。
    expect(stored.provenance["pins.VCC.maxVoltage"]?.confidence).toBe("estimated");
    expect(stored.userOverrides).toEqual(["displayName", "pins.SDA.protocol"]);
  });

  it("迁移到未知版本的元件库时拒绝读取，不猜测字段含义", () => {
    expect(() => deserializeLibrary(JSON.stringify({ librarySchemaVersion: 2, definitions: [] }))).toThrow("不支持的元件库版本：2");
    expect(() => deserializeLibrary(JSON.stringify({ definitions: [] }))).toThrow("不支持的元件库版本：undefined");
  });

  it("图片数据、裁剪与旋转可跨序列化完整还原，引脚热点坐标保持一致", () => {
    const withImage: ComponentDefinition = {
      ...definition("user.pictured", "带图片的元件"),
      footprint: { width: 180, height: 120 },
      image: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 640, naturalHeight: 480, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, rotation: 270 },
      pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 42.5, y: 77.25 } }],
    };
    const restored = deserializeLibrary(serializeLibrary(upsertDefinition(emptyLibrary(), withImage)));
    const stored = findDefinition(restored, "user.pictured")!;
    expect(stored.image).toEqual(withImage.image);
    expect(stored.pins[0].localPosition).toEqual({ x: 42.5, y: 77.25 });
  });

  it("兼容早期只记录图片相对路径的元件库", () => {
    const legacy = JSON.stringify({
      librarySchemaVersion: 1,
      definitions: [{ ...definition("user.legacy"), image: { path: "images/legacy.png" } }],
    });
    const stored = findDefinition(deserializeLibrary(legacy), "user.legacy")!;
    expect(stored.image).toEqual({ path: "images/legacy.png" });
  });

  it("拒绝把非图片 data URL 或绝对路径图片写进库中", () => {
    expect(() => upsertDefinition(emptyLibrary(), { ...definition("user.bad"), image: { dataUrl: "data:text/html;base64,QQ==" } })).toThrow("元件图片数据必须是图片 data URL");
    expect(() => upsertDefinition(emptyLibrary(), { ...definition("user.bad"), image: { path: "/etc/passwd" } })).toThrow("元件图片必须使用相对路径");
  });
});