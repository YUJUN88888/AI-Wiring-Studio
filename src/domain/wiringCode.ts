import { builtInComponentCatalog, createBuiltInComponent, type BuiltInComponentKind } from "./componentCatalog";
import { instantiateFromDefinition, type ComponentDefinition } from "./componentDefinition";
import { addComponent, addWire, createProject } from "./project";
import type { ComponentInstance, Pin, PinRef, Project, Wire } from "./types";

/**
 * 接线代码（Wiring Code，DSL v1）。
 *
 * 用途：让**外部 AI** 按固定格式撰写整张接线图，再把代码导入软件，由本模块**确定性地**解析成
 * 元件实例与连线。这里不含任何模型调用：AI 只负责写文本，是否接受完全由这段代码判定。
 *
 * 铁律（与项目其余部分一致）：
 * - 导入只创建"画布实例 + 连线"，**绝不写入或污染可信元件库**；未知元件类型一律报错，绝不臆造定义。
 * - 外部文本先校验再使用；错误一律带**行号**与中文说明。
 * - 省略坐标时按声明顺序做**确定性**网格排布，同输入必得同输出。
 */

/** 默认线色，与画布上手工连线保持一致。 */
const DEFAULT_WIRE_COLOR = "#57d4ff";

/** 实例 ID 允许的字符：不允许含点，否则 `实例ID.引脚ID` 无法无歧义拆分。 */
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/**
 * 引脚 ID 只要求非空、不含点、不含空白；其余字符一律允许（如电解电容的 `+` / `-`），
 * 否则字典里列出的引脚反而写不进来，自相矛盾。
 */
const PIN_ID_PATTERN = /^[^.\s]+$/;
/** 元件类型标识允许的字符（内置 kind 或 builtin.* / user.* 定义 ID）。 */
const DEFINITION_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 省略坐标时的网格步长与起点。 */
const GRID_STEP_X = 220;
const GRID_STEP_Y = 180;
const GRID_ORIGIN_X = 80;
const GRID_ORIGIN_Y = 80;
const GRID_COLUMNS = 4;

export interface WiringCodeSummary {
  components: number;
  wires: number;
}

export type WiringCodeParseResult =
  | { status: "ok"; project: Project; summary: WiringCodeSummary }
  | { status: "error"; line: number; message: string };

export interface ParseWiringCodeOptions {
  /** 用户元件库中的定义（AI 导入/手工创建并经用户确认的那些）。 */
  definitions?: readonly ComponentDefinition[];
  /** 生成项目的 id / 名称，仅影响项目元数据。 */
  projectId?: string;
  projectName?: string;
  /**
   * 追加模式下由调用方给出的唯一前缀：同时作用于元件实例 ID 与连线 ID，
   * 使解析结果并入既有项目时不会与已有 ID 冲突。替换模式留空即可。
   */
  idPrefix?: string;
}

interface Token {
  value: string;
  quoted: boolean;
}

/** 按空白拆分一行；支持双引号包裹的整段文本（引号内不处理转义）。 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (char === "#" && (index + 1 >= line.length || line[index + 1] === " " || line[index + 1] === "\t")) {
      // 单独的 "#" 视为行尾注释起点（"#rrggbb" 这种颜色不是注释）。
      break;
    }
    if (char === '"') {
      const end = line.indexOf('"', index + 1);
      if (end === -1) throw new Error("双引号未闭合");
      tokens.push({ value: line.slice(index + 1, end), quoted: true });
      index = end + 1;
      continue;
    }
    let cursor = index;
    while (cursor < line.length && line[cursor] !== " " && line[cursor] !== "\t") cursor += 1;
    tokens.push({ value: line.slice(index, cursor), quoted: false });
    index = cursor;
  }
  return tokens;
}

function parsePosition(value: string | undefined): { x: number; y: number } {
  if (value === undefined) throw new Error("at 后面缺少坐标，应写成 at x,y");
  const parts = value.split(",");
  if (parts.length !== 2) throw new Error(`坐标格式应为 x,y，当前为“${value}”`);
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`坐标必须是数字，当前为“${value}”`);
  return { x, y };
}

function splitPinRef(raw: string): PinRef | null {
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const componentId = raw.slice(0, dot);
  const pinId = raw.slice(dot + 1);
  if (!INSTANCE_ID_PATTERN.test(componentId) || !PIN_ID_PATTERN.test(pinId)) return null;
  return { componentId, pinId };
}

/** 内置元件按 kind 或 definitionId 都能引用。 */
function findBuiltInKind(token: string): BuiltInComponentKind | undefined {
  // 用 hasOwnProperty 而非 `in`：`in` 会命中 Object.prototype（如 toString），
  // 让这些名字被误认为内置 kind，进而在取值时抛出内部错误。
  if (Object.prototype.hasOwnProperty.call(builtInComponentCatalog, token)) return token as BuiltInComponentKind;
  const match = Object.values(builtInComponentCatalog).find((definition) => definition.definitionId === token);
  return match?.kind;
}

