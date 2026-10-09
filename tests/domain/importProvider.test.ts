import { describe, expect, it } from "vitest";
import {
  availableCapabilities,
  capabilityForSource,
  findProvider,
  importComponentCandidate,
  knownField,
  unavailableReason,
  type ComponentCandidate,
  type ComponentImage,
  type ComponentImportProvider,
  type ImportCapability,
} from "../../src/domain";

/** 一个字段齐备的合法候选，用作供应商返回值基线。 */
const baseCandidate = (overrides: Partial<ComponentCandidate> = {}): ComponentCandidate => ({
  id: "cand.1",
  displayName: knownField("TPS62160", "ai-suggestion", "estimated", "图片标题栏"),
  model: knownField("TPS62160", "ai-suggestion", "estimated"),
  pins: [
    {
      tempId: "VIN",
      name: knownField("VIN", "ai-suggestion", "estimated"),
      role: knownField("POWER_INPUT", "ai-suggestion", "estimated"),
    },
  ],
  ...overrides,
});

const textProvider = (impl: () => Promise<ComponentCandidate>): ComponentImportProvider => ({
  id: "text.p1",
  displayName: "文字识别服务",
  capabilities: ["text"],
  extract: impl,
});

describe("import provider", () => {
  it("输入类型到所需能力的映射是确定的", () => {
    expect(capabilityForSource("text")).toBe("text");
    expect(capabilityForSource("model")).toBe("text");
    expect(capabilityForSource("image")).toBe("vision");
    expect(capabilityForSource("url")).toBe("web-search");
    // 补查缺失元件走文字模型：只把型号/名称与被引用的引脚 ID 交给模型。
    expect(capabilityForSource("component-lookup")).toBe("text");
  });

  it("没有供应商时明确返回 AI 不可用，绝不伪造结果", async () => {
    const result = await importComponentCandidate([], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toContain("AI 不可用");
    expect(result.reason).toContain("手工创建元件");
  });

  it("有供应商但不具备所需能力时同样返回 AI 不可用", async () => {
    const onlyWeb: ComponentImportProvider = {
      id: "web.p1",
      displayName: "资料检索服务",
      capabilities: ["web-search"],
      extract: async () => baseCandidate(),
    };
    const result = await importComponentCandidate([onlyWeb], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toContain("AI 不可用");
    expect(result.reason).toContain("文字/型号识别");
  });

  it("能力标签与不可用说明一一对应", () => {
    expect(unavailableReason("vision")).toContain("图片识别");
    expect(unavailableReason("web-search")).toContain("资料检索");
  });

  it("选择第一个具备所需能力的供应商，并透传候选与来源", async () => {
    const calls: string[] = [];
    const p1 = textProvider(async () => {
      calls.push("p1");
      return baseCandidate();
    });
    const p2: ComponentImportProvider = {
      id: "text.p2",
      displayName: "备用文字识别",
      capabilities: ["text"],
      extract: async () => {
        calls.push("p2");
        return baseCandidate();
      },
    };
    const result = await importComponentCandidate([p1, p2], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.providerId).toBe("text.p1");
    expect(result.candidate.displayName.value).toBe("TPS62160");
    expect(calls).toEqual(["p1"]);
  });

  it("供应商返回的候选经白名单重建，额外键（如误带的密钥）被丢弃", async () => {
    const leaky = textProvider(async () => ({ ...baseCandidate(), apiKey: "sk-secret" }) as ComponentCandidate);
    const result = await importComponentCandidate([leaky], { kind: "model", model: "TPS62160" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect("apiKey" in result.candidate).toBe(false);
  });

  it("图片导入时，候选图片强制取自用户上传的可信图片，供应商自带图片被覆盖", async () => {
    const trusted = { dataUrl: "data:image/png;base64,AAAA", naturalWidth: 10, naturalHeight: 10 } as const;
    const vision: ComponentImportProvider = {
      id: "vision.p1",
      displayName: "图片识别服务",
      capabilities: ["vision"],
      // 供应商试图塞入自己的图片（dataUrl 不同），必须被覆盖。
      extract: async () => baseCandidate({ image: { dataUrl: "data:image/png;base64,BBBB" } }),
    };
    const result = await importComponentCandidate([vision], { kind: "image", image: { ...trusted } });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidate.image).toEqual({ ...trusted });
  });

  it("非图片输入下供应商自行带图，直接判为不合格", async () => {
    const fabricating = textProvider(async () => baseCandidate({ image: { dataUrl: "data:image/png;base64,BBBB" } }));
    const result = await importComponentCandidate([fabricating], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toContain("不得自行生成或替换元件图片");
  });

  it("供应商抛错时返回 error，不向上抛出异常", async () => {
    const failing: ComponentImportProvider = {
      id: "text.bad",
      displayName: "故障服务",
      capabilities: ["text"],
      extract: async () => {
        throw new Error("网络超时");
      },
    };
    const result = await importComponentCandidate([failing], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.providerId).toBe("text.bad");
    expect(result.reason).toContain("网络超时");
  });

  it("供应商返回不合格内容时返回 error，不进入后续流程", async () => {
    const broken = textProvider(async () => ({ id: "cand.1" }) as ComponentCandidate);
    const result = await importComponentCandidate([broken], { kind: "text", text: "TPS62160" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toContain("内容无效");
  });

  it("补查缺失元件的输入被校验：缺标识/显示名、非法引脚 ID 一律拒绝", async () => {
    const provider = textProvider(async () => baseCandidate());
    const base = { kind: "component-lookup" as const, token: "battery-2s-liion", displayName: "2S 锂电池组", referencedPins: ["B+", "B-"] };

    const ok = await importComponentCandidate([provider], base);
    expect(ok.status).toBe("ok");

    const noToken = await importComponentCandidate([provider], { ...base, token: "  " });
    expect(noToken.status).toBe("error");
    if (noToken.status !== "error") return;
    expect(noToken.reason).toContain("标识");

    const noName = await importComponentCandidate([provider], { ...base, displayName: "" });
    expect(noName.status).toBe("error");

    // 引脚 ID 不得含点或空白（与接线代码的引脚 ID 规则一致）。
    const badPin = await importComponentCandidate([provider], { ...base, referencedPins: ["a.b"] });
    expect(badPin.status).toBe("error");
    if (badPin.status !== "error") return;
    expect(badPin.reason).toContain("引脚");
  });

  it("输入边界被校验：空文字、非法链接会被拒绝", async () => {
    const provider = textProvider(async () => baseCandidate());
    const empty = await importComponentCandidate([provider], { kind: "text", text: "   " });
    expect(empty.status).toBe("error");

    const web: ComponentImportProvider = {
      id: "web.p1",
      displayName: "资料检索服务",
      capabilities: ["web-search"],
      extract: async () => baseCandidate(),
    };
    const badUrl = await importComponentCandidate([web], { kind: "url", url: "javascript:alert(1)" });
    expect(badUrl.status).toBe("error");
    if (badUrl.status !== "error") return;
    expect(badUrl.reason).toContain("http");

    const credUrl = await importComponentCandidate([web], { kind: "url", url: "https://user:pass@evil.example/ds.pdf" });
    expect(credUrl.status).toBe("error");
    if (credUrl.status !== "error") return;
    expect(credUrl.reason).toContain("不得包含用户名或密码");

    const okUrl = await importComponentCandidate([web], { kind: "url", url: "https://www.ti.com/tps62160" });
    expect(okUrl.status).toBe("ok");
  });

  it("图片导入返回的图片按白名单重建，额外键被丢弃", async () => {
    const vision: ComponentImportProvider = {
      id: "vision.p1",
      displayName: "图片识别服务",
      capabilities: ["vision"],
      extract: async () => baseCandidate(),
    };
    const taintedImage = { dataUrl: "data:image/png;base64,AAAA", secret: "sk-secret" } as unknown as ComponentImage;
    const result = await importComponentCandidate([vision], { kind: "image", image: taintedImage });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidate.image).toEqual({ dataUrl: "data:image/png;base64,AAAA" });
    expect("secret" in (result.candidate.image ?? {})).toBe(false);
  });

  it("校验在调用供应商之前完成，非法输入不会触发供应商调用", async () => {
    let called = false;
    const provider = textProvider(async () => {
      called = true;
      return baseCandidate();
    });
    await importComponentCandidate([provider], { kind: "text", text: "" });
    expect(called).toBe(false);
  });

  it("findProvider 只按声明的能力匹配", () => {
    const vision: ComponentImportProvider = {
      id: "vision.p1",
      displayName: "图片识别服务",
      capabilities: ["vision"],
      extract: async () => baseCandidate(),
    };
    expect(findProvider([vision], "vision")?.id).toBe("vision.p1");
    expect(findProvider([vision], "text")).toBeUndefined();
  });

  it("availableCapabilities 按固定顺序去重汇总", () => {
    const provider = (id: string, capabilities: readonly ImportCapability[]): ComponentImportProvider => ({
      id,
      displayName: id,
      capabilities,
      extract: async () => baseCandidate(),
    });
    const providers = [provider("a", ["web-search", "text"]), provider("b", ["text", "vision"])];
    expect(availableCapabilities(providers)).toEqual(["text", "vision", "web-search"]);
    expect(availableCapabilities([])).toEqual([]);
  });

  it("未知字段保持未知，导入结果不会把未知洗成已知", async () => {
    const provider = textProvider(async () => ({
      id: "cand.2",
      displayName: unknownFieldStub(),
      pins: [],
    }) as ComponentCandidate);
    const result = await importComponentCandidate([provider], { kind: "text", text: "未知元件" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidate.displayName.unknown).toBe(true);
    expect("value" in result.candidate.displayName).toBe(false);
  });
});

/** 便捷构造：未知字段，避免测试文件顶部引入过多符号。 */
function unknownFieldStub() {
  return { unknown: true as const, confidence: "unknown" as const, source: "ai-suggestion" as const };
}
