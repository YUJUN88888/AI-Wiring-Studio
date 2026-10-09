import { describe, expect, it } from "vitest";
import {
  createBuiltInComponent,
  createEmptyDefinition,
  createPinDefinition,
  definitionFromInstance,
  instantiateFromDefinition,
  normalizeComponentDefinition,
  removeFieldProvenance,
  validateComponentDefinition,
  type ComponentDefinition,
} from "../../src/domain";

const definition = (overrides: Partial<ComponentDefinition> = {}): ComponentDefinition => ({
  id: "user.part-1",
  displayName: "自定义稳压器",
  manufacturer: "某厂",
  model: "XYZ-3V3",
  category: "regulator",
  footprint: { width: 100, height: 60 },
  pins: [
    { id: "VIN", name: "VIN", role: "POWER_INPUT", localPosition: { x: 0, y: 0 }, maxVoltage: 6 },
    { id: "3V3", name: "3V3", role: "POWER_OUTPUT", localPosition: { x: 50, y: 0 }, outputVoltage: 3.3 },
  ],
  electricalProperties: { maxVoltage: 6, outputVoltage: 3.3 },
  metadata: { 备注: "手工录入" },
  provenance: {
    displayName: { confidence: "confirmed", source: "user" },
    model: { confidence: "confirmed", source: "datasheet", evidence: "https://example.com/ds.pdf 第 1 页" },
    "electricalProperties.maxVoltage": { confidence: "estimated", source: "ai-suggestion" },
  },
  userOverrides: ["displayName"],
  ...overrides,
});

