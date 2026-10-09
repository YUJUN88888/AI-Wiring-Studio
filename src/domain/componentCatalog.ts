import type { ComponentCategory } from "./componentDefinition";
import type { ComponentInstance, Pin } from "./types";

/** A small, offline catalog used by the first ERC workflows.
 *
 * Values are deliberately sparse: unknown ratings and operating current are
 * omitted instead of being guessed. Factories always create a new instance so
 * a canvas edit cannot mutate the catalog or another placed component.
 */
export type BuiltInComponentKind =
  | "power-5v"
  | "ground"
  | "esp32-devkit-demo"
  | "resistor-220r"
  | "red-led"
  | "electrolytic-capacitor"
  | "regulator-3v3"
  | "resistor-1k"
  | "resistor-10k"
  | "ceramic-capacitor-100nf"
  | "push-button"
  | "diode-1n4148"
  | "regulator-5v"
  | "buzzer-active"
  | "oled-ssd1306-i2c"
  | "mpu6050-module"
  | "hc-sr04"
  | "dht11"
  | "sg90-servo"
  | "relay-module";

export type CanvasPosition = { x: number; y: number };
export interface BuiltInComponentDefinition {
  kind: BuiltInComponentKind;
  definitionId: string;
  displayName: string;
  /** 组件库列表中显示的短标签。 */
  label: string;
  /** 组件库中的分组依据，与用户元件共用同一套分类。 */
  category: ComponentCategory;
  create: (id: string, position: CanvasPosition) => ComponentInstance;
}

const pin = (id: string, name: string, role: Pin["role"], index: number, extra: Omit<Partial<Pin>, "id" | "name" | "role" | "localPosition"> = {}): Pin => ({
  id,
  name,
  role,
  localPosition: { x: 0, y: index },
  ...extra,
});

const instance = (id: string, definitionId: string, displayName: string, position: CanvasPosition, pins: Pin[], voltageTransforms?: ComponentInstance["voltageTransforms"]): ComponentInstance => ({
  id,
  definitionId,
  displayName,
  position: { ...position },
  rotation: 0,
  pins,
  ...(voltageTransforms ? { voltageTransforms } : {}),
});

