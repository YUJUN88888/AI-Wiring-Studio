import { describe, expect, it } from "vitest";
import {
  clearAiApiKey,
  createAiImportProvider,
  createConfiguredAiProviders,
  createMemoryAiSettingsStorage,
  createTauriInvoker,
  DEFAULT_AI_SETTINGS,
  isAiApiKeyConfigured,
  loadAiSettings,
  normalizeAiSettings,
  saveAiSettings,
  setAiApiKey,
  validateAiSettings,
  type AiImportInvoker,
  type AiImportSettings,
} from "../../src/ai/tauriImportProvider";
import { importComponentCandidate, type ImportSource } from "../../src/domain";

const settings: AiImportSettings = {
  baseUrl: "https://example.test/v1",
  textModel: "text-model",
  visionModel: "vision-model",
};

/** 可编程的假调用器：记录调用并返回预设值。 */
function fakeInvoker(handler: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const invoker: AiImportInvoker = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return handler(command, args) as T;
    },
  };
  return { invoker, calls };
}

/** 只关心模型输出的最小合法抽取结果。 */
const modelExtraction = {
  displayName: "TPS62160",
  manufacturer: null,
  model: "TPS62160",
  category: "regulator",
  footprint: null,
  pins: [{ tempId: "VIN", name: "VIN", role: "POWER_INPUT", maxVoltage: 6 }],
  electricalProperties: { maxVoltage: 6 },
  notes: null,
};

