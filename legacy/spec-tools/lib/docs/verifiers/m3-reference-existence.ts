/**
 * M3 参照実在チェック + 規範逆流検査。
 *
 * reference_policy.md の前提「参照はパスではなく id で書く」が成り立つには、
 * norms / decisions に並ぶ id が実在する文書の id でなければならない。
 * 実在しない id は「規範に従っているつもりで何にも従っていない」状態であり、
 * 参照グラフ(M6・生成物・AI の読み進め)を静かに壊す。
 *
 * 参照先の母集団は走査した全文書(docs/rules + docs/specs)の id。
 * 仕様文書の norms も「上位の正典へ辿れること」が価値なので同じ検査にかける。
 * 一方、仕様の中で使われる ID(ドメインイベント ID・不変条件 ID・テストケース ID)は
 * フロントマターの参照キーではなく仕様の中身であり、V 群・A 群・Q 群が別途突合する。
 *
 * **規範逆流検査(2026-09-04 実装)。** reference_policy.md「参照の可否」表は、
 * meta / principle / architecture が process / spec を参照してはならず、
 * domain も process を参照してはならないと定める(上位の層が下位の手順・仕様に
 * 依存すると、手順や仕様を変えるたびに上位の規範を直す羽目になり、規範が
 * 規範でなくなる)。実在判定だけでは、id の綴りが合っていれば逆流参照も通って
 * しまうため、参照先の id が属する層(バケット)まで見て検査する。
 *
 * バケットは物理配置(ファイルパスの先頭)で決める。`directory_guide` は
 * 全層に存在し doc_type だけでは層を特定できないため、doc_type ではなく
 * パスで判定する(reference_policy の行・列そのものが物理層の名前でもある)。
 * docs/rules・docs/knowledge・docs/specs のいずれにも属さない文書(テスト用の
 * 仮想パス等)は判定対象外とし、既存の実在チェックにのみ従う。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import { referencesOf } from '../references.js';
import type { DocsModel, ScannedDoc } from '../../model/docs/types.js';
import type { ProductRoots } from '../../model/product/types.js';

/** reference_policy.md の行・列に対応する物理層。 */
type Bucket = 'meta' | 'principle' | 'domain' | 'architecture' | 'process' | 'decision' | 'spec';

/** ファイルパスの先頭からバケットを判定する。判定できなければ null(検査対象外)。 */
function bucketOf(file: string, roots: ProductRoots): Bucket | null {
  if (file.startsWith('docs/rules/meta/')) return 'meta';
  if (file.startsWith('docs/rules/principles/')) return 'principle';
  if (file.startsWith('docs/rules/architecture/')) return 'architecture';
  if (file.startsWith('docs/rules/process/')) return 'process';
  if (file.startsWith('docs/rules/decisions/')) return 'decision';
  const knowledge = roots.knowledge;
  if (knowledge !== null && file.startsWith(`${knowledge}/`)) return 'domain';
  if (file.startsWith(`${roots.specs}/`)) return 'spec';
  return null;
}

/**
 * 逆流(不可)と判定するバケットの組。reference_policy.md「参照の可否」表の
 * 「不可」セルだけを列挙する(可・推奨のセルは何もしない)。
 */
const FORBIDDEN_DIRECTIONS: ReadonlySet<string> = new Set([
  'meta->process',
  'meta->spec',
  'principle->process',
  'principle->spec',
  'domain->process',
  'architecture->process',
  'architecture->spec',
]);

/** M3: norms / decisions の参照先 id が実在し、参照の向きが逆流していないことを検証する。 */
export const referenceExistenceVerifier: DocVerifier = {
  id: 'M3',
  title: '参照実在 — norms / decisions が指す id の文書があり、向きが逆流していない',

  verify(model: DocsModel): Finding[] {
    const known = new Set(model.docs.map((doc) => doc.id).filter((id): id is string => id !== null));
    const bucketById = new Map<string, Bucket>();
    for (const doc of model.docs) {
      if (doc.id === null) continue;
      const bucket = bucketOf(doc.file, model.roots);
      if (bucket !== null) bucketById.set(doc.id, bucket);
    }
    return model.docs.flatMap((doc) => checkDoc(doc, known, bucketById, model.roots));
  },
};

/** 1 文書の参照先を検査する。 */
function checkDoc(
  doc: ScannedDoc,
  known: ReadonlySet<string>,
  bucketById: ReadonlyMap<string, Bucket>,
  roots: ProductRoots,
): Finding[] {
  const findings: Finding[] = [];
  const sourceBucket = bucketOf(doc.file, roots);
  for (const ref of referencesOf(doc)) {
    if (!known.has(ref.id)) {
      findings.push(
        docFinding('M3', {
          message: `${ref.key} が参照する ${ref.id} の文書がありません`,
          location: { file: doc.file, pointer: `${ref.key}.${ref.id}` },
          suggestion: `id の綴りを確認するか、参照先の文書を作る。参照先が廃止済みなら ${ref.key} から外す(id_policy: 廃番は再利用しない)`,
          counterexample: { key: ref.key, id: ref.id },
        }),
      );
      continue;
    }
    if (sourceBucket === null) continue;
    const targetBucket = bucketById.get(ref.id);
    if (targetBucket === undefined) continue;
    if (!FORBIDDEN_DIRECTIONS.has(`${sourceBucket}->${targetBucket}`)) continue;
    findings.push(
      docFinding('M3', {
        message: `${ref.key} が ${sourceBucket} 層から ${targetBucket} 層の ${ref.id} を参照しています(規範の逆流)`,
        location: { file: doc.file, pointer: `${ref.key}.${ref.id}` },
        suggestion: `reference_policy.md「参照の可否」表により ${sourceBucket} → ${targetBucket} は不可。${ref.key} から外すか、この判断の根拠を上位層(principle / architecture)に昇格させてから参照する`,
        counterexample: { key: ref.key, id: ref.id },
      }),
    );
  }
  return findings;
}
