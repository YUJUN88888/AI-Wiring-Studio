import { describe, expect, it } from "vitest";
import {
  createEmptyCandidate,
  createLayoutFromImage,
  definitionFromCandidate,
  deserializeLibrary,
  emptyLibrary,
  findDefinition,
  imagePixelToLocal,
  knownField,
  listCandidateFields,
  normalizeComponentCandidate,
  serializeLibrary,
  unknownField,
  upsertDefinition,
  validateComponentCandidate,
  type ComponentCandidate,
} from "../../src/domain";

const candidate = (overrides: Partial<ComponentCandidate> = {}): ComponentCandidate => ({
  id: "cand.1",
  displayName: knownField("TPS62160", "ai-suggestion", "estimated", "图片标题栏"),
  manufacturer: knownField("TI", "official-web", "confirmed", "https://www.ti.com/tps62160"),
  model: knownField("TPS62160", "ai-suggestion", "estimated"),
  category: knownField("regulator", "datasheet", "confirmed"),
  footprint: knownField({ width: 100, height: 60 }, "ai-suggestion", "estimated"),
  pins: [
    {
      tempId: "VIN",
      name: knownField("VIN", "ai-suggestion", "estimated"),
      role: knownField("POWER_INPUT", "ai-suggestion", "estimated"),
      maxVoltage: knownField(6, "datasheet", "confirmed", "第 1 页 绝对最大额定值"),
    },
    {
      tempId: "GND",
      name: knownField("GND", "ai-suggestion", "estimated"),
      role: knownField("GND", "ai-suggestion", "estimated"),
    },
  ],
  electricalProperties: { maxVoltage: knownField(6, "datasheet", "confirmed") },
  ...overrides,
});

/** 采纳候选中所有已知（非 unknown）字段的路径，模拟用户逐字段全部确认。 */
const acceptAllKnown = (value: ComponentCandidate): string[] =>
  listCandidateFields(value).filter((ref) => !ref.field.unknown).map((ref) => ref.path);

