import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 直接给受控的 <input type="color"> 赋值。
 * Playwright 的 fill 不支持 color 类型，必须走原生 value setter + input 事件，React 的 onChange 才会收到。
 */
async function setColor(scope: Locator, label: string, value: string) {
  await scope.getByLabel(label).evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 从电源拖一根线到 ESP32，返回建出来的唯一一条连线。 */
async function connectFirstWire(page: Page) {
  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.react-flow__handle-right').first();
  const target = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' }).locator('.react-flow__handle-left').first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('引脚热点未渲染');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
}

test('设置-外观：画布背景可在工程网格/点状/纯色之间切换', async ({ page }) => {
  await page.goto('/');
  // 默认是工程网格：用 path 画横竖线，没有圆点。
  await expect(page.locator('.react-flow__background')).toHaveCount(1);
  await expect(page.locator('.react-flow__background-pattern.lines')).toHaveCount(1);
  await expect(page.locator('.react-flow__background-pattern.dots')).toHaveCount(0);

  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: '点状' }).click();
  await expect(page.locator('.react-flow__background-pattern.dots')).toHaveCount(1);

  await dialog.getByRole('button', { name: '纯色' }).click();
  await expect(page.locator('.react-flow__background')).toHaveCount(0);

  await dialog.getByRole('button', { name: '工程网格' }).click();
  await expect(page.locator('.react-flow__background-pattern.lines')).toHaveCount(1);
});

test('设置-外观：颜色改动即时生效、写入本地，重新打开后仍生效', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await setColor(dialog, '画布颜色', '#123456');

  // 改的是根节点的 CSS 变量，画布底色真的跟着变（取计算样式，不靠肉眼）。
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--aiws-canvas-color'))).toBe('#123456');
  await expect.poll(() => page.locator('.canvas').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(18, 52, 86)');

  // 外观存在独立的本地存储键下，与项目文件分开。
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aiws.appearance') ?? '{}'));
  expect(stored.canvasColor).toBe('#123456');
  expect(await page.evaluate(() => localStorage.getItem('aiws.m0.demo'))).toBeNull();

  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--aiws-canvas-color'))).toBe('#123456');

  // 恢复默认：回到深色画布并覆盖本地存档。
  const reopened = await openSettings(page);
  await reopened.getByRole('button', { name: '恢复默认' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--aiws-canvas-color'))).toBe('#08090a');
});

test('设置-外观：新连线用全局默认颜色，改默认色不会覆盖已有连线', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await setColor(dialog, '默认连线颜色', '#ff00aa');
  await dialog.getByRole('button', { name: '关闭' }).click();

  await connectFirstWire(page);
  const edgeStroke = () => page.locator('.react-flow__edge-path').first().evaluate((element) => getComputedStyle(element).stroke);
  await expect.poll(edgeStroke).toBe('rgb(255, 0, 170)');

  // 「全局默认」只作新建时的兜底：再改默认色，已经画好的这根线必须保持原色。
  const again = await openSettings(page);
  await setColor(again, '默认连线颜色', '#00c853');
  await expect.poll(edgeStroke).toBe('rgb(255, 0, 170)');
});