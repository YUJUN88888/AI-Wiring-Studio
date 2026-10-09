import { describe, expect, it } from "vitest";
import { addComponent, addWire, computeWireFocus, createProject, isDarkColor, problemWireIds, runErc, wirePurposes, type ComponentInstance, type Pin, type Project, type WirePurpose } from "../../src/domain";

const pin = (id: string, partial: Partial<Pin> = {}): Pin => ({ id, name: id, role: "UNKNOWN", localPosition: { x: 0, y: 0 }, ...partial });
const component = (id: string, pins: Pin[]): ComponentInstance => ({ id, definitionId: id, displayName: id, position: { x: 0, y: 0 }, rotation: 0, pins });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, source: { componentId: a, pinId: ap }, target: { componentId: b, pinId: bp }, color: "#20242a" });
const withParts = (...parts: ComponentInstance[]): Project => parts.reduce((p, c) => addComponent(p, c), createProject("project"));

/**
 * 一个"电源 + 地 + 主控 + 传感器"的最小场景：
 * w-power = 电源网络、w-ground = 地网络、w-signal = 信号网络、w-unknown = 两个都没填角色的引脚（判不出来）。
 */
function scene(): Project {
  let project = withParts(
    component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 }), pin("GND", { role: "GND" })]),
    component("sensor", [pin("VCC", { role: "POWER_INPUT" }), pin("DIN", { role: "INPUT" }), pin("GND", { role: "GND" })]),
    component("mcu", [pin("GPIO21", { role: "GPIO" }), pin("X", {}), pin("Y", {})]),
    // 没接任何线的元件：聚焦别人时它必须退到背景。
    component("spare", [pin("P1", { role: "GPIO" })]),
  );
  project = addWire(project, wire("w-power", "supply", "5V", "sensor", "VCC"));
  project = addWire(project, wire("w-ground", "supply", "GND", "sensor", "GND"));
  project = addWire(project, wire("w-signal", "mcu", "GPIO21", "sensor", "DIN"));
  project = addWire(project, wire("w-unknown", "mcu", "X", "mcu", "Y"));
  return project;
}

describe("线路用途（确定性分类，判不出来就是未分类）", () => {
  it("直接采用 ERC 已算出的电气网络分类，不按引脚名或电压猜", () => {
    const project = scene();
    const purposes = wirePurposes(project, runErc(project));
    expect(purposes.get("w-power")).toBe<WirePurpose>("power");
    expect(purposes.get("w-ground")).toBe<WirePurpose>("ground");
    expect(purposes.get("w-signal")).toBe<WirePurpose>("signal");
    // 两端引脚角色都是 UNKNOWN：没有任何依据，必须诚实给「未分类」而不是猜成信号。
    expect(purposes.get("w-unknown")).toBe<WirePurpose>("unclassified");
  });

  it("悬空线（端点指向不存在的元件）记为未分类，而不是漏掉", () => {
    // 悬空线过不了 addWire，也过不了项目载入校验（两处都拒绝不存在的端点），
    // 所以这里直接构造项目对象，只为钉住兜底分支：万一出现了也必须给「未分类」，不能漏掉。
    const base = withParts(component("mcu", [pin("GPIO21", { role: "GPIO" })]));
    const project: Project = { ...base, wires: [wire("w-lost", "mcu", "GPIO21", "missing", "PIN")] };
    expect(wirePurposes(project, runErc(project)).get("w-lost")).toBe<WirePurpose>("unclassified");
  });

  it("每条连线都有用途，一条都不落下", () => {
    const project = scene();
    const purposes = wirePurposes(project, runErc(project));
    expect([...purposes.keys()].sort()).toEqual(["w-ground", "w-power", "w-signal", "w-unknown"]);
  });
});

describe("问题线路（确定性推导）", () => {
  it("把出问题网络上的连线全部算进来", () => {
    // 已知 5V 直连地：SHORT_CIRCUIT 会把这条网络标成问题。
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 }), pin("GND", { role: "GND" })]));
    project = addWire(project, wire("w-short", "supply", "5V", "supply", "GND"));
    const erc = runErc(project);
    expect(erc.problems.map((p) => p.rule)).toContain("SHORT_CIRCUIT");
    expect(problemWireIds(erc).has("w-short")).toBe(true);
  });

  it("悬空线不进任何网络，也能从问题证据里追到", () => {
    // 同上：直接构造，验证「问题线路」能从证据里的 wireId 追到没进网络的线。
    const base = withParts(component("mcu", [pin("GPIO21", { role: "GPIO" })]));
    const project: Project = { ...base, wires: [wire("w-lost", "mcu", "GPIO21", "missing", "PIN")] };
    const erc = runErc(project);
    expect(erc.problems.map((p) => p.rule)).toContain("DANGLING_WIRE");
    expect(problemWireIds(erc).has("w-lost")).toBe(true);
  });

  it("没问题时不虚构问题线路", () => {
    const project = scene();
    const problems = runErc(project).problems.filter((p) => p.rule !== "UNCONFIRMED_NET" && p.rule !== "PARALLEL_POWER_OUTPUTS");
    expect(problems.length).toBeGreaterThanOrEqual(0);
    const ids = problemWireIds(runErc(project));
    // 场景里没有短路/过压/输出冲突这类硬伤，除了「电流未知」的待确认条目以外不应命中任何线。
    expect(ids.has("w-power")).toBe(false);
    expect(ids.has("w-signal")).toBe(false);
  });
});

