import { describe, expect, it } from "vitest";
import {
  createImageLayout,
  createLayoutFromImage,
  imagePixelToLocal,
  imageRenderGeometry,
  localToImagePixel,
  normalizeCrop,
  type ImageRotation,
} from "../../src/domain";

const footprint = { width: 200, height: 100 };

describe("image mapping", () => {
  it("等比缩放并居中留白：正方形图片放进扁盒子时左右留白", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 100, naturalHeight: 100 });
    expect(layout.scale).toBe(1);
    expect(layout.displayWidth).toBe(100);
    expect(layout.displayHeight).toBe(100);
    expect(layout.offsetX).toBe(50);
    expect(layout.offsetY).toBe(0);
  });

  it("旋转 90 度会交换裁剪后的宽高，缩放比例随之变化", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 200, naturalHeight: 100, rotation: 90 });
    // 旋转后为 100×200，受盒子高度 100 限制，缩放 0.5。
    expect(layout.scale).toBe(0.5);
    expect(layout.displayWidth).toBe(50);
    expect(layout.displayHeight).toBe(100);
    expect(layout.offsetX).toBe(75);
    expect(layout.offsetY).toBe(0);
  });

  it("裁剪会改变参与映射的像素尺寸", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 100, naturalHeight: 100, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(layout.croppedWidth).toBe(50);
    expect(layout.croppedHeight).toBe(50);
    // 裁剪后是 50×50，放进 200×100 的盒子，缩放 2。
    expect(layout.scale).toBe(2);
    expect(layout.displayWidth).toBe(100);
    expect(layout.displayHeight).toBe(100);
  });

  it("每种旋转下，像素坐标与本地坐标互为逆变换", () => {
    for (const rotation of [0, 90, 180, 270] as ImageRotation[]) {
      const layout = createImageLayout({ footprint, naturalWidth: 120, naturalHeight: 80, crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }, rotation });
      // 只取仍落在裁剪区域内的点。
      for (const pixel of [{ x: 30, y: 30 }, { x: 45, y: 33 }, { x: 12, y: 16 }]) {
        const local = imagePixelToLocal(layout, pixel);
        const back = localToImagePixel(layout, local);
        expect(back.x).toBeCloseTo(pixel.x, 6);
        expect(back.y).toBeCloseTo(pixel.y, 6);
      }
    }
  });

  it("旋转 90 度把裁剪图左上角映射到本地右上角", () => {
    const layout = createImageLayout({ footprint: { width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, rotation: 90 });
    // 缩放 1、无留白：原图左上角 (0,0) 顺时针旋转 90° 后落在本地右上角 (100, 0)。
    expect(imagePixelToLocal(layout, { x: 0, y: 0 })).toEqual({ x: 100, y: 0 });
    expect(localToImagePixel(layout, { x: 100, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("缺少原图尺寸时无法建立映射", () => {
    expect(createLayoutFromImage(footprint, {})).toBeUndefined();
    expect(createLayoutFromImage(footprint, { naturalWidth: 0, naturalHeight: 100 })).toBeUndefined();
  });

  it("越界或空白的裁剪会被规整为完整原图", () => {
    expect(normalizeCrop({ x: -1, y: 0, width: 2, height: 2 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(normalizeCrop({ x: 0.5, y: 0, width: 0, height: 1 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(normalizeCrop()).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("热点的本地坐标只取决于元件尺寸与图片布局，与像素密度无关", () => {
    const small = createImageLayout({ footprint, naturalWidth: 40, naturalHeight: 20 });
    const large = createImageLayout({ footprint, naturalWidth: 4000, naturalHeight: 2000 });
    // 同一相对位置的像素点映射到相同的本地坐标，说明映射是分辨率无关的。
    const a = imagePixelToLocal(small, { x: 10, y: 5 });
    const b = imagePixelToLocal(large, { x: 1000, y: 500 });
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it("小图放进大盒子会放大，且保持居中", () => {
    const layout = createImageLayout({ footprint: { width: 300, height: 300 }, naturalWidth: 10, naturalHeight: 10 });
    expect(layout.scale).toBe(30);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
    expect(imagePixelToLocal(layout, { x: 5, y: 5 })).toEqual({ x: 150, y: 150 });
  });

  it("渲染几何：无裁剪无旋转时内部图片恰好填满外框", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 100, naturalHeight: 100 });
    const geometry = imageRenderGeometry(layout);
    // 100×100 图片放进 200×100 盒子：缩放 1、左右各留白 50。
    expect(geometry.container).toEqual({ left: 50, top: 0, width: 100, height: 100 });
    expect(geometry.image.rotation).toBe(0);
    expect(geometry.image.left).toBe(0);
    expect(geometry.image.top).toBe(0);
    expect(geometry.image.width).toBe(100);
    expect(geometry.image.height).toBe(100);
  });

  it("渲染几何：旋转 90 度后外框宽高互换，内部图片绕裁剪中心旋转", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 200, naturalHeight: 100, rotation: 90 });
    const geometry = imageRenderGeometry(layout);
    // 旋转后为 100×200，受盒子高度限制缩放 0.5：外框 50×100，居中偏移 75。
    expect(geometry.container).toEqual({ left: 75, top: 0, width: 50, height: 100 });
    expect(geometry.image.rotation).toBe(90);
    // 内部仍是未旋转的原图（200×100 缩放 0.5），靠 transform 旋转，绕裁剪区中心。
    expect(geometry.image.width).toBe(100);
    expect(geometry.image.height).toBe(50);
    expect(geometry.image.originX).toBe(50);
    expect(geometry.image.originY).toBe(25);
    // 旋转中心（transform-origin）在容器内居中；旋转后 50×100 恰好填满外框。
    expect(geometry.image.left + geometry.image.originX).toBeCloseTo(geometry.container.width / 2, 6);
    expect(geometry.image.top + geometry.image.originY).toBeCloseTo(geometry.container.height / 2, 6);
    // 未旋转的图片要越过外框，旋转后才刚好填满。
    expect(geometry.image.left).toBeLessThan(0);
    expect(geometry.image.width).toBeGreaterThan(geometry.container.width);
  });

  it("渲染几何：裁剪后内部图片比外框更大（外框负责裁掉多余部分）", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 100, naturalHeight: 100, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    const geometry = imageRenderGeometry(layout);
    // 裁剪出 50×50 后放大 2 倍填满 100×100 外框。
    expect(geometry.container.width).toBe(100);
    expect(geometry.container.height).toBe(100);
    // 原始 100×100 缩放 2 倍为 200×200，确实大于外框，说明被真正裁剪而非拉伸。
    expect(geometry.image.width).toBe(200);
    expect(geometry.image.height).toBe(200);
    expect(geometry.image.width).toBeGreaterThan(geometry.container.width);
    // 裁剪区中心落在缩放后原图 (100,100)，与外框中心对齐。
    expect(geometry.image.originX).toBe(100);
    expect(geometry.image.originY).toBe(100);
  });

  it("渲染几何：热点本地坐标落在渲染外框内，且与外框中心一致", () => {
    const layout = createImageLayout({ footprint, naturalWidth: 100, naturalHeight: 100, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    const geometry = imageRenderGeometry(layout);
    // 裁剪区中心对应的原图像素点，映射到本地坐标应正好落在外框中心。
    const center = imagePixelToLocal(layout, { x: 50, y: 50 });
    expect(center.x).toBeCloseTo(geometry.container.left + geometry.container.width / 2, 6);
    expect(center.y).toBeCloseTo(geometry.container.top + geometry.container.height / 2, 6);
  });
});
