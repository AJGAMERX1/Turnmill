declare module "cdt2d" {
  export default function triangulate(
    vertices: number[][],
    constraints: number[][],
    options: { exterior: boolean },
  ): number[][];
}
