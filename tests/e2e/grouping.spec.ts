import { expect, test, type Locator, type Page } from '@playwright/test';

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('元件未渲染');
  return box;
};

/** 左键在空白处拖出一个矩形，把给定的两个元件完整框住（框选＝左键拖拽，平移已改为中键）。 */
async function boxSelect(page: Page, first: Locator, second: Locator) {
  const a = await boxOf(first);
  const b = await boxOf(second);
  await page.mouse.move(Math.min(a.x, b.x) - 12, Math.min(a.y, b.y) - 12);
  await page.mouse.down();
  await page.mouse.move(Math.max(a.x + a.width, b.x + b.width) + 12, Math.max(a.y + a.height, b.y + b.height) + 12, { steps: 10 });
  await page.mouse.up();
}

/**
 * 画布上既不在元件上、也不在浮层控件上的空白点，用来清空选中。
 *
 * 左下角的「适配视口」按钮（.react-flow__controls）与右下角的 React Flow
 * 署名链接（.react-flow__attribution）都会吃掉点击，必须与元件一样避让，
 * 否则点空白处其实点到了按钮上，选中不会被清掉。
 */
async function emptyPoint(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) throw new Error('没有找到画布');
    const box = pane.getBoundingClientRect();
    const obstacles = [
      ...document.querySelectorAll('.react-flow__node, .react-flow__controls, .react-flow__attribution, .react-flow__panel'),
    ].map((element) => element.getBoundingClientRect());
    const clear = (point: { x: number; y: number }) =>
      obstacles.every((rect) => point.x < rect.left - 4 || point.x > rect.right + 4 || point.y < rect.top - 4 || point.y > rect.bottom + 4);
    const candidates = [
      { x: box.left + 40, y: box.bottom - 90 },
      { x: box.right - 30, y: box.bottom - 30 },
      { x: box.left + 40, y: box.top + 40 },
      { x: box.right - 40, y: box.top + 40 },
    ];
    const hit = candidates.find(clear);
    if (!hit) throw new Error('画布上没有找到空白点');
    return hit;
  });
}

/** 点画布空白处清空选中。框选后必须清空，否则多选矩形会拦截后续点击。 */
async function clearSelection(page: Page) {
  const empty = await emptyPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
}

/** 从元件标题处把它拖走（标题在盒子内部，不会碰到引脚热点）。 */
async function dragNode(page: Page, node: Locator, dx: number, dy: number) {
  const box = await boxOf(node);
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 12 + dy, { steps: 12 });
  await page.mouse.up();
}

/**
 * 元件在画布坐标系里的位置（React Flow 把节点写在 `transform: translate(Xpx, Ypx)` 上）。
 *
 * 不能用 `boundingBox()`：拖动靠近视口边缘时 React Flow 会自动平移画布（autoPanOnNodeDrag），
 * 屏幕坐标会整体偏移（实测同一元件屏幕 x 偏 49.5px 而画布坐标纹丝不动），
 * 断言"另一个成员原地不动"就会被这个平移污染。
 */
async function nodeXY(node: Locator) {
  return node.evaluate((element) => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((element as HTMLElement).style.transform);
    if (!match) throw new Error('元件没有 transform');
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

test('A11 成组：拖动其中一个成员，整组按同一个位移一起移动', async ({ page }) => {
  await page.goto('/');
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });

  // 单个元件不能成组，给出明确提示。
  await resistor.click();
  await page.getByRole('button', { name: '成组' }).click();
  await expect(page.getByText('至少选中两个元件才能成组，先在画布上框选或用 Ctrl 多选。')).toBeVisible();

  await boxSelect(page, resistor, led);
  await page.getByRole('button', { name: '成组' }).click();
  await expect(page.getByText('已把 2 个元件成组：拖动其中任意一个，整组一起移动。')).toBeVisible();
  await expect(page.locator('.part-group-badge')).toHaveCount(2);

  // 先点空白清掉选中：这样"另一个成员跟着动"只可能来自成组逻辑，而不是 React Flow 的多选拖动。
  await clearSelection(page);

  const beforeResistor = await nodeXY(resistor);
  const beforeLed = await nodeXY(led);
  await dragNode(page, resistor, 130, 90);
  const afterResistor = await nodeXY(resistor);
  const afterLed = await nodeXY(led);
  const movedResistor = { x: afterResistor.x - beforeResistor.x, y: afterResistor.y - beforeResistor.y };
  const movedLed = { x: afterLed.x - beforeLed.x, y: afterLed.y - beforeLed.y };
  expect(Math.hypot(movedResistor.x, movedResistor.y)).toBeGreaterThan(40);
  expect(Math.abs(movedLed.x - movedResistor.x)).toBeLessThan(2);
  expect(Math.abs(movedLed.y - movedResistor.y)).toBeLessThan(2);
});

