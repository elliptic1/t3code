import { expect, it } from "vite-plus/test";
import { voiceFabDestination } from "./voiceFabPhysics";

it.each([
  [
    { x: 30, y: 80 },
    { x: 0, y: 0 },
    { side: "left", vertical: "top" },
  ],
  [
    { x: 270, y: 550 },
    { x: 0, y: 0 },
    { side: "right", vertical: "bottom" },
  ],
  [
    { x: 30, y: 550 },
    { x: 1500, y: -1800 },
    { side: "right", vertical: "top" },
  ],
  [
    { x: 270, y: 80 },
    { x: -1500, y: 1800 },
    { side: "left", vertical: "bottom" },
  ],
  [
    { x: 30, y: 550 },
    { x: 100, y: -100 },
    { side: "left", vertical: "bottom" },
  ],
])("docks position %j with velocity %j at %j", (position, velocity, expected) => {
  expect(
    voiceFabDestination(position, velocity, { left: 16, right: 300, top: 40, bottom: 600 }),
  ).toEqual(expected);
});