describe("component definition", () => {
  it("接受一个完整且带来源信息的元件定义", () => {
    expect(() => validateComponentDefinition(definition())).not.toThrow();
  });

  it("空定义起点不预设任何已确认的数值，且因缺少引脚而不可保存", () => {
    const empty = createEmptyDefinition("user.new", "新元件");
    expect(empty.pins).toEqual([]);
    expect(empty.electricalProperties).toEqual({});
    expect(empty.provenance.displayName).toEqual({ confidence: "confirmed", source: "user" });
    expect(empty.provenance.category).toEqual({ confidence: "unknown", source: "user" });
    expect(empty.provenance.footprint).toEqual({ confidence: "unknown", source: "user" });
    expect(() => validateComponentDefinition(empty)).toThrow("元件至少需要一个引脚");
  });

  it("图片必须使用相对路径，保证元件库可以整体搬移", () => {
    expect(() => validateComponentDefinition(definition({ image: { path: "images/led.png" } }))).not.toThrow();
    for (const path of ["C:\\pics\\led.png", "\\\\server\\share\\led.png", "/absolute/led.png", "https://example.com/led.png"]) {
      expect(() => validateComponentDefinition(definition({ image: { path } }))).toThrow("元件图片必须使用相对路径");
    }
  });

  it("图片可以改用自包含 data URL，此时不再要求相对路径", () => {
    const image = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 640, naturalHeight: 480, rotation: 90 as const, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.4 } };
    expect(() => validateComponentDefinition(definition({ image }))).not.toThrow();
    const normalized = normalizeComponentDefinition(definition({ image }));
    expect(normalized.image).toEqual(image);
  });

  it("拒绝既无图片数据又无路径、以及非图片 data URL 的图片", () => {
    expect(() => validateComponentDefinition(definition({ image: {} }))).toThrow("元件图片必须包含图片数据或相对路径");
    expect(() => validateComponentDefinition(definition({ image: { dataUrl: "data:text/plain;base64,QQ==" } }))).toThrow("元件图片数据必须是图片 data URL");
    expect(() => validateComponentDefinition(definition({ image: { path: "https://example.com/a.png" } }))).toThrow("元件图片必须使用相对路径");
  });

  it("拒绝非法裁剪区域、非法旋转角度与非法原图尺寸", () => {
    const base = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", naturalWidth: 100, naturalHeight: 100 };
    expect(() => validateComponentDefinition(definition({ image: { ...base, crop: { x: 0.8, y: 0, width: 0.5, height: 1 } } }))).toThrow("元件图片裁剪区域无效");
    expect(() => validateComponentDefinition(definition({ image: { ...base, crop: { x: 0, y: 0, width: 0, height: 1 } } }))).toThrow("元件图片裁剪区域无效");
    expect(() => validateComponentDefinition(definition({ image: { ...base, rotation: 45 as never } }))).toThrow("元件图片旋转角度无效");
    expect(() => validateComponentDefinition(definition({ image: { ...base, naturalWidth: 0 } }))).toThrow("元件图片尺寸无效");
    expect(() => validateComponentDefinition(definition({ image: { ...base, naturalHeight: Number.NaN } }))).toThrow("元件图片尺寸无效");
  });

  it("闭集重建会丢弃图片内部未声明的额外字段", () => {
    const raw = { ...definition(), image: { dataUrl: "data:image/png;base64,AA==", naturalWidth: 10, naturalHeight: 10, rotation: 180 as const, apiKey: "LEAK-IMAGE" } };
    const normalized = normalizeComponentDefinition(raw);
    expect(JSON.stringify(normalized)).not.toContain("LEAK-IMAGE");
    expect(Object.keys(normalized.image!).sort()).toEqual(["dataUrl", "naturalHeight", "naturalWidth", "rotation"]);
  });

  it("闭集重建会丢弃定义内部与引脚内部未声明的额外字段", () => {
    const raw = {
      ...definition(),
      apiKey: "LEAK",
      pins: [{ ...definition().pins[0], injected: "LEAK" }],
    };
    const normalized = normalizeComponentDefinition(raw);
    expect(JSON.stringify(normalized)).not.toContain("LEAK");
    expect(Object.keys(normalized).sort()).toEqual([
      "category", "displayName", "electricalProperties", "footprint", "id", "manufacturer",
      "metadata", "model", "pins", "provenance", "userOverrides",
    ]);
    expect(Object.keys(normalized.pins[0]).sort()).toEqual(["id", "localPosition", "maxVoltage", "name", "role"]);
  });

  it("拒绝缺少 id、非法分类、非法尺寸与空引脚列表", () => {
    expect(() => validateComponentDefinition({ ...definition(), id: "" })).toThrow("缺少 id");
    expect(() => validateComponentDefinition({ ...definition(), category: "banana" })).toThrow("元件分类无效");
    expect(() => validateComponentDefinition({ ...definition(), footprint: { width: 0, height: 60 } })).toThrow("元件尺寸无效");
    expect(() => validateComponentDefinition({ ...definition(), pins: [] })).toThrow("元件至少需要一个引脚");
  });

  it("拒绝重复引脚 ID、非法来源置信度和指向不存在引脚的电压变换", () => {
    const duplicate = definition({ pins: [definition().pins[0], definition().pins[0]] });
    expect(() => validateComponentDefinition(duplicate)).toThrow("引脚 ID 重复");

    const badProvenance = definition({ provenance: { model: { confidence: "sure", source: "user" } as never } });
    expect(() => validateComponentDefinition(badProvenance)).toThrow("元件来源信息无效");

    const badTransform = definition({
      voltageTransforms: [{ inputPinId: "VIN", outputPinId: "GONE", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }],
    });
    expect(() => validateComponentDefinition(badTransform)).toThrow("电压变换无效");
  });

  it("拒绝非文本元数据，避免把任意对象塞进元件库", () => {
    expect(() => validateComponentDefinition(definition({ metadata: { nested: { a: 1 } as never } }))).toThrow("元件元数据必须是文本");
  });

  it("实例化时深拷贝引脚与电压变换，且实例不依赖用户库", () => {
    const source = definition({
      voltageTransforms: [{ inputPinId: "VIN", outputPinId: "3V3", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }],
    });
    const instance = instantiateFromDefinition(source, "placed-1", { x: 10, y: 20 }, 90);
    expect(instance.definitionId).toBe("user.part-1");
    expect(instance.position).toEqual({ x: 10, y: 20 });
    expect(instance.rotation).toBe(90);
    expect(instance.pins.map((pin) => pin.id)).toEqual(["VIN", "3V3"]);
    expect(instance.pins[0].maxVoltage).toBe(6);

    instance.pins[0].localPosition.x = 999;
    expect(source.pins[0].localPosition.x).toBe(0);
    instance.voltageTransforms![0].inputVoltageRange.min = 1;
    expect(source.voltageTransforms![0].inputVoltageRange.min).toBe(4.75);
  });

  it("未确认电压变换的元件实例化后不带电压变换字段", () => {
    const instance = instantiateFromDefinition(definition(), "placed-2", { x: 0, y: 0 });
    expect("voltageTransforms" in instance).toBe(false);
    expect(instance.rotation).toBe(0);
  });

  it("新建引脚默认全部未知：类型未定、名称为空、不含任何电气数值", () => {
    const pin = createPinDefinition("PIN1");
    expect(pin).toEqual({ id: "PIN1", name: "", role: "UNKNOWN", localPosition: { x: 0, y: 0 } });
    expect("maxVoltage" in pin).toBe(false);
    expect("maxCurrent" in pin).toBe(false);
  });

  it("接受并保留引脚的电流上限、协议与备注，缺省即未知", () => {
    const withExtras = definition({
      pins: [
        { id: "VIN", name: "VIN", role: "POWER_INPUT", localPosition: { x: 0, y: 0 }, maxVoltage: 6, maxCurrent: 0.5, protocol: "I2C", note: "接 5V" },
        { id: "3V3", name: "3V3", role: "POWER_OUTPUT", localPosition: { x: 50, y: 0 }, outputVoltage: 3.3 },
      ],
    });
    expect(() => validateComponentDefinition(withExtras)).not.toThrow();
    const normalized = normalizeComponentDefinition(withExtras);
    expect(normalized.pins[0].maxCurrent).toBe(0.5);
    expect(normalized.pins[0].protocol).toBe("I2C");
    expect(normalized.pins[0].note).toBe("接 5V");
    // 未填写的引脚不产生任何电气数值字段。
    expect("maxCurrent" in normalized.pins[1]).toBe(false);
    expect("protocol" in normalized.pins[1]).toBe(false);
  });

  it("拒绝非数值电流上限与非文本协议，避免把脏数据写进库中", () => {
    const badCurrent = definition({ pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 }, maxCurrent: Number.NaN }] });
    expect(() => validateComponentDefinition(badCurrent)).toThrow("引脚定义无效");
    const badProtocol = definition({ pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 }, protocol: 5 as never }] });
    expect(() => validateComponentDefinition(badProtocol)).toThrow("引脚定义无效");
  });

  it("闭集重建同样丢弃引脚上新增字段内部的多余键", () => {
    const raw = {
      ...definition(),
      pins: [{ ...definition().pins[0], maxCurrent: 0.2, apiKey: "LEAK-PIN" }],
    };
    const normalized = normalizeComponentDefinition(raw);
    expect(JSON.stringify(normalized)).not.toContain("LEAK-PIN");
    expect(Object.keys(normalized.pins[0]).sort()).toEqual(["id", "localPosition", "maxCurrent", "maxVoltage", "name", "role"]);
  });

  it("字段被清空时可移除其来源记录，使其重新回到未知", () => {
    const source = definition({ provenance: { model: { confidence: "confirmed", source: "datasheet" } }, userOverrides: ["model"] });
    const cleaned = removeFieldProvenance(source, "model");
    expect(cleaned.provenance.model).toBeUndefined();
    expect(cleaned.userOverrides).toEqual([]);
    // 只删来源，不动数据本身。
    expect(cleaned.model).toBe("XYZ-3V3");
  });
});

