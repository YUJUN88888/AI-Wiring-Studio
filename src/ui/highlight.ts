import { createContext } from 'react';
import type { WireFocusView, WirePurpose, WiringPreview } from '../domain';

/**
 * A14 引脚网络高亮：点击引脚时临时点亮同一电气网络上的所有引脚与连线。
 *
 * 高亮是**纯展示态**——不写项目文件、不改连线的持久颜色（`Wire.color`），
 * 所以用 React Context 从画布传给 `PartNode` 与 `RoutedEdge` 直接读，
 * 不必把状态塞进节点/边的 `data` 里反复同步，也就不会和 A7「动手接线模式」的灰化互相污染。
 */
/**
 * A7【动手接线模式】的展示态：模式开关、已接好的连线、以及当下建议先接的那一根。
 * 和 A14 一样是**纯展示态**：真实"已接好"写在项目文件（`Wire.manuallyWired`），
 * 这里只把「当前项目的这份状态」传给边组件读，避免把状态塞进每条边的 data 里反复重建。
 */
export type WiringGuide = {
  /** 模式是否开启；关闭时不灰化、不闪烁，但已接好的记忆仍留在项目里。 */
  active: boolean;
  /** 已标记「已接好」的连线 id。 */
  done: ReadonlySet<string>;
  /** 当下建议先接的连线 id；模式关闭或全部接完时为 null。 */
  suggested: string | null;
};

export type PinHighlight = {
  /** 点亮某个引脚所在的整张电气网络；再点同一个引脚则取消。 */
  select: (componentId: string, pinId: string) => void;
  /** 处于高亮网络中的引脚键（`componentId:pinId`，与领域层 pinKey 同构）。 */
  pins: ReadonlySet<string>;
  /** 处于高亮网络中的连线 id。 */
  wires: ReadonlySet<string>;
  /** A7 动手接线模式的展示态。 */
  wiring: WiringGuide;
  /**
   * A8【更新接线代码并对比】的差异预览态：null 表示不在预览中。
   * 同样只是展示态——预览期间画布渲染的是"并集项目"，`project` 状态一个字节都没改，
   * 用户点「取消」就回到原样。
   */
  preview: WiringPreview | null;
  /**
   * 批次1「线路聚焦与筛选」的展示态：默认淡化、聚焦强调、按用途筛选。
   * 与 A14/A7 一样是**纯展示态**——只影响描边透明度与光晕，不写项目文件、不改 `Wire.color`。
   */
  focus: WireFocusView;
  /** 每条连线的用途（电源／地线／信号／未分类），判据是领域层已有的电气网络分类。 */
  purposes: ReadonlyMap<string, WirePurpose>;
};

const EMPTY: ReadonlySet<string> = new Set();
const IDLE_WIRING: WiringGuide = { active: false, done: EMPTY, suggested: null };
const IDLE_FOCUS: WireFocusView = {
  mutedWires: EMPTY,
  strongWires: EMPTY,
  mutedComponents: EMPTY,
  strongComponents: EMPTY,
  matchedWires: 0,
  focusActive: false,
  moduleFilterNeedsFocus: false,
};

export const PinHighlightContext = createContext<PinHighlight>({ select: () => {}, pins: EMPTY, wires: EMPTY, wiring: IDLE_WIRING, preview: null, focus: IDLE_FOCUS, purposes: new Map() });