import { describe, expect, it } from "vitest";
import {
  candidateFromExtraction,
  definitionFromCandidate,
  listCandidateFields,
  parseAiExtraction,
  validateComponentCandidate,
  type AiExtraction,
  type ComponentCandidate,
} from "../../src/domain";

/** 一个内容完整、合法的模型抽取结果基线。 */
const extraction: AiExtraction = {
  displayName: "TPS62160",
  manufacturer: "TI",
  model: "TPS62160",
  category: "regulator",
  footprint: { width: 100, height: 60 },
  pins: [
    {
      tempId: "VIN",
      name: "VIN",
      role: "POWER_INPUT",
      polarity: null,
      driveMode: null,
      maxVoltage: 6,
      maxCurrent: 2,
      outputVoltage: null,
      protocol: null,
      note: null,
      imagePixel: null,
    },
  ],
  electricalProperties: { maxVoltage: 6 },
  notes: null,
};

describe("parseAiExtraction", () => {
  it("拒绝结构上不可用的结果，绝不做容错修补", () => {
    expect(() => parseAiExtraction(null)).toThrow("必须是一个对象");
    expect(() => parseAiExtraction([1, 2])).toThrow("必须是一个对象");
    expect(() => parseAiExtraction({ pins: "VIN,GND" })).toThrow("引脚列表必须是数组");
    expect(() => parseAiExtraction({ pins: [42] })).toThrow("引脚必须是对象");
    expect(() => parseAiExtraction({ footprint: 100 })).toThrow("尺寸必须是对象");
    expect(() => parseAiExtraction({ electricalProperties: [] })).toThrow("电气参数必须是对象");
  });

  it("缺失字段一律落到 null，绝不以 0 或空串冒充已知", () => {
    const parsed = parseAiExtraction({});
    expect(parsed.displayName).toBeNull();
    expect(parsed.manufacturer).toBeNull();
    expect(parsed.model).toBeNull();
    expect(parsed.category).toBeNull();
    expect(parsed.footprint).toBeNull();
    expect(parsed.pins).toEqual([]);
    expect(parsed.electricalProperties).toEqual({});
    expect(parsed.notes).toBeNull();
  });

  it("数值只接受有限数或纯数字字符串，带单位与非法值一律视为未知", () => {
    const parsed = parseAiExtraction({
      electricalProperties: { maxVoltage: "6", maxCurrent: "6V", outputVoltage: " ", resistance: true, capacitance: null, forwardVoltage: 1.2 },
    });
    expect(parsed.electricalProperties.maxVoltage).toBe(6);
    expect(parsed.electricalProperties.forwardVoltage).toBe(1.2);
    expect("maxCurrent" in parsed.electricalProperties).toBe(false);
    expect("outputVoltage" in parsed.electricalProperties).toBe(false);
    expect("resistance" in parsed.electricalProperties).toBe(false);
  });

  it("枚举按大小写不敏感匹配；匹配不到就是未知，绝不近似映射", () => {
    const parsed = parseAiExtraction({
      category: "Regulator",
      pins: [
        { tempId: "A", role: "power_input", polarity: "Positive", driveMode: "OPEN-DRAIN" },
        { tempId: "B", role: "电源输入", polarity: "both", driveMode: "totem-pole" },
      ],
    });
    expect(parsed.category).toBe("regulator");
    expect(parsed.pins[0].role).toBe("POWER_INPUT");
    expect(parsed.pins[0].polarity).toBe("positive");
    expect(parsed.pins[0].driveMode).toBe("open-drain");
    expect(parsed.pins[1].role).toBeNull();
    expect(parsed.pins[1].polarity).toBeNull();
    expect(parsed.pins[1].driveMode).toBeNull();
  });

  it("尺寸必须两个方向都是正数，否则视为未知", () => {
    expect(parseAiExtraction({ footprint: { width: 100, height: 60 } }).footprint).toEqual({ width: 100, height: 60 });
    expect(parseAiExtraction({ footprint: { width: 100 } }).footprint).toBeNull();
    expect(parseAiExtraction({ footprint: { width: 0, height: 60 } }).footprint).toBeNull();
    expect(parseAiExtraction({ footprint: { width: -1, height: 60 } }).footprint).toBeNull();
  });

  it("引脚临时 ID 缺失或非法时按顺序生成，重复时自动去重", () => {
    const parsed = parseAiExtraction({
      pins: [
        { name: "无 ID" },
        { tempId: "有 空格 的 ID", name: "非法 ID" },
        { tempId: "A", name: "第一个 A" },
        { tempId: "A", name: "第二个 A" },
      ],
    });
    expect(parsed.pins.map((pin) => pin.tempId)).toEqual(["P1", "P2", "A", "A-2"]);
  });

  it("文本字段去除首尾空白，纯空白视为未知", () => {
    const parsed = parseAiExtraction({ displayName: "  TPS62160  ", manufacturer: "   " });
    expect(parsed.displayName).toBe("TPS62160");
    expect(parsed.manufacturer).toBeNull();
  });

  it("图片像素坐标只接受非负有限数，其余一律视为未给出", () => {
    const parsed = parseAiExtraction({
      pins: [
        { tempId: "A", imagePixel: { x: 12, y: "34.5" } },
        { tempId: "B", imagePixel: { x: -1, y: 5 } },
        { tempId: "C", imagePixel: { x: "1px", y: 5 } },
        { tempId: "D", imagePixel: [10, 20] },
        { tempId: "E" },
      ],
    });
    expect(parsed.pins[0].imagePixel).toEqual({ x: 12, y: 34.5 });
    expect(parsed.pins[1].imagePixel).toBeNull();
    expect(parsed.pins[2].imagePixel).toBeNull();
    expect(parsed.pins[3].imagePixel).toBeNull();
    expect(parsed.pins[4].imagePixel).toBeNull();
  });
});

