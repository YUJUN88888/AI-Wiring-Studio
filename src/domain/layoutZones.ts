import { builtInComponentCatalog } from "./componentCatalog";
import type { ComponentCategory } from "./componentDefinition";
import type { ComponentInstance, FunctionZoneId, Project, Wire } from "./types";
import { findDefinition, type UserLibrary } from "./userLibrary";

/**
 * 批次2【按功能分区布局】的域层实现。全部是**确定性纯函数**：
 * 同样的项目 + 同样的大小表，一定得到同一份坐标，因此「自动整理布局」可以放心走 undo/redo。
 *
 * 设计口径（对应 feature-backlog.md §F 的硬约束）：
 * 1. 分区归属只来自**已有数据**——元件分类（`ComponentInstance.definitionId` → 定义/内置目录的 `category`），
 *    或用户亲手指定的 `ComponentInstance.zone`。判不出来就是 `unclassified`（未分组），绝不猜。
 * 2. 摆位只改坐标，绝不增删改任何元件或连线（返回值里只有 `positions`）。
 * 3. 位置被锁定的元件（`positionLocked`）完全不参与，原地不动。
 */

/** 分区的固定顺序：区域从左到右、元件在这个顺序里成列摆放。 */
export const FUNCTION_ZONE_ORDER: readonly FunctionZoneId[] = ["power", "control", "acquire", "audio", "aux", "drive", "unclassified"];

/** 分区默认显示名；用户可在 `Project.zoneNames` 里重命名。 */
export const FUNCTION_ZONE_LABELS: Record<FunctionZoneId, string> = {
  power: "电源",
  control: "主控",
  acquire: "采集",
  audio: "音频输出",
  aux: "副控与外设",
  drive: "执行与驱动",
  unclassified: "未分组",
};

/** 摆放参数：区域之间的列间距、区域内的簇间距、元件间距与四周留白。 */
export const ZONE_GAP = 72;
export const CLUSTER_GAP = 44;
export const COMPONENT_GAP = 40;
export const LAYOUT_ORIGIN = { x: 80, y: 80 };
/** 分区底色框比成员包围盒每边多留的边距，好让标题与连线端点不贴边。 */
export const ZONE_PADDING = 28;
/** 没有尺寸信息时的兜底盒子（与 nodeFromComponent 的兜底一致）。 */
export const DEFAULT_COMPONENT_SIZE = { width: 180, height: 120 };

export interface ComponentSize { width: number; height: number; }

/**
 * 元件分类 → 功能分区。只有**有确定依据**的两类才自动归属：
 * - 电源 / 地 / 稳压器 → 电源区；
 * - 主控（mcu） → 主控区；
 * 其余分类（无源/二极管/电容/开关/其他）无法判定它属于采集、音频输出、副控与外设还是执行与驱动，
 * 一律 `unclassified`，由用户在右键菜单里亲手指定，而不是我们猜。
 */
export function categoryZone(category: ComponentCategory): FunctionZoneId {
  switch (category) {
    case "power":
    case "ground":
    case "regulator":
      return "power";
    case "mcu":
      return "control";
    default:
      return "unclassified";
  }
}

/**
 * 画布元件的分类：先在用户库找定义，找不到再回内置目录（内置元件的 definitionId 形如 `builtin.<kind>`）。
 * 两处都没有的归入 `other`，不猜也不报错。
 */
export function categoryOf(component: ComponentInstance, library: UserLibrary): ComponentCategory {
  const definition = findDefinition(library, component.definitionId);
  if (definition) return definition.category;
  const kind = component.definitionId.startsWith("builtin.") ? component.definitionId.slice("builtin.".length) : "";
  const builtIn = (builtInComponentCatalog as Record<string, { category: ComponentCategory } | undefined>)[kind];
  return builtIn?.category ?? "other";
}

/** 元件的分区：用户亲手指定优先，否则按分类自动归属（判不出即未分组）。 */
export function componentZone(component: ComponentInstance, library: UserLibrary): FunctionZoneId {
  return component.zone ?? categoryZone(categoryOf(component, library));
}

/** 整个项目的分区归属表（`componentId → 分区`），界面与自动整理共用同一份推导。 */
export function zoneOfProject(project: Project, library: UserLibrary): Record<string, FunctionZoneId> {
  const zones: Record<string, FunctionZoneId> = {};
  for (const component of project.components) zones[component.id] = componentZone(component, library);
  return zones;
}

