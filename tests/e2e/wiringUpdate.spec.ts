import { expect, test, type Page } from '@playwright/test';

/**
 * A8【更新接线代码并对比】：
 * 用代码更新画布时先只显示差异（绿色＝新增、黄色＝改写、半透明灰＝将被删除），
 * 项目状态在用户点「应用更新」前完全不变；「取消」原样恢复。
 * 断言全部基于类名计数与节点数量，不靠肉眼读截图。
 */

const UPDATE_CODE = `version 1
component power-5v power-5v "USB 5V 电源"
component esp32 esp32-devkit-demo "主控改名"
component led red-led "LED · 红色"
component r2 resistor-220r "新增电阻"
wire power-5v.5V esp32.3V3
`;

/** 打开接线代码面板 → 选「更新并对比差异」→ 填入代码 → 点「对比差异」。 */
async function requestUpdate(page: Page, code = UPDATE_CODE) {
  await page.getByRole('button', { name: '＋ 导入接线代码' }).click();
  await page.getByRole('button', { name: '更新并对比差异' }).click();
  await page.getByLabel('接线代码', { exact: true }).fill(code);
  await page.getByRole('button', { name: '对比差异', exact: true }).click();
}

test('更新预览：新增/改写/删除各自标注，应用前项目不变，取消后原样恢复', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await requestUpdate(page);

  // 预览态：代码里声明的 4 个 + 画布上将被删除的 resistor = 5 个节点同时可见。
  await expect(page.locator('.update-preview')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('.react-flow__node .part.diff-added')).toHaveCount(1);   // r2
  await expect(page.locator('.react-flow__node .part.diff-changed')).toHaveCount(1); // esp32（显示名改了）
  await expect(page.locator('.react-flow__node .part.diff-removed')).toHaveCount(1); // resistor（代码里没提）
  await expect(page.locator('.routed-edge-added')).toHaveCount(1);

  // 预览期间项目文件里什么都不该变。
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}'));
  expect(saved.components.map((component: { id: string }) => component.id).sort()).toEqual(['esp32', 'led', 'power-5v', 'resistor']);
  expect(saved.wires).toHaveLength(0);

  // 取消：画布回到 4 个元件、差异标记全部消失。
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('已取消更新：画布恢复为更新前的内容。')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.part.diff-added, .part.diff-changed, .part.diff-removed')).toHaveCount(0);
});

test('应用更新：以代码为准写回画布，代码与画布一致时不再进入预览', async ({ page }) => {
  await page.goto('/');
  await requestUpdate(page);
  await page.getByRole('button', { name: '应用更新' }).click();

  await expect(page.getByText(/已按接线代码更新画布：4 个元件、1 根连线/)).toBeVisible();
  await expect(page.locator('.update-preview')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}'));
  expect(saved.components.map((component: { id: string }) => component.id).sort()).toEqual(['esp32', 'led', 'power-5v', 'r2']);
  expect(saved.wires).toHaveLength(1);

  // 再拿同一份代码更新一次：完全一致，明确提示而不进入空的预览态。
  await requestUpdate(page);
  await expect(page.getByText('代码与当前画布完全一致，没有需要更新的内容。')).toBeVisible();
  await expect(page.locator('.update-preview')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});