describe("AI 设置", () => {
  it("缺失或损坏时回退到安全的默认设置", () => {
    expect(loadAiSettings(createMemoryAiSettingsStorage())).toEqual(DEFAULT_AI_SETTINGS);
    expect(loadAiSettings(createMemoryAiSettingsStorage("{ 不是 JSON"))).toEqual(DEFAULT_AI_SETTINGS);
    expect(loadAiSettings(createMemoryAiSettingsStorage(JSON.stringify({ baseUrl: "" })))).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("校验拒绝空字段与非对象，并给出中文错误", () => {
    expect(() => validateAiSettings(null)).toThrow("必须是一个对象");
    expect(() => normalizeAiSettings({ baseUrl: "  ", textModel: "a", visionModel: "b" })).toThrow("接口地址不能为空");
    expect(() => normalizeAiSettings({ baseUrl: "https://x", textModel: "", visionModel: "b" })).toThrow("文字模型不能为空");
    expect(() => normalizeAiSettings({ baseUrl: "https://x", textModel: "a", visionModel: "" })).toThrow("视觉模型不能为空");
  });

  it("按白名单重建设置：任何被误塞进来的密钥都会被丢弃", () => {
    const stored = JSON.stringify({ baseUrl: "https://x/v1", textModel: "a", visionModel: "b", apiKey: "sk-secret" });
    const loaded = loadAiSettings(createMemoryAiSettingsStorage(stored));
    expect(loaded).toEqual({ baseUrl: "https://x/v1", textModel: "a", visionModel: "b" });
    expect(JSON.stringify(loaded)).not.toContain("sk-secret");
  });

  it("可往返保存与读取", () => {
    const storage = createMemoryAiSettingsStorage();
    saveAiSettings(storage, settings);
    expect(storage.load()).not.toContain("apiKey");
    expect(loadAiSettings(storage)).toEqual(settings);
  });
});

describe("AI 提供商桥接", () => {
  it("文字导入使用文字模型，并把候选的来源标为 AI 建议", async () => {
    const { invoker, calls } = fakeInvoker(() => ({ extraction: modelExtraction }));
    const provider = createAiImportProvider(invoker, settings);
    const candidate = await provider.extract({ kind: "text", text: "TPS62160 输入 6V" });
    expect(calls[0].command).toBe("ai_import_extract");
    const request = calls[0].args?.request as { model: string; source: { kind: string } };
    expect(request.model).toBe("text-model");
    expect(request.source.kind).toBe("text");
    expect(candidate.displayName.value).toBe("TPS62160");
    expect(candidate.displayName.source).toBe("ai-suggestion");
  });

  it("图片导入使用视觉模型并传递图片数据", async () => {
    const { invoker, calls } = fakeInvoker(() => ({ extraction: modelExtraction }));
    const provider = createAiImportProvider(invoker, settings);
    await provider.extract({ kind: "image", image: { dataUrl: "data:image/png;base64,AAAA", naturalWidth: 8, naturalHeight: 8 } });
    const request = calls[0].args?.request as { model: string; source: { kind: string; image?: Record<string, unknown> } };
    expect(request.model).toBe("vision-model");
    expect(request.source.kind).toBe("image");
    expect(request.source.image?.dataUrl).toBe("data:image/png;base64,AAAA");
    // 载荷只含像素数据，尺寸不进入原生请求（原生侧也已删除这两个字段）。
    expect(Object.keys(request.source.image ?? {}).sort()).toEqual(["dataUrl"]);
  });

  it("资料链接导入走 web-search 能力", async () => {
    const { invoker, calls } = fakeInvoker(() => ({ extraction: modelExtraction }));
    const provider = createAiImportProvider(invoker, settings);
    expect(provider.capabilities).toContain("web-search");
    await provider.extract({ kind: "url", url: "https://www.ti.com/tps62160" });
    expect((calls[0].args?.request as { source: { kind: string } }).source.kind).toBe("url");
  });

  it("只有相对路径、没有图片数据的图片会被明确拒绝，而不是硬猜", async () => {
    const { invoker } = fakeInvoker(() => ({ extraction: modelExtraction }));
    const provider = createAiImportProvider(invoker, settings);
    await expect(provider.extract({ kind: "image", image: { path: "images/part.png" } })).rejects.toThrow("缺少图片数据");
  });

  it("模型输出结构不可用时抛错，由上层转为 error 而不是伪造候选", async () => {
    const { invoker } = fakeInvoker(() => ({ extraction: [1, 2, 3] }));
    const provider = createAiImportProvider(invoker, settings);
    const result = await importComponentCandidate([provider], { kind: "text", text: "x" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toContain("模型抽取结果必须是一个对象");
  });

  it("原生调用失败时返回 error，不向上抛出异常", async () => {
    const { invoker } = fakeInvoker(() => { throw new Error("尚未配置 API Key，AI 不可用"); });
    const provider = createAiImportProvider(invoker, settings);
    const result = await importComponentCandidate([provider], { kind: "text", text: "x" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toContain("AI 不可用");
  });

  it("图片导入的候选图片强制取自用户上传的可信图片", async () => {
    const { invoker } = fakeInvoker(() => ({ extraction: modelExtraction }));
    const provider = createAiImportProvider(invoker, settings);
    const source: ImportSource = { kind: "image", image: { dataUrl: "data:image/png;base64,USER", naturalWidth: 8, naturalHeight: 8 } };
    const result = await importComponentCandidate([provider], source);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.candidate.image).toEqual({ dataUrl: "data:image/png;base64,USER", naturalWidth: 8, naturalHeight: 8 });
  });
});

describe("供应商可用性与密钥管理", () => {
  it("已配置密钥时提供供应商；未配置时返回空列表（即 AI 不可用）", async () => {
    const configured = fakeInvoker(() => ({ configured: true }));
    const providers = await createConfiguredAiProviders(configured.invoker, settings);
    expect(providers).toHaveLength(1);
    expect(providers[0].capabilities).toEqual(["text", "vision", "web-search"]);

    const notConfigured = fakeInvoker(() => ({ configured: false }));
    expect(await createConfiguredAiProviders(notConfigured.invoker, settings)).toEqual([]);
  });

  it("原生不可用时按未配置处理，绝不假装可用", async () => {
    const { invoker } = fakeInvoker(() => { throw new Error("not in tauri"); });
    expect(await isAiApiKeyConfigured(invoker)).toBe(false);
    expect(await createConfiguredAiProviders(invoker, settings)).toEqual([]);
    const result = await importComponentCandidate(await createConfiguredAiProviders(invoker, settings), { kind: "text", text: "x" });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toContain("AI 不可用");
    expect(result.reason).toContain("手工创建元件");
  });

  it("写入密钥前校验非空，且密钥不会出现在其它调用参数里", async () => {
    const { invoker, calls } = fakeInvoker(() => undefined);
    await expect(setAiApiKey(invoker, "   ")).rejects.toThrow("API Key 不能为空");
    await setAiApiKey(invoker, "sk-secret");
    expect(calls[0]).toEqual({ command: "ai_set_api_key", args: { apiKey: "sk-secret" } });
    await clearAiApiKey(invoker);
    expect(calls[1].command).toBe("ai_clear_api_key");
  });
});

describe("createTauriInvoker", () => {
  it("非 Tauri 运行环境返回 null，绝不伪造可用状态", async () => {
    // 测试运行在 Node 环境，没有 Tauri 运行时，应确定性地返回 null。
    await expect(createTauriInvoker()).resolves.toBeNull();
  });
});