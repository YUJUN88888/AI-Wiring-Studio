import { FUNCTION_ZONE_ORDER } from "./layoutZones";
import { WIRE_PURPOSE_ORDER } from "./wireFocus";
import { CURRENT_SCHEMA_VERSION, type FunctionZoneId, type Project, type WirePurpose } from "./types";

export function serializeProject(project: Project): string { validateProject(project); return JSON.stringify(project, null, 2); }
export function deserializeProject(json: string): Project {
  let value: unknown; try { value = JSON.parse(json); } catch { throw new Error("项目文件不是合法的 JSON"); }
  const migrated = migrateProject(value);
  validateProject(migrated); return migrated as Project;
}

/** v1 transforms did not describe a valid input range. Drop them rather than manufacture a known output voltage. */
function migrateProject(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return value;
  const components = Array.isArray(raw.components) ? raw.components.map((component) => {
    if (!component || typeof component !== "object") return component;
    const c = component as Record<string, unknown>;
    const transforms = Array.isArray(c.voltageTransforms) ? c.voltageTransforms.filter(hasValidRangeShape) : undefined;
    const next: Record<string, unknown> = { ...c };
    if (transforms?.length) next.voltageTransforms = transforms; else delete next.voltageTransforms;
    return next;
  }) : raw.components;
  return { ...raw, schemaVersion: CURRENT_SCHEMA_VERSION, components };
}

function hasValidRangeShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const transform = value as { inputVoltageRange?: unknown };
  return validRange(transform.inputVoltageRange);
}
function validRange(value: unknown): value is { min: number; max: number; unit: "V" } {
  if (!value || typeof value !== "object") return false;
  const range = value as { min?: unknown; max?: unknown; unit?: unknown };
  return typeof range.min === "number" && Number.isFinite(range.min) && typeof range.max === "number" && Number.isFinite(range.max) && range.min <= range.max && range.unit === "V";
}

export function validateProject(value: unknown): asserts value is Project {
  if (!value || typeof value !== "object") throw new Error("项目必须是一个对象");
  const p = value as Partial<Project>;
  if (p.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error(`不支持的项目文件版本：${String(p.schemaVersion)}`);
  if (typeof p.id !== "string" || typeof p.name !== "string" || !p.canvas || !Array.isArray(p.components) || !Array.isArray(p.wires)) throw new Error("项目缺少必要字段");
  const componentIds = new Set<string>();
  for (const c of p.components) {
    if (!c || typeof c.id !== "string" || componentIds.has(c.id) || !Array.isArray(c.pins)) throw new Error("元件无效或 ID 重复");
    componentIds.add(c.id); const pinIds = new Set<string>();
    for (const pin of c.pins) { if (!pin || typeof pin.id !== "string" || pinIds.has(pin.id)) throw new Error("引脚无效或 ID 重复"); pinIds.add(pin.id); }
    if (c.voltageTransforms !== undefined) {
      if (!Array.isArray(c.voltageTransforms)) throw new Error("电压变换数据无效");
      for (const transform of c.voltageTransforms) {
        if (!transform || typeof transform.inputPinId !== "string" || typeof transform.outputPinId !== "string" || !pinIds.has(transform.inputPinId) || !pinIds.has(transform.outputPinId) || typeof transform.outputVoltage !== "number" || !Number.isFinite(transform.outputVoltage) || !validRange(transform.inputVoltageRange)) throw new Error("电压变换无效");
      }
    }
    // A11 成组标记：可选字符串（组 id）；旧项目没有它。空串不算合法的组名，宁可报错也不留一个没有名字的组。
    const groupId = (c as { groupId?: unknown }).groupId;
    if (groupId !== undefined && (typeof groupId !== "string" || groupId.length === 0)) throw new Error("元件的成组标记无效");
    // 批次2 的功能分区：可选，且必须是已知分区之一（闭集），不接受自造的名字。
    const zone = (c as { zone?: unknown }).zone;
    if (zone !== undefined && !FUNCTION_ZONE_ORDER.includes(zone as FunctionZoneId)) throw new Error("元件的功能分区无效");
    // 批次2 的位置锁定：可选布尔，旧项目没有它；有就必须是布尔，不接受 0/1/"true"。
    const locked = (c as { positionLocked?: unknown }).positionLocked;
    if (locked !== undefined && typeof locked !== "boolean") throw new Error("元件的位置锁定标记无效");
  }
  // 批次2 的分区重命名：可选对象，键必须是已知分区，值必须是非空字符串。
  if (p.zoneNames !== undefined) {
    if (!p.zoneNames || typeof p.zoneNames !== "object" || Array.isArray(p.zoneNames)) throw new Error("分区名称表无效");
    for (const [key, value] of Object.entries(p.zoneNames)) {
      if (!FUNCTION_ZONE_ORDER.includes(key as FunctionZoneId)) throw new Error(`分区名称表里有未知分区：${key}`);
      if (typeof value !== "string" || value.length === 0) throw new Error("分区名称不能为空");
    }
  }
  const endpoints = new Set([...p.components].flatMap((c) => c.pins.map((pin) => `${c.id}:${pin.id}`)));
  const wireIds = new Set<string>(); const wireEndpoints = new Set<string>();
  for (const w of p.wires) {
    const source = `${w?.source?.componentId}:${w?.source?.pinId}`; const target = `${w?.target?.componentId}:${w?.target?.pinId}`; const endpointKey = [source, target].sort().join("|");
    if (!w || typeof w.id !== "string" || wireIds.has(w.id) || !endpoints.has(source) || !endpoints.has(target) || source === target || wireEndpoints.has(endpointKey)) throw new Error("连线无效、自环或重复");
    if ((w as { waypoints?: unknown }).waypoints !== undefined && !validWaypoints((w as { waypoints?: unknown }).waypoints)) throw new Error("连线途经点无效");
    // A7「已接好」标记：可选布尔，旧项目没有它；有就必须是布尔，不接受 0/1/"true" 这类含糊值。
    if ((w as { manuallyWired?: unknown }).manuallyWired !== undefined && typeof (w as { manuallyWired?: unknown }).manuallyWired !== "boolean") throw new Error("连线接线状态无效");
    // 批次3 线路分类：label 是自由文本（历史字段，之前完全没校验，这里补上）；必须是字符串。
    const label = (w as { label?: unknown }).label;
    if (label !== undefined && typeof label !== "string") throw new Error("连线的分类文字必须是文本");
    // purpose 是用户手工指定的用途，必须是四个已知值之一（闭集），不接受自造的用途名。
    const purpose = (w as { purpose?: unknown }).purpose;
    if (purpose !== undefined && !WIRE_PURPOSE_ORDER.includes(purpose as WirePurpose)) throw new Error("连线的线路用途无效");
    wireIds.add(w.id); wireEndpoints.add(endpointKey);
  }
}

/** 途经点是可选字段：旧项目文件没有它，必须仍能正常打开（向后兼容）。 */
function validWaypoints(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((point) => {
    if (!point || typeof point !== "object") return false;
    const { x, y } = point as { x?: unknown; y?: unknown };
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
  });
}
