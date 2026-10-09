import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

/** 生成一张合法 PNG，尺寸固定，便于断言坐标映射。 */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 真彩色
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // 过滤器
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = (x * 6) % 256;
      raw[offset + 1] = (y * 12) % 256;
      raw[offset + 2] = 128;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 40×20 的横向图片：元件尺寸会被设为 180×90，便于推算缩放。 */
const IMAGE = { name: 'part.png', mimeType: 'image/png', buffer: makePng(40, 20) };

async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** 用户元件列表已收进「元件库」弹窗：侧栏只剩一个入口按钮。 */
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '元件库…' }).click();
  const dialog = page.getByRole('dialog', { name: '元件仓库' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function newComponentWithImage(page: Page, name: string, pinName: string) {
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill(name);
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill(pinName);
  await page.getByLabel('上传元件图片').setInputFiles(IMAGE);
  await expect(page.getByLabel('引脚热点编辑区')).toBeVisible();
}

/** 读取元素的计算样式矩阵（matrix(a, b, c, d, e, f)），用于断言图片确实旋转。 */
async function readTransform(page: Page, selector: string): Promise<number[]> {
  const raw = await page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
  return (raw.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
}

test('上传图片后可在图片上拖动引脚热点，保存后重新打开坐标一致', async ({ page }) => {
  await page.goto('/');
  await newComponentWithImage(page, '带图片元件', 'P1');

  await expect(page.getByLabel('引脚热点编辑区').locator('img')).toHaveAttribute('src', /^data:image\/png/);

  const stage = page.getByLabel('引脚热点编辑区');
  const hotspot = page.getByLabel('引脚热点 P1');
  const stageBox = await stage.boundingBox();
  const hotspotBox = await hotspot.boundingBox();
  if (!stageBox || !hotspotBox) throw new Error('热点编辑区未渲染');

  // 把热点从左上角拖到舞台右下方。
  await dragFromTo(
    page,
    { x: hotspotBox.x + hotspotBox.width / 2, y: hotspotBox.y + hotspotBox.height / 2 },
    { x: stageBox.x + stageBox.width * 0.7, y: stageBox.y + stageBox.height * 0.6 },
  );

  const xValue = await page.getByLabel('引脚 1 位置 X').inputValue();
  const yValue = await page.getByLabel('引脚 1 位置 Y').inputValue();
  expect(Number(xValue)).toBeGreaterThan(50);
  expect(Number(yValue)).toBeGreaterThan(20);

  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「带图片元件」已保存。')).toBeVisible();

  await page.reload();
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '编辑元件 带图片元件' }).click();
  await expect(page.getByLabel('引脚热点编辑区').locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.getByLabel('引脚 1 位置 X')).toHaveValue(xValue);
  await expect(page.getByLabel('引脚 1 位置 Y')).toHaveValue(yValue);
});

test('旋转与裁剪随元件保存，并在重新加载后还原', async ({ page }) => {
  await page.goto('/');
  await newComponentWithImage(page, '旋转裁剪元件', 'P1');

  // 旋转两次 → 180°。
  await page.getByRole('button', { name: /旋转 90°/ }).click();
  await page.getByRole('button', { name: /旋转 90°/ }).click();
  await expect(page.getByRole('button', { name: '旋转 90°（当前 180°）' })).toBeVisible();

  // 断言图片确实被旋转（而不是只改了盒子尺寸）：rotate(180deg) → matrix(-1, 0, 0, -1, …)。
  const rotatedMatrix = await readTransform(page, '.image-stage-img');
  expect(rotatedMatrix[0]).toBeCloseTo(-1, 3);
  expect(rotatedMatrix[3]).toBeCloseTo(-1, 3);
  expect(rotatedMatrix[1]).toBeCloseTo(0, 3);
  expect(rotatedMatrix[2]).toBeCloseTo(0, 3);

  // 框选裁剪区域。
  await page.getByRole('button', { name: '裁剪图片' }).click();
  const cropStage = page.getByLabel('裁剪区域');
  const box = await cropStage.boundingBox();
  if (!box) throw new Error('裁剪区域未渲染');
  await dragFromTo(
    page,
    { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 },
    { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 },
  );
  await page.getByRole('button', { name: '应用裁剪' }).click();
  await expect(page.getByLabel('引脚热点编辑区')).toBeVisible();

  // 断言裁剪真实生效：外框裁掉多余部分（overflow:hidden），内部原图比外框更大。
  const clip = await page.evaluate(() => {
    const frame = document.querySelector('.image-stage-frame') as HTMLElement | null;
    const img = document.querySelector('.image-stage-img') as HTMLElement | null;
    if (!frame || !img) return null;
    return { overflow: getComputedStyle(frame).overflow, frameWidth: frame.offsetWidth, imgWidth: img.offsetWidth };
  });
  if (!clip) throw new Error('图片外框未渲染');
  expect(clip.overflow).toBe('hidden');
  expect(clip.imgWidth).toBeGreaterThan(clip.frameWidth);

  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「旋转裁剪元件」已保存。')).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aiws.user-library') ?? '{}'));
  const saved = stored.definitions.find((item: { displayName: string }) => item.displayName === '旋转裁剪元件');
  expect(saved.image.rotation).toBe(180);
  expect(saved.image.crop.width).toBeLessThan(1);
  expect(saved.image.crop.width).toBeGreaterThan(0);
  expect(String(saved.image.dataUrl).startsWith('data:image/png')).toBe(true);

  await page.reload();
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '编辑元件 旋转裁剪元件' }).click();
  await expect(page.getByRole('button', { name: '旋转 90°（当前 180°）' })).toBeVisible();
  await expect(page.getByLabel('引脚热点编辑区')).toBeVisible();
});