/** 省略坐标时的确定性网格位置：按元件声明顺序排列。 */
function gridPosition(index: number): { x: number; y: number } {
  return {
    x: GRID_ORIGIN_X + (index % GRID_COLUMNS) * GRID_STEP_X,
    y: GRID_ORIGIN_Y + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y,
  };
}

/**
 * 解析接线代码。
 *
 * 语法（`#` 开头的整行是注释，空行忽略）：
 *   version 1
 *   component <实例ID> <元件类型> ["显示名"] [at x,y]
 *   wire <实例ID>.<引脚ID> <实例ID>.<引脚ID> [color #rrggbb]
 *
 * 元件类型可以是内置 kind（如 esp32-devkit-demo）、内置定义 ID（builtin.*）或用户元件定义 ID（user.*）。
 * 引脚一律使用引脚 ID（字典会逐条列出）。
 */
export function parseWiringCode(text: string, options: ParseWiringCodeOptions = {}): WiringCodeParseResult {
  const prefix = options.idPrefix ?? "";
  const definitions = options.definitions ?? [];
  const errors: { line: number; message: string }[] = [];

  interface Declaration {
    line: number;
    instanceId: string;
    kindToken: string;
    displayName?: string;
    position?: { x: number; y: number };
  }
  interface WireDeclaration {
    line: number;
    source: PinRef;
    target: PinRef;
    color: string;
  }

  const components: Declaration[] = [];
  const wires: WireDeclaration[] = [];
  const seenInstanceIds = new Map<string, number>();

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    let tokens: Token[];
    try {
      tokens = tokenize(raw);
    } catch (thrown) {
      errors.push({ line: lineNumber, message: thrown instanceof Error ? thrown.message : "无法解析该行" });
      continue;
    }
    if (tokens.length === 0) continue;

    const head = tokens[0].value;
    try {
      if (head === "version") {
        if (tokens.length !== 2 || tokens[1].value !== "1") throw new Error("只支持 version 1");
        continue;
      }
      if (head === "component") {
        if (tokens.length < 3) throw new Error("component 至少需要：实例ID 与 元件类型");
        const instanceId = tokens[1].value;
        const kindToken = tokens[2].value;
        if (!INSTANCE_ID_PATTERN.test(instanceId)) throw new Error(`实例 ID“${instanceId}”不合法：只能包含字母、数字、下划线、连字符，且不含点`);
        if (!DEFINITION_TOKEN_PATTERN.test(kindToken)) throw new Error(`元件类型“${kindToken}”不合法`);
        let displayName: string | undefined;
        let position: { x: number; y: number } | undefined;
        let cursor = 3;
        if (cursor < tokens.length && tokens[cursor].quoted) {
          displayName = tokens[cursor].value;
          cursor += 1;
        }
        while (cursor < tokens.length) {
          const keyword = tokens[cursor].value;
          if (keyword === "at") {
            position = parsePosition(tokens[cursor + 1]?.value);
            cursor += 2;
            continue;
          }
          throw new Error(`component 不认识的写法“${keyword}”，可用的有：显示名（双引号）、at x,y`);
        }
        const previous = seenInstanceIds.get(instanceId);
        if (previous !== undefined) throw new Error(`实例 ID 重复：“${instanceId}”（第 ${previous} 行已声明）`);
        seenInstanceIds.set(instanceId, lineNumber);
        components.push({ line: lineNumber, instanceId, kindToken, displayName, position });
        continue;
      }
      if (head === "wire") {
        if (tokens.length < 3) throw new Error("wire 至少需要：两个 实例ID.引脚ID");
        const source = splitPinRef(tokens[1].value);
        const target = splitPinRef(tokens[2].value);
        if (!source) throw new Error(`连线端点“${tokens[1].value}”不合法，应写成 实例ID.引脚ID`);
        if (!target) throw new Error(`连线端点“${tokens[2].value}”不合法，应写成 实例ID.引脚ID`);
        let color = DEFAULT_WIRE_COLOR;
        if (tokens.length > 3) {
          if (tokens.length !== 5 || tokens[3].value !== "color") throw new Error("wire 只支持可选后缀 color #rrggbb");
          if (!COLOR_PATTERN.test(tokens[4].value)) throw new Error(`颜色“${tokens[4].value}”不合法，应写成 #rrggbb`);
          color = tokens[4].value;
        }
        wires.push({ line: lineNumber, source, target, color });
        continue;
      }
      throw new Error(`不认识的指令“${head}”，只支持 version / component / wire`);
    } catch (thrown) {
      errors.push({ line: lineNumber, message: thrown instanceof Error ? thrown.message : "无法解析该行" });
    }
  }

  // 先把元件建出来，再建连线，因此连线可以写在元件前面。
  let project = createProject(options.projectId ?? "wiring-code", options.projectName ?? "接线代码导入");
  components.forEach((declaration, order) => {
    const kind = findBuiltInKind(declaration.kindToken);
    const definition = definitions.find((item) => item.id === declaration.kindToken);
    if (!kind && !definition) {
      errors.push({ line: declaration.line, message: `未知元件类型“${declaration.kindToken}”：既不是内置元件，也不在用户元件库中。可用类型见字典。` });
      return;
    }
    const instanceId = `${prefix}${declaration.instanceId}`;
    const position = declaration.position ?? gridPosition(order);
    let instance: ComponentInstance;
    try {
      instance = kind
        ? createBuiltInComponent(kind, instanceId, position)
        : instantiateFromDefinition(definition as ComponentDefinition, instanceId, position);
    } catch (thrown) {
      errors.push({ line: declaration.line, message: thrown instanceof Error ? thrown.message : "无法创建该元件" });
      return;
    }
    if (declaration.displayName !== undefined) instance = { ...instance, displayName: declaration.displayName };
    try {
      project = addComponent(project, instance);
    } catch (thrown) {
      errors.push({ line: declaration.line, message: thrown instanceof Error ? thrown.message : "无法加入该元件" });
    }
  });

  const hasPin = (ref: PinRef): boolean => {
    const instance = project.components.find((item) => item.id === ref.componentId);
    return instance !== undefined && instance.pins.some((pin) => pin.id === ref.pinId);
  };
  wires.forEach((declaration, order) => {
    const source: PinRef = { componentId: `${prefix}${declaration.source.componentId}`, pinId: declaration.source.pinId };
    const target: PinRef = { componentId: `${prefix}${declaration.target.componentId}`, pinId: declaration.target.pinId };
    for (const [side, ref] of [["起点", source], ["终点", target]] as const) {
      const instance = project.components.find((item) => item.id === ref.componentId);
      if (!instance) {
        errors.push({ line: declaration.line, message: `连线${side}引用了未声明的实例“${ref.componentId}”，请先声明对应 component` });
        return;
      }
      if (!hasPin(ref)) {
        const available = instance.pins.map((pin) => pin.id).join(" / ");
        errors.push({ line: declaration.line, message: `${instance.displayName} 没有引脚“${ref.pinId}”，可用引脚：${available}` });
        return;
      }
    }
    const wire: Wire = { id: `${prefix}w${order + 1}`, source, target, color: declaration.color };
    try {
      project = addWire(project, wire);
    } catch (thrown) {
      errors.push({ line: declaration.line, message: thrown instanceof Error ? thrown.message : "无法创建该连线" });
    }
  });

  if (errors.length > 0) {
    const first = [...errors].sort((a, b) => a.line - b.line)[0];
    return { status: "error", line: first.line, message: first.message };
  }
  if (components.length === 0 && wires.length === 0) {
    return { status: "error", line: 1, message: "没有可导入的内容：请至少写一行 component 或 wire" };
  }
  return { status: "ok", project, summary: { components: project.components.length, wires: project.wires.length } };
}

