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

    export class Clipper {
        static CleanPolygons(polys: Paths, distance?: number): void;
    }

    export class ClipperOffset {
        constructor(miterLimit?: number, roundPrecision?: number);
        AddPath(path: Path, joinType: JoinType, endType: EndType): void;
        AddPaths(paths: Paths, joinType: JoinType, endType: EndType): void;
        Execute(solution: Paths, delta: number): void;
        Clear(): void;
    }
}
