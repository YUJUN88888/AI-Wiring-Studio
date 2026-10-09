import { expect, test, type Locator, type Page } from '@playwright/test';

/** 1×1 的合法 PNG，用于验证"右键上传元件图片"能把内置元件转成图片元件。 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * 侧栏只留一个「元件库」入口，用户元件与内置元件都从这个弹窗里取用：
 * 打开弹窗 → 点条目 → 关闭弹窗。打开的句柄由调用方按需再取。
 */
async function openWarehouse(page: Page) {
  await page.getByRole('button', { name: '元件库…' }).click();
  const dialog = page.getByRole('dialog', { name: '元件仓库' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addBuiltInFromWarehouse(page: Page, label: string) {
  const dialog = await openWarehouse(page);
  await dialog.getByRole('button', { name: `＋ ${label}` }).click();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * 在元件库弹窗里数一数某个条目的数量后关闭。
 * 内置元件被改尺寸/传图片后会以同一个 definitionId 进入用户库，库里的"内置条目"随之消失，
 * 只剩「我的元件」那一条，所以这个数量正好能验证"同型号不会出现两个可点条目"。
 */
async function expectWarehouseEntryCount(page: Page, label: string, count: number) {
  const dialog = await openWarehouse(page);
  await expect(dialog.getByRole('button', { name: `＋ ${label}` })).toHaveCount(count);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * 取连线路径中点的屏幕坐标。
 * 不能再用「边包围盒 + 固定偏移」：折线连线的包围盒可能从引脚出发，
 * 写死的右上角偏移会正好落在元件热点上，右键就变成了点元件。
 */
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

test('shows the M0 wiring canvas and deletes a selected component', async ({ page }) => {
  await page.goto('/');
  // 软件名只在自定义标题栏显示（顶栏已去掉重复的软件名，改为单行工具栏）。
  await expect(page.locator('.titlebar')).toContainText('AI Wiring Studio');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' })).toBeVisible();
  const supplyNode = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  await supplyNode.click();
  await page.getByRole('button', { name: '删除所选' }).click();
  await expect(supplyNode).toHaveCount(0);
  await expect(page.getByText('已删除所选组件及其关联连线。')).toBeVisible();
});

test('adds, saves, deletes, and opens a local project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 添加元件' }).click();
  const added = page.locator('.react-flow__node').filter({ hasText: '通用开关' });
  await expect(added).toHaveCount(1);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  await added.click();
  await page.getByRole('button', { name: '删除所选' }).click();
  await expect(added).toHaveCount(0);
  await page.getByRole('button', { name: '打开项目' }).click();
  await expect(page.getByText('项目已打开。')).toBeVisible();
  await expect(page.locator('.react-flow__node').filter({ hasText: '通用开关' })).toHaveCount(1);
});

test('内置元件的引脚也是每个引脚一个圆点、名字贴在自己的引脚旁', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  // 每个引脚一个可见圆点 + 一个与之重合的透明落点；不再有"名字居中、一行两个圆点"的逐行列表。
  await expect(node.locator('.hotspot')).toHaveCount(4);
  await expect(node.locator('.part-pin-label')).toHaveCount(4);
  await expect(node.locator('.pin')).toHaveCount(0);
  const positions = await node.locator('.part-pin-label').evaluateAll((labels) => labels.map((label) => `${(label as HTMLElement).style.left}/${(label as HTMLElement).style.top}`));
  expect(new Set(positions).size).toBe(4);

  // 名字必须紧贴自己的引脚圆点（旧实现居中），且不越出元件盒子。
  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error('元件未渲染');
  const rects = (selector: string) => node.locator(selector).evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }; }));
  const labels = await rects('.part-pin-label');
  const dots = await node.locator('.hotspot').evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }));
  for (const dot of dots) {
    const gaps = labels.map((label) => Math.max(label.x - dot.x, dot.x - (label.x + label.w), 0) + Math.max(label.y - dot.y, dot.y - (label.y + label.h), 0));
    expect(Math.min(...gaps)).toBeLessThan(25);
  }
  for (const label of labels) {
    expect(label.x).toBeGreaterThanOrEqual(nodeBox.x - 1);
    expect(label.x + label.w).toBeLessThanOrEqual(nodeBox.x + nodeBox.width + 1);
  }
});

