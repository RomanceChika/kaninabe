/**
 * `self_assign`(R2 の受け入れ)を**欄・役・書き手を名指す形**で読む(access_spec の `creates[]` / `writes[]`・state_spec の遷移)。
 *
 * ```yaml
 * self_assign:
 *   - field: store.manager_id    # 役の根拠の欄({集約}.{欄})
 *     role: store_manager        # その欄が根拠の役(claim / binding)。実行者の属性の欄(actor.{欄})なら書かない
 *     by: [company_admin]        # この理由が当てはまる書き手(その規則・遷移の by の部分集合)
 *     reason: 会社管理者が店舗の責任者を任免する。…
 * ```
 *
 * 受け入れは名指した**欄 × 役 × 書き手**にだけ効く。以前は規則単位の 1 文字列で、ある欄のために書いた理由が、後から同じ規則に
 * 足した別の役の根拠の欄も黙って受け入れた(点検 9 回目 A9-2)。欄 × 役にした後も書き手を名指さなかったので、遷移の `by`(並び)
 * に後から足した別のロールの自己昇格も、最初の書き手のために書いた理由が黙って受け入れた(10 回目 A10-1)。腐った受け入れ
 * (名指したのに何も受け入れない要素 × 書き手・`by` に無い書き手)も R2 が止める。`by` の部分集合であることは、規則・遷移の
 * `by` を知っている R2 が見る(読み手はどの宣言の要素かを知らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SelfAssignDecl } from './types-common.js';
import type { SpecReporter } from './parse-common.js';
import { eachRecord, type YamlReader } from './yaml-reader.js';

/** 要素に書けるキー。 */
const KEYS: readonly string[] = ['field', 'role', 'by', 'reason'];

/** `{集約}.{欄}`。 */
const QUALIFIED = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/u;

/** 書き方。 */
export const SELF_ASSIGN_SUGGESTION =
  'self_assign は、書いてよい役の根拠の欄を 1 本ずつ、理由が当てはまる書き手と一緒に名指して並べる ——' +
  ' "- field: {集約}.{欄} / role: {その欄が根拠の役} / by: [{書き手のロール}] / reason: {理由}"(実行者の属性の欄なら role を書かない。' +
  'by はその規則・遷移の by の部分集合)。名指していない欄・書き手には効かない' +
  '(例: - field: entry.owner_id / role: entry_owner / by: [member] / reason: 枠を作った人がその枠の枠主になる。作った枠の外には何も得ない)';

/**
 * 要素の `by`(この理由が当てはまる書き手)を読む。必須・空にできない・重複できない(読めなければ null で、要素ごと載せない)。
 *
 * @param element 要素の読み手
 * @param pointer 要素の YAML パス
 * @param index 要素の番号
 * @param reporter 違反の記録先
 * @returns 書き手のロール ID(読めなければ null)
 */
function writersOf(element: YamlReader, pointer: string, index: number, reporter: SpecReporter): readonly string[] | null {
  const listed = element.requiredStringList('by', SELF_ASSIGN_SUGGESTION, false);
  if (listed === null) return null;
  const writers = listed.map((writer) => writer.trim());
  const blank = writers.findIndex((writer) => writer === '');
  if (blank >= 0) {
    reporter.error(`${pointer}.by[${blank}]`, `self_assign[${index}].by[${blank}] が空です`, SELF_ASSIGN_SUGGESTION);
    return null;
  }
  const duplicate = writers.find((writer, at) => writers.indexOf(writer) !== at);
  if (duplicate !== undefined) {
    reporter.error(`${pointer}.by`, `self_assign[${index}].by に ${duplicate} が 2 回あります`, SELF_ASSIGN_SUGGESTION, { value: duplicate });
    return null;
  }
  return writers;
}

/**
 * `self_assign` を読む(書かれていなければ空)。
 *
 * 緩める宣言なので、読めない要素は**載せない**(緩めない側に倒す)。違反は記録するので verify は止まる。
 *
 * @param reader 規則・遷移の要素の読み手
 * @param reporter 違反の記録先
 * @returns 名指した欄ごとの受け入れ
 */
export function parseSelfAssign(reader: YamlReader, reporter: SpecReporter): readonly SelfAssignDecl[] {
  if (!reader.has('self_assign')) return [];
  if (typeof reader.raw('self_assign') === 'string') {
    reporter.error(
      reader.pointer('self_assign'),
      'self_assign を 1 つの文字列では書けません(規則単位の受け入れは、名指していない欄まで受け入れます)',
      SELF_ASSIGN_SUGGESTION,
    );
    return [];
  }
  const base = reader.pointer('self_assign');
  const decls: SelfAssignDecl[] = [];
  eachRecord(reader.optionalList('self_assign', SELF_ASSIGN_SUGGESTION), base, reporter, SELF_ASSIGN_SUGGESTION, (element, index) => {
    element.rejectUnknownKeys(KEYS, 'self_assign の要素', SELF_ASSIGN_SUGGESTION);
    const field = element.requiredString('field', SELF_ASSIGN_SUGGESTION);
    const reason = element.requiredString('reason', SELF_ASSIGN_SUGGESTION);
    const role = element.optionalString('role', SELF_ASSIGN_SUGGESTION);
    const by = writersOf(element, `${base}[${index}]`, index, reporter);
    if (field === null || reason === null || by === null) return;
    const parts = QUALIFIED.exec(field.trim());
    if (parts === null) {
      reporter.error(`${base}[${index}].field`, `self_assign[${index}].field が "{集約}.{欄}" の形ではありません`, SELF_ASSIGN_SUGGESTION, { value: field });
      return;
    }
    decls.push({
      entity: parts[1] ?? '',
      field: parts[2] ?? '',
      ...(role === undefined ? {} : { role: role.trim() }),
      by,
      reason,
      location: reporter.location(`${base}[${index}]`),
    });
  });
  return decls;
}

/**
 * その受け入れが、根拠の欄 1 本(欄 × 役)を名指しているか。
 *
 * 役の無い根拠(実行者の属性の欄)は役を書かない要素だけが、役のある根拠は同じ役を書いた要素だけが名指す。
 *
 * @param decl 受け入れの要素
 * @param ground 根拠の欄(集約・欄・役)
 * @returns 名指していれば true
 */
export function namesGround(decl: SelfAssignDecl, ground: { readonly entity: string; readonly field: string; readonly role?: string }): boolean {
  return decl.entity === ground.entity && decl.field === ground.field && decl.role === ground.role;
}
