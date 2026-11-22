export function voiceFabDestination(
  position: { x: number; y: number },
  velocity: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  // Project 220 ms of momentum; velocities are points per second, unlike PanResponder's ms.
  // Returned as fractions of the bounds so the spot survives keyboard and rotation changes.
  return {
    x: fraction(position.x + velocity.x * 0.22, bounds.left, bounds.right),
    y: fraction(position.y + velocity.y * 0.22, bounds.top, bounds.bottom),
  };
}

function fraction(value: number, min: number, max: number) {
  if (max <= min) return 1;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