test('元件仓库：默认显示全部，可按分类筛选与关键字检索', async ({ page }) => {
  await page.goto('/');
  const dialog = await openWarehouse(page);
  // 内置元件按分类分组：分组标题使用与元件编辑器一致的中文分类名。
  await expect(dialog.getByRole('heading', { name: '无源器件（电阻等）' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '主控（MCU）' })).toBeVisible();
  // 每个元件都带能力标签（引脚数等）。
  await expect(dialog.locator('.library-group .tag').first()).toBeVisible();

  const search = dialog.getByLabel('在仓库中搜索元件');
  await search.fill('ESP32');
  await expect(dialog.getByRole('button', { name: '＋ ESP32 DevKit（演示）' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '＋ 电解电容' })).toHaveCount(0);

  await search.fill('');
  await expect(dialog.getByRole('button', { name: '＋ 电解电容' })).toBeVisible();

  // 「我的元件」分类：库为空时给出明确提示，而不是留空白。
  await dialog.getByRole('button', { name: '我的元件', exact: true }).click();
  await expect(dialog.getByText('共 0 个元件。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '＋ 电解电容' })).toHaveCount(0);
});

test('creates a Pin-to-Pin wire by dragging handles', async ({ page }) => {
  await page.goto('/');
  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.react-flow__handle-right').first();
  const target = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' }).locator('.react-flow__handle-left').first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Pin handles not rendered');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText(/项目：4 个组件，1 根连线，1 个网络。/)).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('persists a dragged component position', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const box = await node.boundingBox();
  if (!box) throw new Error('ESP32 node not rendered');
  await page.mouse.move(box.x + 80, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 75, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aiws.m0.demo') ?? '{}'));
  const esp32 = saved.components.find((component: { id: string }) => component.id === 'esp32');
  expect(esp32.position).not.toEqual({ x: 390, y: 160 });
});

test('undo and redo restore a deleted component', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  await node.click();
  await page.getByRole('button', { name: '删除所选' }).click();
  await expect(node).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' })).toHaveCount(1);
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' })).toHaveCount(0);
});

test('highlights selection and deletes a component with the Delete key', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  await node.click();
  await expect(node).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(node).toHaveCount(0);
  await expect(page.getByText('已删除组件及其关联连线。')).toBeVisible();
});

test('edits and deletes a wire from its context menu', async ({ page }) => {
  await page.goto('/');
  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.react-flow__handle-right').first();
  const target = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' }).locator('.react-flow__handle-left').first();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Pin handles not rendered');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); await page.mouse.up();
  const wirePoint = await wireMidpoint(page);
  await page.mouse.click(wirePoint.x, wirePoint.y, { button: 'right' });
  await page.getByRole('button', { name: '设置连线颜色 #e34b4b' }).click();
  await expect(page.getByText('连线颜色已更新为 #e34b4b。')).toBeVisible();
  await page.mouse.click(wirePoint.x, wirePoint.y, { button: 'right' });
  await page.getByRole('button', { name: '删除连线' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.getByText('已删除连线。')).toBeVisible();
});

test('deletes multiple components atomically, then undo/redo and save/open preserve the result', async ({ page }) => {
  await page.goto('/');
  const supply = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  await supply.click();
  await resistor.click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(supply).toHaveCount(0);
  await expect(resistor).toHaveCount(0);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(supply).toHaveCount(1);
  await expect(resistor).toHaveCount(1);
  await page.getByRole('button', { name: '重做' }).click();
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();
  await page.getByRole('button', { name: '打开项目' }).click();
  await expect(supply).toHaveCount(0);
  await expect(resistor).toHaveCount(0);
});

test('deletes a component from its right-click menu', async ({ page }) => {
  await page.goto('/');
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });
  await led.click({ button: 'right' });
  await page.getByRole('button', { name: '删除元件' }).click();
  await expect(led).toHaveCount(0);
  await expect(page.getByText('已删除组件及其关联连线。')).toBeVisible();
});

