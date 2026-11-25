/**
 * M5 テンプレート準拠(H2)チェック。
 *
 * template_policy.md が定める手順で解決したテンプレートの H2 見出しと、
 * 文書の H2 見出しを突き合わせる。見出しの集合が揃っていれば
 * 「同じ種類の文書は同じ順路で読める」が保てる。
 *
 * 判定は warning から始める。テンプレート自体がまだ育っている最中で、
 * 過不足が「文書の不備」なのか「テンプレートの不足」なのかを人間が振り分ける必要があるため。
 * 掃除が済んだ時点で error に上げる。
 *
 * 語彙が開いたテンプレート(`h2_policy: open`)は例外で、テンプレートに無い H2 を咎めない。
 * directory_guide(README)のように、案内すべき中身がディレクトリごとに違う文書のためのもので、
 * ここで見るのは「必須節の欠落」と「節がひとつも無い」ことだけになる。
 *
 * 検査しない場合:
 *   - docs/specs の仕様文書(doc_type が action_spec / state_spec 等。schema.ts の SPEC_DOC_TYPE_RULES)。
 *     本文は `<!-- AUTO-GENERATED -->` の生成物が主で、節の構成を決めているのは生成器であり、
 *     テンプレートとの H2 突合は「人が書く文書」への検査としての意味を持たない。
 *     仕様がテンプレートどおりかは A0 / Q0 / V1 のスキーマ検査が実質的に担う。
 *     docs/specs にあっても README(directory_guide)は人が書く案内なので対象に残す。
 *   - テンプレートが解決できない文書(例: 対応する doc_type の template.md がどの階層にも無い)
 *   - `{リソース名}` や `N:` を含む繰り返しパターンのテンプレート(H2 の集合が文書ごとに変わる)
 * テンプレートの解決と読み込みはローダー(template.ts)が済ませてある。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import { isSpecDocType } from '../schema.js';
import type { DocsModel, ScannedDoc, TemplateSpec } from '../../model/docs/types.js';

/** M5: H2 見出しがテンプレートと一致することを検証する。 */
export const templateH2Verifier: DocVerifier = {
  id: 'M5',
  title: 'テンプレート準拠 — H2 見出しが解決されたテンプレートと一致する',

  verify(model: DocsModel): Finding[] {
    return model.docs.flatMap(checkDoc);
  },
};

/** 1 文書の H2 を、解決済みテンプレートと突き合わせる。 */
function checkDoc(doc: ScannedDoc): Finding[] {
  if (isSpecDocType(doc.docType)) return [];
  const template = doc.template;
  if (template === null || template.repeatable || template.h2.length === 0) return [];

  const actual = doc.headings.filter((heading) => heading.level === 2).map((heading) => heading.text);
  const missing = missingHeadings(doc, template, actual);
  if (!template.openH2) return [...missing, ...extraHeadings(doc, template, actual)];
  return [...missing, ...emptyBody(doc, template, actual)];
}

/**
 * 語彙が開いたテンプレートで、節がひとつも無い文書。
 *
 * 開いたテンプレートは節の増減を許すが、節が皆無なら「テンプレートに従った」とは言えない
 * (README なら配下の案内が無い状態)。閉じたテンプレートでは必須節の欠落として現れるため、ここでは見ない。
 */
function emptyBody(doc: ScannedDoc, template: TemplateSpec, actual: readonly string[]): Finding[] {
  if (actual.length > 0) return [];
  return [
    docFinding('M5', {
      severity: 'warning',
      message: '見出し(H2)がひとつもありません',
      location: { file: doc.file },
      suggestion: `${template.file} の節から、この文書に要るものを選んで書く(節の名前は自由に足してよいが、節が無い文書は案内にならない)`,
      counterexample: { heading: '(H2 なし)', template: template.file },
    }),
  ];
}

/** テンプレートが必須としている H2 のうち、文書に無いもの。 */
function missingHeadings(doc: ScannedDoc, template: TemplateSpec, actual: readonly string[]): Finding[] {
  return template.h2
    .filter((heading) => !heading.optional && !actual.includes(heading.name))
    .map((heading) =>
      docFinding('M5', {
        severity: 'warning',
        message: `テンプレートにある H2 見出しがありません: ## ${heading.name}`,
        location: { file: doc.file, pointer: `## ${heading.name}` },
        suggestion: `${template.file} に合わせて見出しを足す。この文書に不要な節ならテンプレート側で (任意) を付ける`,
        counterexample: { heading: heading.name, template: template.file },
      }),
    );
}

/** 文書にあるが、テンプレートには無い H2。 */
function extraHeadings(doc: ScannedDoc, template: TemplateSpec, actual: readonly string[]): Finding[] {
  const allowed = new Set(template.h2.map((heading) => heading.name));
  return actual
    .filter((name) => !allowed.has(name))
    .map((name) =>
      docFinding('M5', {
        severity: 'warning',
        message: `テンプレートに無い H2 見出しがあります: ## ${name}`,
        location: { file: doc.file, pointer: `## ${name}` },
        suggestion: `${template.file} の見出しに寄せるか、H3 に下げる。この種類の文書に共通して要る節ならテンプレート側に追加する`,
        counterexample: { heading: name, template: template.file },
      }),
    );
}
