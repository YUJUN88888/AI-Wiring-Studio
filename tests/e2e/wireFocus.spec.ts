import { expect, test, type Page } from '@playwright/test';

/**
 * 批次1【线路聚焦与筛选】。
 *
 * 场景刻意做成"每类都有"：电源 1 根、地线 2 根、信号 1 根、未分类 1 根（两个无源引脚相接），
 * 外加一个没接任何线的模块，用来验证"无关元件退到背景"。
 * 数据里没有任何短路/过压/输出冲突，所以「问题线路」必须命中 0——这是判断筛选真的生效的关键。
 */
const CODE = `version 1
component pwr power-5v "电源" at 40,60
component oled oled-ssd1306-i2c "显示模块" at 660,60
component mcu esp32-devkit-demo "主控" at 340,300
component r1 resistor-220r "限流电阻" at 40,520
component r2 resistor-220r "上拉电阻" at 280,520
component x1 hc-sr04 "未接线模块" at 660,520
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

/** 连线当前的渲染透明度。默认档＝0.62、聚焦命中＝1、退到背景＝0.1。 */
const opacityOf = (page: Page, wireId: string) =>
  page.locator(`.react-flow__edge[data-id="${wireId}"] path.react-flow__edge-path`)
    .evaluate((element) => Math.round(Number(getComputedStyle(element).opacity) * 100) / 100);

async function expectOpacity(page: Page, wireIds: string[], value: number) {
  for (const wireId of wireIds) await expect.poll(() => opacityOf(page, wireId)).toBe(value);
}

/**
 * 画布上既不在元件、也不在任何浮层上的空白点。
 * 右下角的「线路筛选」条与「选中线路」信息面板都会吃掉点击，必须一起避让，
 * 否则"点空白清空选中"其实点在了浮层按钮上。
 */
async function emptyPoint(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) throw new Error('没有找到画布');
    const box = pane.getBoundingClientRect();
    const obstacles = [
      ...document.querySelectorAll('.react-flow__node, .react-flow__controls, .react-flow__attribution, .react-flow__panel, .wire-filter, .wire-filter-min, .wire-info, .panel-rail'),
    ].map((element) => element.getBoundingClientRect());
    const clear = (point: { x: number; y: number }) =>
      obstacles.every((rect) => point.x < rect.left - 6 || point.x > rect.right + 6 || point.y < rect.top - 6 || point.y > rect.bottom + 6);
    const candidates = [
      { x: box.left + 30, y: box.top + 30 },
      { x: box.right - 30, y: box.top + 30 },
      { x: box.left + 30, y: box.bottom - 120 },
      { x: box.right - 30, y: box.bottom - 120 },
    ];
    const hit = candidates.find(clear);
    if (!hit) throw new Error('画布上没有找到空白点');
    return hit;
  });
}

/** 点一根连线的路径中点（避开引脚热点，也避开元件盒子）。 */
async function clickEdgeMidpoint(page: Page, wireId: string) {
  const point = await page.locator(`.react-flow__edge[data-id="${wireId}"] path.react-flow__edge-path`).evaluate((element) => {
    const path = element as SVGPathElement;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('拿不到连线的坐标变换矩阵');
    return { x: middle.x * matrix.a + middle.y * matrix.c + matrix.e, y: middle.x * matrix.b + middle.y * matrix.d + matrix.f };
  });
  // 中点必须真的落在连线的命中区上；被别的元素挡住时直接报出是谁挡的，避免以后莫名其妙地失败。
  const blocker = await page.evaluate(({ x, y, wireId }) => {
    const element = document.elementFromPoint(x, y) as Element | null;
    if (!element) return 'none';
    const edge = element.closest('.react-flow__edge');
    if (!edge) return `${element.tagName}.${element.getAttribute('class') ?? ''}`;
    const id = edge.getAttribute('data-id') ?? '';
    return id === wireId ? '' : `另一根连线 ${id}`;
  }, { ...point, wireId });
  if (blocker) throw new Error(`连线 ${wireId} 的中点被 ${blocker} 挡住`);
  await page.mouse.click(point.x, point.y);
}

test('默认不再所有线同时满强度；按用途筛选只淡化、不隐藏、不改连接', async ({ page }) => {
  await importCode(page);
  const bar = page.getByRole('group', { name: '线路筛选' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('status')).toHaveText('共 5 根');
  // 用途判不出来就如实说「未分类」，而不是塞进「信号」里。
  await expect(bar.getByText('其中 1 根用途未分类（现有数据不足以判定，不猜）。')).toBeVisible();

  // 默认档：线路退到中等强度，让元件和名字先被看清。
  await expectOpacity(page, ['w1', 'w2', 'w3', 'w4', 'w5'], 0.62);
  // 深色地线（#20242a）在深色画布上必须有浅色衬底，否则等于看不见。
  await expect(page.locator('.routed-edge-casing')).toHaveCount(2);

  await bar.getByRole('button', { name: '电源' }).click();
  await expect(page.getByText(/已按「电源」筛选线路/)).toBeVisible();
  await expect(bar.getByRole('status')).toHaveText('命中 1 / 5 根');
  await expectOpacity(page, ['w1'], 1);
  await expectOpacity(page, ['w2', 'w3', 'w4', 'w5'], 0.1);
  // 筛选只是显示态：五根线全都还在画布上。
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);

  await bar.getByRole('button', { name: '问题线路' }).click();
  await expect(bar.getByRole('status')).toHaveText('命中 0 / 5 根');
  await expect(bar.getByText('这一类当前没有线路；筛选只让连线淡出，不会隐藏或删除任何连接。')).toBeVisible();

  await bar.getByRole('button', { name: '全部' }).click();
  await expect(bar.getByRole('status')).toHaveText('共 5 根');
  await expectOpacity(page, ['w1', 'w2', 'w3', 'w4', 'w5'], 0.62);
});

test('悬停模块只留下它的直接连接，无关线路与未接线模块一起退到背景；点空白恢复', async ({ page }) => {
  await importCode(page);
  await expect(page.locator('.part.focus-muted')).toHaveCount(0);

  await page.locator('.react-flow__node[data-id="mcu"]').hover();
  // 与主控直接相连的两根（信号 + 地线）保持满强度，其余三根淡化。
  await expectOpacity(page, ['w3', 'w4'], 1);
  await expectOpacity(page, ['w1', 'w2', 'w5'], 0.1);
  // 没接任何线的模块退到背景；被它连到的电源与显示模块留在前景。
  await expect(page.locator('.part.focus-muted')).toHaveCount(3);
  await expect(page.locator('.react-flow__node[data-id="x1"] .part.focus-muted')).toHaveCount(1);
  await expect(page.locator('.react-flow__node[data-id="mcu"] .part.focus-muted')).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="oled"] .part.focus-muted')).toHaveCount(0);

  const empty = await emptyPoint(page);
  await page.mouse.move(empty.x, empty.y);
  await expectOpacity(page, ['w1', 'w2', 'w3', 'w4', 'w5'], 0.62);
  await expect(page.locator('.part.focus-muted')).toHaveCount(0);
});

test('选中线路给出起点/终点/用途/网络与电压；点画布空白处恢复', async ({ page }) => {
  await importCode(page);
  await clickEdgeMidpoint(page, 'w1');

  const info = page.getByRole('status', { name: '选中线路信息' });
  await expect(info).toBeVisible();
  await expect(info).toContainText('选中线路：w1');
  await expect(info).toContainText('电源.5V');
  await expect(info).toContainText('显示模块.VCC');
  // 用途与网络都来自已有数据：这条是电源网络、电压已确认 5V。
  await expect(info).toContainText('电源');
  await expect(info).toContainText('5V（已确认）');

  const empty = await emptyPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(info).toBeHidden();
});