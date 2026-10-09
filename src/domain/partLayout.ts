import type { PinRole } from "./types";

/**
 * 画布元件引脚的显示布局。
 *
 * 只做确定性的几何计算，不读网络、不调模型。坐标以元件盒子左上角为原点（画布单位）。
 * 两种来源：
 * - hotspot：引脚坐标有明确出处（用户亲手录入过，或定义里带了来源）→ 原样保留、绝不改动，
 *   否则热点就和图片上的真实引脚对不上了。其中"用户亲手确认过位置"的定义无条件采信；
 *   纯机器来源的坐标若在几何上站不住（同侧引脚挤到标签会叠字），按退化数据处理、退回自动排布。
 * - auto：还有引脚完全没有坐标来源（典型的"上传了图但没拖热点"，以及
 *   "AI 只识别出引脚名、没有像素坐标"）→ 按类型分到左右两侧、均匀铺开，
 *   并把盒子撑到足够大，保证标签既不重叠、也不会压在引脚圆点上。
 */

export interface PartLayoutPinInput {
  id: string;
  name: string;
  role: PinRole;
  localPosition: { x: number; y: number };
  /** 该引脚的位置是否有明确来源（编辑元件定义时的 userOverrides 命中，或定义里记了 x/y 的来源）。 */
  placed: boolean;
  /**
   * 该引脚的位置是否由**用户亲手录入/拖动**确认过（来源＝已确认 · 用户录入）。
   * 与 placed 的区别：placed 只说"这个坐标有出处、别丢"，confirmed 说"这是人看着编辑器里的数字定的"。
   */
  confirmed: boolean;
}

export interface PartLayoutPin {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 标签贴在引脚内侧的哪一边：left 表示标签在引脚左边，right 表示在右边。 */
  labelSide: "left" | "right";
}

export interface PartLayout {
  width: number;
  height: number;
  pins: PartLayoutPin[];
  source: "hotspot" | "auto";
}

/** 引脚沿边缘的最小垂直间距：要大于一行标签的高度，避免上下两条标签叠在一起。 */
export const PART_PIN_GAP = 30;

/**
 * 判定"用户热点"是否退化：热点包围盒在元件盒子里铺开的比例（取两轴中较大的一个）。
 * 只要至少一个轴明显铺开，就说明这组坐标是用户按图片仔细放的（例如同一行左右分布的引脚，
 * 横向铺开但纵向很接近，此时标签并不会互相压住）。
 * 两个轴都只占盒子很小一块，说明坐标被压成了一小团：典型的坏数据是图片像素坐标被当成
 * 本地坐标存进引脚（可能来自历史数据或外部手写候选），此时标签必然叠在一起读不出名字，退回自动排布。
 */
export const MIN_HOTSPOT_SPREAD_RATIO = 0.25;

/** 自动排布时的盒子最小尺寸。 */
const MIN_WIDTH = 150;
const MIN_HEIGHT = 60;

/** 视作"输入侧"的角色；自动排布时这些引脚放左边。 */
const INPUT_SIDE_ROLES: readonly PinRole[] = ["POWER_INPUT", "INPUT", "GND"];

const isInputSide = (role: PinRole): boolean => INPUT_SIDE_ROLES.includes(role);

/**
 * 一组"用户已定位"的热点是否可用。除了每个引脚都得定位过，还要求它们在几何上站得住：
 * 热点不能全挤在盒子的一个小角落里，否则标签必然互相压住。
 * 只有单引脚时不存在拥挤，始终可用。
 * 这样就能挡住"AI 像素坐标被当成本地坐标"这类退化数据，而不是把坏坐标渲染成一个糊团。
 */
function hotspotsUsable(pins: readonly PartLayoutPinInput[], width: number, height: number): boolean {
  if (pins.length < 2) return true;
  const xs = pins.map((pin) => pin.localPosition.x);
  const ys = pins.map((pin) => pin.localPosition.y);
  const spread = Math.max(
    (Math.max(...xs) - Math.min(...xs)) / width,
    (Math.max(...ys) - Math.min(...ys)) / height,
  );
  return spread >= MIN_HOTSPOT_SPREAD_RATIO;
}

/**
 * 计算元件在画布上的引脚布局。
 * 输入是元件原始尺寸与引脚（含用户热点坐标），输出是实际渲染用的盒子尺寸与引脚位置。
 */
export function layoutPart(
  footprint: { width: number; height: number },
  pins: readonly PartLayoutPinInput[],
): PartLayout {
  const width = Math.max(footprint.width, 1);
  const height = Math.max(footprint.height, 1);
  if (pins.length === 0) return { width, height, pins: [], source: "auto" };

  // ① 只要用户亲手确认过**至少一个**引脚的位置，这份定义里的坐标就是"用户在编辑器里看到的那些数字"，
  //    必须全部原样采用。否则用户在编辑器里改坐标、保存后画布纹丝不动——因为只要还有一个引脚是
  //    AI 兜底排布出来的（没有点，placed=false），旧规则就会整体退回自动排布，把用户的改动吃掉。
  // ② 没有用户亲手确认时仍走原来的门控：每个引脚都得有坐标、且这组坐标在几何上站得住，
  //    挡住"AI 像素坐标被当成本地坐标"这类退化数据，而不是把坏坐标渲染成一个糊团。
  const userAuthored = pins.some((pin) => pin.confirmed);
  const useHotspot = userAuthored || (pins.every((pin) => pin.placed) && hotspotsUsable(pins, width, height));

  if (useHotspot) {
    return {
      width,
      height,
      source: "hotspot",
      pins: pins.map((pin) => ({
        id: pin.id,
        name: pin.name,
        x: pin.localPosition.x,
        y: pin.localPosition.y,
        labelSide: pin.localPosition.x <= width / 2 ? "right" : "left",
      })),
    };
  }

  // 自动排布：先按角色分左右；若有一侧为空、或两侧悬殊到没法用，就按顺序对半拆开。
  // 一侧为空时所有引脚会挤在同一条边缘上（"看不见引脚、名字对不上"的根因）；
  // 悬殊则出现在多功能模块上：引脚绝大多数是 GPIO，按角色分只剩两三个落左边，
  // 右边会被拉成几十行、整块盒子高到画布外。
  let left = pins.filter((pin) => isInputSide(pin.role));
  let right = pins.filter((pin) => !isInputSide(pin.role));
  const lopsided = Math.min(left.length, right.length) * 3 < Math.max(left.length, right.length);
  if (left.length === 0 || right.length === 0 || lopsided) {
    const half = Math.ceil(pins.length / 2);
    left = pins.slice(0, half);
    right = pins.slice(half);
  }

  const boxWidth = Math.max(width, MIN_WIDTH);
  // 每侧 n 个引脚会均分成 n+1 段，因此要支撑最小间距至少需要 (n+1)×间距 的高度。
  const boxHeight = Math.max(height, (Math.max(left.length, right.length) + 1) * PART_PIN_GAP, MIN_HEIGHT);

  const place = (list: readonly PartLayoutPinInput[], x: number, labelSide: "left" | "right"): PartLayoutPin[] =>
    list.map((pin, index) => ({
      id: pin.id,
      name: pin.name,
      x,
      y: (boxHeight * (index + 1)) / (list.length + 1),
      labelSide,
    }));

  return {
    width: boxWidth,
    height: boxHeight,
    source: "auto",
    pins: [...place(left, 0, "right"), ...place(right, boxWidth, "left")],
  };
}