/** 分区显示名：用户重命名优先，否则用内置名称。 */
export function zoneLabel(project: Project, zone: FunctionZoneId): string {
  const renamed = project.zoneNames?.[zone];
  return renamed && renamed.length > 0 ? renamed : FUNCTION_ZONE_LABELS[zone];
}

export interface ArrangeInput {
  project: Project;
  /** 每个元件的实测/定义尺寸；缺的用 DEFAULT_COMPONENT_SIZE 兜底。 */
  sizes: Record<string, ComponentSize>;
  /** `componentId → 分区`，由 zoneOfProject 给出（独立传入便于测试与复用）。 */
  zoneOf: Record<string, FunctionZoneId>;
}

/**
 * 「自动整理布局」：把元件按**连接紧密程度**聚簇，再按分区成列摆放。
 *
 * 步骤（每步都是确定性的）：
 * 1. 参与整理的元件＝未锁定的元件；锁定的原地不动。
 * 2. 用并查集按连线把参与整理的元件聚成一个个连通簇（连在一起的摆一起）。
 * 3. 每个簇归入"成员分区里的多数派"，票数相同时取 FUNCTION_ZONE_ORDER 里靠前的那个。
 * 4. 簇的排序：先分区顺序，再按成员数多的在前，最后按最小元件 id，保证同输入必同结果。
 * 5. 摆位：每个分区一列（列内簇自上而下），列内每个簇用接近正方形的网格排开。
 *
 * 只返回坐标，**不返回也不需要新的项目对象**——调用方拿到坐标后自己决定怎么写入，
 * 因此这里不可能增删改任何元件或连线。
 */
export function arrangeByZone({ project, sizes, zoneOf }: ArrangeInput): Record<string, { x: number; y: number }> {
  const sizeOf = (id: string): ComponentSize => sizes[id] ?? DEFAULT_COMPONENT_SIZE;

  // 1. 锁定元件不参与。
  const movable = project.components.filter((component) => component.positionLocked !== true);
  if (movable.length === 0) return {};
  const movableIds = new Set(movable.map((component) => component.id));

  // 2. 并查集聚簇（只连参与整理的元件）。
  const parent = new Map<string, string>();
  const root = (id: string): string => { const p = parent.get(id) ?? id; if (p === id) return id; const r = root(p); parent.set(id, r); return r; };
  const join = (a: string, b: string) => { const ra = root(a); const rb = root(b); if (ra !== rb) parent.set(rb, ra); };
  for (const id of movableIds) parent.set(id, id);
  for (const wire of project.wires as readonly Wire[]) {
    const { componentId: a } = wire.source;
    const { componentId: b } = wire.target;
    if (a !== b && movableIds.has(a) && movableIds.has(b)) join(a, b);
  }
  const clusters = new Map<string, string[]>();
  for (const component of movable) {
    const r = root(component.id);
    clusters.set(r, [...(clusters.get(r) ?? []), component.id]);
  }

  const zoneIndex = new Map(FUNCTION_ZONE_ORDER.map((zone, index) => [zone, index]));
  /** 簇的分区＝成员分区的多数派；票数相同取固定顺序里靠前的。 */
  const majorityZone = (members: readonly string[]): FunctionZoneId => {
    const tally = new Map<FunctionZoneId, number>();
    for (const id of members) { const zone = zoneOf[id] ?? "unclassified"; tally.set(zone, (tally.get(zone) ?? 0) + 1); }
    return [...tally].sort((a, b) => (b[1] - a[1]) || ((zoneIndex.get(a[0]) ?? 0) - (zoneIndex.get(b[0]) ?? 0)))[0][0];
  };

  // 4. 排序：分区顺序 → 成员数多的在前 → 最小元件 id。
  const ordered = [...clusters.values()]
    .map((members) => ({ members, zone: majorityZone(members) }))
    .sort((a, b) => (zoneIndex.get(a.zone)! - zoneIndex.get(b.zone)!)
      || (b.members.length - a.members.length)
      || compareIds(minId(a.members), minId(b.members)));
  const byZone = new Map<FunctionZoneId, { members: string[] }[]>();
  for (const cluster of ordered) byZone.set(cluster.zone, [...(byZone.get(cluster.zone) ?? []), cluster]);

  // 锁定的元件原地不动，但它们**仍然占住自己分区的空间**：列宽算上它们，同分区的活动元件排到它们下方。
  // 否则「自动整理」会把别的元件压在锁定元件身上，被压住的那个就既看不见也点不到了。
  const lockedByZone = new Map<FunctionZoneId, ComponentInstance[]>();
  for (const component of project.components) {
    if (component.positionLocked !== true) continue;
    const zone = zoneOf[component.id] ?? "unclassified";
    lockedByZone.set(zone, [...(lockedByZone.get(zone) ?? []), component]);
  }

  // 5. 摆位：分区成列，列内簇自上而下，簇内接近正方形铺开。
  const positions: Record<string, { x: number; y: number }> = {};
  let columnX = LAYOUT_ORIGIN.x;
  for (const zone of FUNCTION_ZONE_ORDER) {
    const inZone = byZone.get(zone) ?? [];
    const lockedHere = lockedByZone.get(zone) ?? [];
    if (inZone.length === 0 && lockedHere.length === 0) continue;
    let columnWidth = 0;
    let cursorY = LAYOUT_ORIGIN.y;
    // 锁定元件的实际位置也要计入本列：列宽按它的右边缘算，本区活动元件从它下方开始排。
    for (const component of lockedHere) {
      const size = sizeOf(component.id);
      columnWidth = Math.max(columnWidth, component.position.x - columnX + size.width);
      cursorY = Math.max(cursorY, component.position.y + size.height + CLUSTER_GAP);
    }
    for (const cluster of inZone) {
      const columns = Math.max(1, Math.ceil(Math.sqrt(cluster.members.length)));
      let rowHeight = 0;
      let clusterWidth = 0;
      cluster.members.forEach((id, i) => {
        const column = i % columns;
        const row = Math.floor(i / columns);
        const size = sizeOf(id);
        if (column === 0 && row > 0) cursorY += rowHeight + COMPONENT_GAP;
        if (column === 0) rowHeight = 0;
        const x = columnX + (row > 0 || column > 0 ? gridOffsetX(cluster.members, columns, column, sizes) : 0);
        positions[id] = { x: Math.round(x), y: Math.round(cursorY) };
        clusterWidth = Math.max(clusterWidth, x - columnX + size.width);
        rowHeight = Math.max(rowHeight, size.height);
      });
      cursorY += rowHeight + CLUSTER_GAP;
      columnWidth = Math.max(columnWidth, clusterWidth);
    }
    columnX += columnWidth + ZONE_GAP;
  }
  return positions;
}

