import { describe, expect, it } from "vitest";
import {
  applyProjectUpdate,
  componentsInGroup,
  createProject,
  deleteComponent,
  deserializeProject,
  groupComponents,
  serializeProject,
  ungroup,
  type ComponentInstance,
  type Project,
} from "../../src/domain";

const component = (id: string, position = { x: 0, y: 0 }): ComponentInstance => ({
  id,
  definitionId: `builtin.${id}`,
  displayName: id,
  position,
  rotation: 0,
  pins: [{ id: "A", name: "A", role: "PASSIVE", localPosition: { x: 0, y: 0 } }],
});

const projectWith = (...components: ComponentInstance[]): Project => ({ ...createProject("p"), components });
const groups = (project: Project) => project.components.map((item) => item.groupId ?? null);

describe("A11 成组", () => {
  it("给选中的元件打同一个组 id，其它元件不受影响", () => {
    const project = projectWith(component("a"), component("b"), component("c"));
    const next = groupComponents(project, ["a", "b"], "g1");
    expect(groups(next)).toEqual(["g1", "g1", null]);
    expect(componentsInGroup(next, "g1").map((item) => item.id)).toEqual(["a", "b"]);
    expect(componentsInGroup(next, "nope")).toEqual([]);
  });

  it("少于两个元件不成组：报错而不是留一个「1 人组」", () => {
    const project = projectWith(component("a"), component("b"));
    expect(() => groupComponents(project, ["a"], "g1")).toThrow("至少选中两个元件才能成组");
    expect(() => groupComponents(project, [], "g1")).toThrow("至少选中两个元件才能成组");
    expect(() => groupComponents(project, ["a", "b"], "")).toThrow("组标识不能为空");
    // 有元件不在画布上时也不能"部分成组"，否则用户看到的组和实际不符。
    expect(() => groupComponents(project, ["a", "ghost"], "g1")).toThrow("有元件不在画布上，无法成组");
    expect(groups(project)).toEqual([null, null]);
  });

  it("解组只清掉这一组的标记，成员与位置都不动", () => {
    const project = groupComponents(projectWith(component("a", { x: 5, y: 6 }), component("b"), component("c")), ["a", "b"], "g1");
    const next = ungroup(project, "g1");
    expect(groups(next)).toEqual([null, null, null]);
    expect(next.components[0].position).toEqual({ x: 5, y: 6 });
    // 组不存在时是空操作（返回原对象，不白白产生新状态）。
    expect(ungroup(next, "g1")).toBe(next);
  });

  it("删除成员后只剩一个的组自动解除，不留残留标记", () => {
    const project = groupComponents(projectWith(component("a"), component("b"), component("c")), ["a", "b", "c"], "g1");
    const afterOne = deleteComponent(project, "a");
    expect(groups(afterOne)).toEqual(["g1", "g1"]);
    const afterTwo = deleteComponent(afterOne, "b");
    expect(groups(afterTwo)).toEqual([null]);
  });

  it("成组标记随项目文件存取，且必须是合法字符串", () => {
    const project = groupComponents(projectWith(component("a"), component("b")), ["a", "b"], "g1");
    expect(deserializeProject(serializeProject(project)).components.map((item) => item.groupId)).toEqual(["g1", "g1"]);

    const invalid = { ...projectWith(component("a")), components: [{ ...component("a"), groupId: 7 }] };
    expect(() => serializeProject(invalid as unknown as Project)).toThrow("元件的成组标记无效");
    const empty = { ...projectWith(component("a")), components: [{ ...component("a"), groupId: "" }] };
    expect(() => serializeProject(empty as unknown as Project)).toThrow("元件的成组标记无效");
  });

  it("按接线代码更新画布时保留用户的成组标记（代码里没有这个概念）", () => {
    const canvas = groupComponents(projectWith(component("a"), component("b")), ["a", "b"], "g1");
    // 代码更新会按实例 id 重写元件，组标记属于画布侧状态，必须与位置一样被保留。
    const incoming = projectWith(component("a", { x: 999, y: 999 }), component("b"), component("c"));
    const merged = applyProjectUpdate(canvas, incoming);
    expect(merged.components.find((item) => item.id === "a")?.groupId).toBe("g1");
    expect(merged.components.find((item) => item.id === "b")?.groupId).toBe("g1");
    expect(merged.components.find((item) => item.id === "a")?.position).toEqual({ x: 0, y: 0 });
    expect(merged.components.find((item) => item.id === "c")?.groupId).toBeUndefined();
  });
});