import { pinKey } from "./net";
import type { ComponentInstance, Project, Wire } from "./types";

/**
 * A8【更新接线代码并对比】的差异计算、预览状态与确定性合并规则。
 *
 * 匹配规则（确定性，不猜）：
 * - **元件按实例 ID 匹配**。接线代码里的实例 ID 由写代码的人给定（如 `u1`、`r1`），
 *   重新导入同一份代码时它不变，因此"同一个 ID ＝ 同一个元件"是可靠判据。
 * - **连线按两端引脚匹配**（无向）。接线代码语法里根本没有"连线 ID"，
 *   解析器按出现顺序生成的 `w1`、`w2` 只是内部序号：一旦在代码中间插入一根线，后面所有序号都会平移。
 *   用序号比对会把"插入一根线"误报成"后面每根线都被改了"，所以判据取两端引脚本身。
 * - 元件内容比较**不含位置**：`at x,y` 只影响摆放，移动一个元件不算"内容被改"。
 *   因此应用更新时会保留画布上用户摆好的位置，不会被代码里的坐标覆盖回原位。
 */

/** 连线的差异身份：两端引脚键排序后拼接。全项目唯一（同一对引脚不允许出现两根线）。 */
export function wireEndpointKey(wire: Pick<Wire, "source" | "target">): string {
  return [pinKey(wire.source), pinKey(wire.target)].sort().join("|");
}

/** 单条元件/连线在预览里的状态：新增 / 将被删除 / 将被改写。 */
export type UpdatePreviewState = "added" | "removed" | "changed";

/**
 * 画布差异预览态。
 * 元件按实例 ID 索引；连线按端点键（`wireEndpointKey`）索引——
 * 两端对得上就是同一根线，与"连线在代码里的先后顺序"无关。
 */
export interface WiringPreview {
  components: ReadonlyMap<string, UpdatePreviewState>;
  wires: ReadonlyMap<string, UpdatePreviewState>;
}

export interface ProjectUpdateDiff {
  /** 代码里有、画布上没有：将被新增。 */
  addedComponents: string[];
  /** 画布上有、代码里没有：将被删除。 */
  removedComponents: string[];
  /** 同一个实例 ID，但定义 / 显示名 / 引脚不同：将被改写。 */
  changedComponents: string[];
  /** 以下三项是**端点键**（见 `wireEndpointKey`），不是内部连线序号。 */
  addedWires: string[];
  removedWires: string[];
  changedWires: string[];
}

/** 元件"内容"是否相同：位置与运行时字段不算，只看定义、显示名、引脚快照与电压变换。 */
function sameComponentContent(a: ComponentInstance, b: ComponentInstance): boolean {
  return a.definitionId === b.definitionId
    && a.displayName === b.displayName
    && JSON.stringify(a.pins) === JSON.stringify(b.pins)
    && JSON.stringify(a.voltageTransforms ?? null) === JSON.stringify(b.voltageTransforms ?? null);
}

/** 只做比较，不改动任何数据。每个数组都按"各自项目里的原始顺序"排列。 */
export function diffProjects(current: Project, incoming: Project): ProjectUpdateDiff {
  const currentComponents = new Map(current.components.map((component) => [component.id, component]));
  const incomingComponents = new Map(incoming.components.map((component) => [component.id, component]));
  const currentWires = new Map(current.wires.map((wire) => [wireEndpointKey(wire), wire]));
  const incomingWires = new Map(incoming.wires.map((wire) => [wireEndpointKey(wire), wire]));

  const diff: ProjectUpdateDiff = { addedComponents: [], removedComponents: [], changedComponents: [], addedWires: [], removedWires: [], changedWires: [] };
  for (const component of incoming.components) {
    const existing = currentComponents.get(component.id);
    if (!existing) diff.addedComponents.push(component.id);
    else if (!sameComponentContent(existing, component)) diff.changedComponents.push(component.id);
  }
  for (const component of current.components) if (!incomingComponents.has(component.id)) diff.removedComponents.push(component.id);
  for (const wire of incoming.wires) {
    const key = wireEndpointKey(wire);
    const existing = currentWires.get(key);
    if (!existing) diff.addedWires.push(key);
    else if (existing.color !== wire.color) diff.changedWires.push(key);
  }
  for (const wire of current.wires) {
    const key = wireEndpointKey(wire);
    if (!incomingWires.has(key)) diff.removedWires.push(key);
  }
  return diff;
}

