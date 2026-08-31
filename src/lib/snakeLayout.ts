export interface SnakePosition {
  row: number;
  col: number;
  vertical: boolean;
  direction: 1 | -1;
}

/**
 * Lays chain tiles out in a boustrophedon (back-and-forth) path so a long
 * chain wraps within a fixed-width table instead of overflowing.
 * Every (rowLen+1)-th tile is a "corner" — rotated to bridge the row above
 * to the row below at a shared column, like the old Nokia Snake turning.
 */
export function computeSnakePosition(index: number, rowLen: number): SnakePosition {
  const group = rowLen + 1;
  const groupIndex = Math.floor(index / group);
  const posInGroup = index % group;
  const direction: 1 | -1 = groupIndex % 2 === 0 ? 1 : -1;
  const baseRow = groupIndex * 2;

  if (posInGroup < rowLen) {
    const col = direction === 1 ? posInGroup : rowLen - 1 - posInGroup;
    return { row: baseRow, col, vertical: false, direction };
  }

  const col = direction === 1 ? rowLen - 1 : 0;
  return { row: baseRow + 1, col, vertical: true, direction };
}
