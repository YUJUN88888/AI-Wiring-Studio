import { describe, expect, it } from "vitest";
import { addComponent, addWire, createProject, deserializeProject, serializeProject, type ComponentInstance } from "../../src/domain";

const c = (id: string): ComponentInstance => ({ id, definitionId: "test", displayName: id, position: { x: 1, y: 2 }, rotation: 0, pins: [{ id: "P", name: "P", role: "PASSIVE", localPosition: { x: .5, y: .5 } }] });
describe("project serialization", () => {
  it("round-trips components and wires", () => {
    let project = addComponent(addComponent(createProject("p", "Test"), c("a")), c("b"));
    project = addWire(project, { id: "wire", source: { componentId: "a", pinId: "P" }, target: { componentId: "b", pinId: "P" }, color: "red", label: "rail" });
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
  it("rejects unsupported schemas and dangling endpoints", () => {
    expect(() => deserializeProject('{"schemaVersion":99}')).toThrow("不支持的项目文件版本");
    const p = createProject("p");
    expect(() => deserializeProject(JSON.stringify({ ...p, wires: [{ id: "x", source: { componentId: "gone", pinId: "P" }, target: { componentId: "gone", pinId: "P" } }] }))).toThrow("连线无效");
  });
  it("rejects malformed persisted self-loop and duplicate endpoint wires", () => {
    const project = addComponent(addComponent(createProject("p"), c("a")), c("b"));
    const selfLoop = { id: "self", source: { componentId: "a", pinId: "P" }, target: { componentId: "a", pinId: "P" }, color: "black" };
    expect(() => deserializeProject(JSON.stringify({ ...project, wires: [selfLoop] }))).toThrow("自环");
    const first = { id: "one", source: { componentId: "a", pinId: "P" }, target: { componentId: "b", pinId: "P" }, color: "black" };
    const reverse = { id: "two", source: first.target, target: first.source, color: "black" };
    expect(() => deserializeProject(JSON.stringify({ ...project, wires: [first, reverse] }))).toThrow("重复");
  });
  it("migrates legacy transforms without a confirmed VIN range to unknown-safe components", () => {
    const project = addComponent(createProject("legacy"), { ...c("reg"), pins: [...c("reg").pins, { id: "OUT", name: "OUT", role: "POWER_OUTPUT", localPosition: { x: 0, y: 1 } }], voltageTransforms: [{ inputPinId: "P", outputPinId: "OUT", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }] });
    const legacy = { ...project, schemaVersion: 1, components: project.components.map((component) => ({ ...component, voltageTransforms: [{ inputPinId: "P", outputPinId: "OUT", outputVoltage: 3.3 }] })) };
    const migrated = deserializeProject(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.components[0].voltageTransforms).toBeUndefined();
  });
  it("rejects malformed current transforms rather than letting ERC read them", () => {
    const project = addComponent(createProject("bad"), { ...c("reg"), pins: [...c("reg").pins, { id: "OUT", name: "OUT", role: "POWER_OUTPUT", localPosition: { x: 0, y: 1 } }], voltageTransforms: [{ inputPinId: "P", outputPinId: "OUT", outputVoltage: 3.3, inputVoltageRange: { min: 4.75, max: 5.25, unit: "V" } }] });
    const bad = { ...project, components: project.components.map((component) => ({ ...component, voltageTransforms: [{ inputPinId: "missing", outputPinId: "OUT", outputVoltage: Number.NaN, inputVoltageRange: { min: 5, max: 4, unit: "V" } }] })) };
    expect(() => deserializeProject(JSON.stringify(bad))).toThrow("电压变换无效");
  });
  it("accepts a chosen wire purpose and rejects an unknown one", () => {
    const base = addComponent(addComponent(createProject("p"), c("a")), c("b"));
    const wire = { id: "wire", source: { componentId: "a", pinId: "P" }, target: { componentId: "b", pinId: "P" }, color: "#57d4ff", purpose: "signal" as const, label: "电机供电正极" };
    // 用户亲手指定的用途与自定义文字都随项目存下来。
    expect(deserializeProject(JSON.stringify({ ...base, wires: [wire] })).wires[0]).toMatchObject({ purpose: "signal", label: "电机供电正极" });
    // 自造的用途名直接拒绝，不猜用户想表达什么。
    expect(() => deserializeProject(JSON.stringify({ ...base, wires: [{ ...wire, purpose: "motor" }] }))).toThrow("连线的线路用途无效");
    // 分类文字必须是文本。
    expect(() => deserializeProject(JSON.stringify({ ...base, wires: [{ ...wire, label: 42 }] }))).toThrow("连线的分类文字必须是文本");
  });
});
