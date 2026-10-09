import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BaseEdge, useInternalNode, useReactFlow, useStore, useStoreApi, type EdgeProps } from '@xyflow/react';
import { isDarkColor, routeWire, sideOfPin, wireEndpointKey, type RoutePoint, type RouteRect, type RouteSide } from '../domain';
import { PinHighlightContext } from './highlight';

/**
 * 折线连线（八方向：水平 / 垂直 / 45°）。
 *
 * 路径完全由域层的 routeWire 纯函数算出来，这里只负责三件事：
 * 1. 渲染：把点序列画成带圆角的折线；
 * 2. 折点编辑：选中连线后出现折点圆点，拖动它就变成"用户固定途经点"；
 * 3. 线段拖拽：拖动某一整段，整段沿垂直方向平移，等效于同时改相邻折点。
 *
 * 「增量重路由」：只订阅与布线有关的节点签名（位置 + 实测尺寸），
 * 所以移动一个元件只会让真正受影响的连线重算，单纯选中元件不会触发全部重算。
 * 未固定的连线始终自动重算并绕开障碍物；固定了途经点的连线保持用户定下的形状。
 */

export type RoutedEdgeData = {
  wireId: string;
  /** 两端的引脚 ID。A8 的差异判据是"两端引脚"，而 EdgeProps 里拿不到 handle 名字，所以建边时就带过来。 */
  sourcePin?: string;
  targetPin?: string;
  /** 用户固定途经点；缺省表示完全自动布线。 */
  waypoints?: RoutePoint[];
  /** 拖动结束时回写途经点；传 undefined 表示恢复自动布线。 */
  onWaypointsChange?: (wireId: string, waypoints?: RoutePoint[]) => void;
  /** 当前折线的登记表，供右键「固定途经点」直接拿屏幕上这条路径。 */
  registry?: { current: Map<string, RoutePoint[]> };
};

const CORNER_RADIUS = 9;
const BEND_RADIUS = 5;
/** A7：动手接线模式里"还没接"的连线统一用这个灰色，与已接好线的原色形成对比。 */
const HANDS_ON_PENDING_COLOR = '#54637a';
/**
 * 批次1：连线的三档视觉强度。
 * - 默认（无聚焦、筛选＝全部）：适度降低，让元件与分组名先被看清，而不是被一片线淹掉。
 * - 聚焦命中（悬停/选中的模块相关、点亮的网络、选中的线、当前筛选出的线）：满强度。
 * - 淡化（不符合筛选、或与聚焦无关）：退到背景里。
 */
const FOCUS_MUTED_OPACITY = 0.1;
const FOCUS_DEFAULT_OPACITY = 0.62;

/** 画布节点上取包围盒：内部节点用绝对坐标，普通节点退回自己的位置。 */
type NodeLike = {
  measured?: { width?: number; height?: number };
  position?: { x: number; y: number };
  internals?: { positionAbsolute?: { x: number; y: number } };
};
function rectOf(node: NodeLike | undefined): RouteRect | null {
  const width = node?.measured?.width;
  const height = node?.measured?.height;
  const position = node?.internals?.positionAbsolute ?? node?.position;
  if (typeof width !== 'number' || typeof height !== 'number' || !position) return null;
  return { x: position.x, y: position.y, width, height };
}

/**
 * 包围盒的"值指纹"，专门用来当 useMemo 的依赖。
 * rectOf 每次都返回新对象，若直接把它放进依赖数组，**任何一次渲染都会让所有连线重算路径**——
 * 于是选中一根线、改个颜色都会让整片连线跟着挪动。用值指纹就能保证"几何真变了才重算"。
 */
function rectKey(rect: RouteRect | null): string {
  return rect ? `${rect.x}|${rect.y}|${rect.width}|${rect.height}` : '';
}

function toSide(value: unknown, fallback: RouteSide): RouteSide {
  const text = String(value);
  return text === 'left' || text === 'right' || text === 'top' || text === 'bottom' ? text : fallback;
}