export const builtInComponentCatalog: Record<BuiltInComponentKind, BuiltInComponentDefinition> = {
  "power-5v": {
    kind: "power-5v", definitionId: "builtin.power-5v", displayName: "USB 5V 电源", label: "USB 5V 电源", category: "power",
    create: (id, position) => instance(id, "builtin.power-5v", "USB 5V 电源", position, [
      pin("5V", "5V", "POWER_OUTPUT", 0, { outputVoltage: 5, driveMode: "none" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
    ]),
  },
  ground: {
    kind: "ground", definitionId: "builtin.ground", displayName: "地（GND）", label: "地（GND）", category: "ground",
    create: (id, position) => instance(id, "builtin.ground", "地（GND）", position, [
      pin("GND", "GND", "GND", 0, { driveMode: "none" }),
    ]),
  },
  "esp32-devkit-demo": {
    kind: "esp32-devkit-demo", definitionId: "builtin.esp32-devkit-demo", displayName: "ESP32 DevKit（演示）", label: "ESP32 DevKit（演示）", category: "mcu",
    create: (id, position) => instance(id, "builtin.esp32-devkit-demo", "ESP32 DevKit（演示）", position, [
      // This is a conservative demo board model, not a substitute for a board revision's datasheet.
      pin("3V3", "3V3", "POWER_INPUT", 0, { maxVoltage: 3.3, driveMode: "none" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
      pin("GPIO21", "GPIO21", "GPIO", 2, { maxVoltage: 3.3, driveMode: "unknown" }),
      pin("GPIO23", "GPIO23", "GPIO", 3, { maxVoltage: 3.3, driveMode: "unknown" }),
    ]),
  },
  "resistor-220r": {
    kind: "resistor-220r", definitionId: "builtin.resistor-220r", displayName: "R1 · 220 Ω", label: "220 Ω 电阻", category: "passive",
    create: (id, position) => instance(id, "builtin.resistor-220r", "R1 · 220 Ω", position, [
      pin("A", "A", "PASSIVE", 0, { driveMode: "none" }),
      pin("B", "B", "PASSIVE", 1, { driveMode: "none" }),
    ]),
  },
  "red-led": {
    kind: "red-led", definitionId: "builtin.red-led", displayName: "LED · 红色", label: "红色 LED", category: "diode",
    create: (id, position) => instance(id, "builtin.red-led", "LED · 红色", position, [
      pin("A", "阳极（+）", "PASSIVE", 0, { polarity: "positive", driveMode: "none" }),
      pin("K", "阴极（−）", "PASSIVE", 1, { polarity: "negative", driveMode: "none" }),
    ]),
  },
  "electrolytic-capacitor": {
    kind: "electrolytic-capacitor", definitionId: "builtin.electrolytic-capacitor", displayName: "电解电容", label: "电解电容", category: "capacitor",
    create: (id, position) => instance(id, "builtin.electrolytic-capacitor", "电解电容", position, [
      // No capacitance or voltage rating is assigned until the user selects a specific part.
      pin("+", "+", "PASSIVE", 0, { polarity: "positive", driveMode: "none" }),
      pin("-", "−", "PASSIVE", 1, { polarity: "negative", driveMode: "none" }),
    ]),
  },
  "regulator-3v3": {
    kind: "regulator-3v3", definitionId: "builtin.regulator-3v3", displayName: "3.3V 稳压器", label: "3.3V 稳压器", category: "regulator",
    create: (id, position) => instance(id, "builtin.regulator-3v3", "3.3V 稳压器", position, [
      pin("VIN", "VIN", "POWER_INPUT", 0, { driveMode: "none" }),
      // A generic regulator has no confirmed VIN range, so ERC must keep its output Unknown.
      pin("3V3", "3V3", "POWER_OUTPUT", 1, { driveMode: "none" }),
      pin("GND", "GND", "GND", 2, { driveMode: "none" }),
    ]),
  },
  "resistor-1k": {
    kind: "resistor-1k", definitionId: "builtin.resistor-1k", displayName: "R · 1 kΩ", label: "1 kΩ 电阻", category: "passive",
    create: (id, position) => instance(id, "builtin.resistor-1k", "R · 1 kΩ", position, [
      pin("A", "A", "PASSIVE", 0, { driveMode: "none" }),
      pin("B", "B", "PASSIVE", 1, { driveMode: "none" }),
    ]),
  },
  "resistor-10k": {
    kind: "resistor-10k", definitionId: "builtin.resistor-10k", displayName: "R · 10 kΩ", label: "10 kΩ 电阻", category: "passive",
    create: (id, position) => instance(id, "builtin.resistor-10k", "R · 10 kΩ", position, [
      pin("A", "A", "PASSIVE", 0, { driveMode: "none" }),
      pin("B", "B", "PASSIVE", 1, { driveMode: "none" }),
    ]),
  },
  "ceramic-capacitor-100nf": {
    kind: "ceramic-capacitor-100nf", definitionId: "builtin.ceramic-capacitor-100nf", displayName: "C · 100 nF", label: "100 nF 陶瓷电容", category: "capacitor",
    create: (id, position) => instance(id, "builtin.ceramic-capacitor-100nf", "C · 100 nF", position, [
      // 陶瓷电容无极性；具体耐压取决于选型，未选型前不虚构额定值。
      pin("A", "A", "PASSIVE", 0, { driveMode: "none" }),
      pin("B", "B", "PASSIVE", 1, { driveMode: "none" }),
    ]),
  },
  "push-button": {
    kind: "push-button", definitionId: "builtin.push-button", displayName: "按键开关", label: "按键开关", category: "switch",
    create: (id, position) => instance(id, "builtin.push-button", "按键开关", position, [
      // 轻触开关常为四脚两网：1/2 与 3/4 各自短接，这里按两个电学端点建模。
      pin("1", "1", "PASSIVE", 0, { driveMode: "none" }),
      pin("2", "2", "PASSIVE", 1, { driveMode: "none" }),
    ]),
  },
  "diode-1n4148": {
    kind: "diode-1n4148", definitionId: "builtin.diode-1n4148", displayName: "1N4148 二极管", label: "1N4148 二极管", category: "diode",
    create: (id, position) => instance(id, "builtin.diode-1n4148", "1N4148 二极管", position, [
      // 正向压降随电流与温度变化，未确认具体工作点前不写入额定值。
      pin("A", "阳极（+）", "PASSIVE", 0, { polarity: "positive", driveMode: "none" }),
      pin("K", "阴极（−）", "PASSIVE", 1, { polarity: "negative", driveMode: "none" }),
    ]),
  },
  "regulator-5v": {
    kind: "regulator-5v", definitionId: "builtin.regulator-5v", displayName: "5V 稳压器", label: "5V 稳压器", category: "regulator",
    create: (id, position) => instance(id, "builtin.regulator-5v", "5V 稳压器", position, [
      // 通用稳压器没有已确认的 VIN 范围，ERC 必须把输出保持为未知。
      pin("VIN", "VIN", "POWER_INPUT", 0, { driveMode: "none" }),
      pin("5V", "5V", "POWER_OUTPUT", 1, { driveMode: "none" }),
      pin("GND", "GND", "GND", 2, { driveMode: "none" }),
    ]),
  },
  "buzzer-active": {
    kind: "buzzer-active", definitionId: "builtin.buzzer-active", displayName: "有源蜂鸣器", label: "有源蜂鸣器", category: "other",
    create: (id, position) => instance(id, "builtin.buzzer-active", "有源蜂鸣器", position, [
      pin("+", "+", "PASSIVE", 0, { polarity: "positive", driveMode: "none" }),
      pin("-", "−", "PASSIVE", 1, { polarity: "negative", driveMode: "none" }),
    ]),
  },
  "oled-ssd1306-i2c": {
    kind: "oled-ssd1306-i2c", definitionId: "builtin.oled-ssd1306-i2c", displayName: '0.96" OLED（I2C）', label: "OLED 屏（I2C）", category: "other",
    create: (id, position) => instance(id, "builtin.oled-ssd1306-i2c", '0.96" OLED（I2C）', position, [
      // 模块供电范围随厂商不同（常见 3.3–5V），未选型前不写 maxVoltage。
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none", protocol: "I2C" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
      pin("SCL", "SCL", "INPUT", 2, { driveMode: "none", protocol: "I2C" }),
      pin("SDA", "SDA", "INPUT", 3, { driveMode: "unknown", protocol: "I2C" }),
    ]),
  },
  "mpu6050-module": {
    kind: "mpu6050-module", definitionId: "builtin.mpu6050-module", displayName: "MPU6050 六轴模块", label: "MPU6050 模块", category: "other",
    create: (id, position) => instance(id, "builtin.mpu6050-module", "MPU6050 六轴模块", position, [
      // 引脚按常见焊盘模块的丝印排列：主 I2C、辅助 I2C、地址选择与中断。
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
      pin("SCL", "SCL", "INPUT", 2, { driveMode: "none", protocol: "I2C" }),
      pin("SDA", "SDA", "INPUT", 3, { driveMode: "unknown", protocol: "I2C" }),
      pin("XDA", "XDA", "INPUT", 4, { driveMode: "unknown", protocol: "I2C" }),
      pin("XCL", "XCL", "INPUT", 5, { driveMode: "none", protocol: "I2C" }),
      pin("ADO", "ADO", "INPUT", 6, { driveMode: "none" }),
      pin("INT", "INT", "OUTPUT", 7, { driveMode: "unknown" }),
    ]),
  },
  "hc-sr04": {
    kind: "hc-sr04", definitionId: "builtin.hc-sr04", displayName: "HC-SR04 超声波", label: "HC-SR04 超声波", category: "other",
    create: (id, position) => instance(id, "builtin.hc-sr04", "HC-SR04 超声波", position, [
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none" }),
      pin("TRIG", "TRIG", "INPUT", 1, { driveMode: "none" }),
      // ECHO 为模块输出，其电平与驱动能力取决于供电，不猜测。
      pin("ECHO", "ECHO", "OUTPUT", 2, { driveMode: "unknown" }),
      pin("GND", "GND", "GND", 3, { driveMode: "none" }),
    ]),
  },
  dht11: {
    kind: "dht11", definitionId: "builtin.dht11", displayName: "DHT11 温湿度", label: "DHT11 温湿度", category: "other",
    create: (id, position) => instance(id, "builtin.dht11", "DHT11 温湿度", position, [
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none" }),
      // 单总线数据脚为双向，驱动方式未确认。
      pin("DATA", "DATA", "INPUT", 1, { driveMode: "unknown" }),
      pin("GND", "GND", "GND", 2, { driveMode: "none" }),
    ]),
  },
  "sg90-servo": {
    kind: "sg90-servo", definitionId: "builtin.sg90-servo", displayName: "SG90 舵机", label: "SG90 舵机", category: "other",
    create: (id, position) => instance(id, "builtin.sg90-servo", "SG90 舵机", position, [
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
      pin("PWM", "PWM", "INPUT", 2, { driveMode: "none" }),
    ]),
  },
  "relay-module": {
    kind: "relay-module", definitionId: "builtin.relay-module", displayName: "继电器模块", label: "继电器模块", category: "other",
    create: (id, position) => instance(id, "builtin.relay-module", "继电器模块", position, [
      // 只建模控制侧（VCC/GND/IN）；触点是干接点，不在电气网内，需按具体接线另说。
      pin("VCC", "VCC", "POWER_INPUT", 0, { driveMode: "none" }),
      pin("GND", "GND", "GND", 1, { driveMode: "none" }),
      pin("IN", "IN", "INPUT", 2, { driveMode: "none" }),
    ]),
  },
};

export function createBuiltInComponent(kind: BuiltInComponentKind, id: string, position: CanvasPosition): ComponentInstance {
  return builtInComponentCatalog[kind].create(id, position);
}

export const createPower5V = (id: string, position: CanvasPosition) => createBuiltInComponent("power-5v", id, position);
export const createGround = (id: string, position: CanvasPosition) => createBuiltInComponent("ground", id, position);
export const createEsp32DevKitDemo = (id: string, position: CanvasPosition) => createBuiltInComponent("esp32-devkit-demo", id, position);
export const createResistor220R = (id: string, position: CanvasPosition) => createBuiltInComponent("resistor-220r", id, position);
export const createRedLed = (id: string, position: CanvasPosition) => createBuiltInComponent("red-led", id, position);
export const createElectrolyticCapacitor = (id: string, position: CanvasPosition) => createBuiltInComponent("electrolytic-capacitor", id, position);
export const createRegulator3V3 = (id: string, position: CanvasPosition) => createBuiltInComponent("regulator-3v3", id, position);