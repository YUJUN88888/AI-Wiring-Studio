import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 元件在画布坐标系里的位置（React Flow 把节点写在 `transform: translate(Xpx, Ypx)` 上）。
 *
 * 不能用 `boundingBox()`：视口缩放/自动平移会让屏幕坐标整体偏移，
 * 而"这个元件没被动过"必须看画布坐标（与 grouping.spec.ts 同一判据）。
 */
async function nodeXY(node: Locator) {
  return node.evaluate((element) => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((element as HTMLElement).style.transform);
    if (!match) throw new Error('元件没有 transform');
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

const partByText = (page: Page, text: string) => page.locator('.react-flow__node').filter({ hasText: text });
const titleOf = (page: Page, text: string) => page.locator('.zone-band-title').filter({ hasText: text });

test('批次2 自动整理布局：按分区重新摆放并画出分区底色框，且可以撤销', async ({ page }) => {
  await page.goto('/');
  const power = partByText(page, 'USB 5V 电源');
  const esp32 = partByText(page, 'ESP32 DevKit（演示）');

  // 演示项目自带 电源 / 主控 / 未分组 三种归属，所以一开始就有分区框。
  await expect(page.locator('.zone-band[data-zone="power"]')).toHaveCount(1);
  await expect(page.locator('.zone-band[data-zone="control"]')).toHaveCount(1);
  await expect(page.locator('.zone-band[data-zone="unclassified"]')).toHaveCount(1);
  await expect(titleOf(page, '电源')).toBeVisible();

  const before = { power: await nodeXY(power), esp32: await nodeXY(esp32) };

  await page.getByRole('button', { name: '自动整理布局' }).click();
  await expect(page.getByText(/已按功能分区整理布局：重新摆放了 \d+ 个元件/)).toBeVisible();

  const after = { power: await nodeXY(power), esp32: await nodeXY(esp32) };
  const moved = Math.hypot(after.power.x - before.power.x, after.power.y - before.power.y);
  expect(moved).toBeGreaterThan(20);
  // 电源与主控之间有连线 → 同一个连通簇 → 整理后落在同一行、紧挨着（分区让它们聚在一起）。
  expect(Math.abs(after.power.y - after.esp32.y)).toBeLessThan(2);

  // 整理后分区框仍在，并且真的把该分区的元件圈进去了（框的左上是元件左上的左上方）。
  const band = await page.locator('.zone-band[data-zone="power"]').boundingBox();
  const powerBox = await power.boundingBox();
  expect(band && powerBox).toBeTruthy();
  expect(band!.x).toBeLessThan(powerBox!.x);
  expect(band!.y).toBeLessThan(powerBox!.y);

  // 自动整理走的是同一条 commit 通道，所以可以直接撤销回原位。
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('已撤销。')).toBeVisible();
  const restored = { power: await nodeXY(power), esp32: await nodeXY(esp32) };
  expect(Math.hypot(restored.power.x - before.power.x, restored.power.y - before.power.y)).toBeLessThan(2);
  expect(Math.hypot(restored.esp32.x - before.esp32.x, restored.esp32.y - before.esp32.y)).toBeLessThan(2);
});

test('批次2 锁定位置：锁定的元件不参与自动整理，也不能在画布上拖动', async ({ page }) => {
  await page.goto('/');
  const power = partByText(page, 'USB 5V 电源');
  const esp32 = partByText(page, 'ESP32 DevKit（演示）');

  const box = await power.boundingBox();
  if (!box) throw new Error('元件未渲染');
  await page.mouse.click(box.x + box.width / 2, box.y + 12, { button: 'right' });
  await page.locator('.context-component').getByRole('button', { name: '锁定位置' }).click();
  await expect(page.getByText(/已锁定「USB 5V 电源」的位置/)).toBeVisible();
  await expect(page.locator('.part-lock-badge')).toHaveCount(1);

  const lockedBefore = await nodeXY(power);
  const otherBefore = await nodeXY(esp32);

  // 锁定的元件不能被拖动：拖它一下，画布坐标必须纹丝不动。
  const lockedBox = await power.boundingBox();
  await page.mouse.move(lockedBox!.x + lockedBox!.width / 2, lockedBox!.y + 12);
  await page.mouse.down();
  await page.mouse.move(lockedBox!.x + lockedBox!.width / 2 + 140, lockedBox!.y + 12 + 120, { steps: 10 });
  await page.mouse.up();
  const lockedAfterDrag = await nodeXY(power);
  expect(Math.hypot(lockedAfterDrag.x - lockedBefore.x, lockedAfterDrag.y - lockedBefore.y)).toBeLessThan(2);

  // 自动整理必须跳过它（提示里明确写出有几个锁定的元件保持不动）。
  await page.getByRole('button', { name: '自动整理布局' }).click();
  await expect(page.getByText(/个锁定的元件保持不动/)).toBeVisible();
  const lockedAfterArrange = await nodeXY(power);
  const otherAfterArrange = await nodeXY(esp32);
  expect(Math.hypot(lockedAfterArrange.x - lockedBefore.x, lockedAfterArrange.y - lockedBefore.y)).toBeLessThan(2);
  expect(Math.hypot(otherAfterArrange.x - otherBefore.x, otherAfterArrange.y - otherBefore.y)).toBeGreaterThan(20);

  // 解锁后徽标消失。
  const menuBox = await power.boundingBox();
  await page.mouse.click(menuBox!.x + menuBox!.width / 2, menuBox!.y + 12, { button: 'right' });
  await page.locator('.context-component').getByRole('button', { name: '解锁位置' }).click();
  await expect(page.getByText(/已解锁「USB 5V 电源」的位置/)).toBeVisible();
  await expect(page.locator('.part-lock-badge')).toHaveCount(0);
});

test('批次2 手工分区：右键把元件划入「采集」，分区框立刻出现', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.zone-band[data-zone="acquire"]')).toHaveCount(0);

  const resistor = partByText(page, '220 Ω');
  const box = await resistor.boundingBox();
  if (!box) throw new Error('元件未渲染');
  await page.mouse.click(box.x + box.width / 2, box.y + 12, { button: 'right' });
  await page.locator('.context-component').getByRole('button', { name: '采集' }).click();
  await expect(page.getByText(/已划入「采集」分区/)).toBeVisible();
  await expect(page.locator('.zone-band[data-zone="acquire"]')).toHaveCount(1);

  // 菜单里当前生效的分区要高亮；「按分类自动」取消手工指定，回到自动归属（电阻 → 未分组）。
  const again = await resistor.boundingBox();
  await page.mouse.click(again!.x + again!.width / 2, again!.y + 12, { button: 'right' });
  await expect(page.locator('.context-component .context-zone-list button.active')).toHaveText('采集');
  await page.locator('.context-component').getByRole('button', { name: '按分类自动' }).click();
  await expect(page.getByText(/已取消手工分区/)).toBeVisible();
  await expect(page.locator('.zone-band[data-zone="acquire"]')).toHaveCount(0);
});

test('批次2 分区重命名：只改标题文字，元件与连线不受影响', async ({ page }) => {
  await page.goto('/');
  const power = partByText(page, 'USB 5V 电源');
  const beforeXY = await nodeXY(power);
  const beforeEdges = await page.locator('.react-flow__edge').count();

  await titleOf(page, '电源').click();
  const input = page.getByLabel('分区名称');
  await input.fill('供电仓');
  await page.locator('.zone-band-editor').getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('分区已重命名为「供电仓」。')).toBeVisible();
  await expect(titleOf(page, '供电仓')).toBeVisible();

  expect(await nodeXY(power)).toEqual(beforeXY);
  expect(await page.locator('.react-flow__edge').count()).toBe(beforeEdges);

  // 改名后保存项目再打开，标题仍是新名字（它是项目文件里的持久字段）。
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('aiws.m0.demo'));
  expect(stored).toContain('供电仓');
});