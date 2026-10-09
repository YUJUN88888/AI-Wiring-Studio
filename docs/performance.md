# M0 performance benchmark

Run `npm run benchmark` to measure framework-independent domain work using a
deterministic fixture with exactly **100 components** and **300 wires**. It
reports p50 and p95 latency for electrical-net construction, ERC, and project
serialization/deserialization. The command exits non-zero when a p95 guardrail
is exceeded.

The M0 guardrails are deliberately conservative cross-machine limits:

| Operation | p95 limit |
| --- | ---: |
| Net build | 50 ms |
| ERC | 100 ms |
| Serialization round trip | 100 ms |

This benchmark does not measure React Flow rendering, GPU work, or desktop-app
startup. Results must always be recorded with the Node version, platform, and
hardware before using them as release-performance evidence.