describe("画布实例 → 用户元件定义", () => {
  it("内置元件没有库定义时，沿用实例的 definitionId 重建定义，只把已有事实记为内置来源", () => {
    const instance = createBuiltInComponent("regulator-3v3", "regulator-1", { x: 10, y: 10 });
    const result = definitionFromInstance(instance, undefined, { footprint: { width: 200, height: 150 } });

    // 沿用同一个 id：画布上同型号的其它元件因此会一起解析到这份定义。
    expect(result.id).toBe("builtin.regulator-3v3");
    expect(result.displayName).toBe("3.3V 稳压器");
    expect(result.pins.map((pin) => pin.id)).toEqual(["VIN", "3V3", "GND"]);
    expect(result.footprint).toEqual({ width: 200, height: 150 });

    // 尺寸是用户这次确认的；引脚事实来自内置目录，如实登记来源而不是升级成"用户录入"。
    expect(result.provenance.footprint).toEqual({ confidence: "confirmed", source: "user" });
    expect(result.userOverrides).toContain("footprint");
    expect(result.provenance["pins.VIN.role"]).toEqual({ confidence: "confirmed", source: "builtin" });
    // 内置的 VIN 没有额定电压，绝不能凭空多出一条"已确认"的来源。
    expect("pins.VIN.maxVoltage" in result.provenance).toBe(false);
    expect(result.electricalProperties).toEqual({});

    // 生成的定义必须能直接通过闭集校验写进用户库。
    expect(() => normalizeComponentDefinition(result)).not.toThrow();
  });

  it("库里已有同 id 定义时以它为基础，只覆盖本次改动的字段", () => {
    const base = definition();
    const instance = instantiateFromDefinition(base, "placed-3", { x: 0, y: 0 });
    const image = { dataUrl: "data:image/png;base64,AA==", naturalWidth: 8, naturalHeight: 4, rotation: 0 as const };
    const result = definitionFromInstance(instance, base, { footprint: { width: 240, height: 160 }, image });

    expect(result.model).toBe("XYZ-3V3");
    expect(result.electricalProperties).toEqual({ maxVoltage: 6, outputVoltage: 3.3 });
    expect(result.provenance.model).toEqual({ confidence: "confirmed", source: "datasheet", evidence: "https://example.com/ds.pdf 第 1 页" });
    expect(result.provenance["electricalProperties.maxVoltage"]).toEqual({ confidence: "estimated", source: "ai-suggestion" });
    expect(result.footprint).toEqual({ width: 240, height: 160 });
    expect(result.image).toEqual(image);
    expect(result.provenance.image).toEqual({ confidence: "confirmed", source: "user" });
    expect(result.userOverrides).toEqual(["displayName", "footprint", "image"]);
    expect(() => normalizeComponentDefinition(result)).not.toThrow();
  });

  it("实例带电压变换时会一并带入，之后仍需通过引脚存在性校验", () => {
    const base = definition({
      voltageTransforms: [{ inputPinId: "VIN", outputPinId: "3V3", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }],
    });
    const instance = instantiateFromDefinition(base, "placed-4", { x: 0, y: 0 });
    const result = definitionFromInstance(instance, undefined, { footprint: { width: 100, height: 60 } });
    expect(result.voltageTransforms).toEqual(base.voltageTransforms);
    expect(() => normalizeComponentDefinition(result)).not.toThrow();
  });
});