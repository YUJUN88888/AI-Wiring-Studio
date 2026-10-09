import { describe, expect, it } from "vitest";
import { isOctilinear, routeWire, sideOfPin, type RouteRect } from "../../src/domain";

/** 一个 100×60 的元件盒子，方便手算期望值。 */
const box = (x: number, y: number, width = 100, height = 60): RouteRect => ({ x, y, width, height });

/** 检查折线里是否有任何一段真的穿过这些矩形。 */
function hits(points: { x: number; y: number }[], rects: readonly RouteRect[]): boolean {
  const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, r: RouteRect): boolean => {
    for (let step = 0; step <= 200; step += 1) {
      const t = step / 200;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // 采样点落在矩形"内部"（留 0.5 余量）才算穿过，避免把贴边误判成穿越。
      if (x > r.x + 0.5 && x < r.x + r.width - 0.5 && y > r.y + 0.5 && y < r.y + r.height - 0.5) return true;
    }
    return false;
  };
  for (let index = 1; index < points.length; index += 1) {
    if (rects.some((rect) => crosses(points[index - 1], points[index], rect))) return true;
  }
  return false;
}

describe("wire routing", () => {
  it("同排两点且无遮挡时是一条直线，只有起点终点", () => {
    const result = routeWire({ start: { x: 0, y: 50 }, end: { x: 300, y: 50 }, startSide: "right", endSide: "left", obstacles: [] });
    expect(result.source).toBe("auto");
    expect(result.blocked).toBe(false);
    expect(result.points).toEqual([{ x: 0, y: 50 }, { x: 300, y: 50 }]);
  });

  it("对角两点：先垂直引脚水平离开，再用一条 45° 斜线连上终点", () => {
    const result = routeWire({ start: { x: 0, y: 0 }, end: { x: 200, y: 200 }, startSide: "right", endSide: "left", obstacles: [] });
    expect(isOctilinear(result.points)).toBe(true);
    expect(result.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.points.at(-1)).toEqual({ x: 200, y: 200 });
    // 出口短线必须垂直于引脚：首段是水平的，第二段才是 45°。
    expect(result.points[1]).toEqual({ x: 18, y: 0 });
    expect(result.points.some((point, index) => index > 0 && point.x - result.points[index - 1].x !== 0 && point.y - result.points[index - 1].y !== 0)).toBe(true);
  });

  it("错位两点用 45° + 水平两段连接，每一段都是八方向", () => {
    const result = routeWire({ start: { x: 0, y: 0 }, end: { x: 300, y: 100 }, startSide: "right", endSide: "left", obstacles: [] });
    expect(isOctilinear(result.points)).toBe(true);
    // 出发点与落点都必须垂直于引脚离开/进入：首段水平向右，末段水平向左进入终点。
    expect(result.points[1].y).toBe(result.points[0].y);
    expect(result.points.at(-1)).toEqual({ x: 300, y: 100 });
    const beforeEnd = result.points.at(-2);
    if (!beforeEnd) throw new Error("缺少倒数第二个点");
    expect(beforeEnd.y).toBe(100);
  });

  it("挡在中间的大元件会被绕开，折线不穿过任何障碍物", () => {
    const middle = box(140, 20, 80, 120);
    const result = routeWire({
      start: { x: 0, y: 80 },
      end: { x: 300, y: 80 },
      startSide: "right",
      endSide: "left",
      obstacles: [middle],
    });
    expect(result.blocked).toBe(false);
    expect(isOctilinear(result.points)).toBe(true);
    expect(hits(result.points, [middle])).toBe(false);
  });

  it("起点元件在身后也能绕出去，不会横穿自己的元件", () => {
    const source = box(0, 60, 60, 40);
    const target = box(0, 0, 60, 40);
    const result = routeWire({
      start: { x: 60, y: 80 },
      end: { x: 0, y: 20 },
      startSide: "right",
      endSide: "left",
      obstacles: [source, target],
    });
    expect(isOctilinear(result.points)).toBe(true);
    expect(hits(result.points, [source, target])).toBe(false);
  });

  it("用户固定的途经点被逐字保留，并仍保持八方向", () => {
    const waypoint = { x: 120, y: 260 };
    const result = routeWire({
      start: { x: 0, y: 80 },
      end: { x: 300, y: 80 },
      startSide: "right",
      endSide: "left",
      obstacles: [],
      fixed: [waypoint],
    });
    expect(result.source).toBe("fixed");
    expect(result.points).toContainEqual(waypoint);
    expect(isOctilinear(result.points)).toBe(true);
  });

  it("无路可走时仍然返回点序列，只用 blocked 标记，绝不返回空路径", () => {
    // 把出口短线整个包在障碍里：任何走法都会穿越。
    const wall = box(-50, -50, 400, 400);
    const result = routeWire({ start: { x: 0, y: 0 }, end: { x: 200, y: 200 }, startSide: "right", endSide: "left", obstacles: [wall] });
    expect(result.blocked).toBe(true);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    expect(result.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.points.at(-1)).toEqual({ x: 200, y: 200 });
  });

  it("同样输入反复计算结果完全一致（确定性）", () => {
    const request = {
      start: { x: 10, y: 90 },
      end: { x: 420, y: 130 },
      startSide: "right" as const,
      endSide: "left" as const,
      obstacles: [box(150, 40, 90, 90), box(300, 100, 70, 70)],
    };
    const first = routeWire(request);
    for (let index = 0; index < 5; index += 1) expect(routeWire(request).points).toEqual(first.points);
  });

  it("A4：同样长度的两条走法里，优先选不与既有连线平行重合的那条", () => {
    // 中间一个元件把直线挡死，只能从它上方（y≈28）或下方（y≈132）绕，两条走法长度相同。
    const obstacle = box(120, 40, 60, 80);
    const base = {
      start: { x: 0, y: 80 },
      end: { x: 300, y: 80 },
      startSide: "right" as const,
      endSide: "left" as const,
      obstacles: [obstacle],
    };
    // 没有被占用的走法时，先生成的"上方"走法胜出。
    const free = routeWire(base);
    expect(free.blocked).toBe(false);
    expect(free.points.some((point) => Math.abs(point.y - 28) < 1)).toBe(true);

    // 上方走廊已被另一条连线占用（一条从 x=0 到 x=400、y=28 的横线）：改走下边。
    const existing = [[{ x: 0, y: 28 }, { x: 400, y: 28 }]];
    const rerouted = routeWire({ ...base, existing });
    expect(rerouted.blocked).toBe(false);
    expect(isOctilinear(rerouted.points)).toBe(true);
    expect(rerouted.points.some((point) => Math.abs(point.y - 28) < 1)).toBe(false);
    expect(rerouted.points.some((point) => Math.abs(point.y - 132) < 1)).toBe(true);
  });

  it("A4：只算平行重合，不惩罚 45° 斜线与十字交错，且与既有连线的排列顺序无关", () => {
    const base = {
      start: { x: 0, y: 80 },
      end: { x: 300, y: 80 },
      startSide: "right" as const,
      endSide: "left" as const,
      obstacles: [box(120, 40, 60, 80)],
    };
    const horizontal = [{ x: 0, y: 28 }, { x: 400, y: 28 }];
    const vertical = [{ x: 28, y: 0 }, { x: 28, y: 400 }];
    const forward = routeWire({ ...base, existing: [horizontal, vertical] });
    const backward = routeWire({ ...base, existing: [vertical, horizontal] });
    expect(forward.points).toEqual(backward.points);
    // 竖向既有线只是"穿过"候选走法，不算重合，所以还是走下边。
    expect(forward.points.some((point) => Math.abs(point.y - 132) < 1)).toBe(true);
  });

  it("引脚在图片元件左半边时向左出口，在右半边时向右出口", () => {
    const rect = box(100, 100, 200, 100);
    expect(sideOfPin({ x: 110, y: 150 }, rect)).toBe("left");
    expect(sideOfPin({ x: 290, y: 150 }, rect)).toBe("right");
    expect(sideOfPin({ x: 200, y: 104 }, rect)).toBe("top");
    expect(sideOfPin({ x: 200, y: 196 }, rect)).toBe("bottom");
  });

  it("isOctilinear 能识破既非水平垂直也非 45° 的斜线", () => {
    expect(isOctilinear([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    expect(isOctilinear([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }])).toBe(true);
    expect(isOctilinear([{ x: 0, y: 0 }, { x: 10, y: 7 }])).toBe(false);
  });
});