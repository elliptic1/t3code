import { expect, it } from "vite-plus/test";
import { voiceFabDestination } from "./voiceFabPhysics";

it.each([
  [
    { x: 16, y: 40 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
  [
    { x: 158, y: 320 },
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
  ],
  [
    { x: 87, y: 180 },
    { x: 0, y: 0 },
    { x: 0.25, y: 0.25 },
  ],
  [
    { x: 30, y: 300 },
    { x: 1500, y: -1800 },
    { x: 1, y: 0 },
  ],
  [
    { x: 100, y: 300 },
    { x: 100, y: -100 },
    { x: 0.375, y: 0.425 },
  ],
])("rests position %j with velocity %j at %j", (position, velocity, expected) => {
  const result = voiceFabDestination(position, velocity, {
    left: 16,
    right: 300,
    top: 40,
    bottom: 600,
  });
  expect(result.x).toBeCloseTo(expected.x, 2);
  expect(result.y).toBeCloseTo(expected.y, 2);
});