/** 一组元件里字典序最小的 id：**只用来排序**，保证同输入必得同一份结果。 */
const minId = (ids: readonly string[]): string => (ids.length ? [...ids].sort()[0] : "");
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 簇内第 column 列的起始 x 偏移＝前面各列的最大宽度 + 列间距之和。
 * 抽成函数是为了让"网格铺开"这件事本身保持确定性、可单独断言。
 */
function gridOffsetX(members: readonly string[], columns: number, column: number, sizes: Record<string, ComponentSize>): number {
  if (column === 0) return 0;
  let offset = 0;
  for (let c = 0; c < column; c += 1) {
    let widest = 0;
    for (let i = c; i < members.length; i += columns) widest = Math.max(widest, (sizes[members[i]] ?? DEFAULT_COMPONENT_SIZE).width);
    offset += widest + COMPONENT_GAP;
  }
  return offset;
}

/** 画布上一个已定位元件的盒子（分区底色框的输入）。 */
export interface LayoutBox { id: string; zone: FunctionZoneId; x: number; y: number; width: number; height: number; }

/**
 * 分区底色框＝该分区全部成员包围盒 + 四周留白。
 * 只包含**实际存在成员**的分区，空分区不画（避免满屏空框）。
 * 由界面用"实时位置"调用，所以用户手动挪动元件后，框会跟着走。
 */
export function zoneBounds(boxes: readonly LayoutBox[], padding = ZONE_PADDING): { zone: FunctionZoneId; x: number; y: number; width: number; height: number }[] {
  const grouped = new Map<FunctionZoneId, LayoutBox[]>();
  for (const box of boxes) grouped.set(box.zone, [...(grouped.get(box.zone) ?? []), box]);
  return FUNCTION_ZONE_ORDER
    .filter((zone) => grouped.has(zone))
    .map((zone) => {
      const items = grouped.get(zone)!;
      const minX = Math.min(...items.map((item) => item.x));
      const minY = Math.min(...items.map((item) => item.y));
      const maxX = Math.max(...items.map((item) => item.x + item.width));
      const maxY = Math.max(...items.map((item) => item.y + item.height));
      return { zone, x: Math.round(minX - padding), y: Math.round(minY - padding), width: Math.round(maxX - minX + padding * 2), height: Math.round(maxY - minY + padding * 2) };
    });
}