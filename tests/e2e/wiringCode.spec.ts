import { expect, test, type Page } from '@playwright/test';

/** 打开「接线代码导入」面板。 */
async function openPanel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 导入接线代码' }).click();
  const dialog = page.getByRole('dialog', { name: '接线代码导入' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const VALID_CODE = `version 1
component u1 esp32-devkit-demo "主控" at 120,80
component r1 resistor-220r at 400,80
component d1 red-led at 620,80
wire u1.GPIO21 r1.A
wire r1.B d1.A color #e34b4b
`;

test('粘贴接线代码即可确定性地生成接线图（替换画布）', async ({ page }) => {
  const dialog = await openPanel(page);
  // 初始画布是内置演示项目：4 个元件、尚未连线。
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await dialog.getByRole('textbox', { name: '接线代码' }).fill(VALID_CODE);
  await expect(dialog.getByText('可以导入：3 个元件、2 根连线')).toBeVisible();

  await dialog.getByRole('button', { name: '应用到画布' }).click();
  // 画布非空，替换属于破坏性操作：必须先看到确认提示，且此时画布不变。
  await expect(dialog.getByText('替换会先清空画布上的全部元件与连线（可撤销）。确认要继续吗？点击下方「确认替换」执行，或切换导入方式放弃。')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await dialog.getByRole('button', { name: '确认替换' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  // 代码里给 u1 指定的显示名必须原样落在画布上。
  await expect(page.locator('.react-flow__node').filter({ hasText: '主控' })).toHaveCount(1);
  await expect(page.getByText(/已按接线代码生成接线图：3 个元件、2 根连线/)).toBeVisible();
});

test('追加模式把代码生成的元件与连线并入既有画布', async ({ page }) => {
  const dialog = await openPanel(page);
  await dialog.getByRole('textbox', { name: '接线代码' }).fill(VALID_CODE);
  await dialog.getByRole('button', { name: '追加到当前画布' }).click();
  await dialog.getByRole('button', { name: '应用到画布' }).click();
  await expect(dialog).toBeHidden();
  // 原有 4 个元件（演示项目初始没有连线）保持不变，代码内容并入。
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.react-flow__node').filter({ hasText: '主控' })).toHaveCount(1);
});

test('非法代码给出带行号的中文错误，且不改动画布', async ({ page }) => {
  const dialog = await openPanel(page);
  await dialog.getByRole('textbox', { name: '接线代码' }).fill('version 1\ncomponent u1 unknown-chip\n');

  // 解析在面板内即时进行：错误必须指出行号并说明原因。
  await expect(dialog.getByText(/第 2 行：未知元件类型“unknown-chip”/)).toBeVisible();
  await dialog.getByRole('button', { name: '应用到画布' }).click();

  // 面板不关闭、画布不变；错误只在行内以 aria-live 呈现，不重复弹 role=alert。
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
});

test('字典页签导出格式规范与可用引脚，供外部 AI 查阅', async ({ page }) => {
  const dialog = await openPanel(page);
  await dialog.getByRole('button', { name: '字典' }).click();
  const dictionary = dialog.getByLabel('接线代码字典');
  await expect(dictionary).toContainText('接线代码格式');
  await expect(dictionary).toContainText('esp32-devkit-demo');
  await expect(dictionary).toContainText('GPIO21');
  await expect(dictionary).toContainText('version 1');
  // 字符规范与最小模板必须出现在字典里，用户才能整段复制给外部 AI。
  await expect(dictionary).toContainText('字符规范');
  await expect(dictionary).toContainText('可直接照抄的最小模板');
});

test('代码里未收录的元件被确定性扫描出来，并可请求 AI 补查', async ({ page }) => {
  const dialog = await openPanel(page);
  await dialog.getByRole('textbox', { name: '接线代码' }).fill(
    'component b1 battery-2s-liion "2S 锂电池组"\ncomponent p1 bms-2s-20a\nwire b1.B+ p1.P+\n',
  );

  // 解析照旧报错（未知元件类型），但面板同时给出"未收录元件"清单，指引用户去补查而不是只报一行错。
  const box = dialog.locator('.missing-box');
  await expect(box.getByRole('heading', { name: '未收录元件 · 2' })).toBeVisible();
  await expect(box.locator('code', { hasText: 'battery-2s-liion' })).toBeVisible();
  await expect(box.locator('code', { hasText: 'bms-2s-20a' })).toBeVisible();
  // 显示名取自代码里的引号字符串；引脚 ID 原样保留（B+ 不被改写）。
  await expect(box.getByText('2S 锂电池组')).toBeVisible();
  await expect(box.getByText(/代码已引用引脚：B\+/)).toBeVisible();
  await expect(box.getByText(/代码已引用引脚：P\+/)).toBeVisible();

  // 补查结果必须经用户逐字段确认才写库。浏览器环境没有原生能力，
  // 必须明确说"AI 不可用…可继续手工新建元件"，而不是假装成功。
  await box.getByRole('button', { name: '用 AI 补查 battery-2s-liion' }).click();
  await expect(box.getByText(/AI 不可用/)).toBeVisible();
  await expect(box.getByText(/可继续手工新建元件/)).toBeVisible();
});