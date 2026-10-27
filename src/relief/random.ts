// 固定种子：同样的输入每次生成同样的粒子，便于比较调整，也让存档恢复一致。
export function seededRandom(seed: number) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}
