import { expect, test, type Page } from '@playwright/test';

/**
 * 八方向折线布线：折线形状、折点拖动、线段拖拽、固定途经点、移动元件后重路由。
 * 所有断言都基于数值（路径 d、localStorage 里的 wires），不靠肉眼看截图。
 */

/**
 * 从 USB 5V 电源的 GND 引脚连到 ESP32 的 GPIO21：两者不在同一行，必然产生折点。
 * 统一盒式布局后热点按引脚 id 定位（.hotspot 是可见 source 点、.hotspot-hit 是重合的透明落点），
 * 不能再按左右类名的序号取——DOM 顺序跟着排布结果走，序号已不代表某个具体引脚。
 */
async function createWire(page: Page) {
  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.hotspot[data-pin="GND"]');
  const target = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' }).locator('.hotspot-hit[data-pin="GPIO21"]');
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('引脚热点未渲染');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
}

/** 连线路径的 d 属性，用来做几何断言。 */
async function edgePath(page: Page, index = 0) {
  return page.locator('.react-flow__edge').nth(index).locator('.react-flow__edge-path').getAttribute('d') ?? '';
}

/** 取连线路径中点的屏幕坐标（右键、选中都用它，避免落在元件热点上）。 */
async function wireMidpoint(page: Page, index = 0) {
  return page.locator('.react-flow__edge').nth(index).evaluate((element) => {
    const path = element.querySelector('.react-flow__edge-path') as SVGPathElement | null;
    if (!path) throw new Error('连线路径未渲染');
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('无法取得连线变换矩阵');
    return { x: point.x * matrix.a + point.y * matrix.c + matrix.e, y: point.x * matrix.b + point.y * matrix.d + matrix.f };
  });
}

/** 从路径里取出所有拐角坐标（圆角处 Q 的控制点就是折点本身）。 */
function corners(path: string): { x: number; y: number }[] {
  return [...path.matchAll(/Q\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

/**
 * 还原折线的真实顶点序列：起点 + 每个圆角的控制点 + 最后一个点。
 * 不能直接抓所有 L 点——圆角会把折点拆成"入点 L、控制点 Q、出点 L"，
 * 拿入点去和下一段的入点相比，中间自然夹着斜段，会误报"不是八方向"。
 */
function polyline(path: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const first = path.match(/^M\s*(-?[\d.]+)\s+(-?[\d.]+)/);
  if (first) points.push({ x: Number(first[1]), y: Number(first[2]) });
  points.push(...corners(path));
  const lines = [...path.matchAll(/L\s*(-?[\d.]+)\s+(-?[\d.]+)/g)];
  const last = lines.at(-1);
  if (last) points.push({ x: Number(last[1]), y: Number(last[2]) });
  return points;
}

async function savedWires(page: Page) {
  return page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}');
    return (raw.wires ?? []) as { id: string; waypoints?: { x: number; y: number }[] }[];
  });
}

test('连线是八方向折线：有折点、有可编辑手柄，线段只走水平/垂直/45°', async ({ page }) => {
  await page.goto('/');
  await createWire(page);
  const path = await edgePath(page);
  // 折线上除了起点终点必然还有别的顶点（两个引脚不在同一行）。
  expect(polyline(path).length).toBeGreaterThan(2);

  // 逐段验证八方向：每一段只能是水平、垂直或 45°。
  const numbers = polyline(path).map((point) => [point.x, point.y] as const);
  for (let index = 1; index < numbers.length; index += 1) {
    const dx = Math.abs(numbers[index][0] - numbers[index - 1][0]);
    const dy = Math.abs(numbers[index][1] - numbers[index - 1][1]);
    if (dx < 0.5 && dy < 0.5) continue;
    expect(dx < 0.5 || dy < 0.5 || Math.abs(dx - dy) < 0.5).toBe(true);
  }

  const middle = await wireMidpoint(page);
  await page.mouse.click(middle.x, middle.y);
  await expect(page.locator('.routed-bend').first()).toBeVisible();
  expect(await page.locator('.routed-segment').count()).toBeGreaterThanOrEqual(1);
});

test('拖动折点即固定途经点：写进项目并能在移动元件后保留', async ({ page }) => {
  await page.goto('/');
  await createWire(page);
  const middle = await wireMidpoint(page);
  await page.mouse.click(middle.x, middle.y);

  const bend = page.locator('.routed-bend').first();
  const box = await bend.boundingBox();
  if (!box) throw new Error('折点手柄未渲染');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 80, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText(/已固定折线途经点/)).toBeVisible();
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const wires = await savedWires(page);
  expect(wires).toHaveLength(1);
  expect(wires[0].waypoints?.length ?? 0).toBeGreaterThanOrEqual(1);
  const fixed = wires[0].waypoints ?? [];

  // 移动 ESP32：未固定的连线会自动重算，但用户固定的途经点必须留在折线上。
  const esp32 = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const esp32Box = await esp32.boundingBox();
  if (!esp32Box) throw new Error('ESP32 未渲染');
  await page.mouse.move(esp32Box.x + 80, esp32Box.y + 15);
  await page.mouse.down();
  await page.mouse.move(esp32Box.x + 180, esp32Box.y + 95, { steps: 10 });
  await page.mouse.up();

  const afterMove = corners(await edgePath(page));
  for (const waypoint of fixed) {
    expect(afterMove.some((corner) => Math.abs(corner.x - waypoint.x) < 1 && Math.abs(corner.y - waypoint.y) < 1)).toBe(true);
  }
});

test('无障碍时移动元件会自动重路由（未固定途经点的连线）', async ({ page }) => {
  await page.goto('/');
  await createWire(page);
  const before = await edgePath(page);
  const esp32 = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const box = await esp32.boundingBox();
  if (!box) throw new Error('ESP32 未渲染');
  await page.mouse.move(box.x + 80, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 160, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => edgePath(page)).not.toBe(before);
  const wires = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}');
    return (raw.wires ?? []) as { waypoints?: unknown }[];
  });
  // 没有固定过途经点的连线，项目里不该凭空多出途经点。
  if (wires.length) expect(wires[0].waypoints).toBeUndefined();
});

test('拖动线段会整段平移并固定途经点，右键可恢复自动布线', async ({ page }) => {
  await page.goto('/');
  await createWire(page);
  const before = await edgePath(page);
  const middle = await wireMidpoint(page);
  await page.mouse.click(middle.x, middle.y);

  const segment = page.locator('.routed-segment').nth(1);
  const box = await segment.boundingBox();
  if (!box) throw new Error('线段命中区未渲染');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 50, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText(/已固定折线途经点/)).toBeVisible();
  expect(await edgePath(page)).not.toBe(before);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const wires = await savedWires(page);
  expect(wires[0].waypoints?.length ?? 0).toBeGreaterThanOrEqual(2);

  // 右键 → 恢复自动布线：项目里的途经点被清掉，连线回到自动绕行。
  const point = await wireMidpoint(page);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('button', { name: '恢复自动布线' }).click();
  await expect(page.getByText(/已恢复自动布线/)).toBeVisible();
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  expect((await savedWires(page))[0].waypoints).toBeUndefined();
});