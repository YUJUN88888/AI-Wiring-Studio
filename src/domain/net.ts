import type { ElectricalNet, NetKind, PinRef, Project } from "./types";

export const pinKey = (ref: PinRef): string => `${ref.componentId}:${ref.pinId}`;

export function findPin(project: Project, ref: PinRef) {
  return project.components.find((c) => c.id === ref.componentId)?.pins.find((p) => p.id === ref.pinId);
}

/** Builds only physical wire connectivity. It intentionally does not infer internal component paths. */
export function buildElectricalNets(project: Project): ElectricalNet[] {
  const parent = new Map<string, string>();
  const refs = new Map<string, PinRef>();
  const add = (ref: PinRef) => { const key = pinKey(ref); if (!parent.has(key)) { parent.set(key, key); refs.set(key, ref); } };
  const root = (key: string): string => { const p = parent.get(key)!; if (p === key) return key; const r = root(p); parent.set(key, r); return r; };
  const join = (a: string, b: string) => { const ra = root(a); const rb = root(b); if (ra !== rb) parent.set(rb, ra); };
  for (const c of project.components) for (const pin of c.pins) add({ componentId: c.id, pinId: pin.id });
  for (const wire of project.wires) {
    if (!findPin(project, wire.source) || !findPin(project, wire.target)) continue;
    add(wire.source); add(wire.target); join(pinKey(wire.source), pinKey(wire.target));
  }
  const grouped = new Map<string, { pins: PinRef[]; wireIds: string[] }>();
  for (const [key, ref] of refs) { const r = root(key); const group = grouped.get(r) ?? { pins: [], wireIds: [] }; group.pins.push(ref); grouped.set(r, group); }
  for (const wire of project.wires) {
    if (!findPin(project, wire.source) || !findPin(project, wire.target)) continue;
    const group = grouped.get(root(pinKey(wire.source))); if (group) group.wireIds.push(wire.id);
  }
  return [...grouped.values()].filter((g) => g.wireIds.length > 0).map((g, i) => ({ id: `net-${i + 1}`, ...g, kind: classifyNet(project, g.pins) }));
}

function classifyNet(project: Project, refs: PinRef[]): NetKind {
  const pins = refs.map((ref) => findPin(project, ref)!);
  // A known positive source is still POWER even if it is incorrectly shorted to GND;
  // ERC reports the dangerous condition separately.
  if (pins.some((pin) => pin.role === "POWER_OUTPUT" || pin.role === "POWER_INPUT")) return "POWER";
  if (pins.some((pin) => pin.role === "GND")) return "GROUND";
  if (pins.some((pin) => pin.role === "GPIO" || pin.role === "INPUT" || pin.role === "OUTPUT")) return "SIGNAL";
  return "UNKNOWN";
}
