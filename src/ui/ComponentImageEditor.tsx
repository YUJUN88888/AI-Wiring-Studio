import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  createLayoutFromImage,
  imageRenderGeometry,
  localToImagePixel,
  type ComponentImage,
  type ImageRotation,
} from '../domain';

const rotations: readonly ImageRotation[] = [0, 90, 180, 270];
/** 热点编辑区最大像素尺寸；实际显示按 footprint 等比缩放。 */
const STAGE_MAX_WIDTH = 560;
const STAGE_MAX_HEIGHT = 420;
/**
 * 编辑区四周留出的内边距（屏幕像素）。圆点本身就画在引脚坐标上，
 * 没有这圈留白时，落在 X=0 / Y=0 这些边上的引脚会有一半跑到画框外、鼠标够不到。
 */
const STAGE_PADDING = 20;
/** 缩放下限：元件再大也要能整块塞进编辑区，宁可画小一点也不能有引脚留在框外。 */
const MIN_ZOOM = 0.25;
/** 裁剪框画布尺寸。 */
const CROP_STAGE_WIDTH = 360;
const CROP_STAGE_HEIGHT = 260;
/** 裁剪选区小于该比例视为无效，避免生成无意义的极小图。 */
const MIN_CROP_RATIO = 0.05;

export interface ComponentImagePin {
  id: string;
  name: string;
  localPosition: { x: number; y: number };
}

export interface ComponentImageEditorProps {
  image?: ComponentImage;
  footprint: { width: number; height: number };
  pins: ComponentImagePin[];
  onImageChange: (image: ComponentImage | undefined) => void;
  onFootprintChange: (footprint: { width: number; height: number }) => void;
  onPinMove: (pinId: string, position: { x: number; y: number }) => void;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 用浏览器解码图片，取得原图像素尺寸；这是建立坐标映射的前提。 */
export function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => reject(new Error('无法解码图片'));
    probe.src = dataUrl;
  });
}

/**
 * 元件图片与引脚热点编辑器。
 * 所有热点坐标都存成元件本地单位，因此无论图片如何裁剪、旋转或缩放，重新打开都能按同一映射还原。
 */
