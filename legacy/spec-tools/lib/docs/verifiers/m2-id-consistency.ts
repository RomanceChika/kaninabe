/**
 * M2 ID 整合チェック。
 *
 * id_policy.md に対応する 2 つの検査:
 *   1. 重複の禁止 — 同じ id を 2 つ以上の文書が宣言すると、norms / decisions の参照先が一意に決まらない
 *   2. 形式の一致 — doc_type ごとに決まった接頭辞・連番の形になっている
 *
 * 台帳は docs/rules と docs/specs をまたいだ 1 つであり、重複はツリーを越えて検出する。
 * ルール文書の README と仕様ディレクトリの README が同じ DG 番号を宣言していても、
 * 参照した側から見れば行き先は 1 つに決まらないため、同じ違反として扱う
 * (どちらを直すかは検証器が決めない。理由は duplicates のコメント)。
 *
 * 形式違反はすべて error である。かつて directory_guide の PROC-BE-xxxx(参考資料由来)を
 * 「既知の逸脱」として warning に落としていたが、DG-BE-xxxx への統一が済んだので例外は無くなった
 * (id_policy「ID の形式」)。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import { ruleFor } from '../schema.js';
import type { DocsModel, ScannedDoc } from '../../model/docs/types.js';

/** M2: id の一意性と形式を検証する。 */
export const idConsistencyVerifier: DocVerifier = {
  id: 'M2',
  title: 'ID 整合 — id が一意で、doc_type ごとの形式に合っている',

  verify(model: DocsModel): Finding[] {
    return [...duplicates(model.docs), ...model.docs.flatMap(checkFormat)];
  },
};

/**
 * 同じ id を宣言する文書の 2 件目以降に Finding を作る。
 *
 * **どちらが「正」かは決めない**。走査順は rules → specs の実装都合であって
 * 採番の先後ではなく、実際 DG-0038 では後から走査される specs 側が先に宣言していた。
 * 検証器が走査順を根拠に「こちらを直せ」と言うと、直す向きを誤らせる。
 * 反例には宣言している文書を(パス順で)並べるだけにして、先後の判断は履歴に委ねる。
 */
function duplicates(docs: readonly ScannedDoc[]): Finding[] {
  const byId = new Map<string, ScannedDoc[]>();
  for (const doc of docs) {
    if (doc.id === null) continue;
    const group = byId.get(doc.id);
    if (group === undefined) byId.set(doc.id, [doc]);
    else group.push(doc);
  }

  const findings: Finding[] = [];
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const declaredIn = group
      .map((doc) => doc.file)
      .sort()
      .join(', ');
    for (const doc of group.slice(1)) {
      findings.push(
        docFinding('M2', {
          message: `id ${id} が複数の文書で使われています`,
          location: { file: doc.file, pointer: 'id' },
          suggestion:
            'id は文書ごとに一意にする。どちらが先に宣言したかを履歴(git log)で確認し、' +
            '後から宣言した側に新しい連番を振る(id_policy: 再利用しない)',
          counterexample: { id, declared_in: declaredIn },
        }),
      );
    }
  }
  return findings;
}

/** 1 文書の id 形式を検査する。 */
function checkFormat(doc: ScannedDoc): Finding[] {
  if (doc.id === null || doc.docType === null) return [];
  const rule = ruleFor(doc.docType);
  if (rule === null || rule.idPattern === null || rule.idPattern.test(doc.id)) return [];

  return [
    docFinding('M2', {
      severity: 'error',
      message: `id ${doc.id} が doc_type: ${doc.docType} の形式に合っていません`,
      location: { file: doc.file, pointer: 'id' },
      suggestion: `id_policy の形式(${rule.idExample})に合わせて振り直す`,
      counterexample: { id: doc.id, doc_type: doc.docType, expected: rule.idExample },
    }),
  ];
}