/** 接线代码里被引用、但当前元件库无法解析的元件类型。 */
export interface MissingComponentKind {
  /**
   * 代码里逐字使用的元件类型标识。
   * 补查后新写入的元件定义 id **必须与它逐字相同**，否则原代码重新导入仍会报"未知元件类型"。
   */
  token: string;
  /** 供模型参考的显示名：优先取代码里的显示名，没有则退回标识本身。 */
  displayName: string;
  /** 该元件类型出现在哪些 component 声明行。 */
  lines: number[];
  /** 该元件的实例在 wire 行里实际用到的引脚 ID（去重、按出现顺序）。 */
  referencedPins: string[];
}

/**
 * 扫描接线代码，找出"代码里用了、但元件库（内置 + 用户）解析不了"的元件类型。
 *
 * 这是确定性代码，不含任何模型调用：它只负责列出缺口，是否补查完全由用户决定。
 * 与 parseWiringCode 共用同一套 tokenizer 与内置类型判定，因此"扫描说缺"与"解析报错"必然一致。
 */
export function findMissingComponentKinds(
  text: string,
  definitions: readonly ComponentDefinition[] = [],
): MissingComponentKind[] {
  const known = new Set(definitions.map((definition) => definition.id));
  const lines = text.split(/\r?\n/);
  const order: string[] = [];
  const found = new Map<string, { displayName: string; lines: number[]; instanceIds: Set<string> }>();

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let tokens: Token[];
    try {
      tokens = tokenize(raw);
    } catch {
      continue;
    }
    if (tokens.length < 3 || tokens[0].value !== "component") continue;
    const instanceId = tokens[1].value;
    const token = tokens[2].value;
    if (findBuiltInKind(token) !== undefined || known.has(token)) continue;
    const displayName = tokens[3]?.quoted ? tokens[3].value : token;
    const entry = found.get(token);
    if (entry) {
      entry.lines.push(index + 1);
      entry.instanceIds.add(instanceId);
    } else {
      order.push(token);
      found.set(token, { displayName, lines: [index + 1], instanceIds: new Set([instanceId]) });
    }
  }
  if (order.length === 0) return [];

  const pins = new Map<string, string[]>(order.map((token) => [token, [] as string[]]));
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    let tokens: Token[];
    try {
      tokens = tokenize(raw);
    } catch {
      continue;
    }
    if (tokens.length < 3 || tokens[0].value !== "wire") continue;
    for (const rawRef of [tokens[1].value, tokens[2].value]) {
      const ref = splitPinRef(rawRef);
      if (!ref) continue;
      for (const token of order) {
        if (!found.get(token)?.instanceIds.has(ref.componentId)) continue;
        const list = pins.get(token) as string[];
        if (!list.includes(ref.pinId)) list.push(ref.pinId);
      }
    }
  }

  return order.map((token) => {
    const entry = found.get(token) as { displayName: string; lines: number[] };
    return { token, displayName: entry.displayName, lines: entry.lines, referencedPins: pins.get(token) ?? [] };
  });
}

