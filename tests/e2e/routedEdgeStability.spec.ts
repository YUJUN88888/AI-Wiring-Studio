import { expect, test, type Page } from '@playwright/test';

/**
 * 连线路径的稳定性（回归）：
 * 选中一根线、点一个元件都不该让**其它**连线的路径变样。
 *
 * 曾经的根因：RoutedEdge 的路径 useMemo 依赖里放了 rectOf() 刚 new 出来的矩形对象，
 * 于是任何一次渲染都会让所有连线重算路径；而重算又会读"上一遍登记表里别人的路径"做避让，
 * 结果就是选中一根线、改个颜色，整片连线跟着挪动，项目一大还会卡到点不动任何东西。
 * 这里把"其它线的 d 一字不变 + 选中依然生效"钉住。
 */

/**
 * 走廊瓶颈几何：4 根线全部从 u1（左下）跨到右侧那一列电阻，中间没有任何障碍物。
 * 这样每条线的"绕开既有连线"分支都会被真正触发（它们会互相商量着走不同的横向通道），
 * 一旦路径多算一遍就会换通道——最容易看出"选中一根线，别的线跟着挪"。
 */
const CODE = `version 1
component u1 esp32-devkit-demo "主控" at 120,520
component r1 resistor-220r "R1" at 720,60
component r2 resistor-220r "R2" at 720,180
component r3 resistor-220r "R3" at 720,300
component r4 resistor-220r "R4" at 720,420
wire u1.3V3 r1.A
wire u1.GND r2.A
wire u1.GPIO21 r3.A
wire u1.GPIO23 r4.A
`;

const NODE_COUNT = 5;
const WIRE_COUNT = 4;

/** 每条连线的 id → path 的 d，用于逐字比对。 */
async function edgePaths(page: Page): Promise<Record<string, string>> {
  return page.locator('.react-flow__edge').evaluateAll((edges) =>
    Object.fromEntries(edges.map((edge) => [edge.getAttribute('data-id') ?? '', edge.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? ''])),
  );
}

/** 折线中点换算成屏幕坐标——写死偏移会落到引脚热点的落点上，必须按真实路径取点。 */
async function pathMidpoint(page: Page, index: number) {
  return page.locator('.react-flow__edge').nth(index).evaluate((edge) => {
    const path = edge.querySelector('.react-flow__edge-path') as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = point.matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
}

async function importCanvas(page: Page) {
  await page.getByRole('button', { name: '＋ 导入接线代码' }).click();
  await page.getByLabel('接线代码', { exact: true }).fill(CODE);
  await page.getByRole('button', { name: '应用到画布' }).click();
  // 画布非空 → 替换是破坏性操作，必须再点一次「确认替换」。
  await page.getByRole('button', { name: '确认替换' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(NODE_COUNT);
  await expect(page.locator('.react-flow__edge')).toHaveCount(WIRE_COUNT);
}

/** 除 changedId 之外，每条连线的 d 必须与基线完全一致。 */
function expectOthersUnchanged(baseline: Record<string, string>, current: Record<string, string>, changedId: string) {
  for (const id of Object.keys(baseline)) {
    if (id === changedId) continue;
    expect(current[id], `连线 ${id} 的位置被别的操作牵动了`).toBe(baseline[id]);
  }
}

test('选中连线或元件时，其它连线的路径一字不变，且选中始终有效', async ({ page }) => {
  await page.goto('/');
  await importCanvas(page);

  const baseline = await edgePaths(page);
  expect(Object.keys(baseline)).toHaveLength(WIRE_COUNT);

  // 依次选中每一根连线：被选中的那根允许出现折点手柄，但路径本身必须不变；其余连线必须完全不动。
  for (let index = 0; index < WIRE_COUNT; index += 1) {
    const point = await pathMidpoint(page, index);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1);
    expect(await edgePaths(page)).toEqual(baseline);
  }

  // 选中元件同样不该牵动连线路径，并且点得中（"运行一会之后选不中任何东西"的反例）。
  await page.locator('.react-flow__node').first().click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  expect(await edgePaths(page)).toEqual(baseline);

  // 再来一轮：多次交互之后依然能选中（覆盖"用一阵子就选不中"的场景）。
  for (let round = 0; round < 3; round += 1) {
    await page.locator('.react-flow__node').nth(round).click();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  }
  expect(await edgePaths(page)).toEqual(baseline);
});

test('改一根线的颜色、把它固定成折线，都不许牵动其它连线', async ({ page }) => {
  await page.goto('/');
  await importCanvas(page);

  const baseline = await edgePaths(page);
  const ids = Object.keys(baseline);
  const first = ids[0];
  const point = await pathMidpoint(page, 0);

  // 改颜色：只该换这一根的颜色，几何一律不动。
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('button', { name: '设置连线颜色 #4ac47b' }).click();
  expectOthersUnchanged(baseline, await edgePaths(page), first);

  // 固定途经点：把这根线从"自动布线"变成"用户定死的形状"，别的线仍不许动。
  // 这条最关键：别的线以前会因为"重新避让这根刚变形的线"而整片跟着挪。
  await page.locator('.canvas').click({ position: { x: 24, y: 24 } });
  await page.mouse.click(point.x, point.y);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('button', { name: /固定途经点/ }).click();
  expectOthersUnchanged(baseline, await edgePaths(page), first);
});