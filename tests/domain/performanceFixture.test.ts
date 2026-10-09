import { describe, expect, it } from "vitest";
import { buildElectricalNets } from "../../src/domain/net";
import { createM0PerformanceFixture, M0_COMPONENT_COUNT, M0_WIRE_COUNT } from "../../src/domain/performanceFixture";
import { deserializeProject, serializeProject } from "../../src/domain/serialization";

describe("M0 deterministic performance fixture", () => {
  it("contains exactly 100 components and 300 valid wires", () => {
    const project = createM0PerformanceFixture();
    expect(project.components).toHaveLength(M0_COMPONENT_COUNT);
    expect(project.wires).toHaveLength(M0_WIRE_COUNT);
    expect(buildElectricalNets(project)).toHaveLength(3);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
