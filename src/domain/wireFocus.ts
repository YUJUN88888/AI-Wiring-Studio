import { pinKey } from "./net";
import type { ErcResult, PinRef, Project, WirePurpose } from "./types";

// WirePurpose 现在声明在 types.ts（Wire 需要引用它）；这里转出，保持既有 import 路径不变。
export type { WirePurpose };

/**
 * 线路「用途」与画布「聚焦态」的确定性判据。
 *
 * 全部是纯函数，且只使用**已有数据**：
 * - 用途直接照抄 `net.ts` 里已经算好的电气网络分类（`classifyNet` → `NetKind`），
 *   绝不按引脚名相同、电压相同之类的线索猜测，也算不出就明确给「未分类」。
 * - 筛选与淡化只是显示态，**一个字节都不写回项目文件**，所以不可能改变任何电气连接。
 */

export const WIRE_PURPOSE_LABELS: Record<WirePurpose, string> = {
  power: "电源",
  ground: "地线",
  signal: "信号",
  unclassified: "未分类",
};

/** 线路用途的固定顺序，供右键菜单与筛选条共用同一套次序。 */
export const WIRE_PURPOSE_ORDER: readonly WirePurpose[] = ["power", "ground", "signal", "unclassified"];

/** 需求里列出的筛选维度，外加批次3 新增的「未分类」。 */
export type WireFilter = "all" | "power" | "ground" | "signal" | "unclassified" | "module" | "problems";

export const WIRE_FILTER_ORDER: readonly WireFilter[] = ["all", "power", "ground", "signal", "unclassified", "module", "problems"];

export const WIRE_FILTER_LABELS: Record<WireFilter, string> = {
  all: "全部",
  power: "电源",
  ground: "地线",
  signal: "信号",
  unclassified: "未分类",
  module: "当前模块相关",
  problems: "问题线路",
};

/**
 * 每条连线的用途。
 * 判据有两条，且用户手工指定优先：
 * 1. `Wire.purpose`（用户在右键菜单里设过的用途）——直接采用；
 * 2. 否则照抄 ERC 已算出的电气网络分类，同一网络里的所有连线共用同一个用途。
 * 没有进入任何网络、也没手工指定的连线（悬空、端点指向不存在的元件/引脚）显式记为「未分类」，不遗漏也不猜测。
 */
export function wirePurposes(project: Project, erc: ErcResult): Map<string, WirePurpose> {
  const purposes = new Map<string, WirePurpose>();
  for (const net of erc.nets) {
    const purpose: WirePurpose =
      net.kind === "POWER" ? "power" : net.kind === "GROUND" ? "ground" : net.kind === "SIGNAL" ? "signal" : "unclassified";
    for (const wireId of net.wireIds) purposes.set(wireId, purpose);
  }
  for (const wire of project.wires) {
    // 手工指定的用途优先；未指定且网络判不出来时才落到「未分类」。
    if (wire.purpose) purposes.set(wire.id, wire.purpose);
    else if (!purposes.has(wire.id)) purposes.set(wire.id, "unclassified");
  }
  return purposes;
}

/**
 * 被 ERC 判为问题的连线。
 * 推导路径是确定的：问题自带的 `netId`／受影响引脚所在的网络 → 该网络的全部连线；
 * 悬空线与引脚不存在这类问题不进网络，则直接取问题证据里的 `wireId`/`wireIds`。
 */
export function problemWireIds(erc: ErcResult): Set<string> {
  const netByPin = new Map<string, string>();
  for (const net of erc.nets) for (const ref of net.pins) netByPin.set(pinKey(ref), net.id);

  const hitNets = new Set<string>();
  const wires = new Set<string>();
  for (const problem of erc.problems) {
    // 「待确认（缺参数）」刻意排除：只要电流算不出来，**每一条线**所在网络都会被标成待确认，
    // 把它算进来会让「问题线路」筛选命中 100% 的连线，等于没有筛选。
    // 它仍然完整地留在右侧检查器和底部摘要里，只是不参与"哪些线值得单独挑出来看"。
    if (problem.rule === "UNCONFIRMED_NET") continue;
    if (problem.netId) hitNets.add(problem.netId);
    for (const ref of problem.affectedPins) {
      const netId = netByPin.get(pinKey(ref));
      if (netId) hitNets.add(netId);
    }
    const single = problem.evidence.wireId;
    if (typeof single === "string") wires.add(single);
    const many = problem.evidence.wireIds;
    if (Array.isArray(many)) for (const id of many) if (typeof id === "string") wires.add(id);
  }
  for (const net of erc.nets) if (hitNets.has(net.id)) for (const wireId of net.wireIds) wires.add(wireId);
  return wires;
}