describe("component candidate", () => {
  it("未知字段不携带值；已知字段不允许标成 unknown 置信度", () => {
    const unknown = unknownField<string>("ai-suggestion", "识别失败");
    expect(unknown).toEqual({ unknown: true, confidence: "unknown", source: "ai-suggestion", evidence: "识别失败" });
    expect("value" in unknown).toBe(false);
    expect(() => knownField("x", "user", "unknown")).toThrow("已知的候选字段不能使用 unknown 置信度");
  });

  it("拒绝自相矛盾的候选字段：未知却带值 / 已知却无值 / 非法置信度与来源", () => {
    expect(() => validateComponentCandidate({ ...candidate(), displayName: { value: "x", unknown: true, confidence: "unknown", source: "user" } })).toThrow("不得携带值");
    expect(() => validateComponentCandidate({ ...candidate(), displayName: { unknown: false, confidence: "confirmed", source: "user" } })).toThrow("已确认候选字段缺少有效值");
    expect(() => validateComponentCandidate({ ...candidate(), displayName: { value: "x", unknown: false, confidence: "unknown", source: "user" } })).toThrow("置信度无效");
    expect(() => validateComponentCandidate({ ...candidate(), displayName: { value: "x", unknown: false, confidence: "confirmed", source: "guess" } })).toThrow("来源无效");
  });

  it("拒绝非法引脚临时 ID、重复引脚、非法位置与非法图片", () => {
    expect(() => validateComponentCandidate({ ...candidate(), pins: [{ ...candidate().pins[0], tempId: "bad id" }] })).toThrow("临时 ID");
    expect(() => validateComponentCandidate({ ...candidate(), pins: [candidate().pins[0], candidate().pins[0]] })).toThrow("临时 ID 重复");
    expect(() => validateComponentCandidate({ ...candidate(), pins: [{ ...candidate().pins[0], imagePixel: { x: Number.NaN, y: 0 } }] })).toThrow("候选引脚图片像素坐标无效");
    expect(() => validateComponentCandidate({ ...candidate(), pins: [{ ...candidate().pins[0], imagePixel: { x: -3, y: 0 } }] })).toThrow("候选引脚图片像素坐标无效");
    expect(() => validateComponentCandidate({ ...candidate(), image: { dataUrl: "data:text/html;base64,QQ==" } })).toThrow("元件图片数据必须是图片 data URL");
    expect(() => validateComponentCandidate({ ...candidate(), footprint: knownField({ width: 0, height: 60 }, "user", "confirmed") })).toThrow("尺寸已确认候选字段缺少有效值");
  });

  it("新建候选默认全部未知，可显式命名", () => {
    const empty = createEmptyCandidate("cand.empty");
    expect(empty.pins).toEqual([]);
    expect(empty.displayName.unknown).toBe(true);
    expect("value" in empty.displayName).toBe(false);
    expect(createEmptyCandidate("cand.named", "自定义元件").displayName).toEqual({ value: "自定义元件", unknown: false, confidence: "confirmed", source: "user" });
  });

  it("枚举全部候选字段，只包含候选实际提供的内容", () => {
    const paths = listCandidateFields(candidate()).map((ref) => ref.path);
    expect(paths).toContain("displayName");
    expect(paths).toContain("manufacturer");
    expect(paths).toContain("electricalProperties.maxVoltage");
    expect(paths).toContain("pins.VIN.maxVoltage");
    expect(paths).toContain("pins.GND.role");
    // GND 未提供电流/协议等字段，不应出现在列表中。
    expect(paths).not.toContain("pins.GND.maxVoltage");
    expect(paths).not.toContain("pins.GND.protocol");

    const { category: _omitted, ...withoutCategory } = candidate();
    expect(listCandidateFields(withoutCategory).map((ref) => ref.path)).not.toContain("category");
  });

  it("白名单重建丢弃候选与候选字段内部未声明的额外键，密钥不得流入后续流程", () => {
    const raw = {
      ...candidate(),
      apiKey: "LEAK-TOP",
      pins: candidate().pins.map((pin, index) => (index === 0
        ? { ...pin, apiKey: "LEAK-PIN", maxVoltage: { ...pin.maxVoltage, apiKey: "LEAK-FIELD" } }
        : pin)),
    };
    const normalized = normalizeComponentCandidate(raw);
    expect(JSON.stringify(normalized)).not.toContain("LEAK");
    expect(Object.keys(normalized).sort()).toEqual([
      "category", "displayName", "electricalProperties", "footprint", "id", "manufacturer", "model", "pins",
    ]);
    expect(Object.keys(normalized.pins[0]).sort()).toEqual([
      "maxVoltage", "name", "role", "tempId",
    ]);
    expect(Object.keys(normalized.pins[0].maxVoltage!).sort()).toEqual(["confidence", "evidence", "source", "unknown", "value"]);
  });

  it("用户逐字段确认后写入定义，来源与置信度照抄候选，不因确认而升级", () => {
    const value = candidate();
    const definition = definitionFromCandidate(value, {
      id: "user.tps62160",
      displayName: "TPS62160 降压稳压器",
      acceptedFields: acceptAllKnown(value),
      acceptedPinTempIds: ["VIN", "GND"],
    });
    expect(definition.manufacturer).toBe("TI");
    expect(definition.model).toBe("TPS62160");
    expect(definition.category).toBe("regulator");
    // 外部尺寸数值（100×60，单位不可知）一律不采用，改用确定性推导（2 个同侧引脚 → 180×80）。
    expect(definition.footprint).toEqual({ width: 180, height: 80 });
    expect(definition.provenance.footprint).toEqual({ confidence: "unknown", source: "user" });
    expect(definition.electricalProperties).toEqual({ maxVoltage: 6 });
    expect(definition.pins.map((pin) => pin.id)).toEqual(["VIN", "GND"]);
    expect(definition.pins[0].maxVoltage).toBe(6);
    // 名称由用户给出，记为已确认。
    expect(definition.provenance.displayName).toEqual({ confidence: "confirmed", source: "user" });
    expect(definition.userOverrides).toEqual(["displayName"]);
    // 来自数据手册的已确认字段保留来源与证据。
    expect(definition.provenance["pins.VIN.maxVoltage"]).toEqual({ confidence: "confirmed", source: "datasheet", evidence: "第 1 页 绝对最大额定值" });
    // 估算来源不会被悄悄升级成 confirmed。
    expect(definition.provenance.model).toEqual({ confidence: "estimated", source: "ai-suggestion" });
  });

  it("未经确认的字段一律不写入，缺省即未知", () => {
    const definition = definitionFromCandidate(candidate(), {
      id: "user.partial",
      displayName: "只确认了型号",
      acceptedFields: ["model"],
      acceptedPinTempIds: ["VIN"],
    });
    expect(definition.model).toBe("TPS62160");
    // 未确认的顶层字段不应出现。
    expect(definition.manufacturer).toBeUndefined();
    expect(definition.provenance.manufacturer).toBeUndefined();
    expect(definition.electricalProperties).toEqual({});
    expect(definition.category).toBe("other");
    expect(definition.footprint).toEqual({ width: 180, height: 80 });
    expect(Object.keys(definition.provenance)).toEqual(["displayName", "model", "category", "footprint"]);
    // 未确认的引脚字段退回未知，绝不臆造数值。
    expect(definition.pins).toHaveLength(1);
    expect(definition.pins[0].role).toBe("UNKNOWN");
    expect(definition.pins[0].name).toBe("");
    expect(definition.pins[0].maxVoltage).toBeUndefined();
    expect("maxVoltage" in definition.pins[0]).toBe(false);
  });

  it("未确认的引脚不写入；一个引脚都没有时拒绝生成定义", () => {
    expect(() => definitionFromCandidate(candidate(), {
      id: "user.nopin",
      displayName: "无引脚",
      acceptedFields: ["model"],
      acceptedPinTempIds: [],
    })).toThrow("元件至少需要一个引脚");
  });

  it("候选名称被采纳时用作元件名并保留其来源，不计入用户覆盖", () => {
    const definition = definitionFromCandidate(candidate(), {
      id: "user.byname",
      acceptedFields: ["displayName"],
      acceptedPinTempIds: ["VIN"],
    });
    expect(definition.displayName).toBe("TPS62160");
    expect(definition.provenance.displayName).toEqual({ confidence: "estimated", source: "ai-suggestion", evidence: "图片标题栏" });
    expect(definition.userOverrides).toEqual([]);
  });

  it("没有任何可用名称时拒绝生成定义，不拿 id 冒充名称", () => {
    expect(() => definitionFromCandidate(candidate(), {
      id: "user.noname",
      acceptedFields: ["model"],
      acceptedPinTempIds: ["VIN"],
    })).toThrow("元件名称缺失");
  });

  it("用户上传的图片随确认写入并标记为用户提供", () => {
    const value = candidate({ image: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 640, naturalHeight: 480 } });
    const definition = definitionFromCandidate(value, {
      id: "user.pictured",
      displayName: "带图元件",
      acceptedFields: ["model"],
      acceptedPinTempIds: ["VIN"],
    });
    expect(definition.image).toEqual({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 640, naturalHeight: 480 });
    expect(definition.provenance.image).toEqual({ confidence: "confirmed", source: "user" });
  });

  it("图片像素坐标经 imagePixelToLocal 换算成本地坐标后才写入定义，并记录来源为估算 · AI 建议", () => {
    // 图片 200×100（比例 0.5）：按长宽比推导出的盒子是 180×90，等比缩放系数 0.9、无留白。
    const image = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 200, naturalHeight: 100 };
    const value = candidate({
      image,
      pins: [{ ...candidate().pins[0], imagePixel: { x: 30, y: 40 } }],
    });
    const definition = definitionFromCandidate(value, {
      id: "user.pixel",
      displayName: "图片像素元件",
      acceptedFields: ["pins.VIN.name", "pins.VIN.role"],
      acceptedPinTempIds: ["VIN"],
    });
    expect(definition.footprint).toEqual({ width: 180, height: 90 });
    // 换算结果必须与唯一的转换函数一致：本地坐标 = imagePixelToLocal(该盒子 + 图片, 像素坐标)。
    const layout = createLayoutFromImage(definition.footprint, image)!;
    expect(definition.pins[0].localPosition).toEqual(imagePixelToLocal(layout, { x: 30, y: 40 }));
    expect(definition.pins[0].localPosition).toEqual({ x: 27, y: 36 });
    // 来源照抄候选（AI 给出的像素坐标），绝不升级为"已确认 · 用户录入"。
    expect(definition.provenance["pins.VIN.x"]).toEqual({ confidence: "estimated", source: "ai-suggestion" });
    expect(definition.provenance["pins.VIN.y"]).toEqual({ confidence: "estimated", source: "ai-suggestion" });
  });

  it("有像素坐标但没有图片时退回确定性排布，绝不把像素坐标当成本地坐标写入", () => {
    const value = candidate({
      footprint: unknownField("ai-suggestion"),
      image: undefined,
      pins: [
        { tempId: "VIN", name: knownField("VIN", "ai-suggestion", "estimated"), role: knownField("POWER_INPUT", "ai-suggestion", "estimated"), imagePixel: { x: 300, y: 400 } },
        { tempId: "OUT", name: knownField("OUT", "ai-suggestion", "estimated"), role: knownField("OUTPUT", "ai-suggestion", "estimated"), imagePixel: { x: 310, y: 420 } },
      ],
    });
    const definition = definitionFromCandidate(value, {
      id: "user.no-image",
      displayName: "无图元件",
      acceptedFields: acceptAllKnown(value),
      acceptedPinTempIds: ["VIN", "OUT"],
    });
    // 输入侧贴左边、其余贴右边：说明走的是兜底排布，而不是把 300/400 这几个像素值原样写进去。
    const positionOf = (id: string) => definition.pins.find((pin) => pin.id === id)!.localPosition;
    expect(positionOf("VIN")).toEqual({ x: 0, y: definition.footprint.height / 2 });
    expect(positionOf("OUT")).toEqual({ x: definition.footprint.width, y: definition.footprint.height / 2 });
    expect(definition.provenance["pins.VIN.x"]).toBeUndefined();
  });

  it("外部给出的尺寸数值单位不可知，一律不写进定义（避免元件小到引脚挤成一团）", () => {
    const value = candidate({
      footprint: knownField({ width: 20.4, height: 15.6 }, "ai-suggestion", "estimated"),
      pins: ["A", "B", "C", "D"].map((tempId) => ({ tempId, name: knownField(tempId, "ai-suggestion", "estimated"), role: knownField("OUTPUT", "ai-suggestion", "estimated") })),
    });
    const definition = definitionFromCandidate(value, {
      id: "user.small",
      displayName: "小尺寸元件",
      acceptedFields: ["footprint", ...value.pins.map((pin) => `pins.${pin.tempId}.role`)],
      acceptedPinTempIds: ["A", "B", "C", "D"],
    });
    // 4 个引脚同侧 → 高度按每个引脚 28px 加高到 112；宽度固定 180，与 AI 的 20.4×15.6 无关。
    expect(definition.footprint).toEqual({ width: 180, height: 112 });
    expect(definition.provenance.footprint).toEqual({ confidence: "unknown", source: "user" });
  });

  it("图片识别得到的无坐标引脚按角色确定性地排到左右两侧，不再叠在同一角上", () => {
    const value = candidate({
      footprint: unknownField("ai-suggestion"),
      pins: [
        { tempId: "VIN", name: knownField("VIN", "ai-suggestion", "estimated"), role: knownField("POWER_INPUT", "ai-suggestion", "estimated") },
        { tempId: "GND", name: knownField("GND", "ai-suggestion", "estimated"), role: knownField("GND", "ai-suggestion", "estimated") },
        { tempId: "OUT", name: knownField("OUT", "ai-suggestion", "estimated"), role: knownField("OUTPUT", "ai-suggestion", "estimated") },
      ],
    });
    const definition = definitionFromCandidate(value, {
      id: "user.image-pins",
      displayName: "图片引脚元件",
      acceptedFields: acceptAllKnown(value),
      acceptedPinTempIds: ["VIN", "GND", "OUT"],
    });
    // 尺寸未知时按同侧引脚数推导兜底尺寸，引脚据此排布。
    expect(definition.footprint).toEqual({ width: 180, height: 80 });
    const positionOf = (id: string) => definition.pins.find((pin) => pin.id === id)!.localPosition;
    // 输入侧（POWER_INPUT / GND）贴左边，其余贴右边。
    expect(positionOf("VIN").x).toBe(0);
    expect(positionOf("GND").x).toBe(0);
    expect(positionOf("OUT").x).toBe(180);
    // 同侧纵向等距分散，三个引脚互不重叠。
    expect(positionOf("VIN").y).toBeCloseTo(80 / 3, 10);
    expect(positionOf("GND").y).toBeCloseTo(160 / 3, 10);
    expect(positionOf("OUT").y).toBeCloseTo(40, 10);
    expect(new Set(definition.pins.map((pin) => `${pin.localPosition.x},${pin.localPosition.y}`)).size).toBe(3);

    // 尺寸极小、同侧引脚较多时也不因取整而重叠：h=2 上排 3 个引脚仍各不相同。
    const tiny = definitionFromCandidate(candidate({
      footprint: knownField({ width: 20, height: 2 }, "ai-suggestion", "estimated"),
      pins: ["A", "B", "C"].map((tempId) => ({ tempId, name: knownField(tempId, "ai-suggestion", "estimated"), role: knownField("INPUT", "ai-suggestion", "estimated") })),
    }), {
      id: "user.tiny-pins",
      displayName: "小尺寸元件",
      acceptedFields: ["footprint", "pins.A.role", "pins.B.role", "pins.C.role"],
      acceptedPinTempIds: ["A", "B", "C"],
    });
    expect(new Set(tiny.pins.map((pin) => pin.localPosition.y)).size).toBe(3);
  });

  it("尺寸未知且同侧引脚较多时自动加高，保证引脚标签不挤在一起", () => {
    const ids = ["P1", "P2", "P3", "P4", "P5", "P6"];
    const value = candidate({
      footprint: unknownField("ai-suggestion"),
      pins: ids.map((tempId) => ({ tempId, name: knownField(tempId, "ai-suggestion", "estimated"), role: knownField("OUTPUT", "ai-suggestion", "estimated") })),
    });
    const definition = definitionFromCandidate(value, {
      id: "user.crowded",
      displayName: "引脚密集元件",
      acceptedFields: acceptAllKnown(value),
      acceptedPinTempIds: ids,
    });
    // 6 个引脚同在右侧 → 高度按每个引脚 28px 加高到 168，相邻引脚间距 24px。
    expect(definition.footprint).toEqual({ width: 180, height: 168 });
    const ys = definition.pins.map((pin) => pin.localPosition.y);
    expect(new Set(ys).size).toBe(6);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(20);
  });

  it("确认结果可写入用户库并完整还原，元件库版本保持不变（旧库兼容）", () => {
    const value = candidate();
    const definition = definitionFromCandidate(value, {
      id: "user.tps62160",
      displayName: "TPS62160 降压稳压器",
      acceptedFields: acceptAllKnown(value),
      acceptedPinTempIds: ["VIN", "GND"],
    });
    const library = upsertDefinition(emptyLibrary(), definition);
    const restored = deserializeLibrary(serializeLibrary(library));
    expect(restored.librarySchemaVersion).toBe(1);
    expect(findDefinition(restored, "user.tps62160")).toEqual(definition);
  });
});
