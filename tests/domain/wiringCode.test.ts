import { describe, expect, it } from "vitest";
import { buildWiringCodeDictionary, createEmptyDefinition, findMissingComponentKinds, parseWiringCode, type ComponentDefinition } from "../../src/domain";

/** 一个已验证过的用户元件，用来验证接线代码可以引用用户元件库里的定义。 */
const userDefinition: ComponentDefinition = {
  ...createEmptyDefinition("user.co2", "CO2 模块"),
  pins: [
    { id: "VCC", name: "VCC", role: "POWER_INPUT", localPosition: { x: 0, y: 0 } },
    { id: "GND", name: "GND", role: "GND", localPosition: { x: 0, y: 40 } },
    { id: "SCL", name: "SCL", role: "GPIO", localPosition: { x: 180, y: 0 } },
  ],
};

const definitions = [userDefinition];

const expectOk = (text: string, options: Parameters<typeof parseWiringCode>[1] = {}) => {
  const result = parseWiringCode(text, options);
  if (result.status !== "ok") throw new Error(`预期解析成功，实际报错（第 ${result.line} 行）：${result.message}`);
  return result;
};

const expectError = (text: string, options: Parameters<typeof parseWiringCode>[1] = {}) => {
  const result = parseWiringCode(text, options);
  if (result.status !== "error") throw new Error("预期解析失败，实际却成功了");
  return result;
};

describe("接线代码解析", () => {
  it("解析内置元件与连线，忽略注释和空行", () => {
    const result = expectOk(`# 一段示例
version 1

component u1 esp32-devkit-demo "主控" at 120,80
component r1 resistor-220r at 400,80   # 行尾说明
component d1 red-led
wire u1.GPIO21 r1.A
wire r1.B d1.A color #e34b4b
`);
    expect(result.summary).toEqual({ components: 3, wires: 2 });
    expect(result.project.components.map((item) => item.id)).toEqual(["u1", "r1", "d1"]);
    // 显示名覆盖默认名；其余保留目录里的默认名。
    expect(result.project.components[0].displayName).toBe("主控");
    expect(result.project.components[1].displayName).toBe("R1 · 220 Ω");
    expect(result.project.wires[0].source).toEqual({ componentId: "u1", pinId: "GPIO21" });
    expect(result.project.wires[0].target).toEqual({ componentId: "r1", pinId: "A" });
    expect(result.project.wires[1].color).toBe("#e34b4b");
    // 未给坐标的元件按声明顺序落位。
    expect(result.project.components[2].position).toEqual({ x: 520, y: 80 });
  });

  it("省略坐标时按声明顺序确定性网格排布，同输入必得同输出", () => {
    const text = ["component a power-5v", "component b ground", "component c red-led", "component d regulator-3v3", "component e esp32-devkit-demo"].join("\n");
    const first = expectOk(text);
    const second = expectOk(text);
    expect(first.project.components.map((item) => item.position)).toEqual([
      { x: 80, y: 80 },
      { x: 300, y: 80 },
      { x: 520, y: 80 },
      { x: 740, y: 80 },
      { x: 80, y: 260 },
    ]);
    expect(first.project.components).toEqual(second.project.components);
  });

  it("可以引用用户元件库里的定义（user.*）", () => {
    const result = expectOk(`component co2 user.co2 "空气模块"
component u1 esp32-devkit-demo
wire co2.SCL u1.GPIO21
wire co2.VCC u1.3V3
wire co2.GND u1.GND
`, { definitions });
    expect(result.summary).toEqual({ components: 2, wires: 3 });
    expect(result.project.components[0].displayName).toBe("空气模块");
    expect(result.project.components[0].definitionId).toBe("user.co2");
    expect(result.project.components[0].pins.map((pin) => pin.id)).toEqual(["VCC", "GND", "SCL"]);
  });

  it("未知元件类型报错并指出行号", () => {
    const result = expectError("component u1 esp32-devkit-demo\ncomponent u2 mystery-chip\n");
    expect(result.line).toBe(2);
    expect(result.message).toContain("未知元件类型");
    expect(result.message).toContain("mystery-chip");
  });

  it("元件类型含非法字符时报错", () => {
    expect(expectError("component u1 神秘芯片\n").message).toContain("元件类型");
  });

  it("原型链上的名字（toString 等）不被当作内置元件类型", () => {
    const result = expectError("component u1 toString\n");
    expect(result.line).toBe(1);
    expect(result.message).toContain("未知元件类型");
    expect(result.message).toContain("toString");
    expect(expectError("component u1 hasOwnProperty\n").message).toContain("未知元件类型");
    expect(expectError("component u1 valueOf\n").message).toContain("未知元件类型");
  });

  it("字典里导出的特殊引脚 ID（如电解电容的 + / -）能正常写进连线", () => {
    const result = expectOk("component c1 electrolytic-capacitor\ncomponent g1 ground\nwire c1.+ g1.GND\nwire c1.- g1.GND\n");
    expect(result.summary).toEqual({ components: 2, wires: 2 });
    expect(result.project.wires[0].source).toEqual({ componentId: "c1", pinId: "+" });
    expect(result.project.wires[1].source).toEqual({ componentId: "c1", pinId: "-" });
  });

  it("未知引脚报错并列出可用引脚", () => {
    const result = expectError("component u1 esp32-devkit-demo\nwire u1.21 u1.GND\n");
    expect(result.line).toBe(2);
    expect(result.message).toContain("没有引脚“21”");
    expect(result.message).toContain("GPIO21");
  });

  it("引用未声明的实例报错", () => {
    const result = expectError("component u1 esp32-devkit-demo\nwire u1.GND u9.GND\n");
    expect(result.line).toBe(2);
    expect(result.message).toContain("未声明的实例");
  });

  it("重复实例 ID、自环与重复连线都会被拒绝", () => {
    expect(expectError("component u1 power-5v\ncomponent u1 ground\n").message).toContain("实例 ID 重复");
    expect(expectError("component u1 power-5v\nwire u1.5V u1.5V\n").message).toContain("自身");
    expect(expectError("component a power-5v\ncomponent b ground\nwire a.GND b.GND\nwire b.GND a.GND\n").message).toContain("已存在");
  });

  it("语法错误给出中文说明与行号", () => {
    expect(expectError("component u1\n").message).toContain("至少需要");
    expect(expectError("component u1.u2 power-5v\n").message).toContain("实例 ID");
    expect(expectError("component u1 power-5v at 1\n").message).toContain("坐标");
    expect(expectError("component u1 power-5v\nwire u1.GND u1.GND color #zzz\n").message).toContain("颜色");
    expect(expectError("connect u1 power-5v\n").message).toContain("不认识的指令");
    expect(expectError("").message).toContain("没有可导入的内容");
  });

  it("追加模式的 idPrefix 同时作用于元件与连线，避免并入既有项目时冲突", () => {
    const result = expectOk("component u1 power-5v\ncomponent g1 ground\nwire u1.GND g1.GND\n", { idPrefix: "seed-" });
    expect(result.project.components.map((item) => item.id)).toEqual(["seed-u1", "seed-g1"]);
    expect(result.project.wires[0].id).toBe("seed-w1");
    expect(result.project.wires[0].source).toEqual({ componentId: "seed-u1", pinId: "GND" });
    expect(result.project.wires[0].target).toEqual({ componentId: "seed-g1", pinId: "GND" });
  });

  it("字典包含格式规范、内置元件引脚与用户元件引脚", () => {
    const dictionary = buildWiringCodeDictionary(definitions);
    expect(dictionary).toContain("接线代码格式");
    expect(dictionary).toContain("esp32-devkit-demo");
    expect(dictionary).toContain("GPIO21");
    expect(dictionary).toContain("resistor-220r");
    expect(dictionary).toContain("user.co2");
    expect(dictionary).toContain("SCL");
    // 字符规范必须随字典一起导出：外部 AI 最常见的问题就是带进全角/中文标点。
    expect(dictionary).toContain("字符规范");
    expect(dictionary).toContain("半角空格");
    expect(dictionary).toContain("全角空格");
    expect(dictionary).toContain("可直接照抄的最小模板");
    expect(buildWiringCodeDictionary()).toContain("用户元件库为空");
  });

  it("全角字符与中文标点一律被拒绝（与字典里的字符规范一致）", () => {
    // 全角空格当分隔符 → 整行认不出指令
    expect(expectError("component　u1　esp32-devkit-demo\n").message).toContain("不认识的指令");
    // 中文逗号分隔端点 → 只剩一个 token
    expect(expectError("component u1 esp32-devkit-demo\ncomponent g1 ground\nwire u1.GND，g1.GND\n").message)
      .toContain("wire 至少需要");
    // 中文括号顶替显示名引号 → 元件类型不合法
    expect(expectError("component u1 esp32-devkit-demo（主控）\n").message).toContain("元件类型");
    // 全角逗号坐标
    expect(expectError("component u1 esp32-devkit-demo at 120，80\n").message).toContain("坐标");
    // 箭头代替参数顺序
    expect(expectError("component u1 esp32-devkit-demo\ncomponent g1 ground\nwire u1.GND→g1.GND\n").message)
      .toContain("wire 至少需要");
  });
});

