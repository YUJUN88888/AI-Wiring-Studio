import type { RoutePoint } from "./types";

/**
 * 八方向折线布线器（纯函数、确定性，不读网络也不调模型）。
 *
 * 「八方向」指每一段折线只能是水平、垂直或 45°，这样连线看起来像手工画的电路图，
 * 又不会出现大斜线穿板。做法分三步：
 * 1. 从两端引脚各沿"出口方向"伸出一小段短线（stub），保证线是垂直于元件边离开的；
 * 2. 在两条短线之间生成一组候选路径（先试一条 45° 直连，再试绕开每个障碍物左右/上下的走线走廊）；
 * 3. 按「穿到的障碍物数量 → 与既有连线的平行重合长度 → 总长度 → 生成顺序」打分，确定性取最优。
 *    中间那项就是 A4 的"可读性规范"：线可以交叉，但尽量别和别的线在横向/纵向上长距离重合。
 *
 * 障碍物是画布上其它元件的包围盒。一旦某条线段真的无法避开，仍然返回最短路径并标
 * `blocked`，绝不让画布上出现"断掉的连线"。
 */

export type RouteSide = "left" | "right" | "top" | "bottom";

export interface RouteRect { x: number; y: number; width: number; height: number; }

export interface RouteRequest {
  /** 起点：引脚在画布上的绝对坐标。 */
  start: RoutePoint;
  end: RoutePoint;
  startSide: RouteSide;
  endSide: RouteSide;
  /** 所有元件的包围盒（含起点、终点所在的元件）。 */
  obstacles: readonly RouteRect[];
  /** 用户固定的途经点，按起点到终点排序。给了就按它走，不再自动避障。 */
  fixed?: readonly RoutePoint[];
  /**
   * 画布上其它连线的折线点序列。用于打分时避免与它们**长距离平行重合**（都走同一条横线/竖线）。
   * 缺省表示没有既有连线；给同一个集合必然得到同一个结果（打分只做求和，与集合顺序无关）。
   */
  existing?: readonly (readonly RoutePoint[])[];
  /** 出口短线长度。 */
  stub?: number;
  /** 与障碍物保持的最小空隙。 */
  clearance?: number;
}

export interface RouteResult {
  /** 含起点、终点在内的完整折线点序列。 */
  points: RoutePoint[];
  /** 是否仍有线段穿过障碍物（无解时会为 true，但点序列照常返回）。 */
  blocked: boolean;
  source: "fixed" | "auto";
}

export const DEFAULT_STUB = 18;
export const DEFAULT_CLEARANCE = 10;

/** 走线走廊离障碍物外扩边界再留的余量，避免贴着边界线被判成"擦到障碍物"。 */
const CORRIDOR_GAP = 2;
/** 浮点容差：实测尺寸带小数，45° 判定要允许 1e-13 级别的误差。 */
const EPSILON = 0.01;

const SIDE_VECTORS: Record<RouteSide, RoutePoint> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * 判断引脚该从元件的哪一侧离开：取引脚相对元件中心偏移较大的那个轴。
 * 图片元件的引脚可能在盒子内部任意位置，只看 handle 的 position 会一律按"右边"出去。
 */
export function sideOfPin(pin: RoutePoint, rect: RouteRect): RouteSide {
  const halfWidth = Math.max(rect.width / 2, 1);
  const halfHeight = Math.max(rect.height / 2, 1);
  const offsetX = (pin.x - (rect.x + rect.width / 2)) / halfWidth;
  const offsetY = (pin.y - (rect.y + rect.height / 2)) / halfHeight;
  if (Math.abs(offsetX) >= Math.abs(offsetY)) return offsetX >= 0 ? "right" : "left";
  return offsetY >= 0 ? "bottom" : "top";
}

/** 每一段是否都是水平、垂直或 45°（重复点忽略）。 */
export function isOctilinear(points: readonly RoutePoint[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const dx = Math.abs(points[index].x - points[index - 1].x);
    const dy = Math.abs(points[index].y - points[index - 1].y);
    if (dx < EPSILON && dy < EPSILON) continue;
    if (dx > EPSILON && dy > EPSILON && Math.abs(dx - dy) > EPSILON) return false;
  }
  return true;
}