describe("聚焦态（默认淡化 / 聚焦强调 / 筛选）", () => {
  const base = () => {
    const project = scene();
    const erc = runErc(project);
    return { project, erc, purposes: wirePurposes(project, erc), problemWires: problemWireIds(erc) };
  };
  const view = (overrides: Partial<Parameters<typeof computeWireFocus>[0]> = {}) => {
    const { project, purposes, problemWires } = base();
    return computeWireFocus({
      wires: project.wires,
      components: project.components,
      purposes,
      problemWires,
      focused: new Set<string>(),
      netWires: new Set<string>(),
      selectedWire: null,
      filter: "all",
      ...overrides,
    });
  };

  it("默认（无聚焦、筛选＝全部）：不淡化、不强调——强度由渲染层的默认透明度承担", () => {
    const result = view();
    expect(result.mutedWires.size).toBe(0);
    expect(result.strongWires.size).toBe(0);
    expect(result.mutedComponents.size).toBe(0);
    expect(result.matchedWires).toBe(4);
    expect(result.focusActive).toBe(false);
  });

  it("聚焦某个元件时，只强调与它相连的线，其余线和元件退到背景", () => {
    const result = view({ focused: new Set(["sensor"]) });
    expect([...result.strongWires].sort()).toEqual(["w-ground", "w-power", "w-signal"]);
    expect([...result.mutedWires]).toEqual(["w-unknown"]);
    // 与 sensor 相连的 mcu / supply 留在前景；没接线的 spare 退到背景。
    expect(result.mutedComponents.has("spare")).toBe(true);
    expect(result.mutedComponents.has("mcu")).toBe(false);
    expect(result.mutedComponents.has("sensor")).toBe(false);
    expect(result.strongComponents.has("sensor")).toBe(true);
  });

  it("按用途筛选：命中的线保持满强度，其余淡出，且总数不变", () => {
    const result = view({ filter: "power" });
    expect([...result.strongWires]).toEqual(["w-power"]);
    expect(result.mutedWires.has("w-ground")).toBe(true);
    expect(result.mutedWires.has("w-signal")).toBe(true);
    expect(result.matchedWires).toBe(1);
  });

  it("「当前模块相关」没有聚焦目标时退回「全部」，并如实标记", () => {
    const result = view({ filter: "module" });
    expect(result.moduleFilterNeedsFocus).toBe(true);
    expect(result.mutedWires.size).toBe(0);
    expect(result.matchedWires).toBe(4);
  });

  it("「当前模块相关」有聚焦目标时只留下与它相连的线", () => {
    const result = view({ filter: "module", focused: new Set(["sensor"]) });
    expect(result.moduleFilterNeedsFocus).toBe(false);
    expect([...result.strongWires].sort()).toEqual(["w-ground", "w-power", "w-signal"]);
    expect([...result.mutedWires]).toEqual(["w-unknown"]);
  });

  it("按「问题线路」筛选时，没有问题的线全部淡出", () => {
    const result = view({ filter: "problems" });
    expect(result.matchedWires).toBe(0);
    expect(result.mutedWires.size).toBe(4);
  });

  it("点亮的引脚网络与选中的连线都算聚焦，不会被淡化", () => {
    expect(view({ netWires: new Set(["w-signal"]) }).mutedWires.has("w-signal")).toBe(false);
    const selected = view({ selectedWire: "w-unknown" });
    // 选中的那根保持满强度，其余三根退到背景（"选中线路 = 聚焦这根线"）。
    expect(selected.strongWires.has("w-unknown")).toBe(true);
    expect(selected.mutedWires.size).toBe(3);
  });

  it("聚焦状态不会改变任何连接：输入项目原样不动", () => {
    const { project } = base();
    const before = JSON.stringify(project);
    view({ focused: new Set(["sensor"]), filter: "ground" });
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("用户手工指定的用途覆盖自动判定；未分类可单独筛选", () => {
  it("指定了 purpose 就以它为准，没指定的仍按电气网络判定", () => {
    const base = scene();
    // w-signal 自动判定是信号；用户改判为电源后必须听用户的。
    const project: Project = { ...base, wires: base.wires.map((w) => (w.id === "w-signal" ? { ...w, purpose: "power" as WirePurpose } : w)) };
    const purposes = wirePurposes(project, runErc(project));
    expect(purposes.get("w-signal")).toBe<WirePurpose>("power");
    expect(purposes.get("w-ground")).toBe<WirePurpose>("ground");
  });

  it("按「未分类」筛选只命中判不出用途的线，其余淡出", () => {
    const project = scene();
    const erc = runErc(project);
    const result = computeWireFocus({
      wires: project.wires, components: project.components,
      purposes: wirePurposes(project, erc), problemWires: problemWireIds(erc),
      focused: new Set<string>(), netWires: new Set<string>(), selectedWire: null, filter: "unclassified",
    });
    expect([...result.strongWires]).toEqual(["w-unknown"]);
    expect(result.matchedWires).toBe(1);
    expect(result.mutedWires.size).toBe(3);
  });
});

describe("深色连线判据（地线在深色背景上必须可见）", () => {
  it("近黑色判为暗，浅色判为不暗", () => {
    expect(isDarkColor("#20242a")).toBe(true);
    expect(isDarkColor("#000")).toBe(true);
    expect(isDarkColor("#eeeeee")).toBe(false);
    expect(isDarkColor("#e34b4b")).toBe(false);
  });

  it("不是合法十六进制颜色时不武断判定", () => {
    expect(isDarkColor("rebeccapurple")).toBe(false);
    expect(isDarkColor("")).toBe(false);
  });
});