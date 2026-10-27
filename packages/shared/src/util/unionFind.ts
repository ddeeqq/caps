/**
 * 직렬화 가능한 유니온 파인드. 상태는 parent 레코드 하나라 게임 상태에 그대로 둘 수 있다.
 * 소리 짝꿍에서 "팀원 아무나 한 명의 QR만 찍어도 연결"을 판단하는 데 쓴다.
 */
export type UnionFindState = Record<string, string>;

export function ufFind(parent: UnionFindState, x: string): string {
  let root = x;
  while (parent[root] !== undefined && parent[root] !== root) root = parent[root] as string;
  // 경로 압축
  let cur = x;
  while (parent[cur] !== undefined && parent[cur] !== root) {
    const nextNode = parent[cur] as string;
    parent[cur] = root;
    cur = nextNode;
  }
  return root;
}

/** 두 원소를 합친다. 이미 같은 집합이면 false. */
export function ufUnion(parent: UnionFindState, a: string, b: string): boolean {
  const ra = ufFind(parent, a);
  const rb = ufFind(parent, b);
  if (ra === rb) return false;
  // 사전순으로 작은 쪽을 루트로 (결정적 결과)
  if (ra < rb) parent[rb] = ra;
  else parent[ra] = rb;
  return true;
}

/** members 중 가장 큰 연결 집합의 크기 */
export function ufLargestGroup(parent: UnionFindState, members: readonly string[]): number {
  const counts = new Map<string, number>();
  let best = 0;
  for (const m of members) {
    const r = ufFind(parent, m);
    const c = (counts.get(r) ?? 0) + 1;
    counts.set(r, c);
    if (c > best) best = c;
  }
  return best;
}

export function ufAllConnected(parent: UnionFindState, members: readonly string[]): boolean {
  if (members.length <= 1) return true;
  const root = ufFind(parent, members[0] as string);
  return members.every((m) => ufFind(parent, m) === root);
}
