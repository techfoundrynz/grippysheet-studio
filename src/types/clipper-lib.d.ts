declare module 'clipper-lib' {
    export class IntPoint {
        X: number;
        Y: number;
        constructor(x: number, y: number);
    }
    export class Path extends Array<IntPoint> { }
    export class Paths extends Array<Path> { }

    export enum JoinType {
        jtSquare = 0,
        jtRound = 1,
        jtMiter = 2
    }

    export enum EndType {
        etClosedPolygon = 0,
        etClosedLine = 1,
        etOpenSquare = 2,
        etOpenRound = 3,
        etOpenButt = 4
    }

    export enum ClipType {
        ctIntersection = 0,
        ctUnion = 1,
        ctDifference = 2,
        ctXor = 3
    }

    export enum PolyType {
        ptSubject = 0,
        ptClip = 1
    }

    export enum PolyFillType {
        pftEvenOdd = 0,
        pftNonZero = 1,
        pftPositive = 2,
        pftNegative = 3
    }

    export class PolyNode {
        Contour(): Path;
        Childs(): PolyNode[];
        Parent(): PolyNode | null;
        IsHole(): boolean;
    }

    export class PolyTree extends PolyNode {
        Total(): number;
        Clear(): void;
    }

    export class Clipper {
        static CleanPolygons(polys: Paths, distance?: number): void;
        AddPath(path: Path, polyType: PolyType, closed: boolean): boolean;
        AddPaths(paths: Paths, polyType: PolyType, closed: boolean): boolean;
        Execute(
            clipType: ClipType,
            solution: Paths | PolyTree,
            subjFillType: PolyFillType,
            clipFillType: PolyFillType,
        ): boolean;
    }

    export class ClipperOffset {
        constructor(miterLimit?: number, roundPrecision?: number);
        AddPath(path: Path, joinType: JoinType, endType: EndType): void;
        AddPaths(paths: Paths, joinType: JoinType, endType: EndType): void;
        Execute(solution: Paths, delta: number): void;
        Clear(): void;
    }
}