export function isProjectUpdateEmpty(diff: ProjectUpdateDiff): boolean {
  return diff.addedComponents.length === 0 && diff.removedComponents.length === 0 && diff.changedComponents.length === 0
    && diff.addedWires.length === 0 && diff.removedWires.length === 0 && diff.changedWires.length === 0;
}

/** 把差异整理成"画布按 id / 端点键查状态"的映射，供 PartNode 与 RoutedEdge 直接读。 */
export function buildUpdatePreview(diff: ProjectUpdateDiff): WiringPreview {
  const components = new Map<string, UpdatePreviewState>();
  const wires = new Map<string, UpdatePreviewState>();
  for (const id of diff.addedComponents) components.set(id, "added");
  for (const id of diff.changedComponents) components.set(id, "changed");
  for (const id of diff.removedComponents) components.set(id, "removed");
  for (const key of diff.addedWires) wires.set(key, "added");
  for (const key of diff.changedWires) wires.set(key, "changed");
  for (const key of diff.removedWires) wires.set(key, "removed");
  return { components, wires };
}

/**
 * 差异预览用的"并集"项目：代码里的内容 + 画布上将被删除的内容。
 * 画布按它渲染，于是"新增的"能看得见轮廓、"将被删除的"能灰化显示。
 * 这只用于展示，**不写进项目文件**，也不改动 `project` 状态。
 * 连线去重按端点键（同一对引脚不可能画两根线）；追加进来的旧连线 id 加 `-removed` 后缀，
 * 因为两个项目各自从 `w1` 开始编号、直接拼接会产生重复 id。
 */
export function previewProject(current: Project, incoming: Project): Project {
  const incomingComponentIds = new Set(incoming.components.map((component) => component.id));
  const incomingWireKeys = new Set(incoming.wires.map(wireEndpointKey));
  return {
    ...current,
    components: [...incoming.components, ...current.components.filter((component) => !incomingComponentIds.has(component.id))],
    wires: [
      ...incoming.wires,
      ...current.wires.filter((wire) => !incomingWireKeys.has(wireEndpointKey(wire))).map((wire) => ({ ...wire, id: `${wire.id}-removed` })),
    ],
  };
}

/**
 * 应用更新（确定性，不猜）：
 * - 元件：以代码里的定义/引脚为准，但**保留画布上用户已经摆好的位置与朝向**（位置不是"内容"）。
 * - 连线：两端引脚与颜色以代码为准；两端没变的那根线保留用户固定过的折线途经点与「已接好」标记。
 * - 画布上代码里没提到的元件与连线会被删除——这正是"更新"的含义，预览里它们已用灰色标出。
 */
export function applyProjectUpdate(current: Project, incoming: Project): Project {
  const currentComponents = new Map(current.components.map((component) => [component.id, component]));
  const currentWires = new Map(current.wires.map((wire) => [wireEndpointKey(wire), wire]));
  return {
    ...current,
    components: incoming.components.map((component) => {
      const existing = currentComponents.get(component.id);
      // 代码里没有"成组"这个概念，所以组标记属于画布侧状态：与位置、旋转一样保留用户的，不因一次更新丢失。
      return existing ? { ...component, position: existing.position, rotation: existing.rotation, ...(existing.groupId ? { groupId: existing.groupId } : {}) } : component;
    }),
    wires: incoming.wires.map((wire) => {
      const existing = currentWires.get(wireEndpointKey(wire));
      if (!existing) return wire;
      // 电气上还是同一根线（哪怕改了颜色），用户在这根线上的手工状态必须留下。
      const carried: Wire = { ...wire };
      if (existing.waypoints) carried.waypoints = existing.waypoints;
      if (existing.manuallyWired) carried.manuallyWired = true;
      return carried;
    }),
  };
}