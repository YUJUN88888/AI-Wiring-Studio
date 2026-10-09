import { buildElectricalNets, findPin, pinKey } from "./net";
import type { CurrentState, ErcProblem, ErcResult, PinRef, Project, Severity, VoltageState } from "./types";

const refText = (r: PinRef) => `${r.componentId}.${r.pinId}`;
type VoltageSource = { ref: PinRef; voltage: number };

/** 图3 的四级结果分类：明确错误 / 风险警告 / 待确认 / 优化建议。 */
export type ProblemGrade = "DEFINITE" | "WARNING" | "UNCONFIRMED" | "SUGGESTION";
export const GRADE_LABELS: Record<ProblemGrade, string> = {
  DEFINITE: "明确错误",
  WARNING: "风险警告",
  UNCONFIRMED: "待确认",
  SUGGESTION: "优化建议",
};
export const GRADE_ORDER: ProblemGrade[] = ["DEFINITE", "WARNING", "UNCONFIRMED", "SUGGESTION"];
/** 由严重度归到四级分类：CRITICAL/ERROR 都算「明确错误」。 */
export function gradeOfSeverity(severity: Severity): ProblemGrade {
  if (severity === "CRITICAL" || severity === "ERROR") return "DEFINITE";
  if (severity === "WARNING") return "WARNING";
  if (severity === "UNCONFIRMED") return "UNCONFIRMED";
  return "SUGGESTION";
}

/**
 * A15 检查范围：图3 要求区分「已检查 / 估算 / 无法判断」，所以把五层能力如实声明出来交给界面展示。
 * 这块是常量、与项目内容无关（因此不放进 runErc 的返回值，免得每次检查都重算一遍），
 * 目的是让软件**绝不暗示自己做过它没做的事**——尤其是电流预算与电路仿真。
 */
export type CoverageStatus = "COVERED" | "PARTIAL" | "OUT_OF_SCOPE";
export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  COVERED: "已检查",
  PARTIAL: "部分检查",
  OUT_OF_SCOPE: "不在当前范围",
};
export interface CoverageEntry {
  /** 逐字沿用图3 的层级名，便于用户对照。 */
  layer: string;
  status: CoverageStatus;
  note: string;
}
export const ERC_COVERAGE: readonly CoverageEntry[] = [
  { layer: "连接检查", status: "COVERED", note: "悬空线、引脚不存在、重复连接、必接输入未连接。" },
  { layer: "电气规则检查", status: "PARTIAL", note: "短路、电源冲突、过压、输出冲突、极性错误已检查；信号电平不匹配已实现，但只在引脚填了输入电平范围时判断，未填则不判断。" },
  { layer: "系统预算检查", status: "OUT_OF_SCOPE", note: "缺少负载模型，无法计算电流与供电容量；算不出的项一律显示「未知」，不猜测。" },
  { layer: "工程建议", status: "PARTIAL", note: "已实现少量只依据已确认引脚角色的条件提醒（例如电源输入由 GPIO 供电、多个电源输出并联）；不引入通用规则库，资料不足时不给建议。" },
  { layer: "仿真分析", status: "OUT_OF_SCOPE", note: "本软件只做规则检查，不做电路仿真，也不会给出仿真结论。" },
];