function offsetBy(point: RoutePoint, side: RouteSide, distance: number): RoutePoint {
  const vector = SIDE_VECTORS[side];
  return { x: point.x + vector.x * distance, y: point.y + vector.y * distance };
}

/** 两点之间的八方向连接：能直连就直连，否则"45° 一段 + 水平/垂直一段"。 */
function octilinearBetween(a: RoutePoint, b: RoutePoint): RoutePoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < EPSILON || absY < EPSILON || Math.abs(absX - absY) < EPSILON) return [a, b];
  const signX = Math.sign(dx);
  const signY = Math.sign(dy);
  if (absX > absY) return [a, { x: a.x + signX * absY, y: b.y }, b];
  return [a, { x: b.x, y: a.y + signY * absX }, b];
}

function inflate(rect: RouteRect, amount: number): RouteRect {
  return { x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 };
}

/** Liang–Barsky 裁剪：判断线段是否真的穿过矩形（含斜线）。 */
function segmentHitsRect(a: RoutePoint, b: RoutePoint, rect: RouteRect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    a.x - rect.x,
    rect.x + rect.width - a.x,
    a.y - rect.y,
    rect.y + rect.height - a.y,
  ];
  let enter = 0;
  let exit = 1;
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-9) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) {
      if (ratio > exit) return false;
      if (ratio > enter) enter = ratio;
    } else {
      if (ratio < enter) return false;
      if (ratio < exit) exit = ratio;
    }
  }
  return exit > enter;
}

/** 去掉连续重复的点，避免渲染出零长度线段。 */
function dedupe(points: readonly RoutePoint[]): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) continue;
    result.push({ x: point.x, y: point.y });
  }
  return result;
}

/** 再去掉落在前后两点连线上的中间点：出口短线常和后续线段共线，留着只会多出没意义的折点。 */
function simplify(points: readonly RoutePoint[]): RoutePoint[] {
  const line = dedupe(points);
  const result: RoutePoint[] = [];
  for (const point of line) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      const dot = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y);
      if (Math.abs(cross) > EPSILON || dot <= 0) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

/**
 * 统计穿过障碍物的线段条数。
 * 首尾两段（引脚 → 出口短线）跳过：它们本来就贴着引脚所在的元件，属于必然的"穿越"。
 */
function blockedSegments(points: readonly RoutePoint[], obstacles: readonly RouteRect[]): number {
  let count = 0;
  for (let index = 1; index < points.length - 2; index += 1) {
    for (const rect of obstacles) {
      if (segmentHitsRect(points[index], points[index + 1], rect)) { count += 1; break; }
    }
  }
  return count;
}

function pathLength(points: readonly RoutePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

/** 两个区间的重叠长度（端点不分先后）。 */
function overlapInterval(a1: number, b1: number, a2: number, b2: number): number {
  const low = Math.max(Math.min(a1, b1), Math.min(a2, b2));
  const high = Math.min(Math.max(a1, b1), Math.max(a2, b2));
  return Math.max(0, high - low);
}

/**
 * 与既有连线"平行重合"的总长度（A4）。
 * 只算水平/垂直线段：同轴共线（同一 y 或同一 x）且区间相交才计入。
 * 45° 斜线不算、十字交错也不算——它们只是"交叉"，不是"重合"，本来就是允许的。
 */
function overlapLength(points: readonly RoutePoint[], existing: readonly (readonly RoutePoint[])[]): number {
  if (existing.length === 0) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const horizontal = Math.abs(a.y - b.y) < EPSILON && Math.abs(a.x - b.x) >= EPSILON;
    const vertical = Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) >= EPSILON;
    if (!horizontal && !vertical) continue;
    for (const path of existing) {
      for (let other = 1; other < path.length; other += 1) {
        const c = path[other - 1];
        const d = path[other];
        if (horizontal) {
          if (Math.abs(c.y - d.y) < EPSILON && Math.abs(c.y - a.y) < EPSILON) total += overlapInterval(a.x, b.x, c.x, d.x);
        } else if (Math.abs(c.x - d.x) < EPSILON && Math.abs(c.x - a.x) < EPSILON) {
          total += overlapInterval(a.y, b.y, c.y, d.y);
        }
      }
    }
  }
  return total;
}

