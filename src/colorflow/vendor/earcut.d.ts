export default function earcut(
  data: ArrayLike<number>,
  holeIndices?: number[] | null,
  dim?: number,
): number[];

export function area(data: ArrayLike<number>, holeIndices?: number[] | null, dim?: number): number;
export function deviation(
  data: ArrayLike<number>,
  holeIndices: number[] | null,
  dim: number,
  triangles: ArrayLike<number>,
): number;
export function flatten(coords: number[][][]): {
  vertices: number[];
  holes: number[];
  dimensions: number;
};
