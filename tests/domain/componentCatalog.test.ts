import { describe, expect, it } from "vitest";
import {
  addComponent,
  addWire,
  buildElectricalNets,
  createBuiltInComponent,
  createElectrolyticCapacitor,
  createEsp32DevKitDemo,
  createPower5V,
  createRegulator3V3,
  createProject,
  runErc,
} from "../../src/domain";

describe("built-in component catalog", () => {
  it("creates independent instances", () => {
    const first = createBuiltInComponent("resistor-220r", "r1", { x: 1, y: 2 });
    const second = createBuiltInComponent("resistor-220r", "r2", { x: 3, y: 4 });
    first.pins[0].name = "changed";
    first.position.x = 99;
    expect(second).toMatchObject({ id: "r2", position: { x: 3, y: 4 } });
    expect(second.pins[0].name).toBe("A");
  });

  it("models confirmed 5V and ESP32 GPIO voltage limits", () => {
    const supply = createPower5V("power", { x: 0, y: 0 });
    const esp32 = createEsp32DevKitDemo("esp", { x: 0, y: 0 });
    expect(supply.pins.find((part) => part.id === "5V")).toMatchObject({ role: "POWER_OUTPUT", outputVoltage: 5 });
    const gpioPins = esp32.pins.filter((part) => part.role === "GPIO");
    expect(gpioPins).not.toHaveLength(0);
    expect(gpioPins.every((part) => part.maxVoltage === 3.3)).toBe(true);
  });

  it("marks electrolytic terminals as polarized without inventing a voltage rating", () => {
    const capacitor = createElectrolyticCapacitor("c1", { x: 0, y: 0 });
    expect(capacitor.pins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "+", polarity: "positive" }),
      expect.objectContaining({ id: "-", polarity: "negative" }),
    ]));
    expect(capacitor.pins.some((part) => part.maxVoltage !== undefined)).toBe(false);
  });

  it("keeps a generic 3.3V regulator output unknown until a specific part model supplies a VIN range", () => {
    const regulator = createRegulator3V3("u1", { x: 0, y: 0 });
    expect(regulator.voltageTransforms).toBeUndefined();
    expect(regulator.pins.find((part) => part.id === "3V3")?.outputVoltage).toBeUndefined();
  });

  it("feeds the ERC with power net metadata but never claims generic regulator output voltage", () => {
    let project = createProject("catalog-erc");
    const power = createPower5V("power", { x: 0, y: 0 });
    const regulator = createRegulator3V3("reg", { x: 0, y: 0 });
    const esp = createEsp32DevKitDemo("esp", { x: 0, y: 0 });
    project = addComponent(project, power); project = addComponent(project, regulator); project = addComponent(project, esp);
    project = addWire(project, { id: "vin", source: { componentId: "power", pinId: "5V" }, target: { componentId: "reg", pinId: "VIN" }, color: "#f00" });
    project = addWire(project, { id: "vout", source: { componentId: "reg", pinId: "3V3" }, target: { componentId: "esp", pinId: "3V3" }, color: "#f00" });
    expect(buildElectricalNets(project).map((net) => net.kind)).toContain("POWER");
    expect(Object.values(runErc(project).voltages)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "Unknown" })]));
  });
});
