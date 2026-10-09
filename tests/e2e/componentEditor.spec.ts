import { expect, test, type Page } from '@playwright/test';

/** 用户元件列表已收进「元件库」弹窗：侧栏只剩一个入口按钮。 */
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '元件库…' }).click();
  const dialog = page.getByRole('dialog', { name: '元件仓库' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 通过编辑器新建一个用户元件：PIN1 为 5V 电源输出，PIN2 为最大 3.3V 的电源输入。 */
async function createUserComponent(page: Page, name: string) {
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await expect(page.getByRole('dialog', { name: '元件编辑器' })).toBeVisible();
  await page.getByLabel('元件名称').fill(name);

  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill('VCC');
  await page.getByLabel('引脚 1 类型').selectOption({ label: '电源输出' });
  await page.getByLabel('引脚 1 最大电压').fill('6');
  await page.getByLabel('引脚 1 输出电压').fill('5');

  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 2 名称').fill('VIN');
  await page.getByLabel('引脚 2 类型').selectOption({ label: '电源输入' });
  await page.getByLabel('引脚 2 最大电压').fill('3.3');

  await page.getByRole('button', { name: '保存到用户元件库' }).click();
}

test('未填写数值时明确显示未知，填写后显示已确认来源', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  const dialog = page.getByRole('dialog', { name: '元件编辑器' });
  await expect(dialog.getByText('未填写的字段会保持“未知”，不会被当作已确认值；确认过的字段会显示来源。')).toBeVisible();
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();

  const maxVoltage = page.getByLabel('引脚 1 最大电压');
  const maxVoltageField = page.locator('.editor-field').filter({ has: maxVoltage });
  await expect(maxVoltage).toHaveValue('');
  await expect(maxVoltage).toHaveAttribute('placeholder', '未知');
  await expect(page.getByLabel('引脚 1 类型')).toHaveValue('UNKNOWN');
  await expect(maxVoltageField.getByText('未知')).toBeVisible();

  await maxVoltage.fill('5');
  await expect(maxVoltageField.getByText('已确认 · 用户录入')).toBeVisible();

  await maxVoltage.fill('');
  await expect(maxVoltage).toHaveValue('');
  await expect(maxVoltageField.getByText('未知')).toBeVisible();
});

test('新建元件保存到用户库，重新加载后仍可检索并拖入画布', async ({ page }) => {
  await page.goto('/');
  await createUserComponent(page, '自定义传感器');
  await expect(page.getByText('用户元件「自定义传感器」已保存。')).toBeVisible();

  await page.reload();
  const library = await openLibrary(page);
  const entry = library.getByRole('button', { name: '＋ 自定义传感器' });
  await expect(entry).toBeVisible();

  await entry.click();
  await library.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.react-flow__node').filter({ hasText: '自定义传感器' })).toHaveCount(1);
  await expect(page.getByText(/项目：5 个组件/)).toBeVisible();
  await expect(page.getByText(/已添加用户元件 自定义传感器/)).toBeVisible();
});

test('用户元件的明确参数会被 ERC 使用：3.3V 输入接 5V 输出会报输入过压', async ({ page }) => {
  await page.goto('/');
  await createUserComponent(page, '自定义传感器');
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 自定义传感器' }).click();
  await library.getByRole('button', { name: '关闭' }).click();

  const node = page.locator('.react-flow__node').filter({ hasText: '自定义传感器' });
  const output = node.locator('.react-flow__handle-right').first();
  const input = node.locator('.react-flow__handle-left').nth(1);
  const from = await output.boundingBox();
  const to = await input.boundingBox();
  if (!from || !to) throw new Error('用户元件引脚热点未渲染');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.problem.error').filter({ hasText: '输入过压' })).toBeVisible();
  // 未填写的电流上限不会被编造，电流状态保持未知。电压网络在右侧「属性」页。
  await page.getByRole('tab', { name: '属性' }).click();
  await expect(page.getByText('电流：未知').first()).toBeVisible();
});

test('可以编辑与删除已有用户元件', async ({ page }) => {
  await page.goto('/');
  await createUserComponent(page, '待改名元件');
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '编辑元件 待改名元件' }).click();
  await page.getByLabel('元件名称').fill('改好名的元件');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「改好名的元件」已保存。')).toBeVisible();
  await expect(library.getByRole('button', { name: '＋ 改好名的元件' })).toBeVisible();

  await library.getByRole('button', { name: '从库中删除 改好名的元件' }).click();
  await expect(page.getByText('用户元件「改好名的元件」已删除。')).toBeVisible();
  await expect(library.getByRole('button', { name: '＋ 改好名的元件' })).toHaveCount(0);
});