test('shows an ERC overvoltage problem and locates its affected component', async ({ page }) => {
  await page.goto('/');
  // 统一盒式布局后，热点的左右类名由 Handle 的 position 决定、DOM 顺序按排布结果（左侧引脚在前），
  // 按序号取"第几个左/右热点"已经不能确定是哪个引脚了。这里改为按引脚 id 精确取：
  // 可见的 source 热点是 .hotspot[data-pin]，与它重合的透明落点是 .hotspot-hit[data-pin]。
  const source = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' }).locator('.hotspot[data-pin="5V"]');
  const gpio = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const target = gpio.locator('.hotspot-hit[data-pin="GPIO21"]');
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Pin handles not rendered');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); await page.mouse.up();
  const problem = page.locator('.problem.error').filter({ hasText: '输入过压' });
  await expect(problem).toBeVisible();
  // 电压网络（含电流状态与原因）归在右侧「属性」页；切过去核对后，再切回「检查」继续下面的分级筛选。
  await page.getByRole('tab', { name: '属性' }).click();
  await expect(page.getByText('电流：未知')).toBeVisible();
  await expect(page.getByText('该网络缺少完整负载模型，无法计算电流。')).toBeVisible();
  await page.getByRole('tab', { name: '检查' }).click();
  await expect(problem).toBeVisible();
  await problem.click();
  await expect(gpio).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: '问题证据' })).toBeVisible();
  await expect(page.getByLabel('问题证据')).toContainText('检测到的电压');
  // A15 结果分级＝图3 的四级。筛选按钮与底部检查区同名（如「待确认」），所以筛选统一限定在 .problem-filters 里点击。
  const filters = page.locator('.problem-filters');
  await filters.getByRole('button', { name: '待确认', exact: true }).click();
  await expect(problem).toBeHidden();
  await filters.getByRole('button', { name: '优化建议', exact: true }).click();
  await expect(page.getByText('当前筛选条件下没有问题。')).toBeVisible();
  await filters.getByRole('button', { name: '全部', exact: true }).click();
  await expect(problem).toBeVisible();
  // A10 底部检查区：只做摘要 + 点击定位。这条电路只有 1 个「明确错误」（输入过压）。
  const definiteChip = page.locator('.check-chip.definite');
  await expect(definiteChip).toContainText('明确错误 · 1');
  await definiteChip.click();
  await expect(gpio).toHaveClass(/selected/);
});

test('A15 检查范围：如实声明五层覆盖情况，系统预算与仿真分析明确标注不在范围', async ({ page }) => {
  await page.goto('/');
  // 默认折叠：这块是说明性内容，不该长期占满检查器。
  await expect(page.locator('ul.coverage')).toHaveCount(0);
  await page.getByRole('button', { name: '展开检查范围' }).click();
  const coverage = page.locator('ul.coverage');
  await expect(coverage.locator('.coverage-item')).toHaveCount(5);
  // 逐字对照图3 的五层，且状态必须与真实能力一致（不做的事绝不写成已检查）。
  await expect(coverage).toContainText('连接检查 · 已检查');
  await expect(coverage).toContainText('电气规则检查 · 部分检查');
  await expect(coverage).toContainText('系统预算检查 · 不在当前范围');
  await expect(coverage).toContainText('工程建议 · 部分检查');
  await expect(coverage).toContainText('仿真分析 · 不在当前范围');
  // 折叠态写进本地存储：刷新后仍是展开的，不会被反复撑开/收起。
  await page.reload();
  await expect(page.locator('ul.coverage')).toHaveCount(1);
});

test('从元件仓库添加内置元件', async ({ page }) => {
  await page.goto('/');
  await addBuiltInFromWarehouse(page, '电解电容');
  await expect(page.locator('.react-flow__node').filter({ hasText: '电解电容' })).toHaveCount(1);
  await expect(page.getByText(/项目：5 个组件/)).toBeVisible();
});

