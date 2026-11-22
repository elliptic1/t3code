export function voiceFabDestination(
  position: { x: number; y: number },
  velocity: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
) {
  // Project 220 ms of momentum; velocities are points per second, unlike PanResponder's ms.
  const projectedX = position.x + velocity.x * 0.22;
  const projectedY = position.y + velocity.y * 0.22;
  return {
    side: projectedX < (bounds.left + bounds.right) / 2 ? "left" : "right",
    vertical: projectedY < (bounds.top + bounds.bottom) / 2 ? "top" : "bottom",
  };
}