test('编辑器保存后画布上已有的同型号元件立即跟随更新（改名与引脚位置）', async ({ page }) => {
  await page.goto('/');
  await createUserComponent(page, '跟随更新元件');

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 跟随更新元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();

  const node = page.locator('.react-flow__node').filter({ hasText: '跟随更新元件' });
  await expect(node.locator('.part-pin-label')).toHaveCount(2);
  const before = await node.locator('.part-pin-label').first().evaluate((el) => (el as HTMLElement).style.left);

  // 从元件库打开编辑器改名字 + 把两个引脚都拖到明确位置。
  const reopened = await openLibrary(page);
  await reopened.getByRole('button', { name: '编辑元件 跟随更新元件' }).click();
  await page.getByLabel('元件名称').fill('改名后元件');
  await page.getByLabel('引脚 1 位置 X').fill('40');
  await page.getByLabel('引脚 1 位置 Y').fill('20');
  await page.getByLabel('引脚 2 位置 X').fill('140');
  await page.getByLabel('引脚 2 位置 Y').fill('100');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「改名后元件」已保存。')).toBeVisible();

  // 不重新加载页面：画布上的那个实例必须已经改名，且引脚落到刚填的坐标上。
  // 旧实现只写用户库、不重建画布，这里会停在旧名字与旧坐标（"能保存但画布没变"）。
  const updated = page.locator('.react-flow__node').filter({ hasText: '改名后元件' });
  await expect(updated).toHaveCount(1);
  const lefts = await updated.locator('.part-pin-label').evaluateAll((labels) => labels.map((label) => (label as HTMLElement).style.left));
  expect(lefts).toEqual(['40px', '140px']);
  expect(lefts[0]).not.toBe(before);
});

test('项目带过来的元件即使本机没有对应定义，也仍按盒式布局渲染引脚', async ({ page }) => {
  await page.goto('/');
  await createUserComponent(page, '离线定义元件');
  const library = await openLibrary(page);
  await library.getByRole('button', { name: '＋ 离线定义元件' }).click();
  await library.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('项目已保存到本地浏览器存储。')).toBeVisible();

  // 模拟"换台机器打开项目"：项目文件只存元件实例，定义住在用户库里，这里把库清空。
  await page.evaluate(() => localStorage.removeItem('aiws.user-library'));
  await page.reload();
  await page.getByRole('button', { name: '打开项目' }).click();
  await expect(page.getByText('项目已打开。')).toBeVisible();

  // 定义缺失时若退回逐行列表，就会出现"引脚名居中、一个名字两个圆点"的老毛病。
  const node = page.locator('.react-flow__node').filter({ hasText: '离线定义元件' });
  await expect(node.locator('.part-pin-label')).toHaveCount(2);
  await expect(node.locator('.hotspot')).toHaveCount(2);
  await expect(node.locator('.pin')).toHaveCount(0);
});

test('引脚输入电平范围保存后重新打开仍在', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill('带电平范围的元件');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill('IN');
  await page.getByLabel('引脚 1 类型').selectOption({ label: '输入' });
  await page.getByLabel('引脚 1 输入电平下限').fill('4.5');
  await page.getByLabel('引脚 1 输入电平上限').fill('5.5');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByText('用户元件「带电平范围的元件」已保存。')).toBeVisible();

  const library = await openLibrary(page);
  await library.getByRole('button', { name: '编辑元件 带电平范围的元件' }).click();
  await expect(page.getByLabel('引脚 1 输入电平下限')).toHaveValue('4.5');
  await expect(page.getByLabel('引脚 1 输入电平上限')).toHaveValue('5.5');
});

test('只填电平范围一边时拒绝保存并给出中文提示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();
  await page.getByLabel('元件名称').fill('半填电平元件');
  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByLabel('引脚 1 名称').fill('IN');
  await page.getByLabel('引脚 1 输入电平下限').fill('4.5');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByRole('alert')).toHaveText('IN 的电平范围必须同时填写下限和上限，否则视为未知。');
});

test('缺少名称或引脚未命名时拒绝保存并给出中文提示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建元件' }).click();

  await page.getByLabel('元件名称').fill('');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByRole('alert')).toHaveText('请输入元件名称。');

  await page.getByLabel('元件名称').fill('临时元件');
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByRole('alert')).toHaveText('元件至少需要一个引脚。');

  await page.getByRole('button', { name: '＋ 添加引脚' }).click();
  await page.getByRole('button', { name: '保存到用户元件库' }).click();
  await expect(page.getByRole('alert')).toHaveText('请为引脚 PIN1 填写名称。');

  await page.getByRole('button', { name: '删除引脚 PIN1' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog', { name: '元件编辑器' })).toHaveCount(0);
  const library = await openLibrary(page);
  await expect(library.getByRole('button', { name: '＋ 临时元件' })).toHaveCount(0);
  await library.getByRole('button', { name: '关闭' }).click();
});