test('没拖动过热点的元件放到画布后，引脚自动分到两侧、标签不重叠也不压住圆点', async ({ page }) => {
  await page.goto('/');
  await newComponentWithImage(page, '自动排布元件', 'VCC');
  // 再补两个引脚，且一个都不拖动 → 三个引脚的坐标都停在原点，正是"引脚凑成一团"的输入。
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 2 名称').fill('GND');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 3 名称').fill('SDA');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「自动排布元件」已保存。')).toBeVisible();

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 自动排布元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '自动排布元件' });
  const labels = node.locator('.part-pin-label');
  await expect(labels).toHaveCount(3);

  const rects = await labels.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  // 标签两两不重叠：重叠正是"引脚名字对不上引脚"的直接原因。
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      expect(overlap, `标签 ${i} 与标签 ${j} 重叠了`).toBe(false);
    }
  }
  // 标签不盖住任何引脚圆点。
  const handles = await node.locator('.react-flow__handle').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  for (const label of rects) {
    for (const center of handles) {
      const covered = center.x > label.x && center.x < label.right && center.y > label.y && center.y < label.bottom;
      expect(covered, `标签盖住了引脚圆点 ${center.x},${center.y}`).toBe(false);
    }
  }
  // 标签不越出元件盒子。
  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error('元件未渲染');
  for (const label of rects) {
    expect(label.x).toBeGreaterThanOrEqual(nodeBox.x - 1);
    expect(label.right).toBeLessThanOrEqual(nodeBox.x + nodeBox.width + 1);
  }
});

