import { findPin } from "./net";
import { CURRENT_SCHEMA_VERSION, type ComponentInstance, type FunctionZoneId, type Project, type RoutePoint, type Wire } from "./types";

export function createProject(id: string, name = "未命名项目"): Project {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, id, name, canvas: { x: 0, y: 0, zoom: 1, gridSize: 20 }, components: [], wires: [] };
}
export function addComponent(project: Project, component: ComponentInstance): Project {
  if (project.components.some((item) => item.id === component.id)) throw new Error(`组件 ID 重复：${component.id}`);
  return { ...project, components: [...project.components, structuredClone(component)] };
}
export function deleteComponent(project: Project, componentId: string): Project {
  if (!project.components.some((item) => item.id === componentId)) return project;
  const remaining = { ...project, components: project.components.filter((item) => item.id !== componentId), wires: project.wires.filter((wire) => wire.source.componentId !== componentId && wire.target.componentId !== componentId) };
  // A11：组少了一个成员后可能只剩一个，那就没"组"可言了，顺手解除，不留"1 人组"。
  return clearSingletonGroups(remaining);
}
export function addWire(project: Project, wire: Wire): Project {
  if (wire.source.componentId === wire.target.componentId && wire.source.pinId === wire.target.pinId) throw new Error("连线不能把引脚连接到自身");
  if (!findPin(project, wire.source) || !findPin(project, wire.target)) throw new Error("连线端点不存在");
  if (project.wires.some((item) => item.id === wire.id)) throw new Error(`连线 ID 重复：${wire.id}`);
  const duplicate = project.wires.some((item) => (same(item.source, wire.source) && same(item.target, wire.target)) || (same(item.source, wire.target) && same(item.target, wire.source)));
  if (duplicate) throw new Error("该连线已存在");
  return { ...project, wires: [...project.wires, structuredClone(wire)] };
}
export function deleteWire(project: Project, wireId: string): Project {
  if (!project.wires.some((wire) => wire.id === wireId)) return project;
  return { ...project, wires: project.wires.filter((wire) => wire.id !== wireId) };
}
/**
 * 批次3：修改连线的显示属性（颜色 / 分类文字 / 手工用途）。
 * 传 `undefined` 表示"恢复默认"：字段**整体删除**，项目文件里不留 `label: undefined` 这种噪声——
 * 与 setWireWaypoints / setWireManuallyWired 同一套「缺省即语义」约定。
 * 这里只动显示属性，一个字节都不碰 source/target，所以不可能改变任何电气连接。
 */
export function updateWire(project: Project, wireId: string, changes: Partial<Pick<Wire, "color" | "label" | "purpose">>): Project {
  const wire = project.wires.find((item) => item.id === wireId);
  if (!wire) throw new Error(`连线不存在：${wireId}`);
  return {
    ...project,
    wires: project.wires.map((item) => {
      if (item.id !== wireId) return item;
      const next: Wire = { ...item };
      if (changes.color !== undefined) next.color = changes.color;
      if ("label" in changes) { if (changes.label === undefined) delete next.label; else next.label = changes.label; }
      if ("purpose" in changes) { if (changes.purpose === undefined) delete next.purpose; else next.purpose = changes.purpose; }
      return next;
    }),
  };
}
/**
 * 固定折线途经点；传空数组或 undefined 表示恢复自动布线。
 * 坐标必须是有限数字：坏坐标会让折线画到画布外，宁可直接报错也不静默接受。
 */