test('A11 解组：右键「解组」后不再联动，且不留成组标记', async ({ page }) => {
  await page.goto('/');
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });
  await boxSelect(page, resistor, led);
  await page.getByRole('button', { name: '成组' }).click();
  await expect(page.locator('.part-group-badge')).toHaveCount(2);

  // 成组后仍处于多选状态，多选矩形会拦截右键，先清空选中再对单个成员右键。
  await clearSelection(page);
  const box = await boxOf(resistor);
  await page.mouse.click(box.x + box.width / 2, box.y + 12, { button: 'right' });
  // 「解组」在右键菜单与底部工具栏各有一个，这里必须限定到元件右键菜单，否则命中两个按钮。
  await page.locator('.context-component').getByRole('button', { name: '解组' }).click();
  await expect(page.getByText('已解除该组：成员之间不再联动移动。')).toBeVisible();
  await expect(page.locator('.part-group-badge')).toHaveCount(0);

  // 解组后各自独立：拖动电阻，LED 必须原地不动。
  await clearSelection(page);
  const beforeLed = await nodeXY(led);
  await dragNode(page, resistor, 120, 60);
  const afterLed = await nodeXY(led);
  expect(Math.hypot(afterLed.x - beforeLed.x, afterLed.y - beforeLed.y)).toBeLessThan(2);
});

test('A11 解组：底部工具栏的「解组」按钮对整个选中组生效，不必先右键单个成员', async ({ page }) => {
  await page.goto('/');
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });

  // 没选中任何成组元件时给提示，不静默（此时右键菜单未打开，「解组」只命中底部那一个）。
  await page.getByRole('button', { name: '解组' }).click();
  await expect(page.getByText('所选元件都不在任何组里，无需解组。')).toBeVisible();

  await boxSelect(page, resistor, led);
  await page.getByRole('button', { name: '成组' }).click();
  await expect(page.locator('.part-group-badge')).toHaveCount(2);

  // 框选后保持选中，直接点底部「解组」即可解除整个组。
  await page.getByRole('button', { name: '解组' }).click();
  await expect(page.getByText('已解除该组：成员之间不再联动移动。')).toBeVisible();
  await expect(page.locator('.part-group-badge')).toHaveCount(0);

  // 解组后不再联动：拖动电阻，LED 原地不动。
  await clearSelection(page);
  const beforeLed = await nodeXY(led);
  await dragNode(page, resistor, 120, 60);
  const afterLed = await nodeXY(led);
  expect(Math.hypot(afterLed.x - beforeLed.x, afterLed.y - beforeLed.y)).toBeLessThan(2);
});

test('A11 删除语义：删掉一个成员后，剩下的单个成员自动解除成组', async ({ page }) => {
  await page.goto('/');
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });
  await boxSelect(page, resistor, led);
  await page.getByRole('button', { name: '成组' }).click();
  await expect(page.locator('.part-group-badge')).toHaveCount(2);

  // 只选中电阻并删除：先清空框选的多选状态，否则多选矩形会吃掉这一下点击。
  await clearSelection(page);
  await resistor.click();
  await page.keyboard.press('Delete');
  await expect(resistor).toHaveCount(0);
  await expect(led).toHaveCount(1);
  await expect(page.locator('.part-group-badge')).toHaveCount(0);
});