export function ComponentImageEditor({ image, footprint, pins, onImageChange, onFootprintChange, onPinMove }: ComponentImageEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragPinId, setDragPinId] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cropRef = useRef<HTMLDivElement | null>(null);
  const cropStart = useRef<{ x: number; y: number } | null>(null);

  const layout = image ? createLayoutFromImage(footprint, image) : undefined;
  const rotation = image?.rotation ?? 0;

  // 热点编辑区缩放：把元件本地尺寸映射到屏幕上可操作的像素尺寸。
  useEffect(() => {
    const fit = Math.min(STAGE_MAX_WIDTH / footprint.width, STAGE_MAX_HEIGHT / footprint.height);
    setZoom(clamp(fit, MIN_ZOOM, 4));
  }, [footprint.width, footprint.height]);

  /** 指针位置 → 元件本地坐标（画布单位）。编辑区左侧/上方各有 STAGE_PADDING 的留白，要先减掉。 */
  const localFromPointer = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      x: clamp(round1((clientX - rect.left - STAGE_PADDING) / zoom), 0, footprint.width),
      y: clamp(round1((clientY - rect.top - STAGE_PADDING) / zoom), 0, footprint.height),
    };
  };

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragPinId) return;
    const local = localFromPointer(event.clientX, event.clientY);
    if (local) onPinMove(dragPinId, local);
  };

  const stopDragging = () => setDragPinId(null);

  /** 指针位置 → 裁剪框内的本地像素坐标。 */
  const cropPointFromPointer = (clientX: number, clientY: number) => {
    const rect = cropRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return { x: clamp(clientX - rect.left, 0, CROP_STAGE_WIDTH), y: clamp(clientY - rect.top, 0, CROP_STAGE_HEIGHT) };
  };

  const startCrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = cropPointFromPointer(event.clientX, event.clientY);
    if (!start) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    cropStart.current = start;
    setSelection({ x: start.x, y: start.y, width: 0, height: 0 });
  };

  const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = cropStart.current;
    const point = cropPointFromPointer(event.clientX, event.clientY);
    if (!start || !point) return;
    setSelection({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  };

  const endCrop = () => { cropStart.current = null; };

  // 裁剪框中原图的等比缩放与居中偏移（基于未旋转、未裁剪的完整原图）。
  const cropGeometry = image?.naturalWidth && image.naturalHeight
    ? (() => {
        const fit = Math.min(CROP_STAGE_WIDTH / image.naturalWidth!, CROP_STAGE_HEIGHT / image.naturalHeight!);
        const dispW = image.naturalWidth! * fit;
        const dispH = image.naturalHeight! * fit;
        return { dispW, dispH, offX: (CROP_STAGE_WIDTH - dispW) / 2, offY: (CROP_STAGE_HEIGHT - dispH) / 2 };
      })()
    : undefined;

  /** 接受一张选入或拖入的图片：校验类型 → 读成 data URL → 取原图像素尺寸 → 重置裁剪与旋转。 */
  const applyFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('请选择图片文件。'); return; }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const size = await readImageSize(dataUrl);
      const width = 180;
      const height = clamp(Math.round((width * size.height) / size.width), 60, 320);
      onFootprintChange({ width, height });
      // 新图片默认不裁剪、不旋转，避免沿用上一张图的裁剪造成困惑。
      onImageChange({ dataUrl, naturalWidth: size.width, naturalHeight: size.height, rotation: 0 });
      setSelection(null);
      setCropMode(false);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '图片读取失败');
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void applyFile(file);
  };

  const rotate = () => { if (image) onImageChange({ ...image, rotation: rotations[(rotations.indexOf(rotation) + 1) % rotations.length] }); };
  const removeImage = () => { onImageChange(undefined); setSelection(null); setCropMode(false); setError(null); };
  const resetCrop = () => { if (image) onImageChange({ ...image, crop: undefined }); };

  const applyCrop = () => {
    if (!image || !selection || !cropGeometry) return;
    const { dispW, dispH, offX, offY } = cropGeometry;
    const nx = clamp((selection.x - offX) / dispW, 0, 1);
    const ny = clamp((selection.y - offY) / dispH, 0, 1);
    const nw = clamp(selection.width / dispW, 0, 1 - nx);
    const nh = clamp(selection.height / dispH, 0, 1 - ny);
    if (nw < MIN_CROP_RATIO || nh < MIN_CROP_RATIO) { setError('裁剪区域太小，请重新框选。'); return; }
    onImageChange({ ...image, crop: { x: round4(nx), y: round4(ny), width: round4(nw), height: round4(nh) } });
    setSelection(null);
    setCropMode(false);
    setError(null);
  };

  return <div className="image-editor">
    <div className="image-toolbar">
      <label className="image-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void applyFile(file); }}>
        <input type="file" accept="image/*" aria-label="上传元件图片" onChange={onFile} />
        {image ? '替换图片（也可拖入）' : '上传图片（也可拖入）'}
      </label>
      {image && <button type="button" onClick={rotate}>旋转 90°（当前 {rotation}°）</button>}
      {image && <button type="button" onClick={() => { setCropMode(true); setSelection(null); setError(null); }}>裁剪图片</button>}
      {image && <button type="button" className="ghost danger" onClick={removeImage}>移除图片</button>}
    </div>
    {!image && <p className="hint">还没有图片：可以直接在下方把引脚圆点拖到对应位置；上传元件照片或引脚定义图后，同一套坐标会作为图片热点使用。</p>}
    {image && !image.dataUrl && <p className="hint">该元件只记录了图片相对路径，当前无法预览。重新上传图片可把图片数据内嵌进元件库。</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}

    {image?.dataUrl && cropMode && cropGeometry && <div className="crop-panel">
      <strong>裁剪图片</strong>
      <div
        className="crop-stage"
        ref={cropRef}
        aria-label="裁剪区域"
        style={{ width: CROP_STAGE_WIDTH, height: CROP_STAGE_HEIGHT }}
        onPointerDown={startCrop}
        onPointerMove={onCropPointerMove}
        onPointerUp={endCrop}
        onPointerCancel={endCrop}
      >
        <img className="crop-image" src={image.dataUrl} alt="" draggable={false} style={{ left: cropGeometry.offX, top: cropGeometry.offY, width: cropGeometry.dispW, height: cropGeometry.dispH }} />
        {selection && <div className="crop-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}
      </div>
      <div className="crop-actions">
        <span className="hint">在图片上按住并拖动鼠标，框选要保留的区域。</span>
        <button type="button" onClick={applyCrop} disabled={!selection || selection.width < 1 || selection.height < 1}>应用裁剪</button>
        <button type="button" onClick={() => { setCropMode(false); setSelection(null); }}>取消</button>
        {image.crop && <button type="button" className="ghost" onClick={resetCrop}>恢复完整图片</button>}
      </div>
    </div>}

    {!cropMode && <div className="image-hotspot-panel">
      <div
        className={`image-stage${image?.dataUrl ? '' : ' image-stage-empty'}`}
        ref={stageRef}
        aria-label="引脚热点编辑区"
        style={{ width: footprint.width * zoom + STAGE_PADDING * 2, height: footprint.height * zoom + STAGE_PADDING * 2 }}
        onPointerMove={onStagePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {layout && image?.dataUrl && (() => {
          const geometry = imageRenderGeometry(layout, zoom);
          return <div className="image-stage-frame" style={{ left: STAGE_PADDING + geometry.container.left, top: STAGE_PADDING + geometry.container.top, width: geometry.container.width, height: geometry.container.height }}>
            <img className="image-stage-img" src={image.dataUrl} alt="元件图片" draggable={false} style={{ left: geometry.image.left, top: geometry.image.top, width: geometry.image.width, height: geometry.image.height, transformOrigin: `${geometry.image.originX}px ${geometry.image.originY}px`, transform: `rotate(${geometry.image.rotation}deg)` }} />
          </div>;
        })()}
        {/* 圆点画在真正的引脚坐标上（不再把"圆点+名字"整组居中到引脚点，那会把圆点顶偏、边缘引脚挤出画框）；
            名字贴在内侧：左半区的引脚名字向右、右半区的向左，于是长名字也不会伸出编辑区。 */}
        {pins.map((pin) => <div
          key={pin.id}
          className="image-hotspot"
          role="button"
          aria-label={`引脚热点 ${pin.name || pin.id}`}
          data-side={pin.localPosition.x <= footprint.width / 2 ? 'right' : 'left'}
          style={{ left: STAGE_PADDING + pin.localPosition.x * zoom, top: STAGE_PADDING + pin.localPosition.y * zoom }}
          onPointerDown={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId); setDragPinId(pin.id); }}
        >
          <span className="image-hotspot-dot" />
          <span className="image-hotspot-label">{pin.name || pin.id}</span>
        </div>)}
      </div>
      <p className="hint">{image?.dataUrl
        ? '拖动圆点即可调整引脚热点，名称会跟着一起移动；坐标以元件本地单位保存，重新打开时按同一映射还原。'
        : '拖动圆点即可把引脚摆到元件上的位置（名称会跟着一起移动）；上传图片后，这套坐标会自动作为图片热点使用。'}</p>
      <ul className="image-hotspot-list">{pins.map((pin) => {
        const pixel = layout ? localToImagePixel(layout, pin.localPosition) : undefined;
        return <li key={pin.id}>{pin.name || pin.id}：本地 X {pin.localPosition.x}，Y {pin.localPosition.y}{pixel ? ` · 图片 ${Math.round(pixel.x)}, ${Math.round(pixel.y)} px` : ''}</li>;
      })}</ul>
    </div>}
  </div>;
}