/** Deterministic ERC. It only propagates voltage through explicitly modeled transforms. */
export function runErc(project: Project): ErcResult {
  const nets = buildElectricalNets(project);
  const netByPin = new Map<string, string>();
  for (const net of nets) for (const ref of net.pins) netByPin.set(pinKey(ref), net.id);
  const sourcesByNet = new Map<string, VoltageSource[]>();
  const addSource = (netId: string, source: VoltageSource) => {
    const current = sourcesByNet.get(netId) ?? [];
    if (current.some((item) => item.voltage === source.voltage && item.ref.componentId === source.ref.componentId && item.ref.pinId === source.ref.pinId)) return false;
    sourcesByNet.set(netId, [...current, source]);
    return true;
  };

  for (const net of nets) for (const ref of net.pins) {
    const pin = findPin(project, ref)!;
    const voltage = pin.outputVoltage ?? (pin.role === "GND" ? 0 : undefined);
    if (voltage !== undefined && (pin.role === "POWER_OUTPUT" || pin.role === "GND")) addSource(net.id, { ref, voltage });
  }

  // A transform is one-way and only activates when its input rail is deterministically known.
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of project.components) for (const transform of component.voltageTransforms ?? []) {
      const inputRef = { componentId: component.id, pinId: transform.inputPinId };
      const outputRef = { componentId: component.id, pinId: transform.outputPinId };
      const inputNetId = netByPin.get(pinKey(inputRef));
      const outputNetId = netByPin.get(pinKey(outputRef));
      if (!inputNetId || !outputNetId) continue;
      const values = [...new Set((sourcesByNet.get(inputNetId) ?? []).map((source) => source.voltage))];
      const inputVoltage = values.length === 1 ? values[0] : undefined;
      const range = transform.inputVoltageRange;
      if (inputVoltage !== undefined && inputVoltage >= range.min - 0.001 && inputVoltage <= range.max + 0.001) changed = addSource(outputNetId, { ref: outputRef, voltage: transform.outputVoltage }) || changed;
    }
  }

  const problems: ErcProblem[] = [];
  const voltages: Record<string, VoltageState> = {};
  const currents: Record<string, CurrentState> = {};
  for (const net of nets) {
    const entries = net.pins.map((ref) => ({ ref, pin: findPin(project, ref)! }));
    const knownSources = sourcesByNet.get(net.id) ?? [];
    const unique = [...new Set(knownSources.map((source) => source.voltage))];
    const grounds = entries.filter(({ pin }) => pin.role === "GND");
    const positiveSources = knownSources.filter((source) => source.voltage > 0);
    if (grounds.length && positiveSources.length) problems.push(problem("SHORT_CIRCUIT", "CRITICAL", "已知正电源输出与地线直接相连。", "正电源被直接短路到地，通电时可能烧毁电源、连线或元件。", "立即断开该网络上的电源输出与地线，核对连线是否接错。", net.id, [...grounds.map((x) => x.ref), ...positiveSources.map((x) => x.ref)], { positiveVoltages: positiveSources.map((x) => x.voltage) }));
    if (unique.length > 1) problems.push(problem("POWER_CONFLICT", "CRITICAL", "不同电压的已知电源共用了同一个连线网络。", "较高电压可能倒灌进较低电压的电源，损坏元件。", "拆开这些电源，让每个已知电压各自独立成网。", net.id, knownSources.map((x) => x.ref), { voltages: unique }));
    voltages[net.id] = unique.length === 1 ? { kind: "Known", value: unique[0], sourcePins: knownSources.map((x) => x.ref) } : unique.length > 1 ? { kind: "Conflict", sourcePins: knownSources.map((x) => x.ref) } : { kind: "Unknown", sourcePins: [] };
    // No current is claimed until a complete load model exists; wire connectivity alone is insufficient.
    currents[net.id] = { kind: "Unknown", unit: "A", reason: "该网络缺少完整负载模型，无法计算电流。" };
    if (unique.length === 1) for (const { ref, pin } of entries) if (pin.maxVoltage !== undefined && unique[0] > pin.maxVoltage + 0.001) problems.push(problem("OVERVOLTAGE", "ERROR", `${refText(ref)} 最高允许 ${pin.maxVoltage}V，但该网络已知为 ${unique[0]}V。`, `${refText(ref)} 可能因超过最高允许电压而损坏。`, `在 ${refText(ref)} 前加入合适的电平转换或限压，或改用不超过 ${pin.maxVoltage}V 的电源。`, net.id, [ref, ...knownSources.map((x) => x.ref)], { detectedVoltage: unique[0], maxVoltage: pin.maxVoltage }));
    const pushPull = entries.filter(({ pin }) => pin.driveMode === "push-pull");
    if (pushPull.length > 1) problems.push(problem("OUTPUT_CONFLICT", "ERROR", "多个已确认的推挽输出被直接相连。", "两个输出互相驱动时可能产生大电流，损坏引脚。", "让其中一个改为开漏输出，或在两者之间加入限流/隔离；确认是否应共用同一网络。", net.id, pushPull.map((x) => x.ref), {}));
    // 工程建议：只依据已确认的引脚角色做条件式提醒，资料不足一律不提建议；每个网络只报一次。
    const powerInputs = entries.filter(({ pin }) => pin.role === "POWER_INPUT");
    const drivers = entries.filter(({ pin }) => pin.role === "GPIO" || pin.role === "OUTPUT");
    const powerOutputs = entries.filter(({ pin }) => pin.role === "POWER_OUTPUT");
    if (powerInputs.length && drivers.length && !powerOutputs.length) {
      problems.push(problem("GPIO_POWERING_LOAD", "WARNING", "该网络上的电源输入引脚由 GPIO/普通输出引脚供电。", "GPIO 的驱动能力通常不足以给模块供电，可能导致模块工作不稳定或根本不工作。", "确认该模块的工作电流是否在这条 GPIO 的驱动能力之内；若不然，改由真正的电源输出引脚供电（可在元件编辑器里填写引脚的额定电流后再重新检查）。", net.id, [...powerInputs, ...drivers].map((x) => x.ref), {}));
    }
    if (powerOutputs.length >= 2) {
      const outputVoltages = powerOutputs.map(({ pin }) => pin.outputVoltage);
      const voltage = outputVoltages[0];
      // 电压不全有值或彼此不等（后者由 POWER_CONFLICT 报告）时跳过，绝不猜测。
      if (voltage !== undefined && outputVoltages.every((value) => value === voltage)) {
        problems.push(problem("PARALLEL_POWER_OUTPUTS", "SUGGESTION", `该网络上有 ${powerOutputs.length} 个电源输出引脚并联（均为 ${voltage}V）。`, "并联的电源之间可能存在倒灌或互相拉扯。", "确认这些电源输出是否允许并联；若不允许，请把它们分到不同的网络上。", net.id, powerOutputs.map((x) => x.ref), { voltages: outputVoltages }));
      }
    }
    // 待确认：电压/电流只要有一项无法确定，就显式列入「待确认」，而不是静默当作安全。
    const voltageUnknown = voltages[net.id].kind !== "Known";
    const currentUnknown = currents[net.id].kind === "Unknown";
    if (voltageUnknown || currentUnknown) {
      const unknown = [voltageUnknown ? "电压" : null, currentUnknown ? "电流" : null].filter(Boolean).join("与");
      problems.push(problem("UNCONFIRMED_NET", "UNCONFIRMED", `网络 ${net.id} 的${unknown}无法确定。`, "缺少已确认的参数，无法判断该网络是否过压、短路或过流。", "补充已确认的电源来源（输出电压）与负载参数后再检查。", net.id, net.pins, { voltageState: voltages[net.id].kind, currentState: currents[net.id].kind }));
    }
  }

  for (const component of project.components) for (const pin of component.pins) {
    if (!pin.required) continue;
    const ref = { componentId: component.id, pinId: pin.id };
    if (!netByPin.has(pinKey(ref))) problems.push(problem("UNCONNECTED_REQUIRED_INPUT", "WARNING", `${refText(ref)} 被标为必须连接，但当前没有连线。`, "该输入悬空，电路可能无法工作或行为不确定。", `为 ${refText(ref)} 补上连线，或确认它是否真的必须连接。`, undefined, [ref], {}));
  }
  for (const component of project.components) {
    const positivePins = component.pins.filter((pin) => pin.polarity === "positive");
    const negativePins = component.pins.filter((pin) => pin.polarity === "negative");
    for (const positive of positivePins) for (const negative of negativePins) {
      const positiveRef = { componentId: component.id, pinId: positive.id };
      const negativeRef = { componentId: component.id, pinId: negative.id };
      const positiveVoltage = voltages[netByPin.get(pinKey(positiveRef)) ?? ""];
      const negativeVoltage = voltages[netByPin.get(pinKey(negativeRef)) ?? ""];
      if (positiveVoltage?.kind !== "Known" || negativeVoltage?.kind !== "Known" || positiveVoltage.value === undefined || negativeVoltage.value === undefined) continue;
      if (positiveVoltage.value + 0.001 < negativeVoltage.value) problems.push(problem("POLARITY_ERROR", "ERROR", `有极性元件的 ${refText(positiveRef)} 电位低于 ${refText(negativeRef)}。`, "有极性元件（如电解电容）反接可能损坏或爆裂。", `核对 ${refText(positiveRef)} 与 ${refText(negativeRef)} 的接线方向并交换。`, undefined, [positiveRef, negativeRef], { positiveVoltage: positiveVoltage.value, negativeVoltage: negativeVoltage.value }));
    }
  }

  // 电平匹配：只有引脚明确填了输入电平范围、且所在网络电压已确定时才判断；缺参数一律跳过。
  // 电压高于上限且同时超过该引脚的 maxVoltage 时交由 OVERVOLTAGE 报告，避免同一件事报两遍。
  for (const component of project.components) for (const pin of component.pins) {
    const range = pin.voltageRange;
    if (range === undefined) continue;
    const ref = { componentId: component.id, pinId: pin.id };
    const netId = netByPin.get(pinKey(ref));
    if (netId === undefined) continue;
    const state = voltages[netId];
    if (!state || state.kind !== "Known" || typeof state.value !== "number") continue;
    const value = state.value;
    const severity: Severity = pin.role === "POWER_INPUT" ? "ERROR" : "WARNING";
    const rangeText = `${range.min}~${range.max}V`;
    if (value < range.min - 1e-3) {
      problems.push(problem("LEVEL_MISMATCH", severity, `引脚 ${refText(ref)} 所在的网络已知为 ${value}V，低于该引脚可接受的输入电平下限 ${range.min}V。`, `输入电平低于可识别的下限，${refText(ref)} 可能无法识别该信号，电路不会按预期工作。`, `把该网络电压提高到 ${range.min}V 以上，或在 ${refText(ref)} 前加入电平转换。`, netId, [ref], { detectedVoltage: value, inputRange: rangeText }));
    } else if (value > range.max + 1e-3 && !(pin.maxVoltage !== undefined && value > pin.maxVoltage + 1e-3)) {
      problems.push(problem("LEVEL_MISMATCH", severity, `引脚 ${refText(ref)} 所在的网络已知为 ${value}V，高于该引脚可接受的输入电平上限 ${range.max}V。`, `输入电平高于可识别的上限，${refText(ref)} 可能无法正确识别，或长期过压而受损。`, `把该网络电压降到 ${range.max}V 以下，或在 ${refText(ref)} 前加入分压或电平转换。`, netId, [ref], { detectedVoltage: value, inputRange: rangeText }));
    }
  }

  // 连接检查（纯拓扑、确定性）：连线指向不存在的东西，或同一对引脚被重复连接。
  const pairWires = new Map<string, { refs: [PinRef, PinRef]; wireIds: string[] }>();
  for (const wire of project.wires) {
    const missingComponents = [wire.source, wire.target].filter((ref) => !project.components.some((component) => component.id === ref.componentId));
    if (missingComponents.length) {
      problems.push(problem("DANGLING_WIRE", "ERROR", `连线 ${wire.id} 的端点指向已不存在的元件。`, "这条线在画布上悬空，不参与任何真实连接。", "删除这条连线，或把端点重新接到存在的元件上。", undefined, [wire.source, wire.target], { wireId: wire.id }));
      continue;
    }
    const missingPins = [wire.source, wire.target].filter((ref) => !findPin(project, ref));
    if (missingPins.length) {
      problems.push(problem("MISSING_PIN", "ERROR", `连线 ${wire.id} 指向的引脚 ${missingPins.map(refText).join("、")} 在元件中不存在。`, "这条线接不到实际引脚，电气上等于断开。", "删除这条连线，或在元件编辑器里补回对应引脚。", undefined, missingPins, { wireId: wire.id }));
      continue;
    }
    const pair = [pinKey(wire.source), pinKey(wire.target)].sort().join("|");
    const entry = pairWires.get(pair) ?? { refs: [wire.source, wire.target] as [PinRef, PinRef], wireIds: [] };
    entry.wireIds.push(wire.id);
    pairWires.set(pair, entry);
  }
  for (const { refs, wireIds } of pairWires.values()) {
    if (wireIds.length < 2) continue;
    problems.push(problem("DUPLICATE_CONNECTION", "SUGGESTION", `同一对引脚（${refText(refs[0])} ↔ ${refText(refs[1])}）之间有 ${wireIds.length} 条重复连线。`, "重复连线不改变电气连接，但会让画布更杂乱、更难维护。", "删除多余的连线，只保留一条。", undefined, refs, { wireIds }));
  }
  return { nets, voltages, currents, problems };
}

function problem(rule: ErcProblem["rule"], severity: ErcProblem["severity"], message: string, consequence: string, handling: string, netId: string | undefined, affectedPins: PinRef[], evidence: Record<string, unknown>): ErcProblem {
  return { id: `${rule}:${netId ?? affectedPins.map(refText).join(",")}`, rule, severity, message, consequence, handling, netId, affectedPins, evidence };
}