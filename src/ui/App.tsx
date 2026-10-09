import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { addEdge, Background, BackgroundVariant, ConnectionMode, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodeId, useNodesState, useReactFlow, ViewportPortal, type Connection, type Edge, type Node } from '@xyflow/react';
import { addComponent, addWire, appearanceCssVariables, applyDefinitionToInstances, applyProjectUpdate, arrangeByZone, buildElectricalNets, buildUpdatePreview, builtInComponentCatalog, categoryOf, componentZone, createBuiltInComponent, createEmptyDefinition, createEsp32DevKitDemo, createLayoutFromImage, createLocalStorageAppearanceStorage, createLocalStorageLibraryStorage, createLocalStorageShellStorage, createPower5V, createProject, createRedLed, createResistor220R, componentsInGroup, computeWireFocus, defaultAppearance, DEFAULT_COMPONENT_SIZE, defaultShellLayout, definitionFromInstance, deleteComponent, deleteWire, deserializeProject, diffProjects, emptyLibrary, findDefinition, FUNCTION_ZONE_LABELS, FUNCTION_ZONE_ORDER, GRADE_LABELS, GRADE_ORDER, gradeOfSeverity, groupComponents, imageRenderGeometry, instantiateFromDefinition, isProjectUpdateEmpty, layoutPart, loadAppearance, loadLibrary, loadShellLayout, moveComponents, nextWireToConnect, pinKey, previewProject, problemWireIds, removeDefinition, runErc, saveAppearance, saveLibrary, saveShellLayout, serializeProject, setComponentPositionLocked, setComponentZone, setWireManuallyWired, setWireWaypoints, setZoneName, ungroup, upsertDefinition, updateWire, wirePurposes, WIRE_FILTER_LABELS, WIRE_PURPOSE_LABELS, WIRE_PURPOSE_ORDER, zoneBounds, zoneLabel, zoneOfProject, type Appearance, type BuiltInComponentKind, type ComponentCategory, type ComponentDefinition, type ComponentImage, type ComponentInstance, type ComponentSize, type ErcResult, type FunctionZoneId, type LayoutBox, type PinRef, type PinRole, type ProblemGrade, type Project, type ProjectUpdateDiff, type RoutePoint, type ShellLayout, type UserLibrary, type Wire, type WireFilter, type WirePurpose } from '../domain';
import { PinHighlightContext } from './highlight';
import { ComponentEditor, categoryLabels } from './ComponentEditor';
import { readFileAsDataUrl, readImageSize } from './ComponentImageEditor';
import { InspectorPanel } from './InspectorPanel';
import { AiImportPanel } from './AiImportPanel';
import { WiringCodePanel, type WiringCodeApplyMode } from './WiringCodePanel';
import { ComponentWarehouse } from './ComponentWarehouse';
import { AppearancePanel } from './AppearancePanel';
import { RoutedEdge } from './RoutedEdge';
import { WireFilterBar } from './WireFilterBar';
import { WireInfoPanel, type WireInfoData } from './WireInfoPanel';
import { TitleBar } from './TitleBar';
import { Button, IconButton, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from './components';
import { FolderOpen, Save, Settings as SettingsIcon } from 'lucide-react';

type Kind = 'source' | 'board' | 'led' | 'resistor' | 'generic';
/** 画布引脚：除名字外还带上类型、本地坐标、位置是否有出处与"是否由用户亲手确认过"，供图片元件排布与放置连线端点。 */
type PartPin = { id: string; name: string; role: PinRole; x: number; y: number; placed: boolean; confirmed: boolean };
type PartData = { label: string; pins: PartPin[]; kind: Kind; grouped: boolean; locked: boolean; image?: ComponentImage; footprint?: { width: number; height: number } };
const STORAGE_KEY = 'aiws.m0.demo';
/** 组件库拖拽到画布时使用的自定义数据类型。 */
const USER_COMPONENT_MIME = 'application/aiws-user-component';
/** 内置元件列表直接由目录派生，避免"目录里有、侧栏里没有"的两处漂移。 */
const builtInChoices = Object.values(builtInComponentCatalog).map((definition) => ({
  kind: definition.kind,
  definitionId: definition.definitionId,
  label: definition.label,
  category: definition.category,
  pinCount: definition.create('probe', { x: 0, y: 0 }).pins.length,
}));
/** 电源/接地引脚的默认轮廓：电源＝红色轮廓，接地＝近黑描边 + 浅色外发光（深色主题下纯黑不可见）。 */
function pinRoleClass(role: PinRole): string {
  return role === 'POWER_INPUT' || role === 'POWER_OUTPUT' ? 'pin-power' : role === 'GND' ? 'pin-gnd' : '';
}
/** A2：撤销/重做只把文字换成两个弯曲箭头；可访问名仍叫「撤销」「重做」，快捷键与禁用态不变。
    图标自带 fill/stroke="currentColor"（与 lucide 一致）：不依赖父级类名提供描边，
    父级 color 是什么色，箭头就是什么色。 */
function UndoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;
}
function RedoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>;
}
const demoProject: Project = {
  ...createProject('m0-demo', 'M0 演示项目'),
  components: [
    createPower5V('power-5v', { x: 70, y: 110 }),
    createEsp32DevKitDemo('esp32', { x: 390, y: 160 }),
    createResistor220R('resistor', { x: 780, y: 90 }),
    createRedLed('led', { x: 780, y: 300 }),
  ],
};
function kindFor(c: ComponentInstance): Kind { return c.definitionId.includes('power') ? 'source' : c.definitionId.includes('esp32') ? 'board' : c.definitionId.includes('resistor') ? 'resistor' : c.definitionId.includes('led') ? 'led' : 'generic'; }
/** 画布右键菜单：元件、连线，以及空白处（空白处用来放【快速选择】）。 */
type CanvasContextMenu = { kind: 'component' | 'wire'; id: string; x: number; y: number } | { kind: 'canvas'; x: number; y: number };
/** 【快速选择】的一个候选项：点一下就把 `ids` 里的元件全部选中。 */
type QuickSelectChoice = { key: string; label: string; color?: string; ids: string[] };
/** 【快速选择】的三个维度：按连线颜色 / 按类别 / 按供电。 */
type QuickSelectGroup = { title: string; choices: QuickSelectChoice[] };
/** 分类的固定顺序，与元件编辑器、元件仓库一致；保证同一张电路每次得到同样的菜单顺序。 */
const CATEGORY_ORDER: ComponentCategory[] = ['power', 'ground', 'mcu', 'regulator', 'diode', 'capacitor', 'passive', 'switch', 'other'];
/** 空白处右键的【快速选择】菜单最大尺寸（与 styles.css 的 .context-quick 对应）。 */
const QUICK_MENU_BOX = { width: 284, height: 428 };
/**
 * A11：框选要用**左键拖拽**，而 React Flow 只在 `panOnDrag !== true` 时才启用 `selectionOnDrag`。
 * 所以画布平移改为**中键拖拽**（按住 Space + 左键拖拽同样可用），左键留给框选、右键留给菜单。
 */
const PAN_ON_DRAG = [1];
/** 菜单靠近画布右/下边缘时往回收：否则按钮会跑出视口，看得见却点不到。 */
const quickMenuPosition = (x: number, y: number) => ({
  left: Math.max(8, Math.min(x, window.innerWidth - QUICK_MENU_BOX.width)),
  top: Math.max(8, Math.min(y, window.innerHeight - QUICK_MENU_BOX.height)),
});
function nodeFromComponent(c: ComponentInstance, definition?: ComponentDefinition): Node<PartData> {
  // 引脚位置是否已经有明确来源：用户亲手改过（userOverrides）或定义里记了 X/Y 的来源
  // （例如 AI 给出的像素坐标经换算后写入的"估算 · AI 建议"）都算已定位；
  // 都没有的引脚交给 layoutPart 自动排布，避免全部叠在原点。
  const overrides = definition?.userOverrides ?? [];
  const provenance = definition?.provenance ?? {};
  /** 引脚位置是否是"用户亲手录入/拖动"确认下来的（编辑器把改过的字段记成 已确认·用户录入）。 */
  const userConfirmed = (pinId: string) => {
    const x = provenance[`pins.${pinId}.x`];
    const y = provenance[`pins.${pinId}.y`];
    const byUser = (item: { confidence?: string; source?: string } | undefined) => item?.confidence === 'confirmed' && item?.source === 'user';
    return byUser(x) || byUser(y);
  };
  const locked = c.positionLocked === true;
  const data: PartData = { label: c.displayName, pins: c.pins.map((p) => ({ id: p.id, name: p.name, role: p.role, x: p.localPosition.x, y: p.localPosition.y, placed: overrides.includes(`pins.${p.id}.x`) || overrides.includes(`pins.${p.id}.y`) || provenance[`pins.${p.id}.x`] !== undefined || provenance[`pins.${p.id}.y`] !== undefined, confirmed: userConfirmed(p.id) })), kind: kindFor(c), grouped: c.groupId !== undefined, locked };
  // 所有元件统一走盒式布局：每个引脚只画一个圆点、名字贴在自己的引脚旁。
  // 逐行列表（名字居中、每行左右各一个热点）看起来就像"一个引脚名对应两个引脚"，
  // 而且多引脚模块会被拉成一长条、引脚名全挤在盒子正中——内置元件同样不该这样。
  if (definition?.image) data.image = definition.image;
  // 盒子尺寸：有定义就沿用（含用户改过的），没有定义时给确定性兜底，高度由 layoutPart 按引脚数撑大。
  data.footprint = definition?.footprint ?? DEFAULT_COMPONENT_SIZE;
  // 批次2：位置锁定的元件在画布上不能被拖动（React Flow 自己认这个字段），这与「自动整理布局不动它」是同一件事的两面。
  return { id: c.id, type: 'part', position: c.position, draggable: !locked, data };
}
function withPositions(project: Project, nodes: Node[]): Project { const map = new Map(nodes.map((n) => [n.id, n.position])); return { ...project, components: project.components.map((c) => ({ ...c, position: map.get(c.id) ?? c.position })) }; }