test('右键可调整内置元件大小：改的是元件定义，同型号一起变并自动转为「我的元件」', async ({ page }) => {
  await page.goto('/');
  await addBuiltInFromWarehouse(page, '电解电容');
  await addBuiltInFromWarehouse(page, '电解电容');
  const nodes = page.locator('.react-flow__node').filter({ hasText: '电解电容' });
  await expect(nodes).toHaveCount(2);
  // 直接读元件盒子（.part）的 inline width：它就是画布单位下的真实宽度，
  // 不像 boundingBox 那样受 fitView 缩放影响，断言可以写成精确值。
  const boxWidth = (index: number) => nodes.nth(index).locator('.part').evaluate((element) => parseFloat((element as HTMLElement).style.width));

  // 两个同型号元件落点很接近、会互相盖住，右键点在左上角空白处才不会被后一个挡住。
  await nodes.first().click({ button: 'right', position: { x: 8, y: 8 } });
  await page.getByRole('button', { name: '调整元件大小…' }).click();
  const dialog = page.getByRole('dialog', { name: '调整元件大小' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('元件宽度').fill('260');
  await dialog.getByLabel('元件高度').fill('140');
  await dialog.getByRole('button', { name: '应用尺寸' }).click();
  await expect(dialog).toHaveCount(0);

  // 同型号的两个实例一起变：画布单位宽度都应精确等于 260。
  for (let index = 0; index < 2; index += 1) expect(await boxWidth(index)).toBe(260);
  await expect(page.getByText(/原为内置元件，已自动转为「我的元件」/)).toBeVisible();

  // 转为用户元件后：元件库里同型号只剩这一条可编辑条目（内置条目已消失）；侧栏只留一个「元件库」入口。
  const warehouse = await openWarehouse(page);
  await expect(warehouse.getByRole('button', { name: '编辑元件 电解电容' })).toBeVisible();
  await expect(warehouse.locator('.user-component').filter({ hasText: '电解电容' }).getByText('260×140')).toBeVisible();
  await expect(warehouse.getByRole('button', { name: '＋ 电解电容' })).toHaveCount(1);
  await warehouse.getByRole('button', { name: '关闭' }).click();

  // 元件库持久化：重新加载后转换结果仍在，内置条目不会"复活"。
  await page.reload();
  await expectWarehouseEntryCount(page, '电解电容', 1);
  const reloaded = await openWarehouse(page);
  await expect(reloaded.getByRole('button', { name: '编辑元件 电解电容' })).toBeVisible();
  await reloaded.getByRole('button', { name: '关闭' }).click();
});

test('右键可给内置元件上传图片：自动转为「我的元件」并按图片渲染引脚热点', async ({ page }) => {
  await page.goto('/');
  await addBuiltInFromWarehouse(page, '按键开关');
  const node = () => page.locator('.react-flow__node').filter({ hasText: '按键开关' });
  await expect(node()).toHaveCount(1);
  // 所有元件现在都是盒式布局，根节点恒带 image-part 类，所以要用真正的 <img>（.part-image）判断有没有图。
  await expect(node().locator('.part-image')).toHaveCount(0);

  await node().click({ button: 'right' });
  await page.getByLabel('上传画布元件图片').setInputFiles({ name: 'part.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });

  await expect(node().locator('.part-image')).toHaveCount(1);
  await expect(page.getByText(/原为内置元件，已自动转为「我的元件」/)).toBeVisible();
  // 每个引脚只显示一个可见热点，不再出现两个操作点。
  await expect(node().locator('.hotspot')).toHaveCount(2);
  const warehouse = await openWarehouse(page);
  await expect(warehouse.getByRole('button', { name: '编辑元件 按键开关' })).toBeVisible();
  await warehouse.getByRole('button', { name: '关闭' }).click();
});

test('A14 点击引脚高亮整张电气网络，再点一次或点空白处取消', async ({ page }) => {
  await page.goto('/');
  const supply = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  const board = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  // 先建一根线（电源 GND → ESP32 GND），形成含 2 个引脚、1 根线的网络。
  const from = await supply.locator('.hotspot[data-pin="GND"]').boundingBox();
  const to = await board.locator('.hotspot-hit[data-pin="GND"]').boundingBox();
  if (!from || !to) throw new Error('Pin handles not rendered');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // 点网络里的任意一个引脚 → 该网络上的两个引脚与这根连线一起点亮。
  const gndPin = board.locator('.hotspot-hit[data-pin="GND"]');
  await gndPin.click();
  await expect(page.locator('.routed-edge-halo')).toHaveCount(1);
  await expect(page.locator('.hotspot.pin-lit')).toHaveCount(2);
  await expect(page.locator('.part-pin-label.pin-lit')).toHaveCount(2);
  await expect(page.getByText('已高亮该引脚所在网络：2 个引脚、1 根连线。')).toBeVisible();
  // 高亮只是临时可视态：连线的持久颜色不能被改掉（否则会与「动手接线模式」的灰化互相污染）。
  const stroke = await page.locator('.react-flow__edge-path').first().evaluate((element) => getComputedStyle(element as SVGElement).stroke);
  expect(stroke).toBe('rgb(87, 212, 255)');

  // 再点同一个引脚 → 取消。
  await gndPin.click();
  await expect(page.locator('.routed-edge-halo')).toHaveCount(0);
  await expect(page.locator('.hotspot.pin-lit')).toHaveCount(0);
  await expect(page.getByText('已取消网络高亮。')).toBeVisible();

  // 没有连线的引脚没有什么可高亮的：明确提示，而不是假装点亮。
  await board.locator('.hotspot-hit[data-pin="GPIO23"]').click();
  await expect(page.locator('.routed-edge-halo')).toHaveCount(0);
  await expect(page.getByText('引脚 GPIO23 当前没有连线，暂无可高亮的网络。')).toBeVisible();

  // 点画布空白处也要能清除。空白点由"离所有元件都远"的候选点现算，避免写死坐标踩到元件。
  await gndPin.click();
  await expect(page.locator('.routed-edge-halo')).toHaveCount(1);
  const empty = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) throw new Error('没有找到画布');
    const box = pane.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
    const candidates = [{ x: box.right - 30, y: box.bottom - 30 }, { x: box.right - 30, y: box.top + 40 }, { x: box.left + 40, y: box.bottom - 90 }];
    const hit = candidates.find((point) => nodes.every((node) => point.x < node.left || point.x > node.right || point.y < node.top || point.y > node.bottom));
    if (!hit) throw new Error('画布上没有找到空白点');
    return hit;
  });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.routed-edge-halo')).toHaveCount(0);
});

test('A13 画布右键【快速选择】：按连线颜色/类别/供电批量选中元件', async ({ page }) => {
  await page.goto('/');
  const supply = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  const board = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });
  const dragPin = async (from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }) => {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  // 两根线：5V 电源 5V → ESP32 GPIO21（已知 5V 网络）；电阻 A → LED A（无电源、供电未知）。
  const a = await supply.locator('.hotspot[data-pin="5V"]').boundingBox();
  const b = await board.locator('.hotspot-hit[data-pin="GPIO21"]').boundingBox();
  const c = await resistor.locator('.hotspot[data-pin="A"]').boundingBox();
  const d = await led.locator('.hotspot-hit[data-pin="A"]').boundingBox();
  if (!a || !b || !c || !d) throw new Error('引脚热点未渲染');
  await dragPin(a, b);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await dragPin(c, d);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // 在画布空白处右键打开【快速选择】；空白点由"离所有元件都远"的候选点现算，避免写死坐标踩到元件。
  const empty = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) throw new Error('没有找到画布');
    const box = pane.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
    const candidates = [{ x: box.right - 30, y: box.bottom - 30 }, { x: box.right - 30, y: box.top + 40 }, { x: box.left + 40, y: box.bottom - 90 }];
    const hit = candidates.find((point) => nodes.every((node) => point.x < node.left || point.x > node.right || point.y < node.top || point.y > node.bottom));
    if (!hit) throw new Error('画布上没有找到空白点');
    return hit;
  });
  const openQuick = async () => {
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    const menu = page.locator('.context-quick');
    await expect(menu).toBeVisible();
    return menu;
  };

  const menu = await openQuick();
  // 三个维度都在，且都用确定性判据：颜色取连线颜色、类别取定义分类、供电取 ERC 已算出的电压网。
  for (const title of ['按连线颜色', '按类别', '按供电']) await expect(menu.locator('.quick-title').filter({ hasText: title })).toBeVisible();
  await expect(menu.getByRole('button', { name: '#57d4ff（4 个元件）' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '电源（1 个元件）' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '主控（MCU）（1 个元件）' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '二极管（1 个元件）' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '无源器件（电阻等）（1 个元件）' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '5V（2 个元件）' })).toBeVisible();
  // 缺供电参数的元件单列「未知供电」，绝不猜一个电压出来。
  await expect(menu.getByRole('button', { name: '未知供电（2 个元件）' })).toBeVisible();

  // 按类别选中：只选中 ESP32，菜单关闭，状态给出确切数量。
  await menu.getByRole('button', { name: '主控（MCU）（1 个元件）' }).click();
  await expect(page.locator('.context-quick')).toHaveCount(0);
  await expect(board).toHaveClass(/selected/);
  await expect(supply).not.toHaveClass(/selected/);
  await expect(page.getByText('已按「按类别：主控（MCU）」选中 1 个元件。')).toBeVisible();

  // 按供电选中：已知 5V 网络上的两个元件一起选中。
  const menu2 = await openQuick();
  await menu2.getByRole('button', { name: '5V（2 个元件）' }).click();
  await expect(board).toHaveClass(/selected/);
  await expect(supply).toHaveClass(/selected/);
  await expect(resistor).not.toHaveClass(/selected/);
  await expect(page.getByText('已按「按供电：5V」选中 2 个元件。')).toBeVisible();

  // 按连线颜色选中：两根同色连线的四个端点元件全部选中。
  const menu3 = await openQuick();
  await menu3.getByRole('button', { name: '#57d4ff（4 个元件）' }).click();
  for (const node of [supply, board, resistor, led]) await expect(node).toHaveClass(/selected/);
  await expect(page.getByText('已按「按连线颜色：#57d4ff」选中 4 个元件。')).toBeVisible();
});

