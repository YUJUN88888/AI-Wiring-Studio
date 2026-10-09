import { describe, expect, it } from 'vitest';
import { applyProjectUpdate, buildUpdatePreview, diffProjects, isProjectUpdateEmpty, parseWiringCode, previewProject, setWireManuallyWired, setWireWaypoints, wireEndpointKey, type Project } from '../../src/domain';

/**
 * 画布起点就用接线代码生成：这样"当前画布"与"重新导入的代码"用的是同一套内置定义快照，
 * 一一对应的引脚与定义 ID 完全一致，才谈得上"没有差异"。
 */
const code = (text: string): Project => {
  const result = parseWiringCode(text, { projectId: 'canvas' });
  if (result.status !== 'ok') throw new Error(`示例代码应当可解析：${result.message}`);
  return result.project;
};

const CURRENT = `version 1
component u1 resistor-220r "电阻一" at 10,20
component u2 resistor-220r "电阻二" at 10,20
wire u1.A u2.A color #57d4ff
`;
const current = () => code(CURRENT);
/** 当前那一根线的端点键，断言里用它而不是内部序号。 */
const currentWireKey = () => wireEndpointKey(current().wires[0]);

describe('wiring code update diff', () => {
  it('classifies added / removed components and wires by identity, not by sequence number', () => {
    // 唯一那根线从 u1.A–u2.A 改到 u1.A–u3.A：按"端点"判定为一删一增。
    const incoming = code(`version 1
component u1 resistor-220r "电阻一" at 300,400
component u3 resistor-220r "电阻三" at 30,40
wire u1.A u3.A color #57d4ff
`);
    const diff = diffProjects(current(), incoming);
    expect(diff.addedComponents).toEqual(['u3']);
    expect(diff.removedComponents).toEqual(['u2']);
    expect(diff.changedComponents).toEqual([]);
    expect(diff.addedWires).toEqual([wireEndpointKey(incoming.wires[0])]);
    expect(diff.removedWires).toEqual([currentWireKey()]);
    expect(diff.changedWires).toEqual([]);
    expect(isProjectUpdateEmpty(diff)).toBe(false);
  });

  it('keeps wire identity stable when the code inserts a new wire before it', () => {
    // 在代码最前面插入一根无关的线：后面那根线的内部序号从 w1 变成 w2，但它并没有被改。
    const incoming = code(`version 1
component u1 resistor-220r "电阻一" at 10,20
component u2 resistor-220r "电阻二" at 10,20
component u3 resistor-220r "电阻三" at 10,20
wire u3.A u3.B color #57d4ff
wire u1.A u2.A color #57d4ff
`);
    const diff = diffProjects(current(), incoming);
    expect(diff.changedWires).toEqual([]);
    expect(diff.addedWires).toEqual([wireEndpointKey(incoming.wires[0])]);
    expect(diff.removedWires).toEqual([]);
  });

  it('reports no diff when the code matches the canvas (position is not content)', () => {
    const incoming = code(CURRENT.replace('at 10,20', 'at 999,999'));
    expect(isProjectUpdateEmpty(diffProjects(current(), incoming))).toBe(true);
    // 两端写反在电气上是同一根线，不算被改。
    const reversed = code(CURRENT.replace('wire u1.A u2.A', 'wire u2.A u1.A'));
    expect(isProjectUpdateEmpty(diffProjects(current(), reversed))).toBe(true);
    // 改了颜色才算被改。
    const recolored = code(CURRENT.replace('#57d4ff', '#e34b4b'));
    expect(diffProjects(current(), recolored).changedWires).toEqual([currentWireKey()]);
  });

  it('preview keeps every wire once and marks removed ones with a distinct id', () => {
    const incoming = code(`version 1
component u3 resistor-220r "电阻三"
wire u3.A u3.B
`);
    const preview = previewProject(current(), incoming);
    expect(preview.components.map((component) => component.id).sort()).toEqual(['u1', 'u2', 'u3']);
    // 三个元件 + 两根线：新增的那根用代码里的 id，被删的那根加 -removed 后缀避免 id 撞车。
    expect(preview.wires.map((wire) => wire.id).sort()).toEqual(['w1', 'w1-removed']);
    expect(new Set(preview.wires.map((wire) => wire.id)).size).toBe(2);

    const preview2 = buildUpdatePreview(diffProjects(current(), incoming));
    expect(preview2.components.get('u3')).toBe('added');
    // 代码里只声明了 u3：画布上的 u1、u2 都会被删除。
    expect(preview2.components.get('u1')).toBe('removed');
    expect(preview2.components.get('u2')).toBe('removed');
    expect(preview2.wires.get(wireEndpointKey(incoming.wires[0]))).toBe('added');
    expect(preview2.wires.get(currentWireKey())).toBe('removed');
  });

  it('applying keeps the user position and the hand-made wire state, and deletes what the code dropped', () => {
    const manual = setWireManuallyWired(setWireWaypoints(current(), 'w1', [{ x: 5, y: 5 }]), 'w1', true);
    const incoming = code(`version 1
component u1 resistor-220r "电阻一" at 700,800
component u2 resistor-220r "电阻二" at 700,800
wire u1.A u2.A color #e34b4b
`);
    const next = applyProjectUpdate(manual, incoming);
    // 位置保留画布上的（10,20），不被代码里的 700,800 覆盖。
    expect(next.components.map((component) => component.position)).toEqual([{ x: 10, y: 20 }, { x: 10, y: 20 }]);
    // 端点没变、只是改了颜色：手工固定的途经点与「已接好」标记都要留下。
    expect(next.wires[0].color).toBe('#e34b4b');
    expect(next.wires[0].waypoints).toEqual([{ x: 5, y: 5 }]);
    expect(next.wires[0].manuallyWired).toBe(true);

    // 代码里去掉了 u2 与那根线：应用后画布只剩代码里提到的内容。
    const trimmed = code(`version 1
component u1 resistor-220r "电阻一"
`);
    const after = applyProjectUpdate(manual, trimmed);
    expect(after.components.map((component) => component.id)).toEqual(['u1']);
    expect(after.wires).toEqual([]);
  });
});