function WiringCanvas() {
  const [project, setProject] = useState<Project>(demoProject);
  const [nodes, setNodes, onNodesChange] = useNodesState(demoProject.components.map((component) => nodeFromComponent(component)));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [history, setHistory] = useState<Project[]>([]); const [future, setFuture] = useState<Project[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  /** 右键菜单支持 Escape 关闭：只在菜单打开时挂监听，不与画布快捷键/弹窗的 Escape 冲突。 */
  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextMenu]);
  // 用户元件库：启动时从本地存储载入；损坏时明确提示，绝不静默清空用户数据。
  const libraryLoad = useMemo(() => loadLibrary(createLocalStorageLibraryStorage()), []);
  const [library, setLibrary] = useState<UserLibrary>(() => (libraryLoad.kind === 'ok' ? libraryLoad.library : emptyLibrary()));
  // A1 外观：独立于项目文件保存在本地；损坏时用默认配色，但要明确告知，不静默清空用户设置。
  const appearanceStorage = useMemo(() => createLocalStorageAppearanceStorage(), []);
  const appearanceLoad = useMemo(() => loadAppearance(appearanceStorage), [appearanceStorage]);
  const [appearance, setAppearance] = useState<Appearance>(() => (appearanceLoad.kind === 'ok' ? appearanceLoad.appearance : defaultAppearance()));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState(libraryLoad.kind === 'corrupt' ? `用户元件库读取失败：${libraryLoad.message}` : appearanceLoad.kind === 'corrupt' ? `外观设置读取失败，已改用默认配色：${appearanceLoad.message}` : '就绪：从任意引脚拖到另一引脚建立连线');
  const [editorDraft, setEditorDraft] = useState<ComponentDefinition | null>(null);
  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [wiringCodeOpen, setWiringCodeOpen] = useState(false);
  /** 元件库弹窗：用户元件与内置元件统一收在这里浏览、筛选、检索；侧栏只留一个入口按钮。 */
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  /** 右键「调整元件大小」的小对话框；宽度高度先用实测尺寸预填，用户只做微调。 */
  const [sizeDraft, setSizeDraft] = useState<{ nodeId: string; label: string; width: string; height: string } | null>(null);
  /** 主工作台左侧元件库：关键字检索与分类筛选。只过滤"能放上画布"的条目，不改任何库数据。 */
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'mine' | ComponentCategory>('all');
  /** 左侧列表条目：用户元件 + 尚未转成用户元件的内置元件，按分类筛选并做关键字匹配（与元件仓库同一套判据）。 */
  const libraryItems = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const matches = (...parts: (string | undefined)[]) => query === '' || parts.some((part) => part !== undefined && part.toLowerCase().includes(query));
    const mine = library.definitions.filter((definition) => matches(definition.displayName, definition.model, definition.id));
    const builtIns = builtInChoices
      .filter((choice) => !library.definitions.some((definition) => definition.id === choice.definitionId))
      .filter((choice) => matches(choice.label, choice.kind, choice.definitionId));
    return {
      mine: libraryFilter === 'all' || libraryFilter === 'mine' ? mine : mine.filter((definition) => definition.category === libraryFilter),
      builtIns: libraryFilter === 'mine' ? [] : builtIns.filter((choice) => libraryFilter === 'all' || choice.category === libraryFilter),
    };
  }, [library.definitions, libraryQuery, libraryFilter]);
  /** 只保留"实际有内容"的分类，点一个空分类没有意义（与元件仓库一致）。 */
  const libraryChips = useMemo(() => [
    { key: 'all' as const, label: '全部' },
    { key: 'mine' as const, label: '我的' },
    ...CATEGORY_ORDER
      .filter((category) => library.definitions.some((definition) => definition.category === category) || builtInChoices.some((choice) => choice.category === category))
      .map((category) => ({ key: category, label: categoryLabels[category] })),
  ], [library.definitions]);
  /** A14：当前被点亮的引脚键（`componentId:pinId`）；null 表示没有高亮。 */
  const [highlightPin, setHighlightPin] = useState<string | null>(null);
  /** A7：动手接线模式开关（纯 UI 状态；"已接好"写在项目文件的 `Wire.manuallyWired`）。 */
  const [handsOn, setHandsOn] = useState(false);
  /** A8：待确认的「接线代码更新」。非 null 时画布按"并集"渲染差异，确认或取消前都不改项目状态。 */
  const [pendingUpdate, setPendingUpdate] = useState<{ incoming: Project; diff: ProjectUpdateDiff } | null>(null);
  /** 批次1：悬停的元件（临时聚焦）与选中的连线（显示起点/终点/用途/网络名）。都是纯展示态。 */
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  /**
   * 批次3：界面外壳的显示态（左右侧栏 / 底边栏 / 线路筛选的收起态与筛选维度）。
   * 与项目文件、外观一样单独保存：它是"这台机器的界面偏好"，换项目不该带走；重启后自动恢复。
   */
  const shellStorage = useMemo(() => createLocalStorageShellStorage(), []);
  const shellLoad = useMemo(() => loadShellLayout(shellStorage), [shellStorage]);
  const [shell, setShell] = useState<ShellLayout>(() => (shellLoad.kind === 'ok' ? shellLoad.layout : defaultShellLayout()));
  /** 批次1：线路筛选维度。只切换显示，不改任何连接；值存在 shell 里以便持久化。 */
  const wireFilter = shell.wireFilter;
  // 界面布局读取失败时提示一次：仍用默认布局继续，但不静默吞掉用户的设置数据。
  useEffect(() => { if (shellLoad.kind === 'corrupt') setStatus(`界面布局设置读取失败，已用默认布局：${shellLoad.message}`); }, [shellLoad]);
  /** 批次2：正在重命名的分区与草稿文字；null 表示没有在改名。 */
  const [zoneRename, setZoneRename] = useState<{ zone: FunctionZoneId; text: string } | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodeTypes = useMemo(() => ({ part: PartNode }), []);
  /** 折线连线的自定义边类型：八方向折线 + 折点/线段编辑。 */
  const edgeTypes = useMemo(() => ({ routed: RoutedEdge }), []);
  /** 每条折线当前算出来的点序列：右键「固定途经点」直接拿屏幕上看到的那条线，不会和显示不一致。 */
  const routeRegistry = useRef<Map<string, RoutePoint[]>>(new Map());
  /** 批次3：右键「自定义分类文字」输入框用非受控输入 + ref 读取，避免额外状态与"边打字边被重置"。 */
  const wireLabelInput = useRef<HTMLInputElement | null>(null);
  /**
   * A14：点击引脚 → 点亮它所在的整张电气网络（同一网络上的所有引脚与连线）。
   * 网络归属完全由领域层的确定性连通性算法给出，这里只做展示；再点同一个引脚即取消。
   * 没有连线的引脚没有什么可高亮的，明确提示而不是假装点亮。
   */
  const selectPin = useCallback((componentId: string, pinId: string) => {
    const key = `${componentId}:${pinId}`;
    if (highlightPin === key) { setHighlightPin(null); setStatus('已取消网络高亮。'); return; }
    const net = buildElectricalNets(project).find((item) => item.pins.some((ref) => pinKey(ref) === key));
    if (!net) { setHighlightPin(null); setStatus(`引脚 ${pinId} 当前没有连线，暂无可高亮的网络。`); return; }
    setHighlightPin(key);
    setStatus(`已高亮该引脚所在网络：${net.pins.length} 个引脚、${net.wireIds.length} 根连线。`);
  }, [highlightPin, project]);
  /** A7：动手接线模式的展示态。已接好集合与"下一根"都从当前项目现算，所以增删连线后进度始终一致。 */
  const wiringGuide = useMemo(() => ({
    active: handsOn,
    done: new Set(project.wires.filter((wire) => wire.manuallyWired === true).map((wire) => wire.id)),
    suggested: handsOn ? nextWireToConnect(project) : null,
  }), [handsOn, project]);
  /** A8：差异预览态。只在预览期间存在，取消或应用后立刻消失。 */
  const updatePreview = useMemo(() => (pendingUpdate ? buildUpdatePreview(pendingUpdate.diff) : null), [pendingUpdate]);
  /** 检查结果：确定性代码算出，界面各处共用这一份，不重复计算也不分叉。 */
  const erc = runErc(project);
  /** 批次1：每条连线的用途（电源/地线/信号/未分类）与被检查判为问题的连线，都是确定性推导。 */
  const purposes = useMemo(() => wirePurposes(project, erc), [project, erc]);
  const problemWires = useMemo(() => problemWireIds(erc), [erc]);
  /** 选中元件的 id 签名：只在"选中集合"真的变化时才变，拖动元件时不会每帧重算聚焦。 */
  const selectedSignature = useMemo(() => nodes.filter((node) => node.selected).map((node) => node.id).sort().join('|'), [nodes]);
  /** 批次1 的聚焦目标＝悬停的元件 ∪ 选中的元件。 */
  const focusedComponents = useMemo(() => {
    const focused = new Set<string>(selectedSignature ? selectedSignature.split('|') : []);
    if (hoveredComponent) focused.add(hoveredComponent);
    return focused;
  }, [selectedSignature, hoveredComponent]);
  /** A14：点击引脚点亮整张电气网络（引脚键 + 连线 id）；网络归属由领域层连通性算法给出。 */
  const netHighlight = useMemo(() => {
    const pins = new Set<string>();
    const wires = new Set<string>();
    if (highlightPin) {
      const net = buildElectricalNets(project).find((item) => item.pins.some((ref) => pinKey(ref) === highlightPin));
      if (net) { for (const ref of net.pins) pins.add(pinKey(ref)); for (const id of net.wireIds) wires.add(id); }
    }
    return { pins, wires };
  }, [highlightPin, project]);
  /** 批次1：把「聚焦目标 + 筛选」折算成淡化/强调集合。纯展示态，不改任何连接数据。 */
  const focusView = useMemo(() => computeWireFocus({
    wires: project.wires,
    components: project.components,
    purposes,
    problemWires,
    focused: focusedComponents,
    netWires: netHighlight.wires,
    selectedWire,
    filter: wireFilter,
  }), [project.wires, project.components, purposes, problemWires, focusedComponents, netHighlight, selectedWire, wireFilter]);
  /** 批次1：选中连线的文字信息（起点/终点/用途/网络名）。判不出来就写「未分类」，不猜。 */
  const wireInfo = useMemo((): WireInfoData | null => {
    const wire = selectedWire ? project.wires.find((item) => item.id === selectedWire) : undefined;
    if (!wire) return null;
    const describe = (ref: PinRef) => {
      const component = project.components.find((item) => item.id === ref.componentId);
      const pin = component?.pins.find((item) => item.id === ref.pinId);
      return `${component?.displayName ?? `${ref.componentId}（元件不存在）`}.${pin?.name ?? ref.pinId}`;
    };
    const net = erc.nets.find((item) => item.wireIds.includes(wire.id));
    const voltage = net ? erc.voltages[net.id] : undefined;
    return {
      wireId: wire.id,
      source: describe(wire.source),
      target: describe(wire.target),
      purpose: purposes.get(wire.id) ?? 'unclassified',
      label: wire.label ?? '',
      netLabel: net ? `${net.id} · ${net.pins.length} 个引脚 / ${net.wireIds.length} 根线` : '没有电气网络（悬空线）',
      netDetail: !net ? '未知' : voltage?.kind === 'Known' ? `${voltage.value}V（已确认）` : voltage?.kind === 'Conflict' ? '电压冲突（已报错）' : '未知（缺参数）',
      manuallyWired: wire.manuallyWired === true,
    };
  }, [selectedWire, project, erc, purposes]);
  /** 用途判不出来（未分类）的连线数：如实提示，而不是把它算进「信号」。 */
  const unclassifiedWires = useMemo(() => project.wires.filter((wire) => purposes.get(wire.id) === 'unclassified').length, [project.wires, purposes]);
  /**
   * 批次2：每个元件的实测尺寸（React Flow 量出来的），拿不到就退回定义尺寸、再退回兜底。
   * 自动整理与分区底色框共用这一份，避免两处各算一套导致"框和元件对不上"。
   */
  const nodeSizes = useMemo(() => {
    const sizes: Record<string, ComponentSize> = {};
    for (const node of nodes) {
      const measured = node.measured;
      sizes[node.id] = measured?.width && measured?.height
        ? { width: measured.width, height: measured.height }
        : node.data.footprint ?? DEFAULT_COMPONENT_SIZE;
    }
    return sizes;
  }, [nodes]);
  /**
   * 批次2：分区底色框。用**实时位置**算包围盒，所以用户手动挪动元件后框会跟着走。
   * 完全不参与渲染之外的任何逻辑：不改变元件归属，也不改变任何连接。
   */
  const zoneBoxes = useMemo(() => {
    const positionById = new Map(nodes.map((node) => [node.id, node.position]));
    const boxes: LayoutBox[] = [];
    for (const component of project.components) {
      const position = positionById.get(component.id);
      if (!position) continue;
      const size = nodeSizes[component.id] ?? DEFAULT_COMPONENT_SIZE;
      boxes.push({ id: component.id, zone: componentZone(component, library), x: position.x, y: position.y, width: size.width, height: size.height });
    }
    return zoneBounds(boxes);
  }, [nodes, nodeSizes, project.components, library]);
  /** 传给画布的高亮/聚焦视图：所有集合都由当前项目现算，增删连线后始终与电路一致。 */
  const highlight = useMemo(() => {
    const pins = new Set(netHighlight.pins);
    const wires = new Set(netHighlight.wires);
    // 批次1：选中一根线时把它的两个端点一起点亮，这条线本身也进高亮集合（给一层光晕）。
    if (selectedWire) {
      const wire = project.wires.find((item) => item.id === selectedWire);
      if (wire) { wires.add(wire.id); pins.add(pinKey(wire.source)); pins.add(pinKey(wire.target)); }
    }
    return { select: selectPin, pins, wires, wiring: wiringGuide, preview: updatePreview, focus: focusView, purposes };
  }, [netHighlight, selectedWire, project.wires, selectPin, wiringGuide, updatePreview, focusView, purposes]);
  const commit = useCallback((next: Project, text: string) => { setProject((old) => { setHistory((h) => [...h, old]); return next; }); setFuture([]); setStatus(text); }, []);
  // A1：外观直接写进根节点的 CSS 变量，样式表里用 var(...) 取值，改一处即全局生效。
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(appearanceCssVariables(appearance))) root.style.setProperty(name, value);
  }, [appearance]);
  // A1：面板里改一下即存一下（无"保存"按钮）；保存失败只报错，不回滚已经看到的效果。
  const changeAppearance = useCallback((next: Appearance) => {
    setAppearance(next);
    try { saveAppearance(appearanceStorage, next); } catch (error) { setStatus(error instanceof Error ? `外观设置保存失败：${error.message}` : '外观设置保存失败'); }
  }, [appearanceStorage]);
  const resetAppearance = useCallback(() => { changeAppearance(defaultAppearance()); setStatus('外观已恢复默认配色。'); }, [changeAppearance]);
  // 边的 data 里存着回调，会长期留在 React Flow 的边对象里；用 ref 取"最新"的 project / commit，
  // 否则拖动折点时读到的会是建边那一刻的旧项目状态。
  const latest = useRef({ project, commit, setEdges });
  latest.current = { project, commit, setEdges };
  /** 折点或线段拖动结束后回写途经点；传 undefined（或空）表示恢复自动布线。 */
  const setWaypoints = useCallback((wireId: string, waypoints?: RoutePoint[]) => {
    const { project: current, commit: put, setEdges: apply } = latest.current;
    try {
      const next = setWireWaypoints(current, wireId, waypoints);
      const fixed = (waypoints?.length ?? 0) > 0;
      put(next, fixed ? `已固定折线途经点（${waypoints?.length} 个）：移动元件时这段走向会保留。` : '已恢复自动布线：元件移动后连线会重新绕开障碍。');
      apply((all) => all.map((edge) => edge.id === wireId ? { ...edge, data: { ...edge.data, waypoints: fixed ? waypoints : undefined } } : edge));
    } catch (error) { setStatus(error instanceof Error ? `折线途经点更新失败：${error.message}` : '折线途经点更新失败'); }
  }, []);
  /** 由连线生成画布上的折线边：路径不在这里算，交给 RoutedEdge 按实时引脚位置 + 障碍物现算。 */
  const buildEdge = useCallback((wire: Wire): Edge => ({
    id: wire.id,
    source: wire.source.componentId,
    sourceHandle: `out-${wire.source.pinId}`,
    target: wire.target.componentId,
    targetHandle: `in-${wire.target.pinId}`,
    type: 'routed',
    style: { stroke: wire.color, strokeWidth: 3 },
    data: { wireId: wire.id, sourcePin: wire.source.pinId, targetPin: wire.target.pinId, waypoints: wire.waypoints, onWaypointsChange: setWaypoints, registry: routeRegistry },
  }), [setWaypoints]);
  /** 用给定的用户库重建节点：改完元件定义后要立刻按新库渲染，不能等 setLibrary 生效。 */
  const rebuild = useCallback((p: Project, nextLibrary: UserLibrary = library) => { setNodes(p.components.map((component) => nodeFromComponent(component, findDefinition(nextLibrary, component.definitionId)))); setEdges(p.wires.map(buildEdge)); }, [setNodes, setEdges, library, buildEdge]);
  const pinIdFromHandle = (handle: string) => handle.replace(/^(?:in|out)-/, '');
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle || (c.source === c.target && c.sourceHandle === c.targetHandle)) return;
    // 引脚身份只认 handle 名字里 `in-`/`out-` 之后的引脚 id：图片元件每个引脚只有一个热点，
    // 连线方向交给 React Flow 的 loose 模式决定，所以两端都可能拿到同一种前缀。
    const wire: Wire = { id: crypto.randomUUID(), source: { componentId: c.source, pinId: pinIdFromHandle(c.sourceHandle) }, target: { componentId: c.target, pinId: pinIdFromHandle(c.targetHandle) }, color: appearance.wireColor };
    try { const next = addWire(project, wire); commit(next, `连线已创建；ERC：${runErc(next).problems.length} 个问题。`); setEdges((all) => addEdge(buildEdge(wire), all)); } catch (e) { setStatus(e instanceof Error ? e.message : '无法创建连线'); }
  }, [project, commit, setEdges, buildEdge, appearance.wireColor]);
  /**
   * A11【成组】的"整组跟随"：拖动开始时记下整组各成员的起始位置，
   * 拖动过程中用同一个位移量平移其余成员（被拖的那一个由 React Flow 自己更新）。
   * 起点放在 ref 里，避免连续到来的拖动事件读到上一帧已经被改过的位置。
   */
  const groupDrag = useRef<{ id: string; start: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart = useCallback((_event: unknown, node: Node) => {
    const groupId = project.components.find((component) => component.id === node.id)?.groupId;
    if (!groupId) { groupDrag.current = null; return; }
    groupDrag.current = { id: node.id, start: new Map(componentsInGroup(project, groupId).map((member) => [member.id, { ...member.position }])) };
  }, [project]);
  const onNodeDrag = useCallback((_event: unknown, node: Node) => {
    const drag = groupDrag.current;
    const origin = drag?.start.get(node.id);
    if (!drag || !origin) return;
    const delta = { x: node.position.x - origin.x, y: node.position.y - origin.y };
    setNodes((all) => all.map((item) => {
      const base = drag.start.get(item.id);
      // 被拖的元件交给 React Flow 自己走（含网格吸附），这里只搬其余成员，位移量与它完全一致。
      if (!base || item.id === drag.id) return item;
      return { ...item, position: { x: base.x + delta.x, y: base.y + delta.y } };
    }));
  }, [setNodes]);
  const onNodeDragStop = useCallback(() => { groupDrag.current = null; const next = withPositions(project, nodes); if (JSON.stringify(next.components) !== JSON.stringify(project.components)) commit(next, '已移动元件；连线端点随引脚更新。'); }, [project, nodes, commit]);
  /**
   * A11【成组】：把当前选中的元件打成一个组。组 id 由界面生成（域层不引入随机源，便于复现与测试）。
   * 只更新节点的 `grouped` 标记，不整体重建节点，这样选中态与摆放位置都原样保留。
   */
  const groupSelected = useCallback(() => {
    const ids = nodes.filter((node) => node.selected).map((node) => node.id);
    if (ids.length < 2) return setStatus('至少选中两个元件才能成组，先在画布上框选或用 Ctrl 多选。');
    try {
      const next = groupComponents(project, ids, `group-${crypto.randomUUID()}`);
      commit(next, `已把 ${ids.length} 个元件成组：拖动其中任意一个，整组一起移动。`);
      const members = new Set(ids);
      setNodes((all) => all.map((node) => (members.has(node.id) ? { ...node, data: { ...node.data, grouped: true } } : node)));
    } catch (error) { setStatus(error instanceof Error ? `成组失败：${error.message}` : '成组失败'); }
  }, [nodes, project, commit, setNodes]);
  /** A11【解组】：解除该元件所在的组；成员、连线与位置都不动，只是不再联动移动。 */
  const ungroupComponent = useCallback((nodeId: string) => {
    const groupId = project.components.find((component) => component.id === nodeId)?.groupId;
    if (!groupId) return;
    const members = new Set(componentsInGroup(project, groupId).map((component) => component.id));
    commit(ungroup(project, groupId), '已解除该组：成员之间不再联动移动。');
    setNodes((all) => all.map((node) => (members.has(node.id) ? { ...node, data: { ...node.data, grouped: false } } : node)));
    setContextMenu(null);
  }, [project, commit, setNodes]);
  /**
   * A11【解组】：把当前选中元件所在的组全部解除——框选整个组后点底部「解组」即可，不必先右键单个成员。
   * 与「成组」对称：没有选中任何已成组的元件时明确提示，不静默。
   */
  const ungroupSelected = useCallback(() => {
    const selected = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const groupIds = new Set<string>();
    for (const component of project.components) if (component.groupId !== undefined && selected.has(component.id)) groupIds.add(component.groupId);
    if (!groupIds.size) return setStatus('所选元件都不在任何组里，无需解组。');
    try {
      const members = new Set(project.components.filter((component) => component.groupId !== undefined && groupIds.has(component.groupId)).map((component) => component.id));
      let next = project;
      for (const groupId of groupIds) next = ungroup(next, groupId);
      commit(next, groupIds.size === 1 ? '已解除该组：成员之间不再联动移动。' : `已解除 ${groupIds.size} 个组：成员之间不再联动移动。`);
      setNodes((all) => all.map((node) => (members.has(node.id) ? { ...node, data: { ...node.data, grouped: false } } : node)));
    } catch (error) { setStatus(error instanceof Error ? `解组失败：${error.message}` : '解组失败'); }
  }, [nodes, project, commit, setNodes]);
  /**
   * 批次2【自动整理布局】：按功能分区 + 连接紧密程度重新摆放（确定性算法在 `layoutZones.ts`）。
   * 只有用户点这个按钮才会动位置——检查、刷新、普通编辑都不会自动打乱布局。
   * 位置锁定的元件原地不动；整件事走 `commit`，所以可以直接撤销。
   */
  const arrangeLayout = useCallback(() => {
    if (!project.components.length) return setStatus('画布上还没有元件，没有可整理的布局。');
    const moved = arrangeByZone({ project, sizes: nodeSizes, zoneOf: zoneOfProject(project, library) });
    const count = Object.keys(moved).length;
    if (!count) return setStatus('没有可整理的元件：全部元件的位置都已锁定。先解锁要参与整理的元件再试。');
    const lockedCount = project.components.filter((component) => component.positionLocked === true).length;
    const next = moveComponents(project, moved);
    commit(next, `已按功能分区整理布局：重新摆放了 ${count} 个元件${lockedCount ? `，${lockedCount} 个锁定的元件保持不动` : ''}；此操作可撤销。`);
    rebuild(next);
  }, [project, library, nodeSizes, commit, rebuild]);
  /** 批次2：锁定/解锁元件位置。锁定后画布上拖不动它，「自动整理布局」也跳过它。 */
  const togglePositionLock = useCallback((nodeId: string) => {
    const component = project.components.find((item) => item.id === nodeId);
    if (!component) return;
    const locked = component.positionLocked === true;
    try {
      const next = setComponentPositionLocked(project, nodeId, !locked);
      commit(next, locked ? `已解锁「${component.displayName}」的位置。` : `已锁定「${component.displayName}」的位置：拖动与自动整理都不会再动它。`);
      rebuild(next);
      setContextMenu(null);
    } catch (error) { setStatus(error instanceof Error ? `位置锁定更新失败：${error.message}` : '位置锁定更新失败'); }
  }, [project, commit, rebuild]);
  /** 批次2：把元件划到指定功能分区（传 undefined＝取消手工指定，回到按分类自动归属）。 */
  const assignZone = useCallback((nodeId: string, zone: FunctionZoneId | undefined) => {
    const component = project.components.find((item) => item.id === nodeId);
    if (!component) return;
    try {
      const next = setComponentZone(project, nodeId, zone);
      commit(next, zone === undefined
        ? `「${component.displayName}」已取消手工分区，回到按分类自动归属。`
        : `「${component.displayName}」已划入「${FUNCTION_ZONE_LABELS[zone]}」分区；分区只帮助理解结构，不代表实物安装位置。`);
      setContextMenu(null);
    } catch (error) { setStatus(error instanceof Error ? `分区归属更新失败：${error.message}` : '分区归属更新失败'); }
  }, [project, commit]);
  /** 批次2：给分区改名（空字符串＝恢复内置名称）。只改区域标题文字。 */
  const commitZoneName = useCallback(() => {
    if (!zoneRename) return;
    try {
      commit(setZoneName(project, zoneRename.zone, zoneRename.text), zoneRename.text.trim() ? `分区已重命名为「${zoneRename.text.trim()}」。` : '分区已恢复内置名称。');
      setZoneRename(null);
    } catch (error) { setStatus(error instanceof Error ? `分区重命名失败：${error.message}` : '分区重命名失败'); }
  }, [zoneRename, project, commit]);
  const addGeneric = useCallback(() => { const component: ComponentInstance = { id: `switch-${crypto.randomUUID().slice(0, 8)}`, definitionId: 'user.generic-switch', displayName: '通用开关', position: { x: 260, y: 360 }, rotation: 0, pins: ['COM', 'NO'].map((name, index) => ({ id: name, name, role: 'PASSIVE', driveMode: 'none', localPosition: { x: 0, y: index } })) }; const next = addComponent(project, component); commit(next, '已添加通用开关。'); setNodes((all) => [...all, nodeFromComponent(component)]); }, [project, commit, setNodes]);
  const addBuiltIn = useCallback((kind: BuiltInComponentKind) => { const component = createBuiltInComponent(kind, `${kind}-${crypto.randomUUID().slice(0, 8)}`, { x: 240 + (project.components.length % 4) * 55, y: 330 + (project.components.length % 3) * 45 }); const next = addComponent(project, component); commit(next, `已添加 ${component.displayName}。`); setNodes((all) => [...all, nodeFromComponent(component)]); }, [project, commit, setNodes]);
  /** 保存用户元件库：写本地存储并同步内存状态；失败时明确报错，不假装成功。 */
  const persistLibrary = useCallback((next: UserLibrary, text: string) => {
    try { saveLibrary(createLocalStorageLibraryStorage(), next); setLibrary(next); setStatus(text); }
    catch (error) { setStatus(error instanceof Error ? `用户元件库保存失败：${error.message}` : '用户元件库保存失败'); }
  }, []);
  /** 接线代码导入：替换或追加画布内容。只创建实例与连线，绝不写入用户元件库。 */
  const applyWiringCode = useCallback((incoming: Project, mode: WiringCodeApplyMode) => {
    try {
      let next = project;
      if (mode === 'replace') {
        next = { ...project, components: incoming.components, wires: incoming.wires };
      } else {
        for (const component of incoming.components) next = addComponent(next, component);
        for (const wire of incoming.wires) next = addWire(next, wire);
      }
      commit(next, `已按接线代码生成接线图：${incoming.components.length} 个元件、${incoming.wires.length} 根连线；ERC：${runErc(next).problems.length} 个问题。`);
      rebuild(next);
      setWiringCodeOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? `接线代码应用失败：${error.message}` : '接线代码应用失败');
    }
  }, [project, commit, rebuild]);
  /**
   * A8：用代码**更新**当前画布——先按确定性规则算差异，进入"预览态"：
   * 画布渲染的是"代码内容 + 将被删除的旧内容"的并集（灰色＝将被删除、绿/黄轮廓＝新增/改写），
   * 但项目状态一点没动；只有用户点「应用更新」才真正写入。
   * 代码与画布完全一致时明确提示并直接返回，不进入一个"什么都看不出来"的预览态。
   */
  const previewWiringUpdate = useCallback((incoming: Project) => {
    const diff = diffProjects(project, incoming);
    if (isProjectUpdateEmpty(diff)) { setStatus('代码与当前画布完全一致，没有需要更新的内容。'); return; }
    setPendingUpdate({ incoming, diff });
    setWiringCodeOpen(false);
    rebuild(previewProject(project, incoming));
    setStatus(`更新预览：新增 ${diff.addedComponents.length} 个元件、${diff.addedWires.length} 根连线；删除 ${diff.removedComponents.length} 个元件、${diff.removedWires.length} 根连线；改写 ${diff.changedComponents.length} 个元件、${diff.changedWires.length} 根连线。`);
  }, [project, rebuild]);
  /** A8：接受更新。以代码为准写入元件与连线，保留用户摆好的位置、固定过的折点与「已接好」标记。 */
  const acceptWiringUpdate = useCallback(() => {
    if (!pendingUpdate) return;
    try {
      const next = applyProjectUpdate(project, pendingUpdate.incoming);
      commit(next, `已按接线代码更新画布：${next.components.length} 个元件、${next.wires.length} 根连线；ERC：${runErc(next).problems.length} 个问题。`);
      rebuild(next);
      setPendingUpdate(null);
    } catch (error) { setStatus(error instanceof Error ? `应用更新失败：${error.message}` : '应用更新失败'); }
  }, [pendingUpdate, project, commit, rebuild]);
  /** A8：取消更新。画布还原成更新前的内容；项目状态本来就没被改过，这里只是把渲染切回去。 */
  const cancelWiringUpdate = useCallback(() => {
    if (!pendingUpdate) return;
    setPendingUpdate(null);
    rebuild(project);
    setStatus('已取消更新：画布恢复为更新前的内容。');
  }, [pendingUpdate, project, rebuild]);
  const openNewDefinition = useCallback(() => setEditorDraft(createEmptyDefinition(`user.${crypto.randomUUID().slice(0, 8)}`, '新元件')), []);
  const openEditDefinition = useCallback((definition: ComponentDefinition) => setEditorDraft(structuredClone(definition)), []);
  /**
   * A9：右键「元件编辑器」——按画布实例取（库里没有就按实例重建）定义交给既有编辑器。
   * 保存仍走 upsertDefinition 的白名单重建，来源与置信度照抄，绝不升级为"已确认"。
   */
  const openComponentEditor = useCallback((nodeId: string) => {
    const component = project.components.find((item) => item.id === nodeId);
    if (!component) return;
    try { openEditDefinition(definitionFromInstance(component, findDefinition(library, component.definitionId), {})); setContextMenu(null); }
    catch (error) { setStatus(error instanceof Error ? `无法打开元件编辑器：${error.message}` : '无法打开元件编辑器'); }
  }, [project, library, openEditDefinition]);
  /**
   * A11/A12：复制一组元件——新实例 id 用随机 UUID 生成，沿用同一定义与引脚覆盖，落点右下偏移以免完全重合。
   * 右键「复制元件」（单个）与画布「复制所选」（框选/多选批量）共用这一条路径。
   */
  const duplicateComponents = useCallback((ids: string[]) => {
    try {
      const copies: ComponentInstance[] = [];
      let next = project;
      for (const id of ids) {
        const source = project.components.find((item) => item.id === id);
        if (!source) continue;
        // 复制出来的元件不进原组：否则改一个副本的位置会把原组也带着动，很反直觉。
        const { groupId: _drop, ...base } = structuredClone(source);
        const copy: ComponentInstance = { ...base, id: `${source.id}-${crypto.randomUUID().slice(0, 8)}`, position: { x: source.position.x + 40, y: source.position.y + 40 } };
        next = addComponent(next, copy);
        copies.push(copy);
      }
      if (!copies.length) return;
      commit(next, copies.length === 1 ? `已复制元件「${copies[0].displayName}」。` : `已复制 ${copies.length} 个元件。`);
      setNodes((all) => [...all, ...copies.map((copy) => nodeFromComponent(copy, findDefinition(library, copy.definitionId)))]);
    } catch (error) { setStatus(error instanceof Error ? `复制元件失败：${error.message}` : '复制元件失败'); }
  }, [project, commit, setNodes, library]);
  /** A12：右键菜单里的「复制元件」＝复制这一个，并关掉菜单。 */
  const duplicateComponent = useCallback((nodeId: string) => { duplicateComponents([nodeId]); setContextMenu(null); }, [duplicateComponents]);
  /** A11：把当前选中的元件全部复制一份（框选或多选后点「复制所选」）。 */
  const duplicateSelected = useCallback(() => {
    const ids = nodes.filter((node) => node.selected).map((node) => node.id);
    if (!ids.length) return setStatus('没有选中的元件，先在画布上框选或用 Ctrl 多选。');
    duplicateComponents(ids);
  }, [nodes, duplicateComponents]);
  const saveDefinition = useCallback((definition: ComponentDefinition) => {
    try {
      const previous = findDefinition(library, definition.id);
      const nextLibrary = upsertDefinition(library, definition);
      // 画布上已有的同型号实例必须立刻按新定义重画：引脚坐标是实例自带的一份快照，
      // 只写库不刷新实例，就会"保存成功但画布没变"（引脚停在旧位置、名字也不变）。
      const nextProject = applyDefinitionToInstances(project, definition, previous?.displayName);
      const text = `用户元件「${definition.displayName}」已保存。`;
      persistLibrary(nextLibrary, text);
      if (nextProject !== project) commit(nextProject, text);
      rebuild(nextProject, nextLibrary);
      setEditorDraft(null);
    }
    catch (error) { setStatus(error instanceof Error ? `用户元件保存失败：${error.message}` : '用户元件保存失败'); }
  }, [library, persistLibrary, rebuild, project, commit]);
  const deleteDefinition = useCallback((definition: ComponentDefinition) => {
    const nextLibrary = removeDefinition(library, definition.id);
    persistLibrary(nextLibrary, `用户元件「${definition.displayName}」已删除。`);
    // 定义没了，画布上的实例要改按实例自带的引脚重画（非内置元件仍走盒式布局）。
    rebuild(project, nextLibrary);
  }, [library, persistLibrary, rebuild, project]);
  /**
   * 接线代码补查结果经用户逐字段确认后写入用户元件库。
   * 定义 id 就是代码里的元件类型标识（由领域层决定），来源与置信度原样照抄候选，绝不升级为"已确认"。
   */
  const registerDefinition = useCallback((definition: ComponentDefinition) => {
    try {
      const previous = findDefinition(library, definition.id);
      const nextLibrary = upsertDefinition(library, definition);
      // AI 补查的元件往往正是画布上"导入接线代码时先落下来的那一批"：刷新实例后
      // 它们才会从逐行列表切成盒式布局，引脚名才会贴到各自的引脚旁。
      const nextProject = applyDefinitionToInstances(project, definition, previous?.displayName);
      const text = `已把「${definition.displayName}」写入用户元件库（来源与置信度照抄 AI 候选）。`;
      persistLibrary(nextLibrary, text);
      if (nextProject !== project) commit(nextProject, text);
      rebuild(nextProject, nextLibrary);
    }
    catch (error) { setStatus(error instanceof Error ? `补查元件写入失败：${error.message}` : '补查元件写入失败'); }
  }, [library, persistLibrary, rebuild, project, commit]);
  /** 打开「调整元件大小」：用 React Flow 实测尺寸预填，画布上看到多大就默认多大。 */
  const openSizeDialog = useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const component = project.components.find((item) => item.id === nodeId);
    if (!component) return;
    const definition = findDefinition(library, component.definitionId);
    const width = node?.measured?.width ?? definition?.footprint.width ?? 120;
    const height = node?.measured?.height ?? definition?.footprint.height ?? 80;
    setSizeDraft({ nodeId, label: component.displayName, width: String(Math.round(width)), height: String(Math.round(height)) });
    setContextMenu(null);
  }, [nodes, project, library]);
  /**
   * 应用新尺寸。写入的是元件定义（沿用实例原有的 definitionId），
   * 因此同型号的内置元件会立刻从"内置"变成"我的元件"，画布上同型号的元件一起更新。
   */
  const applySize = useCallback(() => {
    if (!sizeDraft) return;
    const width = Math.round(Number(sizeDraft.width));
    const height = Math.round(Number(sizeDraft.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return setStatus('元件尺寸必须是大于 0 的数字。');
    const component = project.components.find((item) => item.id === sizeDraft.nodeId);
    if (!component) return setSizeDraft(null);
    try {
      const base = findDefinition(library, component.definitionId);
      const nextLibrary = upsertDefinition(library, definitionFromInstance(component, base, { footprint: { width, height } }));
      persistLibrary(nextLibrary, `${base ? '' : `「${component.displayName}」原为内置元件，已自动转为「我的元件」；`}尺寸已改为 ${width}×${height}，同型号元件一起更新。`);
      rebuild(project, nextLibrary);
      setSizeDraft(null);
    } catch (error) {
      setStatus(error instanceof Error ? `调整元件大小失败：${error.message}` : '调整元件大小失败');
    }
  }, [sizeDraft, project, library, persistLibrary, rebuild]);
  /** 右键给画布元件上传照片：同样写入元件定义，内置元件因此自动转为可编辑的「我的元件」。 */
  const uploadComponentImage = useCallback(async (nodeId: string, file: File) => {
    const component = project.components.find((item) => item.id === nodeId);
    if (!component) return;
    if (!file.type.startsWith('image/')) return setStatus('请选择图片文件。');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const size = await readImageSize(dataUrl);
      // 与元件编辑器同一套默认值：宽 180 等比缩放，高度夹在 60–320，避免极端比例把画布撑坏。
      const width = 180;
      const height = Math.min(Math.max(Math.round((width * size.height) / size.width), 60), 320);
      const image: ComponentImage = { dataUrl, naturalWidth: size.width, naturalHeight: size.height, rotation: 0 };
      const base = findDefinition(library, component.definitionId);
      const nextLibrary = upsertDefinition(library, definitionFromInstance(component, base, { footprint: { width, height }, image }));
      persistLibrary(nextLibrary, `${base ? '' : `「${component.displayName}」原为内置元件，已自动转为「我的元件」；`}元件图片已上传，同型号元件一起更新。`);
      rebuild(project, nextLibrary);
    } catch (error) {
      setStatus(error instanceof Error ? `上传元件图片失败：${error.message}` : '上传元件图片失败');
    }
  }, [project, library, persistLibrary, rebuild]);
  /** AI 导入经用户逐字段确认后写入用户元件库；来源与置信度由领域层原样保留，绝不升级为已确认。 */
  const confirmAiImport = useCallback((definition: ComponentDefinition) => {
    try { persistLibrary(upsertDefinition(library, definition), `已将 AI 候选写入用户元件库：${definition.displayName}。`); setAiImportOpen(false); }
    catch (error) { setStatus(error instanceof Error ? `用户元件保存失败：${error.message}` : '用户元件保存失败'); }
  }, [library, persistLibrary]);
  /** 把用户元件放到画布：实例自带引脚副本，因此之后即使库里没了也能继续 ERC。 */
  const placeDefinition = useCallback((definition: ComponentDefinition, position?: { x: number; y: number }) => {
    try {
      const component = instantiateFromDefinition(definition, `${definition.id}-${crypto.randomUUID().slice(0, 8)}`, position ?? { x: 220 + (project.components.length % 4) * 60, y: 340 + (project.components.length % 3) * 50 });
      const next = addComponent(project, component);
      commit(next, `已添加用户元件 ${component.displayName}；ERC：${runErc(next).problems.length} 个问题。`);
      setNodes((all) => [...all, nodeFromComponent(component, definition)]);
    } catch (error) { setStatus(error instanceof Error ? `无法添加用户元件：${error.message}` : '无法添加用户元件'); }
  }, [project, commit, setNodes]);
  const onDragOver = useCallback((event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }, []);
  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const definitionId = event.dataTransfer.getData(USER_COMPONENT_MIME);
    if (!definitionId) return;
    const definition = findDefinition(library, definitionId);
    if (!definition) return;
    placeDefinition(definition, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [library, placeDefinition, screenToFlowPosition]);
  const deleteSelected = useCallback(() => { const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id)); if (!ids.size) return; const next = [...ids].reduce((p, id) => deleteComponent(p, id), project); commit(next, '已删除所选组件及其关联连线。'); rebuild(next); }, [nodes, project, commit, rebuild]);
  const deleteById = useCallback((id: string) => { const next = deleteComponent(project, id); commit(next, '已删除组件及其关联连线。'); rebuild(next); setContextMenu(null); }, [project, commit, rebuild]);
  const deleteComponentsById = useCallback((ids: string[]) => { if (!ids.length) return; const next = ids.reduce((current, id) => deleteComponent(current, id), project); commit(next, ids.length === 1 ? '已删除组件及其关联连线。' : `已删除 ${ids.length} 个组件及其关联连线。`); rebuild(next); setContextMenu(null); }, [project, commit, rebuild]);
  const deleteWireById = useCallback((id: string) => { const next = deleteWire(project, id); commit(next, '已删除连线。'); rebuild(next); setContextMenu(null); }, [project, commit, rebuild]);
  const deleteWiresById = useCallback((ids: string[]) => { if (!ids.length) return; const next = ids.reduce((current, id) => deleteWire(current, id), project); commit(next, ids.length === 1 ? '已删除连线。' : `已删除 ${ids.length} 根连线。`); rebuild(next); setContextMenu(null); }, [project, commit, rebuild]);
  const setWireColor = useCallback((id: string, color: string) => { const next = updateWire(project, id, { color }); commit(next, `连线颜色已更新为 ${color}。`); rebuild(next); setContextMenu(null); }, [project, commit, rebuild]);
  /**
   * 批次3：给一根线设手工用途（或传 undefined 清除，恢复电气网络的自动判定）。
   * 只改 `Wire.purpose` 这个显示分类字段，不碰 source/target，所以不可能改变任何电气连接。
   */
  const setWirePurpose = useCallback((id: string, purpose: WirePurpose | undefined) => {
    try {
      commit(updateWire(project, id, { purpose }), purpose ? `已把这根线归类为「${WIRE_PURPOSE_LABELS[purpose]}」。` : '已恢复这根线的自动用途判定。');
      setContextMenu(null);
    } catch (error) { setStatus(error instanceof Error ? `线路分类更新失败：${error.message}` : '线路分类更新失败'); }
  }, [project, commit]);
  /** 批次3：给一根线写用户自定义的分类文字（空字符串＝清除）。写的是 `Wire.label`，不参与电气判定。 */
  const setWireLabel = useCallback((id: string, text: string) => {
    const trimmed = text.trim();
    try {
      commit(updateWire(project, id, { label: trimmed ? trimmed : undefined }), trimmed ? `已把这根线的分类备注写为「${trimmed}」。` : '已清除这根线的分类备注。');
      setContextMenu(null);
    } catch (error) { setStatus(error instanceof Error ? `线路分类文字更新失败：${error.message}` : '线路分类文字更新失败'); }
  }, [project, commit]);
  const save = useCallback(async () => {
    const text = serializeProject(withPositions(project, nodes));
    try {
      const core = await import('@tauri-apps/api/core');
      if (core.isTauri()) {
        let path = currentPath;
        if (!path) {
          const { save } = await import('@tauri-apps/plugin-dialog');
          path = await save({ filters: [{ name: 'AI Wiring Studio', extensions: ['aiws'] }], defaultPath: `${project.name}.aiws` }) ?? null;
        }
        if (!path) return setStatus('已取消保存。');
        await core.invoke('write_project_atomic', { path, contents: text });
        setCurrentPath(path);
        return setStatus(`项目已保存：${path}`);
      }
      localStorage.setItem(STORAGE_KEY, text);
      setStatus('项目已保存到本地浏览器存储。');
    } catch (e) {
      try {
        const core = await import('@tauri-apps/api/core');
        if (core.isTauri()) {
          const fallbackPath = await core.invoke<string>('write_project_default', { contents: text });
          setCurrentPath(fallbackPath);
          return setStatus(`保存窗口不可用，已自动保存到：${fallbackPath}`);
        }
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : '未知错误';
        return setStatus(`保存失败：${message}`);
      }
      setStatus(e instanceof Error ? `保存失败：${e.message}` : '保存失败');
    }
  }, [project, nodes, currentPath]);
  const open = useCallback(async () => { try { let raw = localStorage.getItem(STORAGE_KEY); let openedPath: string | null = null; const core = await import('@tauri-apps/api/core'); if (core.isTauri()) { const { open } = await import('@tauri-apps/plugin-dialog'); const path = await open({ multiple: false, filters: [{ name: 'AI Wiring Studio', extensions: ['aiws'] }] }); openedPath = typeof path === 'string' ? path : null; raw = openedPath ? await core.invoke<string>('read_project', { path: openedPath }) : null; } if (!raw) return setStatus('没有选择可打开的项目。'); const next = deserializeProject(raw); setCurrentPath(openedPath); commit(next, '项目已打开。'); rebuild(next); } catch (e) { setStatus(e instanceof Error ? `打开失败：${e.message}` : '打开失败'); } }, [commit, rebuild]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;
        const path = await core.invoke<string | null>('startup_project_path');
        if (!path) return;
        const raw = await core.invoke<string>('read_project', { path });
        const next = deserializeProject(raw);
        if (cancelled) return;
        setProject(next); setHistory([]); setFuture([]); setCurrentPath(path); rebuild(next);
        setStatus(`已从文件打开项目：${path}`);
      } catch (e) {
        if (!cancelled) setStatus(e instanceof Error ? `启动项目打开失败：${e.message}` : '启动项目打开失败');
      }
    })();
    return () => { cancelled = true; };
  }, [rebuild]);
  const undo = useCallback(() => { const previous = history.at(-1); if (!previous) return; setHistory((h) => h.slice(0, -1)); setFuture((f) => [project, ...f]); setProject(previous); rebuild(previous); setStatus('已撤销。'); }, [history, project, rebuild]);
  const redo = useCallback(() => { const next = future[0]; if (!next) return; setFuture((f) => f.slice(1)); setHistory((h) => [...h, project]); setProject(next); rebuild(next); setStatus('已重做。'); }, [future, project, rebuild]);
  /**
   * A13【快速选择】的候选项。三个维度的判据都是确定性的：
   * - 按连线颜色：同色连线的两端元件（颜色按连线在项目里的出现顺序排列）；
   * - 按类别：元件定义/内置目录里的分类（固定分类顺序）；
   * - 按供电：完全按 ERC 已算出的电压网络归属，缺参数的显式单列「未知供电」、冲突单列「电压冲突」，绝不猜电压。
   */
  const quickSelect = useMemo((): QuickSelectGroup[] => {
    const colors = new Map<string, string[]>();
    for (const wire of project.wires) {
      const ids = colors.get(wire.color) ?? [];
      for (const id of [wire.source.componentId, wire.target.componentId]) if (!ids.includes(id)) ids.push(id);
      colors.set(wire.color, ids);
    }
    const byCategory = new Map<ComponentCategory, string[]>();
    for (const component of project.components) {
      const category = categoryOf(component, library);
      byCategory.set(category, [...(byCategory.get(category) ?? []), component.id]);
    }
    const supplies = new Map<string, { order: number; ids: string[] }>();
    for (const net of erc.nets) {
      const state = erc.voltages[net.id];
      const value = state?.kind === 'Known' ? state.value : undefined;
      const label = value !== undefined ? `${value}V` : state?.kind === 'Conflict' ? '电压冲突' : '未知供电';
      const order = value !== undefined ? value : state?.kind === 'Conflict' ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
      const entry = supplies.get(label) ?? { order, ids: [] };
      for (const ref of net.pins) if (!entry.ids.includes(ref.componentId)) entry.ids.push(ref.componentId);
      supplies.set(label, entry);
    }
    return [
      { title: '按连线颜色', choices: [...colors].map(([color, ids]) => ({ key: `color:${color}`, label: color, color, ids })) },
      { title: '按类别', choices: CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({ key: `category:${category}`, label: categoryLabels[category], ids: byCategory.get(category) ?? [] })) },
      { title: '按供电', choices: [...supplies].sort((a, b) => a[1].order - b[1].order).map(([label, entry]) => ({ key: `supply:${label}`, label, ids: entry.ids })) },
    ];
  }, [project, library, erc]);
  /** 批量选中一组元件并关掉右键菜单；选中态由 React Flow 自己的 selected 字段承担，不新增数据概念。 */
  const selectComponents = useCallback((ids: string[], text: string) => {
    const wanted = new Set(ids);
    setNodes((all) => all.map((node) => ({ ...node, selected: wanted.has(node.id) })));
    setContextMenu(null);
    setStatus(text);
  }, [setNodes]);
  /**
   * 批次3：更新界面外壳显示态并立即持久化（同外观：改一层就存一层，没有"保存"按钮）。
   * 收起/展开只改 CSS 变量与 display，一个字节都不写项目文件。
   */
  const changeShell = useCallback((changes: Partial<ShellLayout>) => {
    const next = { ...shell, ...changes };
    setShell(next);
    try { saveShellLayout(shellStorage, next); } catch (error) { setStatus(error instanceof Error ? `界面布局保存失败：${error.message}` : '界面布局保存失败'); }
  }, [shell, shellStorage]);
  /**
   * 批次3：收/展左右侧栏、底边栏或线路筛选条。
   * 侧栏与底栏改变后画布尺寸也变，紧接着让画布重新居中，避免元件被挤出可视区。
   */
  const togglePanel = useCallback((panel: 'left' | 'right' | 'summary' | 'wireFilter') => {
    const key: keyof ShellLayout = panel === 'left' ? 'leftCollapsed' : panel === 'right' ? 'rightCollapsed' : panel === 'summary' ? 'summaryCollapsed' : 'wireFilterCollapsed';
    const collapsed = !shell[key];
    changeShell({ [key]: collapsed } as Partial<ShellLayout>);
    setStatus(collapsed ? `已收起${panel === 'left' ? '组件库' : panel === 'right' ? '检查器' : panel === 'summary' ? '底边栏' : '线路筛选'}，画布可用面积已放大。` : `已展开${panel === 'left' ? '组件库' : panel === 'right' ? '检查器' : panel === 'summary' ? '底边栏' : '线路筛选'}。`);
    if (panel !== 'wireFilter') window.requestAnimationFrame(() => { fitView().catch(() => undefined); });
  }, [changeShell, shell, fitView]);
  /** 批次1：切换线路筛选。只是显示态，明确告知用户"没有被隐藏或删除的连接"。 */
  const changeWireFilter = useCallback((next: WireFilter) => {
    changeShell({ wireFilter: next });
    setStatus(next === 'all'
      ? '已取消线路筛选：显示全部连线。'
      : `已按「${WIRE_FILTER_LABELS[next]}」筛选线路：不符合的连线只是淡出，不会被隐藏或删除。`);
  }, [changeShell]);
  /** 批次1：点选一根连线，显示起点/终点/用途/网络名；点画布空白处清除。 */
  const selectWire = useCallback((wireId: string) => {
    setContextMenu(null);
    setHighlightPin(null);
    setSelectedWire(wireId);
  }, []);
  // 连线右键菜单要用到"当前这条折线画出来是什么样"，直接从登记表取，保证固定下来的和看到的一致。
  const menuWire = contextMenu?.kind === 'wire' ? project.wires.find((wire) => wire.id === contextMenu.id) : undefined;
  /** A11：右键的这个元件是否已经在一组里——只有成组的元件才显示「解组」。 */
  const menuGrouped = contextMenu?.kind === 'component' && project.components.find((component) => component.id === contextMenu.id)?.groupId !== undefined;
  /** 批次2：右键的元件（用于「锁定位置」与「功能分区」两项的当前值显示）。 */
  const menuComponent = contextMenu?.kind === 'component' ? project.components.find((component) => component.id === contextMenu.id) : undefined;
  const menuLocked = menuComponent?.positionLocked === true;
  /** 当前生效的分区（含按分类的自动归属），用来在菜单里标出"它现在属于哪一区"。 */
  const menuZone = menuComponent ? componentZone(menuComponent, library) : undefined;
  const menuBends = contextMenu?.kind === 'wire' ? (routeRegistry.current.get(contextMenu.id) ?? []).slice(1, -1) : [];
  const focusProblem = (affected: { componentId: string }[]) => { const ids = new Set(affected.map((ref) => ref.componentId)); setNodes((all) => all.map((node) => ({ ...node, selected: ids.has(node.id) }))); setStatus('已在画布中选中受影响元件。'); };
  /**
   * A7：进入/退出动手接线模式。退出只是不再灰化与闪烁，
   * 「已接好」的进度留在项目文件里，再次进入直接接着上次继续。
   */
  const toggleHandsOn = useCallback(() => {
    const next = !handsOn;
    const done = project.wires.filter((wire) => wire.manuallyWired === true).length;
    setHandsOn(next);
    setStatus(next
      ? `已进入动手接线模式：双击连线即标记「已接好」；当前进度 ${done}/${project.wires.length}。`
      : `已退出动手接线模式：连线恢复原色，已接好的 ${done} 根记忆仍保留在项目里。`);
  }, [handsOn, project.wires]);
  /** A7：双击一条连线，在「已接好 / 未接好」之间切换；结果写进项目文件（`Wire.manuallyWired`）。 */
  const toggleWireWired = useCallback((wireId: string) => {
    const wire = project.wires.find((item) => item.id === wireId);
    if (!wire) return;
    try {
      const wired = wire.manuallyWired === true;
      commit(setWireManuallyWired(project, wireId, !wired), wired ? '已取消这根线的「已接好」标记。' : '已把这根线标记为「已接好」。');
    } catch (error) { setStatus(error instanceof Error ? `接线进度更新失败：${error.message}` : '接线进度更新失败'); }
  }, [project, commit]);
  /** 把 `元件.引脚` 写成一行，用于接线进度提示。 */
  const pinLabel = (ref: PinRef) => `${project.components.find((item) => item.id === ref.componentId)?.displayName ?? ref.componentId}.${ref.pinId}`;
  const suggestedWire = wiringGuide.suggested ? project.wires.find((wire) => wire.id === wiringGuide.suggested) : undefined;
  const wiredCount = project.wires.filter((wire) => wire.manuallyWired === true).length;
  // 批次3：把面板收纳折算成 grid 的列宽/行高变量（收起＝0 列宽或固定细条高度），画布随之占满。
  const workspaceStyle = {
    '--left-w': shell.leftCollapsed ? '0px' : undefined,
    '--right-w': shell.rightCollapsed ? '0px' : undefined,
    '--summary-h': shell.summaryCollapsed ? '34px' : undefined,
  } as CSSProperties;
  return <main className="workspace" style={workspaceStyle}>
    {/* A 无边框窗口：自绘标题栏顶在最上方；只有真在 Tauri 里才显示窗口按钮。 */}
    <TitleBar />
    <header className="app-menu">
      {/* 单行紧凑工具栏：常用操作 → 撤销/重做 → 画布操作 → 状态。
          行高由 --header-h 锁死，状态文字变长也不会改变工具栏高度、把画布顶下去。
          软件名只在标题栏（TitleBar）显示，此处不再重复。 */}
      <div className="menu-row">
        <div className="menu-group">
          <Button icon={<FolderOpen />} onClick={open}>打开项目</Button>
          <Button icon={<Save />} onClick={save}>保存项目</Button>
          <Button icon={<SettingsIcon />} onClick={() => setSettingsOpen(true)}>设置</Button>
        </div>
        <div className="menu-group">
          <IconButton label="撤销" icon={<UndoIcon />} onClick={undo} disabled={!history.length} />
          <IconButton label="重做" icon={<RedoIcon />} onClick={redo} disabled={!future.length} />
        </div>
        <div className="menu-actions">
          <button className={handsOn ? 'active' : ''} aria-pressed={handsOn} onClick={toggleHandsOn}>{handsOn ? '退出动手接线' : '动手接线模式'}</button>
          <button onClick={duplicateSelected}>复制所选</button>
          <button onClick={groupSelected}>成组</button>
          <button onClick={ungroupSelected}>解组</button>
          <button onClick={arrangeLayout}>自动整理布局</button>
          <button onClick={deleteSelected}>删除所选</button>
        </div>
        <span className="status-dot" title={status}>● {status}</span>
      </div>
    </header>
    <aside className="library" data-collapsed={shell.leftCollapsed}>
      <div className="panel-head">
        <h2>元件库</h2>
        {/* D：收起左侧栏，让画布占满；收起后在画布左边缘留一个展开条。 */}
        <button type="button" className="panel-collapse" aria-label="收起组件库" title="收起组件库" onClick={() => togglePanel('left')}>«</button>
      </div>
      {/* 添加/导入/新建归组为紧凑按钮，减少大按钮占位。 */}
      <div className="library-actions">
        <Button onClick={addGeneric}>＋ 添加元件</Button>
        <Button onClick={openNewDefinition}>＋ 新建元件</Button>
        <Button onClick={() => setAiImportOpen(true)}>＋ AI 导入元件</Button>
        <Button onClick={() => setWiringCodeOpen(true)}>＋ 导入接线代码</Button>
        <Button className="library-actions-wide" onClick={() => setWarehouseOpen(true)}>元件库…</Button>
      </div>
      <Input className="library-search" aria-label="搜索元件" placeholder="搜索名称、型号、分类…" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
      <div className="library-filters" aria-label="元件分类筛选">
        {libraryChips.map((chip) => <button
          type="button"
          key={chip.key}
          aria-pressed={libraryFilter === chip.key}
          className={libraryFilter === chip.key ? 'active' : ''}
          onClick={() => setLibraryFilter(chip.key)}
        >{chip.label}</button>)}
      </div>
      <div className="library-list">
        {libraryItems.mine.length + libraryItems.builtIns.length === 0
          ? <p className="hint">没有匹配的元件。换个关键字，或先「新建元件」录入自己的元件。</p>
          : <>
            {libraryItems.mine.map((definition) => <button type="button" key={definition.id} className="library-item" title="放入画布" onClick={() => placeDefinition(definition)}>
              <span>{definition.displayName}</span><small>{categoryLabels[definition.category]} · 我的</small>
            </button>)}
            {libraryItems.builtIns.map((choice) => <button type="button" key={choice.kind} className="library-item" title="放入画布" onClick={() => addBuiltIn(choice.kind)}>
              <span>{choice.label}</span><small>{categoryLabels[choice.category]} · 内置</small>
            </button>)}
          </>}
      </div>
      <p className="hint">用户元件与内置元件统一收在「元件库」中，可按分类筛选或关键字检索。</p>
    </aside>
    {/* 注意：这里**不能**清 selectedWire。点连线时 onEdgeClick 先把它设好，事件再冒泡到这里，
        若在这里清空就等于"刚选中就被取消"，信息面板永远出不来（点画布空白处由 onPaneClick 负责清空）。 */}
    <section className="canvas" aria-label="硬件接线画布" onClick={() => { setContextMenu(null); setHighlightPin(null); }}>
      <PinHighlightContext.Provider value={highlight}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} connectionMode={ConnectionMode.Loose} onNodeDragStart={onNodeDragStart} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop} onDrop={onDrop} onDragOver={onDragOver} onEdgeClick={(_event, edge) => selectWire(edge.id)} onNodeMouseEnter={(_event, node) => setHoveredComponent(node.id)} onNodeMouseLeave={() => setHoveredComponent(null)} onEdgeDoubleClick={(event, edge) => { if (!handsOn) return; event.stopPropagation(); toggleWireWired(edge.id); }} onNodesDelete={(deleted) => deleteComponentsById(deleted.map((node) => node.id))} onEdgesDelete={(deleted) => deleteWiresById(deleted.map((edge) => edge.id))} onNodeContextMenu={(event, node) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'component', id: node.id, x: event.clientX, y: event.clientY }); }} onEdgeContextMenu={(event, edge) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: 'wire', id: edge.id, x: event.clientX, y: event.clientY }); }} onPaneContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: 'canvas', x: event.clientX, y: event.clientY }); }} onPaneClick={() => { setContextMenu(null); setHighlightPin(null); setSelectedWire(null); }} fitView snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Delete', 'Backspace']} multiSelectionKeyCode="Control" selectionOnDrag panOnDrag={PAN_ON_DRAG} minZoom={0.05} maxZoom={4}>{appearance.background !== 'solid' && <Background gap={16} size={1} color="#33435c" variant={appearance.background === 'dots' ? BackgroundVariant.Dots : BackgroundVariant.Lines} />}<Controls showZoom={false} showInteractive={false} />
        {/* 批次2：功能分区底色框。走 ViewportPortal，所以与元件共用同一套画布坐标（平移缩放一起动），
            但它不是节点——不参与选中、拖动、删除，也不可能改变任何连接。 */}
        <ViewportPortal>
          {zoneBoxes.map((box) => <div key={box.zone} className="zone-band" data-zone={box.zone} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
            {zoneRename?.zone === box.zone
              ? <span className="zone-band-editor">
                <input aria-label="分区名称" value={zoneRename.text} autoFocus onChange={(event) => setZoneRename({ zone: box.zone, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') commitZoneName(); if (event.key === 'Escape') setZoneRename(null); }} />
                <button onClick={commitZoneName}>确定</button>
                <button onClick={() => setZoneRename(null)}>取消</button>
              </span>
              : <button className="zone-band-title" onClick={() => setZoneRename({ zone: box.zone, text: zoneLabel(project, box.zone) })} title="点击可重命名分区（只改标题文字，不改变任何连接）">{zoneLabel(project, box.zone)}</button>}
          </div>)}
        </ViewportPortal></ReactFlow>
      </PinHighlightContext.Provider>
      {/* D：侧栏收起后，在画布左右边缘各留一个细窄的展开条。 */}
      {shell.leftCollapsed && <button type="button" className="panel-rail panel-rail-left" aria-label="展开组件库" title="展开组件库" onClick={() => togglePanel('left')}>»</button>}
      {shell.rightCollapsed && <button type="button" className="panel-rail panel-rail-right" aria-label="展开检查器" title="展开检查器" onClick={() => togglePanel('right')}>«</button>}
      {/* 批次1：线路筛选 + 选中线路的文字信息。两者都只是显示态，不改任何连接。 */}
      <WireFilterBar filter={wireFilter} matched={focusView.matchedWires} total={project.wires.length} unclassified={unclassifiedWires} moduleNeedsFocus={focusView.moduleFilterNeedsFocus} collapsed={shell.wireFilterCollapsed} onToggleCollapse={() => togglePanel('wireFilter')} onChange={changeWireFilter} />
      {wireInfo && <WireInfoPanel info={wireInfo} />}
      {handsOn && <div className="wiring-guide" role="status">
        <strong>动手接线模式</strong>
        <span>进度 {wiredCount} / {project.wires.length} 根；在实物上接好后，双击画布上对应的连线即标记「已接好」。</span>
        {suggestedWire
          ? <span className="wiring-next">当前建议先接（闪烁的那根）：{pinLabel(suggestedWire.source)} → {pinLabel(suggestedWire.target)}</span>
          : <span className="wiring-next">{project.wires.length ? '全部连线都已标记接好。' : '画布上还没有连线可接。'}</span>}
      </div>}
      {pendingUpdate && <div className="update-preview" role="status" aria-label="更新预览">
        <strong>更新预览</strong>
        <span>新增 {pendingUpdate.diff.addedComponents.length} 个元件、{pendingUpdate.diff.addedWires.length} 根连线；删除 {pendingUpdate.diff.removedComponents.length} 个元件、{pendingUpdate.diff.removedWires.length} 根连线；改写 {pendingUpdate.diff.changedComponents.length} 个元件、{pendingUpdate.diff.changedWires.length} 根连线。</span>
        <span className="update-legend">绿色轮廓＝新增，黄色轮廓＝改写，半透明灰色＝将被删除。确认前画布内容不会被改动。</span>
        <div><button className="primary" onClick={acceptWiringUpdate}>应用更新</button><button onClick={cancelWiringUpdate}>取消</button></div>
      </div>}
      {/* 菜单项比过去多（锁定位置 + 功能分区），靠近视口底部时会超出屏幕：
          把左上角坐标以 CSS 变量带进去，由样式按"剩余空间"限制高度并允许内部滚动。 */}
      {contextMenu?.kind === 'component' && <div className="context-wire context-component" style={{ left: contextMenu.x, top: contextMenu.y, '--menu-top': `${contextMenu.y}px`, '--menu-left': `${contextMenu.x}px` } as CSSProperties} onClick={(event) => event.stopPropagation()}>
        <strong>元件</strong>
        <button onClick={() => openComponentEditor(contextMenu.id)}>元件编辑器…</button>
        <button onClick={() => duplicateComponent(contextMenu.id)}>复制元件</button>
        {menuGrouped && <button onClick={() => ungroupComponent(contextMenu.id)}>解组</button>}
        <button onClick={() => togglePositionLock(contextMenu.id)}>{menuLocked ? '解锁位置' : '锁定位置'}</button>
        {/* 批次2：手工指定功能分区。列的是固定 7 个分区，并标出当前生效的那一个；
            「按分类自动」＝撤销手工指定，回到按元件分类自动归属（判不出来就是未分组）。 */}
        <div className="context-zones" aria-label="功能分区">
          <span className="quick-title">功能分区（只帮助理解，不代表实物位置）</span>
          <div className="context-zone-list">
            {FUNCTION_ZONE_ORDER.map((zone) => <button key={zone} className={menuZone === zone ? 'active' : ''} onClick={() => assignZone(contextMenu.id, zone)}>{FUNCTION_ZONE_LABELS[zone]}</button>)}
            <button onClick={() => assignZone(contextMenu.id, undefined)}>按分类自动</button>
          </div>
        </div>
        <button onClick={() => openSizeDialog(contextMenu.id)}>调整元件大小…</button>
        <label className="image-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void uploadComponentImage(contextMenu.id, file); }}>上传元件图片…（也可把图片拖到这里）
          <input type="file" accept="image/*" aria-label="上传画布元件图片" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadComponentImage(contextMenu.id, file); }} />
        </label>
        <button className="context-delete" onClick={() => deleteById(contextMenu.id)}>删除元件</button>
      </div>}
      {/* F：连线菜单除颜色/途经点外，新增「线路分类」与自定义分类文字。
          分类只写 `Wire.purpose`（显示用途，覆盖电气网络的自动判定）；文字只写 `Wire.label`，两者都不碰 source/target。
          条目多，沿用元件菜单的视口限高（--menu-top/--menu-left）以便内部滚动。 */}
      {contextMenu?.kind === 'wire' && <div className="context-wire context-component" style={{ left: contextMenu.x, top: contextMenu.y, '--menu-top': `${contextMenu.y}px`, '--menu-left': `${contextMenu.x}px` } as CSSProperties} onClick={(event) => event.stopPropagation()}>
        <strong>连线</strong>
        <div className="wire-colors" aria-label="连线颜色">{['#e34b4b', '#20242a', '#f6d44c', '#4a96ef', '#4ac47b', '#eeeeee'].map((color) => <button key={color} aria-label={`设置连线颜色 ${color}`} className="color-swatch" style={{ background: color }} onClick={() => setWireColor(contextMenu.id, color)} />)}</div>
        <div className="context-purposes" aria-label="线路分类">
          <span className="quick-title">线路分类（只改显示用途，不改变连接）</span>
          <div className="context-purpose-list">
            {WIRE_PURPOSE_ORDER.map((purpose) => <button key={purpose} className={menuWire?.purpose === purpose ? 'active' : ''} onClick={() => setWirePurpose(contextMenu.id, purpose)}>{WIRE_PURPOSE_LABELS[purpose]}</button>)}
            <button onClick={() => setWirePurpose(contextMenu.id, undefined)}>按网络自动</button>
          </div>
        </div>
        <div className="context-label">
          <span className="quick-title">自定义分类文字（可选，只作备注）</span>
          <input key={contextMenu.id} ref={wireLabelInput} defaultValue={menuWire?.label ?? ''} aria-label="线路分类文字" placeholder="例：电机供电正极" />
          <button onClick={() => setWireLabel(contextMenu.id, wireLabelInput.current?.value ?? '')}>保存分类文字</button>
        </div>
        <button className="ghost" onClick={() => { const bends = (routeRegistry.current.get(contextMenu.id) ?? []).slice(1, -1); setWaypoints(contextMenu.id, bends); setContextMenu(null); }}>固定途经点（{menuBends.length}）</button>{menuWire?.waypoints?.length ? <button className="ghost" onClick={() => { setWaypoints(contextMenu.id, undefined); setContextMenu(null); }}>恢复自动布线</button> : null}<button className="context-delete" onClick={() => deleteWireById(contextMenu.id)}>删除连线</button></div>}
      {contextMenu?.kind === 'canvas' && <div className="context-wire context-quick" style={quickMenuPosition(contextMenu.x, contextMenu.y)} onClick={(event) => event.stopPropagation()}>
        <strong>快速选择</strong>
        {quickSelect.map((group) => <div className="quick-group" key={group.title}>
          <span className="quick-title">{group.title}</span>
          {group.choices.length === 0
            ? <span className="quick-empty">画布上没有可分组的内容</span>
            : group.choices.map((choice) => <button key={choice.key} className="quick-choice" onClick={() => selectComponents(choice.ids, `已按「${group.title}：${choice.label}」选中 ${choice.ids.length} 个元件。`)}>
              {choice.color ? <span className="color-swatch" style={{ background: choice.color }} aria-hidden="true" /> : null}
              {choice.label}（{choice.ids.length} 个元件）
            </button>)}
        </div>)}
      </div>}
    </section>
    <CheckSummary erc={erc} onFocus={focusProblem} collapsed={shell.summaryCollapsed} onToggle={() => togglePanel('summary')} />
    <InspectorPanel componentCount={project.components.length} wireCount={project.wires.length} erc={erc} onFocusProblem={focusProblem} collapsed={shell.rightCollapsed} onToggleCollapse={() => togglePanel('right')} />
    {/* M4 代表弹窗：改用 Radix Dialog——焦点陷阱、Escape 关闭、滚动锁定、Portal 层级都由 Radix 处理，
        视觉仍由 .editor 系列的类名决定；打开期间画布快捷键（Delete 等）不会误触发。 */}
    {sizeDraft && <Dialog open onOpenChange={(next) => { if (!next) setSizeDraft(null); }}>
      <DialogContent className="editor size-dialog">
        <header className="editor-head"><DialogTitle asChild><strong>调整元件大小</strong></DialogTitle><span>改的是元件定义，同型号元件会一起变。</span></header>
        <div className="editor-body">
          <DialogDescription className="hint">当前元件：{sizeDraft.label}。宽度与高度的单位是画布单位，保存后写入用户元件库；原先的内置元件会因此转为「我的元件」。</DialogDescription>
          <div className="editor-grid">
            <label className="editor-field"><span className="editor-field-name">宽度</span><input aria-label="元件宽度" type="number" min="1" value={sizeDraft.width} onChange={(event) => setSizeDraft({ ...sizeDraft, width: event.target.value })} /></label>
            <label className="editor-field"><span className="editor-field-name">高度</span><input aria-label="元件高度" type="number" min="1" value={sizeDraft.height} onChange={(event) => setSizeDraft({ ...sizeDraft, height: event.target.value })} /></label>
          </div>
        </div>
        <footer className="editor-foot"><span className="hint">只影响显示与布局，不改变任何电气参数。</span><div><Button variant="ghost" onClick={() => setSizeDraft(null)}>取消</Button><Button variant="primary" onClick={applySize}>应用尺寸</Button></div></footer>
      </DialogContent>
    </Dialog>}
    {aiImportOpen && <AiImportPanel onConfirm={confirmAiImport} onCancel={() => setAiImportOpen(false)} />}
    {settingsOpen && <AppearancePanel appearance={appearance} onChange={changeAppearance} onReset={resetAppearance} onClose={() => setSettingsOpen(false)} />}
    {wiringCodeOpen && <WiringCodePanel definitions={library.definitions} hasCanvasContent={nodes.length > 0} onApply={applyWiringCode} onPreviewUpdate={previewWiringUpdate} onRegisterDefinition={registerDefinition} onCancel={() => setWiringCodeOpen(false)} />}
    {warehouseOpen && <ComponentWarehouse
      userDefinitions={library.definitions}
      builtInChoices={builtInChoices}
      onAddBuiltIn={addBuiltIn}
      onPlaceDefinition={placeDefinition}
      onEditDefinition={openEditDefinition}
      onDeleteDefinition={deleteDefinition}
      onClose={() => setWarehouseOpen(false)}
    />}
    {/* 元件编辑器放在最后渲染：从「元件库」里点「编辑」时它必须盖在仓库之上，否则仓库的遮罩会挡住保存按钮。 */}
    {editorDraft && <ComponentEditor definition={editorDraft} onSave={saveDefinition} onCancel={() => setEditorDraft(null)} />}
  </main>;
}
/**
 * A10 底部检查区：只做四类结果的**摘要 + 点击定位**，完整列表仍留在右侧检查器，避免两处逻辑分叉。
 * 每一类的判据都来自 `runErc` 的同一份 problems（经 gradeOfSeverity 归类），不另算一套。
 */
