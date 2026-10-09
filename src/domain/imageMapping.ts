import type { ComponentImage } from "./componentDefinition";

/** 图片旋转角度（顺时针，度）。只允许直角旋转，保证坐标映射是精确的整数变换。 */
export type ImageRotation = 0 | 90 | 180 | 270;

/** 归一化矩形：取值相对原图，范围 0..1，与分辨率无关。 */
export interface NormalizedRect { x: number; y: number; width: number; height: number; }

export interface Point { x: number; y: number; }

export const fullCrop: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * 一张图片在元件本地坐标中的排布结果。本地坐标的原点是元件左上角，单位为画布单位。
 * 图片按“等比缩放 + 居中留白”的方式放入 footprint 盒子，因此需要记录缩放比例与偏移。
 */
export interface ImageLayout {
  /** footprint 盒子尺寸（本地单位）。 */
  width: number;
  height: number;
  /** 原图像素尺寸。 */
  naturalWidth: number;
  naturalHeight: number;
  /** 裁剪后、旋转前的图片像素尺寸。 */
  croppedWidth: number;
  croppedHeight: number;
  rotation: ImageRotation;
  crop: NormalizedRect;
  /** 本地单位 / 旋转后图片像素，等比缩放比例。 */
  scale: number;
  /** 图片（旋转后）在本地坐标中的显示尺寸。 */
  displayWidth: number;
  displayHeight: number;
  /** 图片左上角在本地坐标中的偏移（居中留白）。 */
  offsetX: number;
  offsetY: number;
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/** 把外部给出的裁剪矩形规整到合法范围，避免越界导致映射出错。 */
export function normalizeCrop(crop?: NormalizedRect): NormalizedRect {
  if (!crop) return { ...fullCrop };
  const x = clamp01(crop.x);
  const y = clamp01(crop.y);
  const width = Math.min(Math.max(crop.width, 0), 1 - x);
  const height = Math.min(Math.max(crop.height, 0), 1 - y);
  if (width <= 0 || height <= 0) return { ...fullCrop };
  return { x, y, width, height };
}

/**
 * 计算图片在元件本地坐标中的排布。旋转会交换裁剪后的宽高；缩放取较小比例以保证完整显示。
 */
export function createImageLayout(options: {
  footprint: { width: number; height: number };
  naturalWidth: number;
  naturalHeight: number;
  crop?: NormalizedRect;
  rotation?: ImageRotation;
}): ImageLayout {
  const crop = normalizeCrop(options.crop);
  const rotation = options.rotation ?? 0;
  const naturalWidth = Math.max(options.naturalWidth, 1e-6);
  const naturalHeight = Math.max(options.naturalHeight, 1e-6);
  const croppedWidth = Math.max(crop.width * naturalWidth, 1e-6);
  const croppedHeight = Math.max(crop.height * naturalHeight, 1e-6);
  const swapped = rotation === 90 || rotation === 270;
  const rotatedWidth = swapped ? croppedHeight : croppedWidth;
  const rotatedHeight = swapped ? croppedWidth : croppedHeight;
  const width = Math.max(options.footprint.width, 1e-6);
  const height = Math.max(options.footprint.height, 1e-6);
  const scale = Math.min(width / rotatedWidth, height / rotatedHeight);
  const displayWidth = rotatedWidth * scale;
  const displayHeight = rotatedHeight * scale;
  return {
    width,
    height,
    naturalWidth,
    naturalHeight,
    croppedWidth,
    croppedHeight,
    rotation,
    crop,
    scale,
    displayWidth,
    displayHeight,
    offsetX: (width - displayWidth) / 2,
    offsetY: (height - displayHeight) / 2,
  };
}

/** 直接从元件图片算出排布；缺少原图尺寸时返回 undefined（无法建立映射）。 */
export function createLayoutFromImage(
  footprint: { width: number; height: number },
  image: Pick<ComponentImage, "naturalWidth" | "naturalHeight" | "crop" | "rotation">,
): ImageLayout | undefined {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) return undefined;
  return createImageLayout({ footprint, naturalWidth, naturalHeight, crop: image.crop, rotation: image.rotation });
}

/** 裁剪坐标 → 旋转后的显示坐标。 */
function rotateForward(rotation: ImageRotation, lx: number, ly: number, cw: number, ch: number): Point {
  switch (rotation) {
    case 90: return { x: ch - ly, y: lx };
    case 180: return { x: cw - lx, y: ch - ly };
    case 270: return { x: ly, y: cw - lx };
    default: return { x: lx, y: ly };
  }
}

/** 旋转后的显示坐标 → 裁剪坐标（rotateForward 的逆变换）。 */
function rotateBackward(rotation: ImageRotation, rx: number, ry: number, cw: number, ch: number): Point {
  switch (rotation) {
    case 90: return { x: ry, y: ch - rx };
    case 180: return { x: cw - rx, y: ch - ry };
    case 270: return { x: cw - ry, y: rx };
    default: return { x: rx, y: ry };
  }
}

/** 原图像素坐标 → 元件本地坐标（画布单位）。 */
export function imagePixelToLocal(layout: ImageLayout, pixel: Point): Point {
  const lx = pixel.x - layout.crop.x * layout.naturalWidth;
  const ly = pixel.y - layout.crop.y * layout.naturalHeight;
  const rotated = rotateForward(layout.rotation, lx, ly, layout.croppedWidth, layout.croppedHeight);
  return { x: layout.offsetX + rotated.x * layout.scale, y: layout.offsetY + rotated.y * layout.scale };
}

/** 元件本地坐标 → 原图像素坐标（imagePixelToLocal 的逆变换）。 */
export function localToImagePixel(layout: ImageLayout, local: Point): Point {
  const rx = (local.x - layout.offsetX) / layout.scale;
  const ry = (local.y - layout.offsetY) / layout.scale;
  const cropped = rotateBackward(layout.rotation, rx, ry, layout.croppedWidth, layout.croppedHeight);
  return { x: cropped.x + layout.crop.x * layout.naturalWidth, y: cropped.y + layout.crop.y * layout.naturalHeight };
}

/**
 * 把图片真正画出来所需的几何：外框（裁剪并旋转后的可视区域）+ 内部原图的定位与旋转。
 * 外框需要 overflow:hidden 才能把旋转/裁剪后多余的部分裁掉，否则看到的仍是完整原图。
 */
export interface ImageRenderGeometry {
  container: { left: number; top: number; width: number; height: number };
  image: { left: number; top: number; width: number; height: number; rotation: ImageRotation; originX: number; originY: number };
}

/** zoom 为额外的显示缩放（编辑区按屏幕放大，画布为 1）。 */
export function imageRenderGeometry(layout: ImageLayout, zoom = 1): ImageRenderGeometry {
  const width = layout.displayWidth * zoom;
  const height = layout.displayHeight * zoom;
  // 裁剪区域中心在「缩放后原图」里的位置；旋转围绕该点进行，保证裁剪区始终居中于外框。
  const originX = (layout.crop.x + layout.crop.width / 2) * layout.naturalWidth * layout.scale * zoom;
  const originY = (layout.crop.y + layout.crop.height / 2) * layout.naturalHeight * layout.scale * zoom;
  return {
    container: { left: layout.offsetX * zoom, top: layout.offsetY * zoom, width, height },
    image: {
      left: width / 2 - originX,
      top: height / 2 - originY,
      width: layout.naturalWidth * layout.scale * zoom,
      height: layout.naturalHeight * layout.scale * zoom,
      rotation: layout.rotation,
      originX,
      originY,
    },
  };
}