/** 格式规范（字典的第一部分），可直接复制给外部 AI 阅读。 */
export const WIRING_CODE_SPEC = `## 接线代码格式（Wiring Code v1）

用纯文本逐行书写，\`#\` 开头的整行是注释，空行忽略（行尾注释写成 \`# 说明\`，注意 \`#\` 后有空格）。只有三条指令：

1. \`version 1\`            —— 可选，声明格式版本。
2. \`component <实例ID> <元件类型> ["显示名"] [at x,y]\`
3. \`wire <实例ID>.<引脚ID> <实例ID>.<引脚ID> [color #rrggbb]\`

规则：
- 实例 ID 由你自定，只能包含字母、数字、下划线、连字符，**不能含点**（点用于分隔实例与引脚）。
- 元件类型用下方"可用元件"里列出的标识（内置 kind，或 builtin.* / user.* 定义 ID）。
- 引脚一律写**引脚 ID**（见下方每个元件列出的引脚）。引脚名仅供人看，不要写进代码。
- 省略 \`at x,y\` 时软件会自动按声明顺序排布；建议给出坐标让图更像电路图。
- 省略 \`color\` 时使用默认线色；颜色必须是 \`#rrggbb\`。
- 先声明元件再写连线最稳妥；软件也允许连线写在元件前面。
- 不要臆造元件类型或引脚：写错会直接报错并指出行号，软件不会替你猜。

合法示例：
\`\`\`
version 1
component u1 esp32-devkit-demo "主控" at 120,80
component r1 resistor-220r "限流电阻" at 400,80
component d1 red-led "指示灯" at 620,80
wire u1.GPIO21 r1.A
wire r1.B d1.A color #e34b4b
\`\`\`

## ⭐ 字符规范（最常导致"软件读不出来"的原因，务必逐条遵守）

软件只认 **ASCII 半角字符**。中文输入法、网页复制、排版工具带进来的**全角符号、中文标点、箭头、框线、零宽字符**，都会让那一行直接报错。

允许与禁止：
- ✅ 只允许：半角字母 \`A-Z a-z\`、数字 \`0-9\`、半角符号 \`-\` \`_\` \`.\` \`,\` \`#\` \`"\`，以及**半角空格**（U+0020）。
- ❌ 引号外不得出现任何非 ASCII 字符：中文、全角字母数字、中文标点 \`，：；、（）。！？\`、引号 \`“”‘’\`、书名号 \`《》【】\`、全角空格 \`　\`。
- ❌ 不得出现箭头与数学符号：\`→\` \`←\` \`->\` \`=>\` \`≥\` \`＋\`（连线方向由参数顺序表示，不需要箭头）。
- ❌ 不得出现制表符 Tab、不间断空格 NBSP、零宽字符（从网页复制时最常见）。
- ✅ 中文只能出现在**半角双引号包裹的显示名**里，如 \`"主控"\`；引号内不得再出现 \`"\` 或换行。

硬性要求：
1. **分隔符只认一个半角空格**：不要用全角空格、Tab、逗号、顿号、冒号、斜杠分隔词。
2. **显示名必须用半角双引号 \`"\`**（U+0022），不能用 \`“ ”\`、\`「」\`、\`（ ）\`。
3. **每行必须以 \`version\` / \`component\` / \`wire\` / \`#\` 开头且顶格**：不要缩进，不要加列表符号（\`-\`、\`*\`、\`1.\`），不要把 Markdown 代码块的 \`\`\` 围栏一起抄进来。
4. **一行只写一条指令**，不要把两条写在同一行。
5. **引脚 ID 与元件类型标识逐字照抄本字典**，区分大小写，不翻译、不改写、不加空格（如 \`GPIO21\`、\`battery-2s-liion\`）。
6. **坐标**写 \`at 120,80\`：两个半角数字 + 一个半角逗号；不要写 \`at (120,80)\`、\`at 120，80\`、\`at 120 80\`、\`at x=120,y=80\`。
7. **颜色**写 \`color #rrggbb\`：\`#\` + 6 位半角十六进制；不要写颜色名或中文（\`red\`、\`红色\` 都不行）。
8. **注释**：整行注释以 \`#\` 开头；行尾注释必须写成 \` # 说明\`（\`#\` 前后都是空格）。\`#rrggbb\` 这种颜色不会被当成注释。
9. **不要自造字段名/标签**：写 \`component u1 esp32-devkit-demo\`，不要写 \`TYPE: esp32-devkit-demo\`、\`ID=u1\`。
10. **除 \`#\` 注释外不要输出任何说明文字、Markdown 表格或列表**，只允许上面三条指令。

常见"读不出来的字符"对照（左边一律被拒绝）：

| 错误写法（全角 / 中文标点 / 箭头） | 正确写法（半角） |
| --- | --- |
| \`component　u1　esp32-devkit-demo\`（全角空格分隔） | \`component u1 esp32-devkit-demo\` |
| \`wire u1.GND，r1.B\` | \`wire u1.GND r1.B\` |
| \`wire u1.GND：r1.B\` | \`wire u1.GND r1.B\` |
| \`wire u1.GND → r1.B\` | \`wire u1.GND r1.B\` |
| \`wire u1.GND -> r1.B\` | \`wire u1.GND r1.B\` |
| \`at 120，80\` | \`at 120,80\` |
| \`at (120,80)\` / \`at 120 80\` | \`at 120,80\` |
| \`component u1 esp32-devkit-demo “主控”\` | \`component u1 esp32-devkit-demo "主控"\` |
| \`component u1 esp32-devkit-demo（主控）\` | \`component u1 esp32-devkit-demo "主控"\` |
| \`- component u1 …\`（带列表符号或缩进） | \`component u1 …\`（顶格） |
| \`color 红\` / \`color red\` | \`color #e34b4b\` |
| \`component u1 ESP32-DEVKIT-DEMO\`（大小写不符） | \`component u1 esp32-devkit-demo\` |

输出前自检：
- [ ] 整份文本除双引号里的显示名外，是否**没有任何非 ASCII 字符**？
- [ ] 是否**没有全角空格 / Tab / 箭头 / 零宽字符**？
- [ ] 每行是否以 \`version\`、\`component\`、\`wire\` 或 \`#\` 开头且顶格？
- [ ] 用到的元件类型与引脚 ID 是否都**逐字**来自本字典？
- [ ] 每个 \`wire\` 提到的实例是否都已在 \`component\` 里声明？

可直接照抄的最小模板：

\`\`\`
version 1
# 元件：component 实例ID 元件类型 "显示名" at x,y
component u1 esp32-devkit-demo "主控" at 120,80
component g1 ground "地" at 120,300
# 连线：wire 实例.引脚 实例.引脚 [color #rrggbb]
wire u1.GND g1.GND color #57d4ff
\`\`\`

常见错误（都会被拒绝）：
- \`component 1u esp32-devkit-demo\`  —— 实例 ID 首字符任意但含点或空格不行。
- \`wire u1.21 r1.A\`                 —— 引脚要用引脚 ID（GPIO21），不是引脚序号。
- \`component u1 未知型号\`            —— 元件不在可用清单里。
- \`component u9 esp32-devkit-demo\` + \`wire u8.GND u9.GND\` —— u8 未声明。
`;