function CheckSummary({ erc, onFocus, collapsed, onToggle }: { erc: ErcResult; onFocus: (affectedPins: PinRef[]) => void; collapsed: boolean; onToggle: () => void }) {
  return <footer className="check-summary" data-collapsed={collapsed} aria-label="检查摘要">
    {/* D：收起后用箭头把底栏压成一行细条，画布因此多出一段高度。 */}
    <button type="button" className="summary-toggle" aria-expanded={!collapsed} aria-label={collapsed ? '展开检查摘要' : '收起检查摘要'} title={collapsed ? '展开检查摘要' : '收起检查摘要'} onClick={onToggle}>{collapsed ? '⌄' : '⌃'}</button>
    <span className="check-title">检查摘要</span>
    {collapsed ? null : <>
      {GRADE_ORDER.map((grade: ProblemGrade) => {
        const items = erc.problems.filter((problem) => gradeOfSeverity(problem.severity) === grade);
        const pins = items.flatMap((problem) => problem.affectedPins);
        return <button key={grade} type="button" className={`check-chip ${grade.toLowerCase()}`} disabled={!items.length} onClick={() => onFocus(pins)}>{GRADE_LABELS[grade]} · {items.length}</button>;
      })}
      <span className="hint">点击某一类可选中画布上受影响的元件；完整列表在右侧检查器。</span>
    </>}
  </footer>;
}
function PartNode({ data }: { data: PartData }) {
  // 盒式布局（现在所有元件都用它）：引脚坐标统一走 layoutPart——用户亲手定位过的热点原样保留，
  // 还有引脚没定位时整体自动排布（分到左右两侧、撑大盒子，两侧悬殊时对半拆开）。
  // 名字贴在引脚内侧、每个引脚只画一个圆点，所以"名字对不上引脚""一个名字两个圆点"都不会再出现。
  const nodeId = useNodeId();
  const highlight = useContext(PinHighlightContext);
  /** A8：这个元件在"更新预览"里的状态（新增 / 将被删除 / 将被改写）。 */
  const diffState = highlight.preview?.components.get(nodeId ?? '') ?? null;
  /** A14：这个引脚是否落在当前被点亮的电气网络里。 */
  const isLit = (pinId: string) => nodeId !== null && highlight.pins.has(`${nodeId}:${pinId}`);
  /** 批次1：聚焦某个模块时，与它无关的元件退到背景，元件名仍保持可读。 */
  const dimmed = nodeId !== null && highlight.focus.mutedComponents.has(nodeId);
  const footprint = data.footprint ?? { width: 180, height: 120 };
  const layout = layoutPart(footprint, data.pins.map((pin) => ({ id: pin.id, name: pin.name, role: pin.role, localPosition: { x: pin.x, y: pin.y }, placed: pin.placed, confirmed: pin.confirmed })));
  // layoutPart 只回坐标与标签朝向，引脚角色要按 id 回查（A6 的电源/接地轮廓需要它）。
  const roleById = new Map(data.pins.map((pin) => [pin.id, pin.role]));
  const imageLayout = data.image ? createLayoutFromImage({ width: layout.width, height: layout.height }, data.image) : undefined;
  const geometry = imageLayout ? imageRenderGeometry(imageLayout) : undefined;
  /** 点击引脚（可见圆点或与它重合的透明落点）→ 点亮整张电气网络；再点一次取消。 */
  const onPinClick = (event: { stopPropagation: () => void }, pinId: string) => { event.stopPropagation(); if (nodeId !== null) highlight.select(nodeId, pinId); };
  return <div className={['part', 'image-part', data.kind, diffState ? `diff-${diffState}` : '', dimmed ? 'focus-muted' : ''].filter(Boolean).join(' ')} style={{ width: layout.width, height: layout.height }}>
    {geometry && data.image?.dataUrl && <div className="part-image-frame" style={{ left: geometry.container.left, top: geometry.container.top, width: geometry.container.width, height: geometry.container.height }}>
      <img className="part-image" src={data.image.dataUrl} alt="" draggable={false} style={{ left: geometry.image.left, top: geometry.image.top, width: geometry.image.width, height: geometry.image.height, transformOrigin: `${geometry.image.originX}px ${geometry.image.originY}px`, transform: `rotate(${geometry.image.rotation}deg)` }} />
    </div>}
    <div className="part-title image-part-title" title={data.label}>{data.label}</div>
    {/* A11：成组标记——不画"组框"以免压住连线，只在右上角挂一个小徽标，一眼看出它属于某个组。 */}
    {data.grouped && <span className="part-group-badge" title="已成组：拖动其中任意一个，整组一起移动">组</span>}
    {/* 批次2：位置锁定标记——锁定后不能在画布上拖动，「自动整理布局」也会跳过它。 */}
    {data.locked && <span className="part-lock-badge" title="位置已锁定：拖动与自动整理都不会再动它">锁</span>}
    {layout.pins.map((pin) => <span className={['part-pin-label', isLit(pin.id) ? 'pin-lit' : ''].filter(Boolean).join(' ')} key={pin.id} data-side={pin.labelSide} data-pin={pin.id} style={{ left: pin.x, top: pin.y }}>{pin.name || pin.id}</span>)}
    {/* 每个引脚只画一个圆点，但仍要能"拖出"和"落点"：可见的 source 画圆点，
        与它完全重合的 target 透明并置于其上接收落点。两个 id 都保留，edgeFromWire 才还原得出端点。
        拖拽方向由 React Flow 的 loose 模式决定，不再靠左右错开 7px 区分（那会让每个引脚显示成两个点）。
        data-pin 只供测试按引脚 id 稳定定位，不参与任何逻辑。
        透明落点在最上层，所以点击要挂在它身上（可见圆点收不到点击），两者共用同一个高亮/选择回调。 */}
    {layout.pins.map((pin) => <Handle key={`${pin.id}-out`} className={['hotspot', pinRoleClass(roleById.get(pin.id) ?? 'UNKNOWN'), isLit(pin.id) ? 'pin-lit' : ''].filter(Boolean).join(' ')} type="source" position={Position.Right} id={`out-${pin.id}`} data-pin={pin.id} style={{ left: pin.x, top: pin.y, right: 'auto', transform: 'translate(-50%, -50%)' }} />)}
    {layout.pins.map((pin) => <Handle key={`${pin.id}-in`} className="hotspot-hit" type="target" position={Position.Left} id={`in-${pin.id}`} data-pin={pin.id} style={{ left: pin.x, top: pin.y, right: 'auto', transform: 'translate(-50%, -50%)' }} onClick={(event) => onPinClick(event, pin.id)} />)}
  </div>;
}
export function App() { return <ReactFlowProvider><WiringCanvas /></ReactFlowProvider>; }
