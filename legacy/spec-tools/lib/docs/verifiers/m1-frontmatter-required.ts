/**
 * M1 フロントマター必須項目チェック。
 *
 * frontmatter_policy.md「doc_type ごとの必須フロントマター対応表」に対応する。
 * doc_type が無い文書は配置・参照・必須項目の判定基点を失い、
 * 以降の M2〜M6 も何も言えなくなるため、まずここでエラーにする。
 *
 * 空配列(`norms: []`)は「無い」ではなく「参照が無いことを明示した」であり、
 * frontmatter_policy が directory_guide に対して明示的に要求している書き方なので、
 * 存在するものとして扱う。
 *
 * docs/specs の仕様文書に対しては、doc_type / scope(全文書共通)だけを見る。
 * 仕様のスキーマ(handles / states / reads …)の充足は V1 / A0 / Q0 が見ており、
 * ここで数え直すと 1 つの欠落に 2 つのエラーが並ぶ。その線引きは
 * schema.ts の SPEC_DOC_TYPE_RULES(required が空)が表として持つ。
 * なお「フロントマターが閉じておらず読めない」ものはモデルに載らないため、
 * ローダーが同じ M1 として積む(この検証器には現れない)。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import { COMMON_REQUIRED, ruleFor } from '../schema.js';
import type { DocsModel, ScannedDoc } from '../../model/docs/types.js';

/** M1: doc_type と、doc_type ごとの必須フロントマター項目が揃っていることを検証する。 */
export const frontmatterRequiredVerifier: DocVerifier = {
  id: 'M1',
  title: 'フロントマター必須項目 — doc_type ごとに揃うべき項目が揃っている',

  verify(model: DocsModel): Finding[] {
    return model.docs.flatMap(checkDoc);
  },
};

/** 1 文書の必須項目を検査する。 */
function checkDoc(doc: ScannedDoc): Finding[] {
  const findings = COMMON_REQUIRED.filter((field) => !isPresent(doc.frontmatter[field])).map(
    (field) => missing(doc, field, '全ての文書に必須'),
  );
  if (doc.docType === null) return findings;

  const rule = ruleFor(doc.docType);
  if (rule === null) {
    findings.push(
      docFinding('M1', {
        severity: 'warning',
        message: `doc_types.md に定義の無い doc_type です: ${doc.docType}`,
        location: { file: doc.file, pointer: 'doc_type' },
        suggestion:
          'doc_types.md の一覧から適切な doc_type を選び直す。新しい種類が本当に必要なら先に doc_types.md へ追加する',
        counterexample: { doc_type: doc.docType },
      }),
    );
    return findings;
  }
  for (const field of rule.required) {
    if (!isPresent(doc.frontmatter[field])) {
      findings.push(missing(doc, field, `doc_type: ${doc.docType} に必須`));
    }
  }
  return findings;
}

/** 必須項目が欠けている Finding を作る。 */
function missing(doc: ScannedDoc, field: string, why: string): Finding {
  return docFinding('M1', {
    message: `必須のフロントマター項目がありません: ${field}(${why})`,
    location: { file: doc.file, pointer: field },
    suggestion: `フロントマターに ${field} を追加する。書き方は frontmatter_policy.md と同階層の template.md を見る`,
    counterexample: { doc_type: doc.docType ?? '(なし)', field },
  });
}

/**
 * その値を「書かれている」とみなすか。
 * 未定義・null・空文字は欠落。空配列は「参照が無いことの明示」として存在扱いにする。
 */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}
