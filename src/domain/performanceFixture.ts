import { CURRENT_SCHEMA_VERSION, type ComponentInstance, type Project, type Wire } from "./types";

/**
 * Stable M0 performance fixture. Keep its topology and IDs deterministic so
 * results remain comparable between runs and future releases.
 */
export const M0_COMPONENT_COUNT = 100;
export const M0_WIRE_COUNT = 300;

export function createM0PerformanceFixture(): Project {
  const components: ComponentInstance[] = Array.from({ length: M0_COMPONENT_COUNT }, (_, index) => ({
    id: `fixture-component-${String(index).padStart(3, "0")}`,
    definitionId: "fixture-passive-module-v1",
    displayName: `Fixture module ${index + 1}`,
    position: { x: (index % 10) * 240, y: Math.floor(index / 10) * 160 },
    rotation: 0,
    // Eight pins leave room for future fixture scenarios without changing
    // today's three independent 100-wire rings.
    pins: Array.from({ length: 8 }, (_, pinIndex) => ({
      id: `P${pinIndex + 1}`,
      name: `P${pinIndex + 1}`,
      role: "PASSIVE" as const,
      localPosition: { x: pinIndex < 4 ? 0 : 1, y: (pinIndex % 4) / 3 },
    })),
  }));

  const wires: Wire[] = [];
  for (let ring = 0; ring < 3; ring += 1) {
    for (let index = 0; index < M0_COMPONENT_COUNT; index += 1) {
      const next = (index + 1) % M0_COMPONENT_COUNT;
      wires.push({
        id: `fixture-wire-${ring}-${String(index).padStart(3, "0")}`,
        source: { componentId: components[index].id, pinId: `P${ring + 1}` },
        target: { componentId: components[next].id, pinId: `P${ring + 1}` },
        color: ["#d32f2f", "#1976d2", "#388e3c"][ring],
        label: `fixture-net-${ring + 1}`,
      });
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "m0-performance-fixture",
    name: "M0 deterministic 100 component / 300 wire fixture",
    canvas: { x: 0, y: 0, zoom: 1, gridSize: 20 },
    components,
    wires,
  };
}