describe("扫描接线代码里未收录的元件类型", () => {
  it("与解析判定一致：能解析的类型一律不算缺失", () => {
    const text = "component u1 esp32-devkit-demo\ncomponent c1 user.co2\nwire u1.GPIO21 c1.SCL\n";
    expect(findMissingComponentKinds(text, definitions)).toEqual([]);
  });

  it("列出缺失类型、显示名、行号与被引用的引脚 ID", () => {
    const text = [
      "component bat battery-2s-liion \"2S 锂电池组\"",
      "component bms bms-2s-20a",
      "wire bat.B+ bms.P+",
      "wire bat.B- bms.P-",
      "wire bat.B+ bms.B+", // 重复引用同一个引脚，不应重复计入
    ].join("\n");
    const missing = findMissingComponentKinds(text, definitions);
    expect(missing.map((item) => item.token)).toEqual(["battery-2s-liion", "bms-2s-20a"]);
    expect(missing[0]).toEqual({
      token: "battery-2s-liion",
      displayName: "2S 锂电池组",
      lines: [1],
      referencedPins: ["B+", "B-"],
    });
    // 没有显示名时退回标识本身；`+`/`-` 这类引脚 ID 必须原样保留。
    expect(missing[1].displayName).toBe("bms-2s-20a");
    expect(missing[1].referencedPins).toEqual(["P+", "P-", "B+"]);
  });

  it("同一类型被多次声明时合并为一条，并保留全部行号", () => {
    const text = "component a resistor-10r\ncomponent b resistor-10r\nwire a.A b.B\n";
    expect(findMissingComponentKinds(text, definitions)).toEqual([
      { token: "resistor-10r", displayName: "resistor-10r", lines: [1, 2], referencedPins: ["A", "B"] },
    ]);
  });

  it("未引用任何引脚的缺失元件返回空引脚清单，且不会误报内置元件", () => {
    const missing = findMissingComponentKinds("component x max98357-amp\ncomponent y red-led\n", definitions);
    expect(missing).toEqual([{ token: "max98357-amp", displayName: "max98357-amp", lines: [1], referencedPins: [] }]);
  });
});