test('用户亲手定位过的引脚热点在画布上原样保留，不会被自动排布挪走', async ({ page }) => {
  await page.goto('/');
  await newComponentWithImage(page, '热点保留元件', 'IN1');
  // 手填坐标与拖热点等价：都属于"用户已确认该引脚位置"。
  await page.getByLabel('引脚 1 位置 X').fill('150');
  await page.getByLabel('引脚 1 位置 Y').fill('70');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「热点保留元件」已保存。')).toBeVisible();

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 热点保留元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '热点保留元件' });
  const nodeBox = await node.boundingBox();
  const handleBox = await node.locator('.hotspot').first().boundingBox();
  if (!nodeBox || !handleBox) throw new Error('元件未渲染');
  // 图片按 40×20 上传 → 尺寸 180×90；画布有 fitView 缩放，先换算回元件本地坐标再比对。
  // 每引脚只有一个热点，正落在用户填的坐标上。自动排布会把引脚挪到别处，差得很远，足以区分。
  const scale = nodeBox.width / 180;
  const localX = (handleBox.x + handleBox.width / 2 - nodeBox.x) / scale;
  const localY = (handleBox.y + handleBox.height / 2 - nodeBox.y) / scale;
  expect(Math.abs(localX - 150)).toBeLessThanOrEqual(2);
  expect(Math.abs(localY - 70)).toBeLessThanOrEqual(2);
});

test('带图片的用户元件放到画布后按热点渲染，并可正常连线', async ({ page }) => {
  await page.goto('/');
  await newComponentWithImage(page, '图片元件', 'IN1');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「图片元件」已保存。')).toBeVisible();

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 图片元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '图片元件' });
  await expect(node.locator('.part-image')).toBeVisible();
  await expect(node.locator('.part-image-frame')).toBeVisible();
  await expect(node.locator('.hotspot')).toHaveCount(1);

  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.react-flow__handle-right').first();
  const target = node.locator('.hotspot').first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('连线端点未渲染');
  await dragFromTo(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('编辑器里落在 X=0 的引脚圆点完整留在编辑区内，且能真正拖动', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill('边缘引脚元件');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill('EDGE');

  // 新引脚默认停在原点：旧实现把"圆点+名字"整组居中到引脚点上，圆点会被名字顶到左框外、鼠标够不到。
  const stage = page.getByLabel('引脚热点编辑区');
  const dot = page.getByLabel('引脚热点 EDGE').locator('.image-hotspot-dot');
  const stageBox = await stage.boundingBox();
  const dotBox = await dot.boundingBox();
  if (!stageBox || !dotBox) throw new Error('引脚热点未渲染');
  expect(dotBox.x).toBeGreaterThanOrEqual(stageBox.x - 0.5);
  expect(dotBox.y).toBeGreaterThanOrEqual(stageBox.y - 0.5);
  expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 0.5);
  expect(dotBox.y + dotBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 0.5);

  // 够得到就要真的拖得动。
  await dragFromTo(
    page,
    { x: dotBox.x + dotBox.width / 2, y: dotBox.y + dotBox.height / 2 },
    { x: stageBox.x + stageBox.width * 0.5, y: stageBox.y + stageBox.height * 0.5 },
  );
  expect(Number(await page.getByLabel('引脚 1 位置 X').inputValue())).toBeGreaterThan(10);
});

test('没有图片的用户元件也用盒式布局：每个引脚一个圆点、名字贴在自己的引脚旁', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill('无图多脚元件');
  const pinNames = ['A1', 'A2', 'B1', 'B2'];
  for (let index = 0; index < pinNames.length; index += 1) {
    await page.getByRole('button', { name: '＋ 添加引脚' }).click();
    await page.getByLabel(`引脚 ${index + 1} 名称`).fill(pinNames[index]);
  }
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「无图多脚元件」已保存。')).toBeVisible();

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 无图多脚元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '无图多脚元件' });
  // 旧实现走逐行列表：名字居中、每行左右各一个圆点（看起来像"一个名字两个引脚"）。
  await expect(node.locator('.pin')).toHaveCount(0);
  const labels = node.locator('.part-pin-label');
  await expect(labels).toHaveCount(4);
  await expect(node.locator('.hotspot')).toHaveCount(4);
  // 连线能力不能丢：每个引脚仍同时有 source/target 两种热点。
  await expect(node.locator('.react-flow__handle-right')).toHaveCount(4);
  await expect(node.locator('.react-flow__handle-left')).toHaveCount(4);

  const labelRects = await labels.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  const handleCenters = await node.locator('.hotspot').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  // 每个名字都要紧挨着某个引脚，且不允许两个名字认领同一个引脚（否则还是会"名字对不上引脚"）。
  const claimed = labelRects.map((rect) => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    handleCenters.forEach((center, index) => {
      const dx = Math.max(rect.x - center.x, 0, center.x - rect.right);
      const dy = Math.max(rect.y - center.y, 0, center.y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    expect(bestDistance).toBeLessThan(30);
    return best;
  });
  expect(new Set(claimed).size).toBe(4);
});

