/** Framework-independent project model. Coordinates are canvas units. */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/**
 * 结果分级（对应图3 的四级）：明确错误＝CRITICAL/ERROR；风险警告＝WARNING；
 * 待确认＝UNCONFIRMED（缺参数、无法判断）；优化建议＝SUGGESTION（可改善维护性/布局）。
 * INFO 已删除：它从不被 runErc 产出，保留只会多出一个永远为空的分级。
 */
export type Severity = "CRITICAL" | "ERROR" | "WARNING" | "UNCONFIRMED" | "SUGGESTION";
export type PinRole =
  | "POWER_OUTPUT" | "POWER_INPUT" | "GND" | "GPIO" | "INPUT" | "OUTPUT"
  | "PASSIVE" | "UNKNOWN";
export type DriveMode = "push-pull" | "open-drain" | "none" | "unknown";

export interface VoltageRange { min: number; max: number; unit: "V"; }
export interface Pin {
  id: string;
  name: string;
  role: PinRole;
  /** A source whose value is actually known. Absence is deliberately unknown. */
  outputVoltage?: number;
  /** Absolute/recommended input upper limit, only when confirmed by evidence. */
  maxVoltage?: number;
  /** Confirmed current rating in amperes. Absence is deliberately unknown, never guessed. */
  maxCurrent?: number;
  voltageRange?: VoltageRange;
  /** Used only for components whose terminals have confirmed polarity, such as electrolytic capacitors. */
  polarity?: "positive" | "negative";
  driveMode?: DriveMode;
  required?: boolean;
  /** Bus protocol such as I2C / SPI / UART, only when the user confirms it. */
  protocol?: string;
  /** Free-text note for the pin. */
  note?: string;
  localPosition: { x: number; y: number };
}

/**
 * 批次2【按功能分区布局】的功能分区。判不出归属时一律是 `unclassified`（未分组），绝不猜。
 * 它只用于"把相关的元件摆在一起、标个区域名"，不代表实物安装位置，也不改变任何电气含义。
 */
export type FunctionZoneId = "power" | "control" | "acquire" | "audio" | "aux" | "drive" | "unclassified";

export interface ComponentInstance {
  id: string;
  definitionId: string;
  displayName: string;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  pins: Pin[];
  /**
   * 批次2：用户亲手指定的功能分区。缺省＝按元件分类自动归属（见 layoutZones 的 categoryZone）。
   * 只有用户显式指定才写这个字段——我们不替用户猜"这块板子属于采集还是执行"。
   */
  zone?: FunctionZoneId;
  /**
   * 批次2：位置锁定。锁定后「自动整理布局」不动它，画布上也不能拖动它。
   * 缺省（字段不存在）＝未锁定，旧项目文件因此仍能正常打开。
   */
  positionLocked?: boolean;
  /** Confirmed component-internal power conversion; absent means ERC must not infer a transfer. */
  voltageTransforms?: VoltageTransform[];
  /**
   * A11【成组】：同一次「成组」的元件共用这个 id，拖动其中一个时整组一起移动。
   * 缺省（字段不存在）＝不属于任何组，旧项目文件因此仍能正常打开。
   * 它只描述"一起移动"这件事，不改变任何电气含义。
   */
  groupId?: string;
}

export interface VoltageTransform {
  inputPinId: string;
  outputPinId: string;
  outputVoltage: number;
  /** Confirmed input range required before a transform may create a Known output. */
  inputVoltageRange: VoltageRange;
}

/**
 * 画布坐标上的一个点。折线布线与用户固定的途经点都用它，
 * 与引脚 localPosition 一样属于"本地坐标"，绝不放图片像素坐标。
 */
export interface RoutePoint { x: number; y: number; }

/**
 * 连线的「用途」四类。声明放在这里（而不是 wireFocus.ts）是为了让 Wire 能引用它，
 * 同时避免 wireFocus.ts ⇄ types.ts 互相 import 形成循环依赖。
 * 判据只有一条：已算好的电气网络分类；判不出来就是 `unclassified`（未分类），绝不猜。
 */
export type WirePurpose = "power" | "ground" | "signal" | "unclassified";

export interface Wire {
  id: string;
  source: PinRef;
  target: PinRef;
  color: string;
  /** 用户自定义的线路分类文字（自由文本），或历史遗留的标签；不参与电气判定。 */
  label?: string;
  /**
   * 用户手工指定的线路用途，覆盖电气网络的自动判定。
   * 缺省表示完全按自动判定走（字段整体删除，不留 `purpose: undefined` 噪声）。
   */
  purpose?: WirePurpose;
  /**
   * 用户固定的折线途经点（按起点到终点的顺序，画布坐标）。
   * 缺省表示完全自动布线：元件移动后由布线器重新计算。
   * 一旦用户拖动折点或线段，就把当时的折线存进这里，之后移动元件也保持这段形状。
   */
  waypoints?: RoutePoint[];
  /**
   * A7【动手接线模式】：用户在实物上接好这根线、并在软件里双击确认过。
   * 缺省（字段不存在）＝未接好，旧项目文件因此仍然能正常打开。
   */
  manuallyWired?: boolean;
}
export interface PinRef { componentId: string; pinId: string; }
export interface CanvasState { x: number; y: number; zoom: number; gridSize: number; }
export interface Project {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: string;
  name: string;
  canvas: CanvasState;
  components: ComponentInstance[];
  wires: Wire[];
  /**
   * 批次2：分区显示名的重命名。缺省＝用内置名称（电源/主控/…）。
   * 它只影响区域标题文字，不改变任何元件归属或连接。
   */
  zoneNames?: Partial<Record<FunctionZoneId, string>>;
}

export type NetKind = "POWER" | "GROUND" | "SIGNAL" | "UNKNOWN";
export interface ElectricalNet { id: string; pins: PinRef[]; wireIds: string[]; kind: NetKind; }
export interface VoltageState {
  kind: "Known" | "Conflict" | "Unknown";
  /** Present only for Known, never guessed. */
  value?: number;
  sourcePins: PinRef[];
}
export interface CurrentState {
  kind: "Known" | "Estimated" | "Maximum" | "Unknown";
  value?: number;
  unit: "A";
  reason?: string;
}
export interface ErcProblem {
  id: string;
  rule: "SHORT_CIRCUIT" | "POWER_CONFLICT" | "OVERVOLTAGE" | "OUTPUT_CONFLICT" | "UNCONNECTED_REQUIRED_INPUT" | "POLARITY_ERROR" | "DANGLING_WIRE" | "MISSING_PIN" | "DUPLICATE_CONNECTION" | "UNCONFIRMED_NET" | "LEVEL_MISMATCH" | "GPIO_POWERING_LOAD" | "PARALLEL_POWER_OUTPUTS";
  severity: Severity;
  /** 原因：这条结论的直接依据。 */
  message: string;
  /** 可能后果：该结论成立时会发生什么（确定性文案，不做猜测推断）。 */
  consequence: string;
  /** 处理方法：用户应如何核实或修复。 */
  handling: string;
  affectedPins: PinRef[];
  netId?: string;
  evidence: Record<string, unknown>;
}
export interface ErcResult { nets: ElectricalNet[]; voltages: Record<string, VoltageState>; currents: Record<string, CurrentState>; problems: ErcProblem[]; }
