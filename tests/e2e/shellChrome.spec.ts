import { expect, test, type Page } from '@playwright/test';

/**
 * 批次3【窗口外壳与面板收纳】。
 *
 * 覆盖：自定义标题栏（浏览器下只渲染标题条、不渲染窗口按钮）、六个画布按钮移到顶部菜单栏并等高、
 * 左右侧栏与底部检查摘要的收纳/展开、线路筛选最小化成左下角按钮、右键给线路设分类并影响筛选。
 *
 * 场景：电源 + 显示模块 + 主控 + 两个无源电阻；其中 r1.A–r2.A 两脚都没有角色，必然算「未分类」。
 */
const CODE = `version 1
component pwr power-5v "电源" at 40,60
component oled oled-ssd1306-i2c "显示模块" at 40,520
component mcu esp32-devkit-demo "主控" at 40,300
component r1 resistor-220r "限流电阻" at 500,60
component r2 resistor-220r "上拉电阻" at 500,520
wire pwr.5V oled.VCC
wire pwr.GND oled.GND color #20242a
wire mcu.GPIO21 oled.SCL
wire pwr.GND mcu.GND color #20242a
wire r1.A r2.A
`;

async function importCode(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 导入接线代码' }).click();
  const dialog = page.getByRole('dialog', { name: '接线代码导入' });
  await dialog.getByRole('textbox', { name: '接线代码' }).fill(CODE);
  // 初始画布是内置演示项目（非空），替换必须先确认。
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await dialog.getByRole('button', { name: '应用到画布' }).click();
  await dialog.getByRole('button', { name: '确认替换' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
}

/** 一根连线路径的中点屏幕坐标；被别的元素挡住时直接报出是谁挡的。 */
async function edgeMidpoint(page: Page, wireId: string) {
  const point = await page.locator(`.react-flow__edge[data-id="${wireId}"] path.react-flow__edge-path`).evaluate((element) => {
    const path = element as unknown as SVGPathElement;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('拿不到连线的坐标变换矩阵');
    return { x: middle.x * matrix.a + middle.y * matrix.c + matrix.e, y: middle.x * matrix.b + middle.y * matrix.d + matrix.f };
  });
  const blocker = await page.evaluate(({ x, y, wireId }) => {
    const element = document.elementFromPoint(x, y) as Element | null;
    if (!element) return 'none';
    const edge = element.closest('.react-flow__edge');
    if (!edge) return `${element.tagName}.${element.getAttribute('class') ?? ''}`;
    const id = edge.getAttribute('data-id') ?? '';
    return id === wireId ? '' : `另一根连线 ${id}`;
  }, { ...point, wireId });
  if (blocker) throw new Error(`连线 ${wireId} 的中点被 ${blocker} 挡住`);
  return point;
}

test('批次3：自定义标题栏在浏览器下只渲染标题条，不渲染窗口按钮', async ({ page }) => {
  await page.goto('/');
  const bar = page.locator('.titlebar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('AI Wiring Studio');
  // 非 Tauri（浏览器/e2e）不渲染窗口按钮：不会把"窗口操作"误当成网页功能。
  await expect(page.getByRole('button', { name: '最小化' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '最大化' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '关闭' })).toHaveCount(0);
});

test('批次3：六个画布按钮已移到顶部菜单栏，画布内不再有它们，且按钮等高', async ({ page }) => {
  await page.goto('/');
  const actions = page.locator('.menu-actions');
  for (const name of ['动手接线模式', '复制所选', '成组', '解组', '自动整理布局', '删除所选']) {
    await expect(actions.getByRole('button', { name })).toBeVisible();
  }
  // 原先挤在画布左上角的按钮容器已经删除。
  await expect(page.locator('.canvas-actions')).toHaveCount(0);
  // 菜单栏里所有按钮等高（画布按钮与打开/保存/设置一致）。
  const heights = await page.locator('.app-menu button').evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(6);
  expect([...new Set(heights)]).toEqual([30]);
});

test('批次3：线路筛选可缩成左下角按钮，再点还原', async ({ page }) => {
  await importCode(page);
  const bar = page.getByRole('group', { name: '线路筛选' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: '收起线路筛选' }).click();
  await expect(page.getByRole('group', { name: '线路筛选' })).toHaveCount(0);

  const min = page.getByRole('button', { name: '展开线路筛选' });
  await expect(min).toBeVisible();
  // 最小化按钮落在画布左下角。
  const box = await min.boundingBox();
  const pane = await page.locator('.canvas').boundingBox();
  if (!box || !pane) throw new Error('拿不到位置');
  expect(box.x - pane.x).toBeLessThan(80);
  expect(pane.y + pane.height - (box.y + box.height)).toBeLessThan(80);

  await min.click();
  await expect(page.getByRole('group', { name: '线路筛选' })).toBeVisible();
});

test('批次3：组件库/检查器可收起让画布变宽，并从画布边缘展开', async ({ page }) => {
  await importCode(page);
  const canvasWidth = async () => (await page.locator('.canvas').boundingBox())?.width ?? 0;
  const initial = await canvasWidth();

  await page.getByRole('button', { name: '收起组件库' }).click();
  await expect(page.locator('.library')).toBeHidden();
  const afterLeft = await canvasWidth();
  expect(afterLeft).toBeGreaterThan(initial);
  await expect(page.getByRole('button', { name: '展开组件库' })).toBeVisible();

  await page.getByRole('button', { name: '收起检查器' }).click();
  await expect(page.locator('.inspector')).toBeHidden();
  const afterRight = await canvasWidth();
  expect(afterRight).toBeGreaterThan(afterLeft);
  await expect(page.getByRole('button', { name: '展开检查器' })).toBeVisible();

  // 从画布边缘的展开条恢复左侧栏。
  await page.getByRole('button', { name: '展开组件库' }).click();
  await expect(page.locator('.library')).toBeVisible();
  expect(await canvasWidth()).toBeLessThan(afterRight);
});

test('批次3：底部检查摘要可收起成细条，再展开', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('.check-summary');
  await expect(summary).toHaveAttribute('data-collapsed', 'false');
  // 四类分级各一个可点摘要块。
  await expect(summary.locator('.check-chip')).toHaveCount(4);

  await summary.getByRole('button', { name: '收起检查摘要' }).click();
  await expect(summary).toHaveAttribute('data-collapsed', 'true');
  await expect(summary.locator('.check-chip')).toHaveCount(0);

  await summary.getByRole('button', { name: '展开检查摘要' }).click();
  await expect(summary.locator('.check-chip')).toHaveCount(4);
});

test('批次3：右键线路可设分类，筛选「未分类」与选中信息随之变化', async ({ page }) => {
  await importCode(page);
  const bar = page.getByRole('group', { name: '线路筛选' });
  // 一开始有一根用途判不出来（未分类），如实提示。
  await expect(bar.getByText('其中 1 根用途未分类（现有数据不足以判定，不猜）。')).toBeVisible();

  // 右键那根未分类的线（w5）→ 写自定义分类文字。
  const first = await edgeMidpoint(page, 'w5');
  await page.mouse.click(first.x, first.y, { button: 'right' });
  const menu = page.locator('.context-wire');
  await expect(menu).toBeVisible();
  await menu.getByLabel('线路分类文字').fill('电机供电正极');
  await menu.getByRole('button', { name: '保存分类文字' }).click();
  await expect(menu).toBeHidden();

  // 再右键一次 → 指定四类之一（电源）。
  const second = await edgeMidpoint(page, 'w5');
  await page.mouse.click(second.x, second.y, { button: 'right' });
  await expect(page.locator('.context-wire')).toBeVisible();
  await page.locator('.context-wire').getByRole('button', { name: '电源', exact: true }).click();
  await expect(page.locator('.context-wire')).toBeHidden();

  // 已经没有未分类的线了，提示随之消失；按「未分类」筛选命中 0。
  await expect(bar.getByText(/用途未分类/)).toHaveCount(0);
  await bar.getByRole('button', { name: '未分类', exact: true }).click();
  await expect(bar.getByRole('status')).toHaveText('命中 0 / 5 根');

  // 选中这根线：用途与自定义分类文字都显示出来，且没有改动任何端点。
  await bar.getByRole('button', { name: '全部', exact: true }).click();
  const third = await edgeMidpoint(page, 'w5');
  await page.mouse.click(third.x, third.y);
  const info = page.getByRole('status', { name: '选中线路信息' });
  await expect(info).toContainText('选中线路：w5');
  await expect(info).toContainText('电机供电正极');
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
});