test('A11 框选多个元件后可批量删除与批量复制', async ({ page }) => {
  await page.goto('/');
  const supply = page.locator('.react-flow__node').filter({ hasText: 'USB 5V 电源' });
  const board = page.locator('.react-flow__node').filter({ hasText: 'ESP32 DevKit（演示）' });
  const resistor = page.locator('.react-flow__node').filter({ hasText: '220 Ω' });
  const led = page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' });

  const boxOf = async (locator: Locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('元件未渲染');
    return box;
  };
  /** 左键在空白处拖出一个矩形，把给定的两个元件完整框住（框选＝左键拖拽，平移已改为中键）。 */
  const boxSelect = async (first: Locator, second: Locator) => {
    const a = await boxOf(first);
    const b = await boxOf(second);
    const left = Math.min(a.x, b.x) - 12;
    const top = Math.min(a.y, b.y) - 12;
    const right = Math.max(a.x + a.width, b.x + b.width) + 12;
    const bottom = Math.max(a.y + a.height, b.y + b.height) + 12;
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();
  };

  // 右侧的电阻与 LED 都在其它元件之外，一个矩形能正好框住它们俩。
  await boxSelect(resistor, led);
  await expect(resistor).toHaveClass(/selected/);
  await expect(led).toHaveClass(/selected/);
  await expect(supply).not.toHaveClass(/selected/);
  await expect(board).not.toHaveClass(/selected/);

  // 批量删除：Delete 一次删掉框选中的两个，撤销可整体恢复。
  await page.keyboard.press('Delete');
  await expect(resistor).toHaveCount(0);
  await expect(led).toHaveCount(0);
  await expect(page.getByText('已删除 2 个组件及其关联连线。')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(resistor).toHaveCount(1);
  await expect(led).toHaveCount(1);

  // 批量复制：一次复制框选中的两个元件，落点偏移后总数从 4 变 6。
  await boxSelect(resistor, led);
  await page.getByRole('button', { name: '复制所选' }).click();
  await expect(page.getByText('已复制 2 个元件。')).toBeVisible();
  await expect(page.locator('.react-flow__node').filter({ hasText: '220 Ω' })).toHaveCount(2);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'LED · 红色' })).toHaveCount(2);
  await expect(page.getByText(/项目：6 个组件/)).toBeVisible();

  // 没有选中任何元件时给出明确提示，而不是静默什么也不做（点画布空白处会清空选择）。
  const empty = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane');
    if (!pane) throw new Error('没有找到画布');
    const box = pane.getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
    const candidates = [{ x: box.right - 30, y: box.bottom - 30 }, { x: box.left + 40, y: box.bottom - 90 }];
    const hit = candidates.find((point) => nodes.every((node) => point.x < node.left || point.x > node.right || point.y < node.top || point.y > node.bottom));
    if (!hit) throw new Error('画布上没有找到空白点');
    return hit;
  });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  await page.getByRole('button', { name: '复制所选' }).click();
  await expect(page.getByText('没有选中的元件，先在画布上框选或用 Ctrl 多选。')).toBeVisible();
});
