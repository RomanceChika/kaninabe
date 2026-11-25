/**
 * K2 設定カタログ ⇔ 雛形(`app/.env.example`)の双方向一致。
 *
 * config-spec-writing.md の要求:
 *   - カタログの行は、雛形に同名の行を持つこと
 *   - 持たない行は `not_in_template_reason` に**なぜ置かないか**を書くこと(免除)
 *   - 免除を宣言した行が雛形に現れていないこと(掃除漏れ)
 *   - 雛形にあってカタログに無い行が無いこと
 *
 * 雛形は**引き継いだ人が最初に開くファイル**であり、そこに無い設定は「知らなければ
 * 埋まらない」ものになる。J0 の `not_scheduled_reason` と同じ免除方式を採るのは、
 * 「置かない」という判断も宣言の対象にするためである(黙って抜けているのと区別する)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { ConfigSpecModel } from '../../model/config/types.js';
import { envTemplateFile } from '../env-scan.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K2';

/** K2 の指摘を組み立てる。 */
function k2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** K2 の入力(雛形の読み取りは I/O 境界が済ませてある)。 */
export interface TemplateParityInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
  /** 雛形に現れる変数名。雛形が無い環境では null(K2 は何も見ない)。 */
  readonly template: readonly string[] | null;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(雛形の置き場の道案内を組み立てる)。 */
  readonly layout: ProductLayout;
}

/**
 * カタログの宣言と雛形の行を双方向に突き合わせる。
 *
 * @param input カタログと雛形の変数名
 * @returns 違反のリスト
 */
export function verifyTemplateParity(input: TemplateParityInput): Finding[] {
  const catalog = input.config.catalog;
  const template = input.template;
  if (catalog === null || template === null) return [];
  // 雛形の位置は宣言から来る。ここへ来る時点で雛形は読めているので、口は必ず値を返す。
  const templateFile = envTemplateFile(input.roots, input.layout) ?? '';

  const inTemplate = new Set(template);
  const findings: Finding[] = [];

  for (const decl of catalog.variables) {
    const listed = inTemplate.has(decl.id);
    const exempt = decl.notInTemplateReason !== undefined;
    if (listed && exempt) {
      findings.push(
        k2Finding({
          message: `設定 ${decl.id} は ${templateFile} にあるのに not_in_template_reason を持っています`,
          location: decl.location,
          suggestion:
            'not_in_template_reason を消す(免除は「雛形に置かない」ことの宣言であり、置いたなら要らない)',
          counterexample: { variable: decl.id },
        }),
      );
      continue;
    }
    if (!listed && !exempt) {
      findings.push(
        k2Finding({
          message: `設定 ${decl.id} が ${templateFile} にありません`,
          location: decl.location,
          suggestion:
            `${templateFile} に "${decl.id}=" の行(と何を入れるかのコメント)を足すか、` +
            'not_in_template_reason に「なぜ雛形に置かないか」を書く' +
            '(雛形は引き継いだ人が最初に開くファイルであり、そこに無い設定は知らなければ埋まらない)',
          counterexample: { variable: decl.id },
        }),
      );
    }
  }

  const declared = new Set(catalog.variables.map((decl) => decl.id));
  for (const name of template) {
    if (declared.has(name)) continue;
    findings.push(
      k2Finding({
        message: `${templateFile} の ${name} が設定カタログにありません`,
        location: catalog.location,
        suggestion:
          `${specPath(input.roots, 'backend/config.md')} の variables に "- id: ${name}" の行を足すか、` +
          '使われていないなら雛形から消す(雛形だけにある設定は「埋めるべきか」が誰にも分からない)',
        counterexample: { variable: name },
      }),
    );
  }
  return findings;
}
