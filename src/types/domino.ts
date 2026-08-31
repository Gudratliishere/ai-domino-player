export type PipValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Stone {
  id: string;
  a: PipValue;
  b: PipValue;
}

export function stoneId(a: PipValue, b: PipValue): string {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return `${lo}-${hi}`;
}

export function isDouble(stone: Stone): boolean {
  return stone.a === stone.b;
}

export function makeStone(a: PipValue, b: PipValue): Stone {
  return { id: stoneId(a, b), a, b };
}

/** Rebuilds a stone from its id. Ids are canonical (`lo-hi`), so this round-trips. */
export function stoneFromId(id: string): Stone {
  const [a, b] = id.split('-').map(Number) as [PipValue, PipValue];
  return { id, a, b };
}

/** Whether the stone with this id carries `value`. */
export function idHasValue(id: string, value: PipValue): boolean {
  const [a, b] = id.split('-').map(Number);
  return a === value || b === value;
}
