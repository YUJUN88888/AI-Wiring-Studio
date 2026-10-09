import { describe, expect, it } from 'vitest';
import { addComponent, addWire, createProject, deleteWire, updateWire, type ComponentInstance } from '../../src/domain';

const component = (id: string): ComponentInstance => ({
  id, definitionId: 'test.part', displayName: id, position: { x: 0, y: 0 }, rotation: 0,
  pins: [{ id: 'P', name: 'P', role: 'PASSIVE', localPosition: { x: 0, y: 0 } }],
});

describe('wire editing', () => {
  it('changes only the requested wire color', () => {
    let project = addComponent(createProject('wire-edit'), component('a'));
    project = addComponent(project, component('b'));
    project = addWire(project, { id: 'w1', source: { componentId: 'a', pinId: 'P' }, target: { componentId: 'b', pinId: 'P' }, color: '#57d4ff' });
    const changed = updateWire(project, 'w1', { color: '#e34b4b' });
    expect(changed.wires).toEqual([{ ...project.wires[0], color: '#e34b4b' }]);
    expect(() => updateWire(project, 'missing', { color: '#000000' })).toThrow('不存在');
  });

  it('deletes a wire without changing components', () => {
    let project = addComponent(createProject('wire-delete'), component('a'));
    project = addComponent(project, component('b'));
    project = addWire(project, { id: 'w1', source: { componentId: 'a', pinId: 'P' }, target: { componentId: 'b', pinId: 'P' }, color: '#57d4ff' });
    const changed = deleteWire(project, 'w1');
    expect(changed.components).toHaveLength(2);
    expect(changed.wires).toEqual([]);
  });

  it('classifies a wire, and clears the field back to auto by deleting it', () => {
    let project = addComponent(createProject('wire-purpose'), component('a'));
    project = addComponent(project, component('b'));
    project = addWire(project, { id: 'w1', source: { componentId: 'a', pinId: 'P' }, target: { componentId: 'b', pinId: 'P' }, color: '#57d4ff' });
    const classified = updateWire(project, 'w1', { purpose: 'ground', label: '电机供电负极' });
    expect(classified.wires[0]).toMatchObject({ purpose: 'ground', label: '电机供电负极' });
    // 传 undefined ＝ 撤销手工分类，字段整体删除（不留 `purpose: undefined` 噪声）。
    const cleared = updateWire(classified, 'w1', { purpose: undefined, label: undefined });
    expect('purpose' in cleared.wires[0]).toBe(false);
    expect('label' in cleared.wires[0]).toBe(false);
    // 只改分类，不改颜色与端点。
    expect(cleared.wires[0].color).toBe('#57d4ff');
    expect(cleared.wires[0].source).toEqual(project.wires[0].source);
  });
});