export type WireFocusView = {
  /** 需要淡化的连线：既不在当前筛选内，也不在聚焦范围内。 */
  mutedWires: ReadonlySet<string>;
  /** 需要保持满强度（甚至加光晕）的连线：与聚焦元件相关，或就是当前筛选选中的那些。 */
  strongWires: ReadonlySet<string>;
  /** 需要淡化的元件。 */
  mutedComponents: ReadonlySet<string>;
  /** 需要强调的元件：当前悬停或选中的那些。 */
  strongComponents: ReadonlySet<string>;
  /** 当前筛选实际命中的连线数（用于提示「没有匹配的线路」）。 */
  matchedWires: number;
  /** 是否存在聚焦（悬停元件／选中元件／点亮的引脚网络／选中的连线）。 */
  focusActive: boolean;
  /** 「当前模块相关」在没有聚焦目标时会退回「全部」，这里把它告诉界面以便如实提示。 */
  moduleFilterNeedsFocus: boolean;
};

export type WireFocusInput = {
  wires: readonly { id: string; source: PinRef; target: PinRef }[];
  components: readonly { id: string }[];
  purposes: ReadonlyMap<string, WirePurpose>;
  problemWires: ReadonlySet<string>;
  /** 悬停 + 选中的元件 id。 */
  focused: ReadonlySet<string>;
  /** A14：点击引脚后点亮的整张网络里的连线。 */
  netWires: ReadonlySet<string>;
  selectedWire: string | null;
  filter: WireFilter;
};

/**
 * 把「聚焦目标 + 筛选」折算成两组淡化集合与两组强调集合。
 *
 * 规则（确定性，且与"用户看到的是否真的变淡"对齐）：
 * 1. 筛选决定"哪些线还有资格显示"；不符合筛选的线一律淡化。
 * 2. 有聚焦目标时，与聚焦无关的线也淡化——这就是"选中模块后其他线路退到背景"。
 * 3. 「当前模块相关」若当前没有任何聚焦目标，退回「全部」并提示用户先选模块；
 *    否则画布会整片变灰，看起来像坏了。
 */
export function computeWireFocus(input: WireFocusInput): WireFocusView {
  const { wires, components, purposes, problemWires, focused, netWires, selectedWire } = input;
  const moduleFilterNeedsFocus = input.filter === "module" && focused.size === 0;
  const filter: WireFilter = moduleFilterNeedsFocus ? "all" : input.filter;

  const matches = (wire: WireFocusInput["wires"][number]): boolean => {
    switch (filter) {
      case "all": return true;
      case "power": return purposes.get(wire.id) === "power";
      case "ground": return purposes.get(wire.id) === "ground";
      case "signal": return purposes.get(wire.id) === "signal";
      case "unclassified": return purposes.get(wire.id) === "unclassified";
      case "module": return focused.has(wire.source.componentId) || focused.has(wire.target.componentId);
      case "problems": return problemWires.has(wire.id);
    }
  };
  const touchesFocus = (wire: WireFocusInput["wires"][number]): boolean =>
    focused.has(wire.source.componentId) || focused.has(wire.target.componentId);

  const focusActive = focused.size > 0 || netWires.size > 0 || selectedWire !== null;
  const mutedWires = new Set<string>();
  const strongWires = new Set<string>();
  // 保留满强度的元件：聚焦目标本身，加上所有"没被淡化的连线"的两端。
  const keepComponents = new Set<string>(focused);
  let matchedWires = 0;

  for (const wire of wires) {
    const eligible = matches(wire);
    if (eligible) matchedWires += 1;
    const related = touchesFocus(wire) || netWires.has(wire.id) || wire.id === selectedWire;
    if (!eligible || (focusActive && !related)) {
      mutedWires.add(wire.id);
      continue;
    }
    if (related || filter !== "all") strongWires.add(wire.id);
    keepComponents.add(wire.source.componentId);
    keepComponents.add(wire.target.componentId);
  }

  const mutedComponents = new Set<string>();
  if (focusActive || filter !== "all") {
    for (const component of components) if (!keepComponents.has(component.id)) mutedComponents.add(component.id);
  }

  return { mutedWires, strongWires, mutedComponents, strongComponents: new Set(focused), matchedWires, focusActive, moduleFilterNeedsFocus };
}

/**
 * 十六进制颜色是否偏暗。
 * 深色画布上这类连线几乎看不见（默认地线色 `#20242a` 就是如此），所以渲染时给它们加一层浅色衬底
 * ——只是显示，不改连线自己的颜色。
 */
export function isDarkColor(color: string, threshold = 0.16): boolean {
  const raw = color.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return false;
  const channel = (index: number) => parseInt(full.slice(index, index + 2), 16) / 255;
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  const [r, g, b] = [channel(0), channel(2), channel(4)];
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) < threshold;
}