function describePins(pins: readonly Pin[]): string {
  if (pins.length === 0) return "  （无引脚）";
  return pins.map((pin) => `  - ${pin.id}（名称：${pin.name}；类型：${pin.role}）`).join("\n");
}

/**
 * 生成完整字典：格式规范 + 当前可用元件清单（内置元件 + 用户元件库）。
 * 用户把这段文字复制给自己的 AI，AI 就能知道有哪些元件、哪些引脚、以及怎样写才被接受。
 */
export function buildWiringCodeDictionary(definitions: readonly ComponentDefinition[] = []): string {
  const builtIns = Object.values(builtInComponentCatalog)
    .map((definition) => {
      const instance = definition.create("__dict__", { x: 0, y: 0 });
      return `- \`${definition.kind}\`（等价于 \`${definition.definitionId}\`）— ${definition.displayName}\n${describePins(instance.pins)}`;
    })
    .join("\n");

  const users = definitions.length === 0
    ? "（用户元件库为空：可先在软件里用「新建元件」或「AI 导入元件」创建并确认元件，再让 AI 在这里引用它们。）"
    : definitions
        .map((definition) => `- \`${definition.id}\` — ${definition.displayName}\n${describePins(definition.pins)}`)
        .join("\n");

  return `${WIRING_CODE_SPEC}
## 可用元件（内置）

${builtIns}

## 可用元件（用户元件库）

${users}
`;
}