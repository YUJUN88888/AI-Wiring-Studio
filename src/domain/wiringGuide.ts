import { buildElectricalNets } from "./net";
import type { NetKind, Project } from "./types";

/**
 * A7【动手接线模式】的建议顺序：先供电、再接地、再信号，最后是判不出用途的网络。
 * 这是一份**确定性**排序：同一张电路无论重开多少次，得到的顺序完全一样
 * （网络分组顺序来自 buildElectricalNets 的确定性推导，组内按连线在项目里的原始顺序）。
 */
const KIND_PRIORITY: Record<NetKind, number> = { POWER: 0, GROUND: 1, SIGNAL: 2, UNKNOWN: 3 };

/** 返回全部连线的建议接线顺序（连线 id 列表）。 */
export function wiringSequence(project: Project): string[] {
  const indexOf = new Map(project.wires.map((wire, index) => [wire.id, index]));
  const ordered: string[] = [];
  const grouped = new Set<string>();
  // 同一网络里的连线排在一起，整张网络接完再进入下一张，避免来回反复找线。
  const nets = [...buildElectricalNets(project)].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  for (const net of nets) {
    for (const wireId of [...net.wireIds].filter((id) => indexOf.has(id)).sort((a, b) => indexOf.get(a)! - indexOf.get(b)!)) {
      ordered.push(wireId);
      grouped.add(wireId);
    }
  }
  // 端点不存在、因此不属于任何网络的连线：仍然要给用户一个顺序，排在最后。
  for (const wire of project.wires) if (!grouped.has(wire.id)) ordered.push(wire.id);
  return ordered;
}

/** 下一根建议接的线：建议顺序里第一根尚未标记「已接好」的；全部接完返回 null。 */
export function nextWireToConnect(project: Project): string | null {
  for (const wireId of wiringSequence(project)) {
    const wire = project.wires.find((item) => item.id === wireId);
    if (wire && !wire.manuallyWired) return wireId;
  }
  return null;
}