/** 把折线点序列画成 SVG 路径，拐角处用一小段圆弧过渡。 */
function buildPath(points: readonly RoutePoint[], radius = CORNER_RADIUS): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const limit = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
    const enter = pointTowards(corner, previous, limit);
    const leave = pointTowards(corner, next, limit);
    d += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${leave.x} ${leave.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

const distance = (a: RoutePoint, b: RoutePoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** 从 from 朝 to 方向走 length 距离的点。 */
function pointTowards(from: RoutePoint, to: RoutePoint, length: number): RoutePoint {
  const total = distance(from, to);
  if (total < 1e-6) return { x: from.x, y: from.y };
  return { x: from.x + ((to.x - from.x) / total) * length, y: from.y + ((to.y - from.y) / total) * length };
}

type DragState = {
  kind: 'bend' | 'segment';
  /** 折点拖动：该点在整条折线里的下标；线段拖动：该段起点在整条折线里的下标。 */
  index: number;
  pointer: RoutePoint;
  points: RoutePoint[];
};

export function RoutedEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, selected, data }: EdgeProps) {
  const edgeData = data as RoutedEdgeData | undefined;
  const registry = edgeData?.registry;
  const interaction = useContext(PinHighlightContext);
  // A14：这条连线是否落在当前被点亮的电气网络里。高亮只是加一层光晕，不改连线的持久颜色。
  const lit = interaction.wires.has(id);
  // A7：动手接线的灰化/闪烁/已接好同样只走 Context，不改连线的持久颜色，也不必重建边对象。
  const wiring = interaction.wiring;
  /** A8：这条线在"更新预览"里的状态（新增 / 将被删除 / 将被改写）。判据是两端引脚，与内部序号无关。 */
  const previewState = edgeData?.sourcePin && edgeData.targetPin
    ? interaction.preview?.wires.get(wireEndpointKey({
        source: { componentId: source, pinId: edgeData.sourcePin },
        target: { componentId: target, pinId: edgeData.targetPin },
      })) ?? null
    : null;
  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [draft, setDraft] = useState<RoutePoint[] | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // 只订阅"会影响布线"的节点数据（位置 + 实测尺寸）。选中元件、改颜色都不会改变这个签名，
  // 所以那些操作不会让每条连线都重算一遍。
  const obstacleSignature = useStore((state) => state.nodes
    .map((node) => `${node.id}:${Math.round(node.position.x)},${Math.round(node.position.y)},${Math.round(node.measured?.width ?? 0)}x${Math.round(node.measured?.height ?? 0)}`)
    .join('|'));

  // 用"值指纹"而不是对象本身当依赖：rectOf 每次都返回新对象，直接放进依赖数组会让
  // **任何一次渲染都重算这条线**（选中元件、改颜色都会），于是路径在
  // "读上一遍别人路径做避让"的迭代里整片漂移，项目一大还会卡到点不动任何东西。
  const sourceRectKey = rectKey(rectOf(sourceNode));
  const targetRectKey = rectKey(rectOf(targetNode));
  const sourceRect = useMemo(() => rectOf(sourceNode), [sourceRectKey]);
  const targetRect = useMemo(() => rectOf(targetNode), [targetRectKey]);

  // A4：其它连线的折线要等大家都画完第一遍才登记进 registry，所以挂载后再补算一遍（0 → 1），
  // 让每条线都能避开与既有连线的长距离平行重合。补算只依赖"别人上一遍的结果"，不会互相触发，稳定收敛。
  const [pass, setPass] = useState(0);
  useEffect(() => { setPass(1); }, []);

  const route = useMemo(() => {
    // 障碍物是画布上所有元件：签名一变（移动/缩放/增删元件）才重新取一次。
    const obstacles: RouteRect[] = [];
    for (const node of store.getState().nodes) {
      const rect = rectOf(node as NodeLike);
      if (rect) obstacles.push(rect);
    }
    // 既有连线＝registry 里除自己以外的路径；按 wireId 排序取，保证与登记顺序无关（同样是"同样的输入同样的结果"）。
    const existing: RoutePoint[][] = [];
    if (registry) {
      for (const wireId of [...registry.current.keys()].sort()) {
        if (wireId === id) continue;
        const path = registry.current.get(wireId);
        if (path) existing.push(path);
      }
    }
    const start = { x: sourceX, y: sourceY };
    const end = { x: targetX, y: targetY };
    return routeWire({
      start,
      end,
      startSide: sourceRect ? sideOfPin(start, sourceRect) : toSide(sourcePosition, 'right'),
      endSide: targetRect ? sideOfPin(end, targetRect) : toSide(targetPosition, 'left'),
      obstacles,
      fixed: edgeData?.waypoints,
      existing,
    });
  }, [sourceX, sourceY, targetX, targetY, obstacleSignature, sourceRect, targetRect, store, edgeData?.waypoints, registry, id, pass]);

  const points = draft ?? route.points;

  // 登记当前折线，供右键「固定途经点」使用（画出来是什么样，就固定成什么样）。
  useEffect(() => {
    if (!registry) return;
    registry.current.set(id, route.points);
    return () => { registry.current.delete(id); };
  }, [id, registry, route.points]);

  const beginDrag = (event: ReactPointerEvent, kind: DragState['kind'], index: number) => {
    event.stopPropagation();
    if (!(event.currentTarget as Element).setPointerCapture) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    let base = points.map((point) => ({ ...point }));
    let start = index;
    // 一条直线上没有折点可抓：先把中间"撑"成两个折点，于是拖动整段就等于把线拉开成一个 Z 形。
    if (kind === 'segment' && base.length === 2) {
      const first = base[0];
      const last = base[1];
      base = [
        first,
        { x: first.x + (last.x - first.x) / 3, y: first.y + (last.y - first.y) / 3 },
        { x: first.x + ((last.x - first.x) * 2) / 3, y: first.y + ((last.y - first.y) * 2) / 3 },
        last,
      ];
      start = 1;
    }
    dragRef.current = { kind, index: start, pointer: screenToFlowPosition({ x: event.clientX, y: event.clientY }), points: base };
    setDraft(base);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const delta = { x: current.x - drag.pointer.x, y: current.y - drag.pointer.y };
    const next = drag.points.map((point) => ({ ...point }));
    if (drag.kind === 'bend') {
      // 折点：直接搬动这一个点，起点终点（引脚）不能动。
      const index = Math.min(Math.max(drag.index, 1), next.length - 2);
      next[index] = { x: drag.points[index].x + delta.x, y: drag.points[index].y + delta.y };
    } else {
      // 线段：整段沿自己的垂直方向平移。把鼠标位移投影到垂直方向即可，
      // 水平段只吃 dy、垂直段只吃 dx、45° 段两个方向同时吃，一套公式通吃。
      const from = drag.points[drag.index];
      const to = drag.points[drag.index + 1];
      const length = distance(from, to);
      const normal = length < 1e-6 ? { x: 0, y: 1 } : { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
      const amount = delta.x * normal.x + delta.y * normal.y;
      const shift = { x: normal.x * amount, y: normal.y * amount };
      const touched = new Set<number>();
      if (drag.index > 0) touched.add(drag.index);
      if (drag.index + 1 < next.length - 1) touched.add(drag.index + 1);
      for (const index of touched) next[index] = { x: drag.points[index].x + shift.x, y: drag.points[index].y + shift.y };
    }
    setDraft(next);
  };

  const endDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    if (!drag) return;
    const moved = draft ?? drag.points;
    const nextWaypoints = moved.slice(1, -1).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    setDraft(null);
    edgeData?.onWaypointsChange?.(edgeData.wireId, nextWaypoints);
  };

  const path = buildPath(points);
  // A7：动手接线模式下，未接好的线统一灰化；已接好的线恢复原色，一眼就能看出进度。
  // A8 预览优先：正在对比差异时不叠加动手接线的灰化，避免两套"灰"混淆。
  const pending = previewState === null && wiring.active && !wiring.done.has(id);
  const suggested = pending && wiring.suggested === id;
  // 批次1：默认降低线路视觉强度；聚焦命中恢复满强度，无关的线退到背景里。
  // 透明度只作用于显示，连线的持久颜色（`Wire.color`）一个字节都不动。
  const purpose = interaction.purposes.get(id);
  const opacity = interaction.focus.mutedWires.has(id)
    ? FOCUS_MUTED_OPACITY
    : interaction.focus.strongWires.has(id) ? 1 : FOCUS_DEFAULT_OPACITY;
  const stroke = typeof style?.stroke === 'string' ? style.stroke : '';
  // 深色画布上几乎看不见的线（默认地线色 #20242a 就是）补一层浅色衬底：
  // 「深色背景下的地线必须清晰可见」，但只改显示，不改线自己的颜色。
  const casing = !interaction.focus.mutedWires.has(id) && purpose === 'ground' && isDarkColor(stroke);
  const edgeStyle = previewState === 'removed'
    // A8：将被删除的连线＝半透明灰色 + 虚线（形状还在，但一眼看出"它要没了"）。
    ? { ...style, stroke: HANDS_ON_PENDING_COLOR, strokeDasharray: '7 6', opacity: 0.45 }
    : pending
      ? { ...style, stroke: HANDS_ON_PENDING_COLOR, opacity }
      : { ...style, opacity };

  return <>
    {/* 衬底画在最底下：让深色地线在深色背景上仍然看得见（只是显示，不改颜色）。 */}
    {casing && <path className="routed-edge-casing" d={path} />}
    {/* 高亮光晕画在连线底下：比加粗更醒目，又不会盖住连线本身的颜色。 */}
    {lit && <path className="routed-edge-halo" d={path} />}
    {/* A7「当下应接的线」：闪烁的黄色轮廓，提醒用户现在该接哪一根。 */}
    {suggested && <path className="routed-edge-suggested" d={path} />}
    {/* A8：新增＝绿色轮廓，将被改写＝黄色轮廓（与删除的虚线灰形成三档对比）。 */}
    {previewState === 'added' && <path className="routed-edge-added" d={path} />}
    {previewState === 'changed' && <path className="routed-edge-changed" d={path} />}
    <BaseEdge id={id} path={path} style={edgeStyle} />
    {selected && <>
      {points.slice(1, -1).map((point, index) => (
        <circle
          key={`bend-${index}`}
          className="routed-bend nodrag nopan"
          cx={point.x}
          cy={point.y}
          r={BEND_RADIUS}
          style={{ pointerEvents: 'all', cursor: 'grab' }}
          onPointerDown={(event) => beginDrag(event, 'bend', index + 1)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      ))}
      {points.slice(0, -1).map((point, index) => (
        <path
          key={`segment-${index}`}
          className="routed-segment nodrag nopan"
          d={`M ${point.x} ${point.y} L ${points[index + 1].x} ${points[index + 1].y}`}
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
          onPointerDown={(event) => beginDrag(event, 'segment', index)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      ))}
    </>}
  </>;
}