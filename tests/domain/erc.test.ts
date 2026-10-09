import { describe, expect, it } from "vitest";
import { addComponent, addWire, buildElectricalNets, COVERAGE_LABELS, createProject, deleteComponent, ERC_COVERAGE, runErc, type ComponentInstance, type Pin, type Project } from "../../src/domain";

const pin = (id: string, partial: Partial<Pin> = {}): Pin => ({ id, name: id, role: "UNKNOWN", localPosition: { x: 0, y: 0 }, ...partial });
const component = (id: string, pins: Pin[]): ComponentInstance => ({ id, definitionId: id, displayName: id, position: { x: 0, y: 0 }, rotation: 0, pins });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, source: { componentId: a, pinId: ap }, target: { componentId: b, pinId: bp }, color: "#000" });
const withParts = (...parts: ComponentInstance[]): Project => parts.reduce((p, c) => addComponent(p, c), createProject("project"));

describe("deterministic ERC", () => {
  it("reports a critical short for known positive supply to ground", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("ground", [pin("GND", { role: "GND" })]));
    project = addWire(project, wire("w", "supply", "5V", "ground", "GND"));
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "SHORT_CIRCUIT", severity: "CRITICAL" })]));
  });

  it("reports a confirmed 5V connection to a 3.3V-only input", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("esp", [pin("GPIO21", { role: "GPIO", maxVoltage: 3.3 })]));
    project = addWire(project, wire("w", "supply", "5V", "esp", "GPIO21"));
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "OVERVOLTAGE", severity: "ERROR" })]));
  });

  it("does not invent an overvoltage result if voltage is unknown", () => {
    let project = withParts(component("mystery", [pin("OUT", { role: "POWER_OUTPUT" })]), component("esp", [pin("GPIO", { role: "GPIO", maxVoltage: 3.3 })]));
    project = addWire(project, wire("w", "mystery", "OUT", "esp", "GPIO"));
    const result = runErc(project);
    expect(result.voltages["net-1"]).toMatchObject({ kind: "Unknown" });
    expect(result.problems.some((p) => p.rule === "OVERVOLTAGE")).toBe(false);
  });

  it("reports current as Unknown when no complete load model is available", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("input", [pin("IN", { role: "INPUT" })]));
    project = addWire(project, wire("w", "supply", "5V", "input", "IN"));
    expect(Object.values(runErc(project).currents)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "Unknown", unit: "A" })]));
  });

  it("reports two confirmed push-pull outputs on one net", () => {
    let project = withParts(component("a", [pin("OUT", { role: "OUTPUT", driveMode: "push-pull" })]), component("b", [pin("OUT", { role: "OUTPUT", driveMode: "push-pull" })]));
    project = addWire(project, wire("w", "a", "OUT", "b", "OUT"));
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "OUTPUT_CONFLICT", severity: "ERROR" })]));
  });

  it("does not confuse a compatible 3.3V connection with an error", () => {
    let project = withParts(component("supply", [pin("3V3", { role: "POWER_OUTPUT", outputVoltage: 3.3 })]), component("input", [pin("IN", { role: "INPUT", maxVoltage: 3.3 })]));
    project = addWire(project, wire("w", "supply", "3V3", "input", "IN"));
    // 电流仍无法计算，所以会有「待确认」条目；但没有任何「明确错误」。
    expect(runErc(project).problems.filter((problem) => problem.severity === "ERROR" || problem.severity === "CRITICAL")).toEqual([]);
  });

  it("reports a polarity error only when both polarized terminals have known reversed voltages", () => {
    let project = withParts(
      component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]),
      component("ground", [pin("GND", { role: "GND" })]),
      component("capacitor", [pin("+", { polarity: "positive" }), pin("-", { polarity: "negative" })]),
    );
    project = addWire(project, wire("w1", "supply", "5V", "capacitor", "-"));
    project = addWire(project, wire("w2", "ground", "GND", "capacitor", "+"));
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "POLARITY_ERROR", severity: "ERROR" })]));
  });

  it("does not guess a polarity error when either terminal voltage is unknown", () => {
    let project = withParts(component("mystery", [pin("OUT", { role: "POWER_OUTPUT" })]), component("capacitor", [pin("+", { polarity: "positive" }), pin("-", { polarity: "negative" })]));
    project = addWire(project, wire("w", "mystery", "OUT", "capacitor", "+"));
    expect(runErc(project).problems.some((p) => p.rule === "POLARITY_ERROR")).toBe(false);
  });

  it("propagates a confirmed regulator output without guessing across unmodeled parts", () => {
    let project = withParts(
      component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]),
      { ...component("regulator", [pin("VIN", { role: "POWER_INPUT" }), pin("3V3", { role: "POWER_OUTPUT" })]), voltageTransforms: [{ inputPinId: "VIN", outputPinId: "3V3", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }] },
      component("gpio", [pin("IN", { role: "GPIO", maxVoltage: 3.3 })]),
    );
    project = addWire(project, wire("in", "supply", "5V", "regulator", "VIN"));
    project = addWire(project, wire("out", "regulator", "3V3", "gpio", "IN"));
    const result = runErc(project);
    expect(Object.values(result.voltages)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "Known", value: 3.3 })]));
    expect(result.problems.some((p) => p.rule === "OVERVOLTAGE")).toBe(false);
  });

  it("does not propagate a transform when VIN is outside its confirmed range", () => {
    let project = withParts(
      component("supply", [pin("1V8", { role: "POWER_OUTPUT", outputVoltage: 1.8 })]),
      { ...component("regulator", [pin("VIN", { role: "POWER_INPUT" }), pin("3V3", { role: "POWER_OUTPUT" })]), voltageTransforms: [{ inputPinId: "VIN", outputPinId: "3V3", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }] },
      component("input", [pin("IN", { role: "GPIO", maxVoltage: 3.3 })]),
    );
    project = addWire(project, wire("in", "supply", "1V8", "regulator", "VIN"));
    project = addWire(project, wire("out", "regulator", "3V3", "input", "IN"));
    expect(Object.values(runErc(project).voltages)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "Unknown" })]));
  });

  it("电平不匹配：已知 3.3V 驱动接到要求 4.5–5.5V 的输入引脚时报告", () => {
    let project = withParts(
      component("supply", [pin("3V3", { role: "POWER_OUTPUT", outputVoltage: 3.3 })]),
      component("sensor", [pin("IN", { role: "INPUT", voltageRange: { min: 4.5, max: 5.5, unit: "V" } })]),
    );
    project = addWire(project, wire("w", "supply", "3V3", "sensor", "IN"));
    const mismatch = runErc(project).problems.find((problem) => problem.rule === "LEVEL_MISMATCH");
    expect(mismatch).toMatchObject({ severity: "WARNING", netId: "net-1" });
    expect(mismatch?.message).toContain("3.3");
    expect(mismatch?.message).toContain("4.5");
  });

  it("电平不匹配：电压落在引脚输入电平范围内时不报告", () => {
    let project = withParts(
      component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]),
      component("sensor", [pin("IN", { role: "INPUT", voltageRange: { min: 4.5, max: 5.5, unit: "V" } })]),
    );
    project = addWire(project, wire("w", "supply", "5V", "sensor", "IN"));
    expect(runErc(project).problems.some((problem) => problem.rule === "LEVEL_MISMATCH")).toBe(false);
  });

  it("电平不匹配：引脚没填输入电平范围时绝不报告", () => {
    let project = withParts(
      component("supply", [pin("3V3", { role: "POWER_OUTPUT", outputVoltage: 3.3 })]),
      component("sensor", [pin("IN", { role: "INPUT" })]),
    );
    project = addWire(project, wire("w", "supply", "3V3", "sensor", "IN"));
    expect(runErc(project).problems.some((problem) => problem.rule === "LEVEL_MISMATCH")).toBe(false);
  });

  it("电平不匹配：电压高于上限且同时超过 maxVoltage 时只报输入过压，不重复报", () => {
    let project = withParts(
      component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]),
      component("sensor", [pin("IN", { role: "INPUT", maxVoltage: 3.3, voltageRange: { min: 1, max: 2, unit: "V" } })]),
    );
    project = addWire(project, wire("w", "supply", "5V", "sensor", "IN"));
    const problems = runErc(project).problems;
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "OVERVOLTAGE" })]));
    expect(problems.some((problem) => problem.rule === "LEVEL_MISMATCH")).toBe(false);
  });

  it("电平不匹配：高于输入上限但未超过 maxVoltage 时仍报告（过压规则覆盖不到）", () => {
    let project = withParts(
      component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]),
      component("sensor", [pin("IN", { role: "INPUT", maxVoltage: 6, voltageRange: { min: 1, max: 2, unit: "V" } })]),
    );
    project = addWire(project, wire("w", "supply", "5V", "sensor", "IN"));
    const problems = runErc(project).problems;
    expect(problems.some((problem) => problem.rule === "OVERVOLTAGE")).toBe(false);
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "LEVEL_MISMATCH", severity: "WARNING" })]));
  });

  it("电平不匹配：电源输入引脚电平过低时按明确错误报告", () => {
    let project = withParts(
      component("supply", [pin("3V3", { role: "POWER_OUTPUT", outputVoltage: 3.3 })]),
      component("regulator", [pin("VIN", { role: "POWER_INPUT", voltageRange: { min: 4.5, max: 5.5, unit: "V" } })]),
    );
    project = addWire(project, wire("w", "supply", "3V3", "regulator", "VIN"));
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "LEVEL_MISMATCH", severity: "ERROR" })]));
  });

  it("工程建议：GPIO 给模块的电源输入供电时报告「由 GPIO 供电」", () => {
    let project = withParts(component("esp", [pin("GPIO", { role: "GPIO" })]), component("module", [pin("VCC", { role: "POWER_INPUT" })]));
    project = addWire(project, wire("w", "esp", "GPIO", "module", "VCC"));
    const problem = runErc(project).problems.find((p) => p.rule === "GPIO_POWERING_LOAD");
    expect(problem).toMatchObject({ severity: "WARNING", netId: "net-1" });
    expect(problem?.message).toContain("GPIO");
    expect(problem?.affectedPins).toEqual(expect.arrayContaining([{ componentId: "esp", pinId: "GPIO" }, { componentId: "module", pinId: "VCC" }]));
  });

  it("工程建议：真正的电源输出给电源输入供电时不报「由 GPIO 供电」（防误报）", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("module", [pin("VCC", { role: "POWER_INPUT" })]));
    project = addWire(project, wire("w", "supply", "5V", "module", "VCC"));
    expect(runErc(project).problems.some((p) => p.rule === "GPIO_POWERING_LOAD")).toBe(false);
  });

  it("工程建议：两个同电压电源输出并联时报告「电源输出并联」（优化建议），不报电源冲突", () => {
    let project = withParts(component("a", [pin("OUT", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("b", [pin("OUT", { role: "POWER_OUTPUT", outputVoltage: 5 })]));
    project = addWire(project, wire("w", "a", "OUT", "b", "OUT"));
    const problems = runErc(project).problems;
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "PARALLEL_POWER_OUTPUTS", severity: "SUGGESTION", netId: "net-1" })]));
    expect(problems.some((p) => p.rule === "POWER_CONFLICT")).toBe(false);
  });

  it("工程建议：两个不同电压电源输出只报「电源冲突」，不报并联建议（防重复报）", () => {
    let project = withParts(component("a", [pin("OUT", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("b", [pin("OUT", { role: "POWER_OUTPUT", outputVoltage: 3.3 })]));
    project = addWire(project, wire("w", "a", "OUT", "b", "OUT"));
    const problems = runErc(project).problems;
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "POWER_CONFLICT" })]));
    expect(problems.some((p) => p.rule === "PARALLEL_POWER_OUTPUTS")).toBe(false);
  });

  it("工程建议：电源输出引脚没填电压时不给并联建议（缺资料不提建议）", () => {
    let project = withParts(component("a", [pin("OUT", { role: "POWER_OUTPUT" })]), component("b", [pin("OUT", { role: "POWER_OUTPUT" })]));
    project = addWire(project, wire("w", "a", "OUT", "b", "OUT"));
    expect(runErc(project).problems.some((p) => p.rule === "PARALLEL_POWER_OUTPUTS")).toBe(false);
  });

  it("每条问题都带「原因 / 可能后果 / 处理方法」三段文案", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("ground", [pin("GND", { role: "GND" })]));
    project = addWire(project, wire("w", "supply", "5V", "ground", "GND"));
    const problems = runErc(project).problems;
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.message.length).toBeGreaterThan(0);
      expect(problem.consequence.length).toBeGreaterThan(0);
      expect(problem.handling.length).toBeGreaterThan(0);
    }
  });

  it("连接检查：端点元件已不存在时报告「悬空线」", () => {
    // addWire / deserializeProject 都会挡掉这类坏数据；它真正能出现的地方是「编辑元件定义时删掉了引脚」，
    // 因为 applyDefinitionToInstances 只重建实例引脚、不动连线。所以这里直接构造项目来复现该状态。
    const project: Project = { ...withParts(component("a", [pin("P")])), wires: [wire("w", "a", "P", "ghost", "P")] };
    const dangling = runErc(project).problems.find((problem) => problem.rule === "DANGLING_WIRE");
    expect(dangling).toMatchObject({ severity: "ERROR" });
    expect(dangling?.consequence).toBeTruthy();
    expect(dangling?.handling).toBeTruthy();
  });

  it("连接检查：元件在但引脚不存在时报告「引脚不存在」", () => {
    const project: Project = { ...withParts(component("a", [pin("P")]), component("b", [pin("Q")])), wires: [wire("w", "a", "P", "b", "GONE")] };
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "MISSING_PIN", severity: "ERROR" })]));
  });

  it("连接检查：同一对引脚被重复连接时报告「重复连接」（优化建议）", () => {
    const project: Project = { ...withParts(component("a", [pin("P")]), component("b", [pin("Q")])), wires: [wire("w1", "a", "P", "b", "Q"), wire("w2", "a", "P", "b", "Q")] };
    expect(runErc(project).problems).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "DUPLICATE_CONNECTION", severity: "SUGGESTION" })]));
  });

  it("待确认：电压或电流无法确定的网络会被显式列出，而不是静默", () => {
    let project = withParts(component("supply", [pin("5V", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("input", [pin("IN", { role: "INPUT" })]));
    project = addWire(project, wire("w", "supply", "5V", "input", "IN"));
    const unconfirmed = runErc(project).problems.filter((problem) => problem.rule === "UNCONFIRMED_NET");
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0]).toMatchObject({ severity: "UNCONFIRMED", netId: "net-1" });
  });

  it("检查范围：逐字对照图3 五层，且「没做的层」必须写明不在范围，不得含糊", () => {
    expect(ERC_COVERAGE.map((entry) => entry.layer)).toEqual(["连接检查", "电气规则检查", "系统预算检查", "工程建议", "仿真分析"]);
    for (const entry of ERC_COVERAGE) {
      expect(COVERAGE_LABELS[entry.status]).toBeTruthy();
      expect(entry.note.length).toBeGreaterThan(0);
    }
    // 这三层当前的能力各不相同：「系统预算检查」「仿真分析」确实没实现，声明成「已检查」就是在骗用户；
    // 「工程建议」只实现了少量基于已确认引脚角色的条件提醒，因此是「部分检查」。改实现前必须同步改这里。
    const statusOf = (layer: string) => ERC_COVERAGE.find((entry) => entry.layer === layer)?.status;
    expect(statusOf("系统预算检查")).toBe("OUT_OF_SCOPE");
    expect(statusOf("工程建议")).toBe("PARTIAL");
    expect(statusOf("仿真分析")).toBe("OUT_OF_SCOPE");
    // 「部分检查」必须写明缺什么，否则用户会以为这一层已经查全。
    expect(statusOf("电气规则检查")).toBe("PARTIAL");
    expect(ERC_COVERAGE.find((entry) => entry.layer === "电气规则检查")?.note).toContain("信号电平不匹配");
  });
});