test('没有图片时也能直接拖动引脚摆放，名称跟着引脚一起移动并随元件保存', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill('无图拖动元件');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill('VCC');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 2 名称').fill('GND');

  // 没上传图片也必须能拖：否则用户只能手填位置 X/Y。
  const stage = page.getByLabel('引脚热点编辑区');
  await expect(stage).toBeVisible();
  await expect(stage.locator('img')).toHaveCount(0);

  const hotspot = page.getByLabel('引脚热点 VCC');
  // 填完靠下的引脚字段后，编辑器内部滚动条会把顶部这块编辑区推到视口外，
  // 此时按 boundingBox 拖拽会落在视口外（鼠标事件打给页面背景），必须先把编辑区滚回可见范围。
  await stage.scrollIntoViewIfNeeded();
  // 从热点中心起拖：热点容器就是圆点本身，用 translate(-50%,-50%) 居中在引脚坐标上，中心即引脚点。
  const hotspotBox = await hotspot.boundingBox();
  const dotBefore = await hotspot.locator('.image-hotspot-dot').boundingBox();
  const stageBox = await stage.boundingBox();
  if (!hotspotBox || !dotBefore || !stageBox) throw new Error('引脚热点未渲染');

  await dragFromTo(
    page,
    { x: hotspotBox.x + hotspotBox.width / 2, y: hotspotBox.y + hotspotBox.height / 2 },
    { x: stageBox.x + stageBox.width * 0.6, y: stageBox.y + stageBox.height * 0.7 },
  );

  const dotAfter = await hotspot.locator('.image-hotspot-dot').boundingBox();
  const labelAfter = await hotspot.locator('.image-hotspot-label').boundingBox();
  if (!dotAfter || !labelAfter) throw new Error('引脚热点未渲染');

  // 圆点必须跟着拖动走。
  expect(Math.abs(dotAfter.x - dotBefore.x)).toBeGreaterThan(20);
  // 名称必须始终贴着自己的引脚。拖到右半区时名字会自动翻到圆点左侧（避免长名字伸出编辑区），
  // 所以这里只断言"贴住"，不断言它在左还是在右。
  const gapX = Math.max(labelAfter.x - (dotAfter.x + dotAfter.width), 0, dotAfter.x - (labelAfter.x + labelAfter.width));
  const gapY = Math.max(labelAfter.y - (dotAfter.y + dotAfter.height), 0, dotAfter.y - (labelAfter.y + labelAfter.height));
  expect(Math.hypot(gapX, gapY)).toBeLessThan(30);

  const xValue = await page.getByLabel('引脚 1 位置 X').inputValue();
  const yValue = await page.getByLabel('引脚 1 位置 Y').inputValue();
  expect(Number(xValue)).toBeGreaterThan(40);
  expect(Number(yValue)).toBeGreaterThan(30);

  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「无图拖动元件」已保存。')).toBeVisible();

  await page.reload();
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '编辑元件 无图拖动元件' }).click();
  await expect(page.getByLabel('引脚 1 位置 X')).toHaveValue(xValue);
  await expect(page.getByLabel('引脚 1 位置 Y')).toHaveValue(yValue);
});
