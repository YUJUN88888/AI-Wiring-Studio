import { describe, expect, it } from "vitest";
import {
  arrangeByZone,
  categoryOf,
  categoryZone,
  componentZone,
  createProject,
  DEFAULT_COMPONENT_SIZE,
  emptyLibrary,
  FUNCTION_ZONE_LABELS,
  FUNCTION_ZONE_ORDER,
  moveComponents,
  setComponentPositionLocked,
  setComponentZone,
  setZoneName,
  serializeProject,
  deserializeProject,
  upsertDefinition,
  zoneBounds,
  zoneLabel,
  zoneOfProject,
  type ComponentInstance,
  type ComponentSize,
  type Project,
  type UserLibrary,
} from "../../src/domain";
import { createEmptyDefinition, instantiateFromDefinition } from "../../src/domain/componentDefinition";

const component = (id: string, definitionId = "user.thing"): ComponentInstance => ({
  id,
  definitionId,
  displayName: id,
  position: { x: 0, y: 0 },
  rotation: 0,
  pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 } }],
});

const projectWith = (...components: ComponentInstance[]): Project => ({ ...createProject("p"), components });

/** 造一个用户库：给定 id → 分类。 */
const libraryWith = (...entries: [string, Parameters<typeof categoryZone>[0]][]): UserLibrary => {
  let library = emptyLibrary();
  for (const [id, category] of entries) {
    const definition = createEmptyDefinition(id, id);
    library = upsertDefinition(library, { ...definition, category, pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 } }] });
  }
  return library;
};

const sizes = (project: Project): Record<string, ComponentSize> => {
  const map: Record<string, ComponentSize> = {};
  for (const item of project.components) map[item.id] = { ...DEFAULT_COMPONENT_SIZE };
  return map;
};

describe("批次2 分区归属：只依据已有数据，判不出就是未分组", () => {
  it("分类 → 分区的映射只覆盖有确定依据的两类，其余一律未分组", () => {
    expect(categoryZone("power")).toBe("power");
    expect(categoryZone("ground")).toBe("power");
    expect(categoryZone("regulator")).toBe("power");
    expect(categoryZone("mcu")).toBe("control");
    for (const category of ["passive", "diode", "capacitor", "switch", "other"] as const) {
      expect(categoryZone(category)).toBe("unclassified");
    }
  });

  it("用户亲手指定的分区优先于按分类的自动归属", () => {
    const library = libraryWith(["user.mcu", "mcu"]);
    const auto = component("a", "user.mcu");
    expect(componentZone(auto, library)).toBe("control");
    const manual = setComponentZone(projectWith(auto), "a", "acquire").components[0];
    expect(componentZone(manual, library)).toBe("acquire");
    // 取消手工指定就回到自动归属，且字段整体删除（项目文件里不留 `zone: undefined`）。
    const cleared = setComponentZone(projectWith(manual), "a", undefined).components[0];
    expect(cleared.zone).toBeUndefined();
    expect(componentZone(cleared, library)).toBe("control");
  });

  it("内置元件按内置目录的分类归属，库与目录都没有的算「其他」→ 未分组", () => {
    expect(componentZone(component("p", "builtin.power-5v"), emptyLibrary())).toBe("power");
    expect(componentZone(component("u", "builtin.esp32-devkit-demo"), emptyLibrary())).toBe("control");
    expect(componentZone(component("x", "user.unknown"), emptyLibrary())).toBe("unclassified");
    expect(categoryOf(component("x", "user.unknown"), emptyLibrary())).toBe("other");
  });

  it("zoneOfProject 给每个元件一项；zoneLabel 支持重命名且空名恢复内置名称", () => {
    const project = projectWith(component("p", "builtin.power-5v"), component("x"));
    expect(zoneOfProject(project, emptyLibrary())).toEqual({ p: "power", x: "unclassified" });
    expect(zoneLabel(project, "power")).toBe(FUNCTION_ZONE_LABELS.power);
    const renamed = setZoneName(project, "power", "  供电仓  ");
    expect(zoneLabel(renamed, "power")).toBe("供电仓");
    expect(zoneLabel(setZoneName(renamed, "power", "   "), "power")).toBe(FUNCTION_ZONE_LABELS.power);
    expect(setZoneName(renamed, "power", undefined).zoneNames).toBeUndefined();
  });
});