describe("project commands", () => {
  it("cascades wires on component deletion without corrupting surviving data", () => {
    let project = withParts(component("a", [pin("P")]), component("b", [pin("P")]));
    project = addWire(project, wire("w", "a", "P", "b", "P"));
    const result = deleteComponent(project, "a");
    expect(result.components.map((c) => c.id)).toEqual(["b"]);
    expect(result.wires).toEqual([]);
  });
});

describe("electrical net classification", () => {
  it("classifies power, ground, signal, and unknown from pin metadata instead of wire color", () => {
    let project = withParts(
      component("power", [pin("OUT", { role: "POWER_OUTPUT", outputVoltage: 5 })]), component("vin", [pin("IN", { role: "POWER_INPUT" })]),
      component("ground", [pin("G", { role: "GND" })]), component("passive", [pin("P", { role: "PASSIVE" })]),
      component("gpio", [pin("GPIO", { role: "GPIO" })]), component("input", [pin("IN", { role: "INPUT" })]),
      component("u1", [pin("P", { role: "PASSIVE" })]), component("u2", [pin("P", { role: "PASSIVE" })]),
    );
    project = addWire(project, wire("power", "power", "OUT", "vin", "IN"));
    project = addWire(project, wire("ground", "ground", "G", "passive", "P"));
    project = addWire(project, wire("signal", "gpio", "GPIO", "input", "IN"));
    project = addWire(project, wire("unknown", "u1", "P", "u2", "P"));
    expect(buildElectricalNets(project).map((net) => net.kind).sort()).toEqual(["GROUND", "POWER", "SIGNAL", "UNKNOWN"]);
  });
});
