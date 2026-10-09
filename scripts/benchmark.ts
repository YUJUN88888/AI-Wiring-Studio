import { performance } from "node:perf_hooks";
import { runErc } from "../src/domain/erc";
import { buildElectricalNets } from "../src/domain/net";
import { createM0PerformanceFixture, M0_COMPONENT_COUNT, M0_WIRE_COUNT } from "../src/domain/performanceFixture";
import { deserializeProject, serializeProject } from "../src/domain/serialization";

const WARMUP_RUNS = 10;
const MEASURED_RUNS = 50;

// These are M0 guardrails for domain work only, not a UI frame-rate claim.
// Values are intentionally cross-machine tolerant; CI may lower them after
// a recorded hardware baseline is established.
const thresholdsMs = {
  netBuildP95: 50,
  ercP95: 100,
  serializationRoundTripP95: 100,
} as const;

interface Measurement { name: string; samples: number[]; threshold: number; }

const fixture = createM0PerformanceFixture();
if (fixture.components.length !== M0_COMPONENT_COUNT || fixture.wires.length !== M0_WIRE_COUNT) {
  throw new Error("M0 performance fixture does not contain exactly 100 components and 300 wires.");
}

const serializedFixture = serializeProject(fixture);
const measurements: Measurement[] = [
  { name: "net build", samples: [], threshold: thresholdsMs.netBuildP95 },
  { name: "ERC", samples: [], threshold: thresholdsMs.ercP95 },
  { name: "serialization round trip", samples: [], threshold: thresholdsMs.serializationRoundTripP95 },
];

function time(action: () => void): number {
  const started = performance.now();
  action();
  return performance.now() - started;
}

function runOnce(record: boolean): void {
  const values = [
    () => buildElectricalNets(fixture),
    () => runErc(fixture),
    () => deserializeProject(serializeProject(fixture)),
  ];
  values.forEach((action, index) => {
    const elapsed = time(action);
    if (record) measurements[index].samples.push(elapsed);
  });
}

for (let index = 0; index < WARMUP_RUNS; index += 1) runOnce(false);
for (let index = 0; index < MEASURED_RUNS; index += 1) runOnce(true);

const percentile = (samples: number[], fraction: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const bytes = Buffer.byteLength(serializedFixture, "utf8");
console.log(`M0 domain benchmark | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log(`Fixture: ${fixture.components.length} components, ${fixture.wires.length} wires, ${bytes} serialized UTF-8 bytes`);

let failed = false;
for (const measurement of measurements) {
  const p50 = percentile(measurement.samples, 0.5);
  const p95 = percentile(measurement.samples, 0.95);
  const pass = p95 <= measurement.threshold;
  failed ||= !pass;
  console.log(`${pass ? "PASS" : "FAIL"} ${measurement.name}: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms (threshold <= ${measurement.threshold}ms; n=${measurement.samples.length})`);
}

if (failed) process.exitCode = 1;
