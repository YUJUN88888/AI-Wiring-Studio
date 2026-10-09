import { describe, expect, it } from "vitest";
import { layoutPart, MIN_HOTSPOT_SPREAD_RATIO, PART_PIN_GAP, type PartLayoutPinInput } from "../../src/domain";

const pin = (
  id: string,
  role: PartLayoutPinInput["role"],
  x: number,
  y: number,
  placed = false,
  confirmed = false,
): PartLayoutPinInput => ({ id, name: id, role, localPosition: { x, y }, placed, confirmed });

describe("part layout", () => {
  it("没有引脚时按原尺寸返回，不臆造布局", () => {
    const layout = layoutPart({ width: 180, height: 80 }, []);
    expect(layout).toEqual({ width: 180, height: 80, pins: [], source: "auto" });
  });

  it("每个引脚都由用户定位过时，坐标原样保留一个都不改", () => {
    const pins = [pin("VIN", "POWER_INPUT", 10, 20, true), pin("OUT", "OUTPUT", 90, 40, true), pin("SDA", "GPIO", 170, 70, true)];
    const layout = layoutPart({ width: 180, height: 90 }, pins);
    expect(layout.source).toBe("hotspot");
    expect(layout.width).toBe(180);
    expect(layout.height).toBe(90);
    expect(layout.pins.map((item) => [item.x, item.y])).toEqual([[10, 20], [90, 40], [170, 70]]);
  });

  it("单个引脚只要用户定位过就保留，不会因为只有一个就被挪走", () => {
    const layout = layoutPart({ width: 180, height: 90 }, [pin("P1", "INPUT", 30, 40, true)]);
    expect(layout.source).toBe("hotspot");
    expect([layout.pins[0].x, layout.pins[0].y]).toEqual([30, 40]);
  });

  it("热点引脚按左右半区决定标签方向：不越出盒子也不压住圆点", () => {
    const pins = [pin("A", "POWER_INPUT", 10, 20, true), pin("B", "OUTPUT", 170, 20, true)];
    const layout = layoutPart({ width: 180, height: 90 }, pins);
    expect(layout.pins[0].labelSide).toBe("right");
    expect(layout.pins[1].labelSide).toBe("left");
  });

  it("只要还有引脚没被用户定位，就整体自动排布：分到左右两侧并撑高盒子", () => {
    const pins = [pin("VCC", "POWER_INPUT", 0, 0), pin("GND", "GND", 0, 0), pin("SDA", "INPUT", 0, 0)];
    const layout = layoutPart({ width: 180, height: 80 }, pins);
    expect(layout.source).toBe("auto");
    expect(layout.pins).toHaveLength(3);
    // 两侧都用上，不再是一列贴边。
    expect(new Set(layout.pins.map((item) => item.x))).toEqual(new Set([0, layout.width]));
    // 盒子被撑高到能容纳同侧引脚。
    expect(layout.height).toBeGreaterThanOrEqual((2 + 1) * PART_PIN_GAP);

    const perSide = new Map<number, number[]>();
    for (const item of layout.pins) perSide.set(item.x, [...(perSide.get(item.x) ?? []), item.y]);
    for (const ys of perSide.values()) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(PART_PIN_GAP);
    }
  });

  it("只有部分引脚被定位过时也不拼凑半成品，而是整体重排", () => {
    const pins = [pin("P1", "INPUT", 10, 10, true), pin("P2", "INPUT", 0, 0), pin("P3", "INPUT", 0, 0)];
    const layout = layoutPart({ width: 180, height: 80 }, pins);
    expect(layout.source).toBe("auto");
    expect(new Set(layout.pins.map((item) => `${item.x}|${item.y}`)).size).toBe(3);
  });

  it("输入侧与非输入侧各自成列，输入在左、输出在右", () => {
    const pins = [pin("VIN", "POWER_INPUT", 0, 0), pin("GND", "GND", 0, 0), pin("OUT", "OUTPUT", 0, 0)];
    const layout = layoutPart({ width: 180, height: 80 }, pins);
    const left = layout.pins.filter((item) => item.x === 0);
    const right = layout.pins.filter((item) => item.x === layout.width);
    expect(left.map((item) => item.id)).toEqual(["VIN", "GND"]);
    expect(right.map((item) => item.id)).toEqual(["OUT"]);
    expect(left.every((item) => item.labelSide === "right")).toBe(true);
    expect(right.every((item) => item.labelSide === "left")).toBe(true);
  });

  it("引脚按角色分到两侧时严重失衡（多功能模块）会改成对半拆开，避免一列排到画布外", () => {
    // 复刻 ESP32-S3 这类模块：绝大多数引脚是 GPIO，只有 VCC/GND 算"输入侧"。
    const pins = [pin("VCC", "POWER_INPUT", 0, 0), pin("GND", "GND", 0, 0)];
    for (let index = 0; index < 10; index += 1) pins.push(pin(`GPIO${index}`, "GPIO", 0, 0));
    const layout = layoutPart({ width: 180, height: 80 }, pins);
    expect(layout.source).toBe("auto");
    const perColumn = new Map<number, number>();
    for (const item of layout.pins) perColumn.set(item.x, (perColumn.get(item.x) ?? 0) + 1);
    // 两列都在用，且没有一列超过总数的一半（对半拆开），矮的那列不会只剩两三个。
    expect([...perColumn.values()].sort((a, b) => a - b)).toEqual([6, 6]);
    // 高度只按最长的一列算，不再按"十几个引脚排一列"撑到画布外。
    expect(layout.height).toBeLessThanOrEqual(7 * PART_PIN_GAP);
  });

  it("两侧差距不悬殊时仍按角色分列，输入在左、输出在右", () => {
    const pins = [pin("VIN", "POWER_INPUT", 0, 0), pin("OUT1", "OUTPUT", 0, 0), pin("OUT2", "OUTPUT", 0, 0)];
    const layout = layoutPart({ width: 180, height: 80 }, pins);
    expect(layout.pins.filter((item) => item.x === 0).map((item) => item.id)).toEqual(["VIN"]);
    expect(layout.pins.filter((item) => item.x === layout.width).map((item) => item.id)).toEqual(["OUT1", "OUT2"]);
  });

  it("只有一个未定位的引脚时自动排布到盒子左侧并垂直居中", () => {
    const layout = layoutPart({ width: 180, height: 90 }, [pin("P1", "INPUT", 0, 0)]);
    expect(layout.source).toBe("auto");
    expect(layout.pins).toHaveLength(1);
    expect(layout.pins[0].x).toBe(0);
    expect(layout.pins[0].y).toBe(layout.height / 2);
  });

  it("用户全部定位过但同侧挤到标签会叠字（真实坏数据）时，按退化数据处理、整体自动排布", () => {
    // 复刻真实元件：坐标是图片像素尺度的小数，全挤在 180×73 盒子的左上角。
    const raw: [string, number, number][] = [
      ["VCC", 0, 4.079999923706055], ["GND", 0, 8.15999984741211], ["SCL", 0, 12.239999771118164],
      ["SDA", 15.600000381469727, 4.079999923706055], ["XDA", 15.600000381469727, 8.15999984741211],
      ["XCL", 15.600000381469727, 12.239999771118164], ["ADO", 0, 16.31999969482422], ["INT", 15.600000381469727, 16.31999969482422],
    ];
    const pins = raw.map(([name, x, y]) => pin(name, "PASSIVE", x, y, true));
    const layout = layoutPart({ width: 180, height: 73 }, pins);
    expect(layout.source).toBe("auto");
    // 盒子被撑高到能放下同侧 4 个引脚。
    expect(layout.height).toBeGreaterThanOrEqual((4 + 1) * PART_PIN_GAP);
    // 同侧（同一 x 列）相邻引脚间距满足标签不叠字。
    const perColumn = new Map<number, number[]>();
    for (const item of layout.pins) perColumn.set(item.x, [...(perColumn.get(item.x) ?? []), item.y]);
    for (const ys of perColumn.values()) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(PART_PIN_GAP);
    }
  });

  it("横向铺开但纵向很接近的合法热点仍原样保留，不被误判为退化（独立复核发现的假阳性回归）", () => {
    // 两个引脚同处左半区、y 只差 5，但水平相隔 70：标签锚在各自 x 上，实际并不会重叠。
    // 门控只看单轴间距时会把这种合法摆放丢掉，因此这里钉住"至少一轴铺开就保留"的行为。
    const pins = [pin("A", "PASSIVE", 10, 20, true), pin("B", "PASSIVE", 80, 25, true)];
    const layout = layoutPart({ width: 180, height: 90 }, pins);
    expect(layout.source).toBe("hotspot");
    expect(layout.pins.map((item) => [item.x, item.y])).toEqual([[10, 20], [80, 25]]);
  });

  it("包围盒铺开比例刚好达到阈值时保留、略低于阈值时判为退化", () => {
    const width = 180;
    const height = 90;
    const threshold = MIN_HOTSPOT_SPREAD_RATIO;
    const spreadPin = (id: string, x: number, y: number) => pin(id, "PASSIVE", x, y, true);
    // 两轴都恰好等于阈值 → 保留。
    const atThreshold = layoutPart({ width, height }, [spreadPin("A", 0, 0), spreadPin("B", width * threshold, height * threshold)]);
    expect(atThreshold.source).toBe("hotspot");
    // 两轴都略低于阈值 → 退化，整体自动排布。
    const belowThreshold = layoutPart({ width, height }, [spreadPin("A", 0, 0), spreadPin("B", width * threshold - 1, height * threshold - 1)]);
    expect(belowThreshold.source).toBe("auto");
  });

  it("用户亲手改过坐标后，即使还有引脚没有坐标来源，也一律按定义里的坐标渲染", () => {
    // 复刻真实元件：AI 导入的模块里，有像素坐标的引脚（placed）与兜底排布的引脚（未 placed）混在一起。
    // 用户在编辑器里改了其中一个引脚的坐标并保存 —— 画布必须跟着变，不能被"整体自动排布"吃掉。
    const pins = [pin("VCC", "POWER_INPUT", 12, 30, true, true), pin("GND", "GND", 0, 40), pin("SDA", "GPIO", 150, 70)];
    const layout = layoutPart({ width: 180, height: 90 }, pins);
    expect(layout.source).toBe("hotspot");
    expect(layout.pins.map((item) => [item.x, item.y])).toEqual([[12, 30], [0, 40], [150, 70]]);
  });

  it("用户亲手确认过的坐标即使挤在一起也原样采用：人看着数字填的，不再当成坏数据丢掉", () => {
    const pins = [pin("A", "PASSIVE", 4, 4, true, true), pin("B", "PASSIVE", 4, 8, true, true)];
    const layout = layoutPart({ width: 180, height: 90 }, pins);
    expect(layout.source).toBe("hotspot");
    expect(layout.pins.map((item) => [item.x, item.y])).toEqual([[4, 4], [4, 8]]);
  });
});