export function setWireWaypoints(project: Project, wireId: string, waypoints: readonly RoutePoint[] | undefined): Project {
  const wire = project.wires.find((item) => item.id === wireId);
  if (!wire) throw new Error(`连线不存在：${wireId}`);
  const next = waypoints && waypoints.length ? waypoints.map((point) => ({ x: point.x, y: point.y })) : undefined;
  if (next && next.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error("途经点坐标必须是有限数字");
  return {
    ...project,
    wires: project.wires.map((item) => {
      if (item.id !== wireId) return item;
      if (!next) { const { waypoints: _drop, ...rest } = item; return rest; }
      return { ...item, waypoints: next };
    }),
  };
}
const same = (a: { componentId: string; pinId: string }, b: { componentId: string; pinId: string }) => a.componentId === b.componentId && a.pinId === b.pinId;
/**
 * A7【动手接线模式】：标记/取消「这根线已在实物上接好」。
 * 与 setWireWaypoints 同一套约定：缺省字段表示"未接好"，所以传 false 就把字段删掉，
 * 项目文件里不留 `manuallyWired: false` 这种冗余噪声。
 */
export function setWireManuallyWired(project: Project, wireId: string, wired: boolean): Project {
  if (!project.wires.some((wire) => wire.id === wireId)) throw new Error(`连线不存在：${wireId}`);
  return {
    ...project,
    wires: project.wires.map((item) => {
      if (item.id !== wireId) return item;
      if (!wired) { const { manuallyWired: _drop, ...rest } = item; return rest; }
      return { ...item, manuallyWired: true };
    }),
  };
}

/** 去掉元件的成组标记（字段整体删除，项目文件里不留 `groupId: undefined` 这种噪声）。 */
const withoutGroup = (component: ComponentInstance): ComponentInstance => { const { groupId: _drop, ...rest } = component; return rest; };

/** 组至少要两个成员；只剩一个（或多成员被删到只剩一个）的组没有意义，直接解除，避免"1 人组"这种残留。 */
function clearSingletonGroups(project: Project): Project {
  const counts = new Map<string, number>();
  for (const component of project.components) if (component.groupId) counts.set(component.groupId, (counts.get(component.groupId) ?? 0) + 1);
  const singleton = new Set([...counts].filter(([, count]) => count < 2).map(([id]) => id));
  if (singleton.size === 0) return project;
  return { ...project, components: project.components.map((component) => (component.groupId && singleton.has(component.groupId) ? withoutGroup(component) : component)) };
}

/**
 * A11【成组】：把这批元件打上同一个组 id（由调用方生成，域层不引入随机源，方便复现与测试）。
 * 少于两个元件不构成"组"，直接报错；已有组标记会被这次成组覆盖。
 */
export function groupComponents(project: Project, componentIds: readonly string[], groupId: string): Project {
  if (typeof groupId !== "string" || groupId.length === 0) throw new Error("组标识不能为空");
  const ids = new Set(componentIds);
  const members = project.components.filter((component) => ids.has(component.id));
  if (members.length !== ids.size) throw new Error("有元件不在画布上，无法成组");
  if (members.length < 2) throw new Error("至少选中两个元件才能成组");
  return { ...project, components: project.components.map((component) => (ids.has(component.id) ? { ...component, groupId } : component)) };
}

/** A11【解组】：解除这一组的分组标记；组里其余的元件与连线都不动。 */
export function ungroup(project: Project, groupId: string): Project {
  if (!project.components.some((component) => component.groupId === groupId)) return project;
  return { ...project, components: project.components.map((component) => (component.groupId === groupId ? withoutGroup(component) : component)) };
}

/** 某一组的全部成员（按项目顺序）；组不存在时返回空数组。 */
export function componentsInGroup(project: Project, groupId: string): ComponentInstance[] {
  return project.components.filter((component) => component.groupId === groupId);
}

/**
 * 批次2：手工指定元件所属的功能分区。传 undefined 表示"取消手工指定"，
 * 回到按元件分类的自动归属（字段整体删除，不留 `zone: undefined`）。
 */
export function setComponentZone(project: Project, componentId: string, zone: FunctionZoneId | undefined): Project {
  if (!project.components.some((component) => component.id === componentId)) throw new Error(`元件不存在：${componentId}`);
  return {
    ...project,
    components: project.components.map((component) => {
      if (component.id !== componentId) return component;
      if (zone === undefined) { const { zone: _drop, ...rest } = component; return rest; }
      return { ...component, zone };
    }),
  };
}

/** 批次2：锁定/解锁元件位置。锁定后「自动整理布局」不动它、画布上也不能拖动它。 */
export function setComponentPositionLocked(project: Project, componentId: string, locked: boolean): Project {
  if (!project.components.some((component) => component.id === componentId)) throw new Error(`元件不存在：${componentId}`);
  return {
    ...project,
    components: project.components.map((component) => {
      if (component.id !== componentId) return component;
      if (!locked) { const { positionLocked: _drop, ...rest } = component; return rest; }
      return { ...component, positionLocked: true };
    }),
  };
}

/** 批次2：重命名分区标题。空字符串或 undefined 表示恢复内置名称。 */
export function setZoneName(project: Project, zone: FunctionZoneId, name: string | undefined): Project {
  const trimmed = name?.trim();
  const next: Partial<Record<FunctionZoneId, string>> = { ...(project.zoneNames ?? {}) };
  if (trimmed) next[zone] = trimmed; else delete next[zone];
  if (Object.keys(next).length) return { ...project, zoneNames: next };
  const { zoneNames: _drop, ...rest } = project;
  return rest;
}

/**
 * 批次2：按一张 `元件 id → 坐标` 表写入位置（「自动整理布局」用它提交结果）。
 * 表里没有的元件保持原位置，坐标不是有限数字的直接跳过——绝不把坏坐标写进项目。
 */
export function moveComponents(project: Project, positions: Record<string, { x: number; y: number }>): Project {
  return {
    ...project,
    components: project.components.map((component) => {
      const next = positions[component.id];
      if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) return component;
      return { ...component, position: { x: next.x, y: next.y } };
    }),
  };
}
