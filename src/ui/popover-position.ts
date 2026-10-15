export interface Point { x: number; y: number }
export interface PopoverSize { width: number; height: number }

/** Place beside the pointer, prefer above, and keep a margin at every window edge. */
export function popoverPosition(pointer: Point, card: PopoverSize, viewport: PopoverSize): { left: number; top: number } {
  const margin = 12;
  const clamp = (value: number, max: number) => Math.max(margin, Math.min(value, Math.max(margin, max)));
  const above = pointer.y - card.height - margin;
  return {
    left: clamp(pointer.x + margin, viewport.width - card.width - margin),
    top: clamp(above >= margin ? above : pointer.y + margin, viewport.height - card.height - margin),
  };
}
