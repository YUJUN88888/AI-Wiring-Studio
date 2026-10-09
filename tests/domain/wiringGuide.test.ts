import { describe, expect, it } from 'vitest';
import { addComponent, addWire, createProject, nextWireToConnect, serializeProject, deserializeProject, setWireManuallyWired, wiringSequence, type ComponentInstance, type PinRole } from '../../src/domain';

/** 造一个只有角色差异的元件：接线顺序只认引脚角色，不看别的。 */
const part = (id: string, roles: Record<string, PinRole>): ComponentInstance => ({
  id, definitionId: 'test.part', displayName: id, position: { x: 0, y: 0 }, rotation: 0,
  pins: Object.entries(roles).map(([pinId, role]) => ({ id: pinId, name: pinId, role, localPosition: { x: 0, y: 0 } })),
});

/**
 * 故意把信号线放在项目最前面、电源线放后面：接线顺序应当与"连线在项目里的次序"无关，
 * 只按「先电源/地、再信号」的确定性分组重排。
 */
function demo() {
  let project = createProject('wiring-guide');
  for (const component of [part('a', { VCC: 'POWER_OUTPUT', GND: 'GND' }), part('b', { VCC: 'POWER_INPUT', GND: 'GND' }), part('c', { SIG: 'OUTPUT' }), part('d', { SIG: 'INPUT' })]) {
    project = addComponent(project, component);
  }
  project = addWire(project, { id: 'w-signal', source: { componentId: 'c', pinId: 'SIG' }, target: { componentId: 'd', pinId: 'SIG' }, color: '#57d4ff' });
  project = addWire(project, { id: 'w-power', source: { componentId: 'a', pinId: 'VCC' }, target: { componentId: 'b', pinId: 'VCC' }, color: '#e34b4b' });
  project = addWire(project, { id: 'w-ground', source: { componentId: 'a', pinId: 'GND' }, target: { componentId: 'b', pinId: 'GND' }, color: '#20242a' });
  return project;
}

describe('hands-on wiring guide', () => {
  it('orders wires power first, then ground, then signal (deterministic)', () => {
    const project = demo();
    expect(wiringSequence(project)).toEqual(['w-power', 'w-ground', 'w-signal']);
    // 同一张电路重复调用必须给出同一顺序。
    expect(wiringSequence(project)).toEqual(wiringSequence(project));
  });

  it('suggests the first wire that has not been marked as wired yet', () => {
    const project = demo();
    expect(nextWireToConnect(project)).toBe('w-power');
    expect(nextWireToConnect(setWireManuallyWired(project, 'w-power', true))).toBe('w-ground');
    const almost = setWireManuallyWired(setWireManuallyWired(project, 'w-power', true), 'w-ground', true);
    expect(nextWireToConnect(almost)).toBe('w-signal');
    const all = setWireManuallyWired(almost, 'w-signal', true);
    expect(nextWireToConnect(all)).toBeNull();
  });

  it('keeps the "wired" mark in the project file and drops the field when cleared', () => {
    const project = demo();
    const wired = setWireManuallyWired(project, 'w-power', true);
    expect(wired.wires.find((wire) => wire.id === 'w-power')?.manuallyWired).toBe(true);
    // 缺省＝未接好：取消后字段必须真的消失，不能留 `manuallyWired: false`。
    const cleared = setWireManuallyWired(wired, 'w-power', false);
    expect('manuallyWired' in (cleared.wires.find((wire) => wire.id === 'w-power') ?? {})).toBe(false);
    expect(() => setWireManuallyWired(project, 'missing', true)).toThrow('不存在');
  });

  it('round-trips the mark through the project file and rejects non-boolean values', () => {
    const project = setWireManuallyWired(demo(), 'w-power', true);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    // 端点都合法，唯一的问题就是 manuallyWired 不是布尔：必须由这一条校验拦下来。
    const bad = { ...demo(), wires: demo().wires.map((wire) => wire.id === 'w-power' ? { ...wire, manuallyWired: 'yes' } : wire) };
    expect(() => deserializeProject(JSON.stringify(bad))).toThrow('连线接线状态无效');
  });
});