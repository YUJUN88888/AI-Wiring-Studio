import { expect, test, type Page } from '@playwright/test';

/** 打开 AI 元件导入面板。 */
async function openImportPanel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ AI 导入元件' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 元件导入' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 一张合法的 1×1 PNG，用于让浏览器能真正解码出原图尺寸。 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** 视觉模型识别结果的桩：认出三个引脚，但不给坐标（真实视觉模型同样不返回像素坐标）。 */
const IMAGE_EXTRACTION = {
  displayName: '图片识别元件',
  manufacturer: null,
  model: null,
  category: null,
  footprint: null,
  pins: [
    { tempId: 'VIN', name: 'VIN', role: 'POWER_INPUT' },
    { tempId: 'GND', name: 'GND', role: 'GND' },
    { tempId: 'OUT', name: 'OUT', role: 'OUTPUT' },
  ],
  electricalProperties: {},
  notes: '测试桩',
};

/**
 * 在浏览器里伪装 Tauri 原生层，只桩住 Rust 命令、不桩住任何应用逻辑，
 * 因此 AI 导入的“候选 → 逐字段确认 → 写入元件库 → 放到画布”这条链路与桌面版完全一致。
 */
async function stubNativeAi(page: Page) {
  await page.addInitScript((extraction) => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === 'startup_project_path') return null;
        if (command === 'ai_api_key_status') return { configured: true };
        if (command === 'ai_import_extract') return { extraction };
        throw new Error(`未桩住的原生命令：${command}`);
      },
    };
  }, IMAGE_EXTRACTION);
}

test('非桌面版明确提示 AI 不可用，手工创建元件流程不受影响', async ({ page }) => {
  const dialog = await openImportPanel(page);
  // E2E 运行在浏览器（非 Tauri），必须明确告知不可用，而不是伪造可用状态。
  await expect(dialog.getByText('AI 不可用：当前环境没有可用的原生能力（非桌面版），可继续手工创建元件。')).toBeVisible();
  await expect(dialog.getByText('AI 只产出“候选”；必须由你逐字段确认后才会写入用户元件库，AI 建议不会自动成为已确认。')).toBeVisible();

  await page.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  // 关闭面板后手工新建元件依旧完全可用。
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await expect(page.getByRole('dialog', { name: '元件编辑器' })).toBeVisible();
});

test('可在四种导入来源之间切换，空输入时给出中文提示', async ({ page }) => {
  const dialog = await openImportPanel(page);
  await expect(dialog.getByRole('button', { name: '参数文字' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '元件图片' }).click();
  await expect(dialog.getByRole('button', { name: '元件图片' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('选择图片')).toBeVisible();
  await expect(dialog.getByLabel('上传元件图片')).toHaveAttribute('type', 'file');
  await dialog.getByRole('button', { name: '资料链接' }).click();
  await expect(dialog.getByLabel('资料链接')).toBeVisible();
  await dialog.getByRole('button', { name: '元件型号' }).click();
  await expect(dialog.getByLabel('元件型号')).toBeVisible();

  // 未填写内容就发起识别：本地校验先行，给出确定性中文提示。
  await dialog.getByRole('button', { name: '开始识别' }).click();
  await expect(page.getByRole('alert')).toHaveText('请先填写或选择要导入的内容。');
});

test('填写内容后发起识别，因缺少可用 AI 而明确报错，绝不放行伪造候选', async ({ page }) => {
  const dialog = await openImportPanel(page);
  await dialog.getByLabel('元件参数文字').fill('TPS62160，输入电压 3–17 V，输出电流 1 A');
  await dialog.getByRole('button', { name: '开始识别' }).click();
  await expect(page.getByRole('alert')).toHaveText('AI 不可用：当前环境没有可用的原生能力，可继续手工创建元件。');
  // 没有候选时不允许写入用户元件库。
  await expect(dialog.getByRole('button', { name: '确认写入用户元件库' })).toBeDisabled();
});

test('接口与密钥设置：非桌面环境禁用密钥写入，密钥输入不回显', async ({ page }) => {
  const dialog = await openImportPanel(page);
  await dialog.getByRole('button', { name: '接口与密钥设置' }).click();
  await expect(dialog.getByLabel('AI 接口地址')).toHaveValue('https://api.deepseek.com');
  await expect(dialog.getByLabel('AI 文字模型')).toHaveValue('deepseek-v4.1-flash-expires-on-0910');
  await expect(dialog.getByLabel('AI 视觉模型')).toHaveValue('deepseek-v4.1-flash-expires-on-0910');

  const keyInput = dialog.getByLabel('API Key');
  await expect(keyInput).toHaveAttribute('type', 'password');
  await expect(keyInput).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '保存密钥' })).toBeDisabled();
});

test('AI 图片导入的元件写入库后放到画布，能显示图片并按识别到的引脚数量排布', async ({ page }) => {
  await stubNativeAi(page);
  const dialog = await openImportPanel(page);
  await expect(dialog.getByText('已配置 API Key')).toBeVisible();

  await dialog.getByRole('button', { name: '元件图片' }).click();
  await dialog.getByLabel('上传元件图片').setInputFiles({ name: 'part.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await expect(dialog.getByAltText('待导入的元件图片')).toBeVisible();

  await dialog.getByRole('button', { name: '开始识别' }).click();
  await expect(dialog.getByText('已获得 AI 候选')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '引脚 · 3' })).toBeVisible();
  await dialog.getByRole('button', { name: '确认写入用户元件库' }).click();
  await expect(page.getByText('已将 AI 候选写入用户元件库：图片识别元件。')).toBeVisible();

  // 放到画布：图片必须真正显示，且引脚按识别到的数量排开、不再叠在同一角上。
  // 用户元件列表收进了「元件库」弹窗，先从侧栏入口打开它再取用。
  await page.getByRole('button', { name: '元件库…' }).click();
  const library = page.getByRole('dialog', { name: '元件仓库' });
  await expect(library).toBeVisible();
  await library.getByRole('button', { name: '＋ 图片识别元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '图片识别元件' });
  await expect(node.locator('.part-image')).toBeVisible();
  await expect(node.locator('.part-pin-label')).toHaveCount(3);
  const positions = await node.locator('.part-pin-label').evaluateAll((labels) =>
    labels.map((label) => `${(label as HTMLElement).style.left}/${(label as HTMLElement).style.top}`),
  );
  expect(new Set(positions).size).toBe(3);
  await expect(node.locator('.hotspot')).toHaveCount(3);
});