describe("批次2 自动整理布局：确定性、分区成列、锁定不动", () => {
  /** a、b 有连线 → 同一簇；c 孤立；d 锁定。 */
  const sample = (): Project => ({
    ...projectWith(component("a", "builtin.power-5v"), component("b", "builtin.esp32-devkit-demo"), component("c", "builtin.resistor-220r"), component("d", "builtin.red-led")),
    wires: [{ id: "w1", source: { componentId: "a", pinId: "A" }, target: { componentId: "b", pinId: "A" }, color: "#fff" }],
  });

  it("同一输入必得同一份坐标（确定性）", () => {
    const project = sample();
    const input = { project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) };
    expect(arrangeByZone(input)).toEqual(arrangeByZone({ ...input, project: sample() }));
  });

  it("只返回坐标，不增删改任何元件或连线", () => {
    const project = sample();
    const before = JSON.stringify(project);
    arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) });
    expect(JSON.stringify(project)).toBe(before);
  });

  it("连接在一起的元件落在同一行、同一分区列里；不同分区的簇各自成列", () => {
    const project = sample();
    const positions = arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) });
    // a（电源）与 b（主控）有连线 → 同一个连通簇 → 同一行铺开（两成员＝两列网格）。
    expect(positions.a.y).toBe(positions.b.y);
    expect(positions.b.x - positions.a.x).toBe(DEFAULT_COMPONENT_SIZE.width + 40);
    // c、d 都判不出用途 → 未分组列，排在电源列右侧（FUNCTION_ZONE_ORDER 里 power 在 unclassified 之前）。
    expect(positions.c.x).toBeGreaterThan(positions.b.x);
    // c 与 d 互不相连，是两簇，在同一列里竖直方向不能重叠。
    expect(positions.d.y).toBeGreaterThanOrEqual(positions.c.y + DEFAULT_COMPONENT_SIZE.height);
  });

  it("位置锁定的元件原地不动，且不参与聚簇", () => {
    const project = { ...sample(), components: sample().components.map((item) => (item.id === "d" ? { ...item, positionLocked: true, position: { x: 900, y: 700 } } : item)) };
    const positions = arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) });
    expect(positions.d).toBeUndefined();
    const moved = moveComponents(project, positions);
    expect(moved.components.find((item) => item.id === "d")!.position).toEqual({ x: 900, y: 700 });
  });

  it("锁定元件仍占住自己分区的空间：别的分区不会被摆到它身上（否则锁定的元件会被盖住）", () => {
    // a（电源）锁定在原位；它是电源区唯一成员，若整列宽度记 0，后面的列会左移到它的位置上把它盖住。
    const project = { ...sample(), components: sample().components.map((item) => (item.id === "a" ? { ...item, positionLocked: true, position: { x: 70, y: 110 } } : item)) };
    const positions = arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) });
    expect(positions.a).toBeUndefined();
    const lockedBox = { x: 70, y: 110, ...DEFAULT_COMPONENT_SIZE };
    // 锁定元件的纵向上方/下方都不允许别人压进来：所有被摆放的元件都必须落在它的右侧。
    for (const [id, point] of Object.entries(positions)) {
      expect(point.x, `${id} 压在锁定的 a 上`).toBeGreaterThanOrEqual(lockedBox.x + lockedBox.width);
    }
  });

  it("全部元件都被锁定时不返回任何坐标（界面据此给出提示，而不是原地空跑）", () => {
    const project = { ...sample(), components: sample().components.map((item) => ({ ...item, positionLocked: true })) };
    expect(arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) })).toEqual({});
  });

  it("排出来的元件互不重叠", () => {
    const project = sample();
    const positions = arrangeByZone({ project, sizes: sizes(project), zoneOf: zoneOfProject(project, emptyLibrary()) });
    const boxes = Object.entries(positions).map(([id, point]) => ({ id, ...point, ...DEFAULT_COMPONENT_SIZE }));
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps, `${a.id} 与 ${b.id} 重叠`).toBe(false);
    }
  });
});