/**
 * 生成候选路径（都是八方向）。顺序固定，因此打分相同时结果也固定：
 * 1. 45° 直连；2. 每一条"横向走廊"（先水平到 mx、再垂直到目标高度）；3. 每一条"纵向走廊"。
 * 走廊坐标取两点中点和每个障碍物的外扩边界，保证能绕开挡在中间的元件。
 */
function buildCandidates(a: RoutePoint, b: RoutePoint, obstacles: readonly RouteRect[]): RoutePoint[][] {
  const candidates: RoutePoint[][] = [dedupe(octilinearBetween(a, b))];
  const corridorXs = new Set<number>([(a.x + b.x) / 2]);
  const corridorYs = new Set<number>([(a.y + b.y) / 2]);
  for (const rect of obstacles) {
    corridorXs.add(rect.x - CORRIDOR_GAP);
    corridorXs.add(rect.x + rect.width + CORRIDOR_GAP);
    corridorYs.add(rect.y - CORRIDOR_GAP);
    corridorYs.add(rect.y + rect.height + CORRIDOR_GAP);
  }
  for (const x of corridorXs) candidates.push(dedupe([a, { x, y: a.y }, { x, y: b.y }, b]));
  for (const y of corridorYs) candidates.push(dedupe([a, { x: a.x, y }, { x: b.x, y }, b]));
  return candidates;
}

function bestCandidate(start: RoutePoint, end: RoutePoint, candidates: readonly RoutePoint[][], obstacles: readonly RouteRect[], existing: readonly (readonly RoutePoint[])[]): { points: RoutePoint[]; blocked: number } {
  // 打分用的点序列必须带上真正的起点、终点：这样"首尾两段是出口短线"的规则才成立，
  // 否则一条又短又直的候选会被判成 0 穿越，把绕行的正确走法比下去。
  const assemble = (candidate: readonly RoutePoint[]) => dedupe([start, ...candidate, end]);
  let bestPoints = assemble(candidates[0]);
  let bestBlocked = blockedSegments(bestPoints, obstacles);
  let bestOverlap = overlapLength(bestPoints, existing);
  let bestLength = pathLength(bestPoints);
  for (let index = 1; index < candidates.length; index += 1) {
    const points = assemble(candidates[index]);
    const blocked = blockedSegments(points, obstacles);
    const overlap = overlapLength(points, existing);
    const length = pathLength(points);
    // A4 打分顺序：穿越次数（正确性）→ 与既有连线的平行重合长度（可读性）→ 总长度。
    // 重合项排在总长度之前：宁可稍微绕一点，也不要两条线在横/纵方向长距离叠在一起。
    // 完全相等时保留先生成的候选（顺序固定 → 结果确定）。
    const better = blocked < bestBlocked
      || (blocked === bestBlocked && overlap < bestOverlap - 0.01)
      || (blocked === bestBlocked && Math.abs(overlap - bestOverlap) <= 0.01 && length < bestLength - 0.01);
    if (better) { bestPoints = points; bestBlocked = blocked; bestOverlap = overlap; bestLength = length; }
  }
  return { points: bestPoints, blocked: bestBlocked };
}

/** 计算一条连线的折线路径。 */
export function routeWire(request: RouteRequest): RouteResult {
  const stub = request.stub ?? DEFAULT_STUB;
  const clearance = request.clearance ?? DEFAULT_CLEARANCE;
  const startStub = offsetBy(request.start, request.startSide, stub);
  const endStub = offsetBy(request.end, request.endSide, stub);
  // 起点、终点所在的元件也当障碍物：中段不该横穿自己这头的元件。
  const obstacles = request.obstacles.map((rect) => inflate(rect, clearance));

  if (request.fixed?.length) {
    const anchors: RoutePoint[] = [startStub, ...request.fixed, endStub];
    const middle: RoutePoint[] = [];
    for (let index = 1; index < anchors.length; index += 1) {
      middle.push(...octilinearBetween(anchors[index - 1], anchors[index]).slice(1));
    }
    const assembled = dedupe([request.start, startStub, ...middle, request.end]);
    return { points: simplify(assembled), blocked: blockedSegments(assembled, obstacles) > 0, source: "fixed" };
  }

  const { points, blocked } = bestCandidate(request.start, request.end, buildCandidates(startStub, endStub, obstacles), obstacles, request.existing ?? []);
  return { points: simplify(points), blocked: blocked > 0, source: "auto" };
}