describe("candidateFromExtraction", () => {
  it("已知值来源恒为 ai-suggestion、置信度恒为 estimated，绝无 confirmed", () => {
    const candidate = candidateFromExtraction(extraction, { id: "cand.1" });
    const known = listCandidateFields(candidate).filter((ref) => !ref.field.unknown);
    expect(known.length).toBeGreaterThan(0);
    for (const ref of known) {
      expect(ref.field.source).toBe("ai-suggestion");
      expect(ref.field.confidence).toBe("estimated");
    }
    for (const ref of listCandidateFields(candidate)) {
      expect(ref.field.confidence).not.toBe("confirmed");
    }
  });

  it("模型未能确认的字段保持未知且不携带值", () => {
    const candidate = candidateFromExtraction(parseAiExtraction({}), { id: "cand.1" });
    expect(candidate.displayName.unknown).toBe(true);
    expect("value" in candidate.displayName).toBe(false);
    expect(candidate.category?.unknown).toBe(true);
    expect(candidate.electricalProperties?.maxVoltage?.unknown).toBe(true);
  });

  it("结果通过候选校验，且顶层电气参数键完整给出", () => {
    const candidate = candidateFromExtraction(extraction, { id: "cand.1" });
    expect(() => validateComponentCandidate(candidate)).not.toThrow();
    expect(Object.keys(candidate.electricalProperties ?? {}).sort()).toEqual(
      ["capacitance", "forwardVoltage", "maxCurrent", "maxVoltage", "outputVoltage", "resistance"],
    );
    expect(candidate.pins[0].tempId).toBe("VIN");
    expect(candidate.pins[0].role.value).toBe("POWER_INPUT");
  });

  it("候选绝不携带图片：图片只能来自用户上传", () => {
    const candidate = candidateFromExtraction(extraction, { id: "cand.1" });
    expect(candidate.image).toBeUndefined();
  });

  it("图片像素坐标原样进入候选，且不会作为可勾选字段出现（它不是本地坐标）", () => {
    const parsed = parseAiExtraction({ pins: [{ tempId: "VIN", name: "VIN", imagePixel: { x: 30, y: 40 } }] });
    const candidate = candidateFromExtraction(parsed, { id: "cand.1" });
    expect(candidate.pins[0].imagePixel).toEqual({ x: 30, y: 40 });
    expect("localPosition" in candidate.pins[0]).toBe(false);
    expect(listCandidateFields(candidate).map((ref) => ref.path)).not.toContain("pins.VIN.imagePixel");
  });

  it("证据说明材料来源，并附上截断后的模型备注", () => {
    const withNotes = parseAiExtraction({ displayName: "A", notes: "x".repeat(600) });
    const candidate = candidateFromExtraction(withNotes, { id: "cand.1", evidence: "模型依据用户粘贴的参数文字抽取" });
    const evidence = candidate.displayName.evidence ?? "";
    expect(evidence.startsWith("模型依据用户粘贴的参数文字抽取")).toBe(true);
    expect(evidence).toContain("模型备注：");
    expect(evidence.length).toBeLessThan(600 + 40);
  });

  it("模型返回的多余键不会进入候选（闭集）", () => {
    const hostile = parseAiExtraction({ displayName: "A", apiKey: "sk-secret", pins: [] });
    const candidate = candidateFromExtraction(hostile, { id: "cand.1" }) as ComponentCandidate & { apiKey?: string };
    expect("apiKey" in candidate).toBe(false);
    expect(JSON.stringify(candidate)).not.toContain("sk-secret");
  });

  it("即便用户逐字段全部采纳，写入定义的来源与置信度也不会升级", () => {
    const candidate = candidateFromExtraction(extraction, { id: "cand.1" });
    const accepted = listCandidateFields(candidate).filter((ref) => !ref.field.unknown).map((ref) => ref.path);
    const definition = definitionFromCandidate(candidate, {
      id: "user.tps62160",
      displayName: "TPS62160",
      acceptedFields: accepted,
      acceptedPinTempIds: candidate.pins.map((pin) => pin.tempId),
    });
    for (const [path, provenance] of Object.entries(definition.provenance)) {
      if (path === "displayName") {
        // 名称由用户显式指定，才允许是 user/confirmed。
        expect(provenance).toEqual({ confidence: "confirmed", source: "user" });
        continue;
      }
      if (path === "footprint") {
        // 尺寸一律不采用外部数值（单位不可知），由确定性规则推导，故不是 AI 来源。
        expect(provenance).toEqual({ confidence: "unknown", source: "user" });
        continue;
      }
      expect(provenance.confidence).not.toBe("confirmed");
      expect(provenance.source).toBe("ai-suggestion");
    }
  });
});