describe("批次2 分区底色框与持久化", () => {
  it("包围盒＝成员包围盒 + 四周留白；只画有成员的分区", () => {
    const boxes = zoneBounds([
      { id: "a", zone: "power", x: 100, y: 100, width: 180, height: 120 },
      { id: "b", zone: "power", x: 400, y: 300, width: 180, height: 120 },
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({ zone: "power", x: 100 - 28, y: 100 - 28, width: 300 + 180 + 56, height: 200 + 120 + 56 });
  });

  it("新的可选字段写得进、读得出；旧项目（没有这些字段）仍能正常打开", () => {
    const project = setZoneName(setComponentZone(projectWith(component("a")), "a", "audio"), "audio", "喇叭区");
    const roundTrip = deserializeProject(serializeProject(project));
    expect(roundTrip.components[0].zone).toBe("audio");
    expect(roundTrip.zoneNames).toEqual({ audio: "喇叭区" });
    // 旧项目：完全没有 zone / positionLocked / zoneNames 三个字段。
    const legacy = JSON.parse(serializeProject(createProject("old", "旧项目")));
    delete legacy.components; legacy.components = [];
    expect(() => deserializeProject(JSON.stringify(legacy))).not.toThrow();
  });

  it("非法分区名与非法锁定值一律拒绝，不静默吞掉", () => {
    const base = JSON.parse(serializeProject(projectWith(component("a"))));
    expect(() => deserializeProject(JSON.stringify({ ...base, components: [{ ...base.components[0], zone: "自造分区" }] }))).toThrow("元件的功能分区无效");
    expect(() => deserializeProject(JSON.stringify({ ...base, components: [{ ...base.components[0], positionLocked: 1 }] }))).toThrow("元件的位置锁定标记无效");
    expect(() => deserializeProject(JSON.stringify({ ...base, zoneNames: { nope: "x" } }))).toThrow("分区名称表里有未知分区");
    expect(() => deserializeProject(JSON.stringify({ ...base, zoneNames: { power: "" } }))).toThrow("分区名称不能为空");
  });

  it("分区顺序覆盖全部 7 个分区且没有漏项", () => {
    expect([...FUNCTION_ZONE_ORDER].sort()).toEqual(Object.keys(FUNCTION_ZONE_LABELS).sort());
    expect(FUNCTION_ZONE_ORDER).toHaveLength(7);
  });
});

describe("批次2 与既有功能不互相破坏", () => {
  it("实例化出来的元件默认没有分区字段（不替用户猜），锁定字段也是缺省", () => {
    const definition = { ...createEmptyDefinition("user.amp", "功放"), category: "other" as const };
    const instance = instantiateFromDefinition(definition, "amp-1", { x: 0, y: 0 });
    expect(instance.zone).toBeUndefined();
    expect(instance.positionLocked).toBeUndefined();
  });

  it("setComponentPositionLocked 解锁时把字段整体删掉，不留 false 噪声", () => {
    const locked = setComponentPositionLocked(projectWith(component("a")), "a", true);
    expect(locked.components[0].positionLocked).toBe(true);
    expect(setComponentPositionLocked(locked, "a", false).components[0].positionLocked).toBeUndefined();
    expect(() => setComponentPositionLocked(projectWith(component("a")), "nope", true)).toThrow("元件不存在");
    expect(() => setComponentZone(projectWith(component("a")), "nope", "power")).toThrow("元件不存在");
  });

  it("moveComponents 忽略表里没有的元件与非法坐标", () => {
    const project = projectWith(component("a"), component("b"));
    const moved = moveComponents(project, { a: { x: 10, y: 20 }, b: { x: Number.NaN, y: 5 } });
    expect(moved.components[0].position).toEqual({ x: 10, y: 20 });
    expect(moved.components[1].position).toEqual({ x: 0, y: 0 });
  });
});