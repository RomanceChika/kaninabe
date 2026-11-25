/**
 * M6 循環参照チェック。
 *
 * norms / decisions は「この文書が従う上位」を指すキーであり、
 * 参照グラフは上へ辿れば必ず止まる(非巡回)ことが前提になっている。
 * 循環していると「規範の根拠」が自分自身に戻ってしまい、
 * 上に辿るという読み方(CLAUDE.md の作業の大原則 2)が成立しない。
 *
 * 強連結成分(相互に到達できる id の集まり)を求め、
 * サイズ 2 以上の成分と自己参照を報告する。
 * 成分ごとに 1 件だけ報告し、実際に辿れる巡回路を反例として添える。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import { referencesOf } from '../references.js';
import type { DocsModel, ScannedDoc } from '../../model/docs/types.js';

/** M6: norms / decisions の参照グラフに循環が無いことを検証する。 */
export const circularReferenceVerifier: DocVerifier = {
  id: 'M6',
  title: '循環参照 — norms / decisions のグラフが循環しない',

  verify(model: DocsModel): Finding[] {
    const owners = ownersById(model.docs);
    const edges = buildEdges(model.docs, owners);
    return stronglyConnected(edges)
      .filter((component) => isCyclic(component, edges))
      .map((component) => cycleFinding(component, edges, owners));
  },
};

/** id → その id を宣言する最初の文書。id 重複は M2 の担当なので、ここでは先頭を代表にする。 */
function ownersById(docs: readonly ScannedDoc[]): ReadonlyMap<string, ScannedDoc> {
  const owners = new Map<string, ScannedDoc>();
  for (const doc of docs) {
    if (doc.id !== null && !owners.has(doc.id)) owners.set(doc.id, doc);
  }
  return owners;
}

/** id → 参照先 id の隣接リスト。実在しない参照先(M3 の担当)は辺にしない。 */
function buildEdges(
  docs: readonly ScannedDoc[],
  owners: ReadonlyMap<string, ScannedDoc>,
): ReadonlyMap<string, readonly string[]> {
  const edges = new Map<string, readonly string[]>();
  for (const id of owners.keys()) edges.set(id, []);
  for (const doc of docs) {
    if (doc.id === null || owners.get(doc.id) !== doc) continue;
    edges.set(
      doc.id,
      referencesOf(doc)
        .map((ref) => ref.id)
        .filter((ref) => owners.has(ref)),
    );
  }
  return edges;
}

/** 成分が循環しているか(2 つ以上か、自己参照)。 */
function isCyclic(component: readonly string[], edges: ReadonlyMap<string, readonly string[]>): boolean {
  if (component.length > 1) return true;
  const only = component[0] ?? '';
  return (edges.get(only) ?? []).includes(only);
}

/** 強連結成分ごとの Finding を作る。 */
function cycleFinding(
  component: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
  owners: ReadonlyMap<string, ScannedDoc>,
): Finding {
  const sorted = [...component].sort();
  const start = sorted[0] ?? '';
  const path = findCycle(start, component, edges);
  const doc = owners.get(start);
  return docFinding('M6', {
    severity: 'warning',
    message: `参照が循環しています: ${path.join(' → ')}`,
    location: { file: doc?.file ?? start, pointer: 'norms' },
    suggestion:
      '循環している辺のうち 1 本を外す。上位(原則・アーキテクチャ)から下位(プロセス・仕様)へ一方向に流れるよう、' +
      '下位から上位への参照だけを norms / decisions に残す',
    counterexample: { cycle: path.join(' → '), members: sorted.join(', ') },
  });
}

/** 成分の中を辿って start に戻る巡回路を 1 本見つける。 */
function findCycle(
  start: string,
  component: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[] {
  const inComponent = new Set(component);
  const seen = new Set<string>();
  const path: string[] = [];

  const walk = (id: string): boolean => {
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      if (next === start) return true;
      if (!inComponent.has(next) || seen.has(next)) continue;
      seen.add(next);
      if (walk(next)) return true;
    }
    path.pop();
    return false;
  };

  return walk(start) ? [...path, start] : [start, start];
}

/**
 * Tarjan のアルゴリズムで強連結成分を求める。
 *
 * @param edges id → 参照先 id の隣接リスト
 * @returns 強連結成分の一覧(各成分は id の配列)
 */
function stronglyConnected(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let counter = 0;

  const visit = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of edges.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(next) ?? 0));
      }
    }

    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) break;
      onStack.delete(popped);
      component.push(popped);
      if (popped === id) break;
    }
    components.push(component);
  };

  for (const id of edges.keys()) {
    if (!index.has(id)) visit(id);
  }
  return components;
}
