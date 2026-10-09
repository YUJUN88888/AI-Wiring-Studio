import { expect, test, type Page } from '@playwright/test';

/**
 * A7【动手接线模式】：连线灰化、当下应接的那根闪烁、双击标记「已接好」并写进项目文件、
 * 退出模式后记忆保留（再次进入接着上次继续）。
 * 全部断言都基于数值（computed stroke、localStorage 里的 wires），不靠肉眼读截图。
 */

/** 从 USB 5V 电源的 GND 引脚连到 ESP32 的 GPIO21，得到画布上唯一一根线。 */
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

/** 取连线路径中点的屏幕坐标，作为双击的落点（避开元件热点）。 */
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

/** 连线的实际颜色（computed）。灰化与否只能看它，不能看 style 字符串里有没有 "stroke"。 */
async function edgeStroke(page: Page, index = 0) {
  return page.locator('.react-flow__edge').nth(index).evaluate((element) => getComputedStyle(element.querySelector('.react-flow__edge-path') as SVGPathElement).stroke);
}

async function savedWires(page: Page) {
  return page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}');
    return (raw.wires ?? []) as { id: string; manuallyWired?: boolean }[];
  });
}

const PENDING_GRAY = 'rgb(84, 99, 122)';
const WIRE_BLUE = 'rgb(87, 212, 255)';

test('动手接线模式：灰化 + 闪烁提示，双击标记「已接好」并写进项目文件', async ({ page }) => {
  await page.goto('/');
  await createWire(page);
  const middle = await wireMidpoint(page);

  // 模式未开启时双击不应当改任何东西：接线进度只在动手接线模式里确认。
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(page.getByText(/已把这根线标记为/)).toHaveCount(0);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  expect((await savedWires(page))[0].manuallyWired).toBeUndefined();

  // 进入模式：唯一这根线既是"未接好"也是"当下建议先接的"，因此灰化 + 闪烁轮廓同时出现。
  await page.getByRole('button', { name: '动手接线模式' }).click();
  await expect(page.locator('.wiring-guide')).toBeVisible();
  await expect.poll(() => edgeStroke(page)).toBe(PENDING_GRAY);
  await expect(page.locator('.routed-edge-suggested')).toHaveCount(1);
  await expect(page.getByText(/当前建议先接/)).toBeVisible();

  // 双击连线 → 标记「已接好」：恢复原色，闪烁消失，进度条改为"全部接好"。
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(page.getByText('已把这根线标记为「已接好」。')).toBeVisible();
  await expect.poll(() => edgeStroke(page)).toBe(WIRE_BLUE);
  await expect(page.locator('.routed-edge-suggested')).toHaveCount(0);
  await expect(page.getByText('全部连线都已标记接好。')).toBeVisible();

  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  expect((await savedWires(page))[0].manuallyWired).toBe(true);

  // 退出模式：不再灰化、进度条消失，但「已接好」的颜色与项目里的标记都保留。
  await page.getByRole('button', { name: '退出动手接线' }).click();
  await expect(page.locator('.wiring-guide')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '动手接线模式' })).toBeVisible();
  await expect.poll(() => edgeStroke(page)).toBe(WIRE_BLUE);
  expect((await savedWires(page))[0].manuallyWired).toBe(true);

  // 再次进入：直接接着上次的进度（这根线仍是已接好、不灰化），双击可撤销标记。
  await page.getByRole('button', { name: '动手接线模式' }).click();
  await expect(page.getByText('全部连线都已标记接好。')).toBeVisible();
  await expect.poll(() => edgeStroke(page)).toBe(WIRE_BLUE);
  const again = await wireMidpoint(page);
  await page.mouse.dblclick(again.x, again.y);
  await expect(page.getByText('已取消这根线的「已接好」标记。')).toBeVisible();
  await expect.poll(() => edgeStroke(page)).toBe(PENDING_GRAY);
  await expect(page.locator('.routed-edge-suggested')).toHaveCount(1);
});