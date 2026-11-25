/**
 * 画面が「その口を出すか」を先読みするための述語。
 *
 * 規則の正: docs/rules/process/frontend/specification/standards/screen-spec-writing.md
 *           §先読みの線引き / §予約 ID のガードを先読みしてよい条件
 *
 * 状態機械のイベントは `from` を持つので「宣言した `actions` ∩ 生成遷移表」の交差でボタンを
 * 導けるが、**予約 ID（`create` / `update` / `delete`）は `from` を持たない**。可否の条件は
 * `access_spec` の `when`（ガード式）にしか書かれていないため、交差の材料が無い。
 *
 * そこで、画面が**その行についてすでに描画している事実**だけで決まる `when` に限って先読みを許す。
 * 判定は生成表のガード AST をエンジンの評価器にかけて行い、**画面は状態名を 1 つも手で書かない**
 * （`when` を変えれば画面の出し分けも一緒に変わる）。
 *
 * **評価できない（`'unknown'`）ときは先読みしない。** 画面に渡せていない事実があるという意味であり、
 * そこで隠すと「評価漏れ = 操作が消える」という静かな壊れ方になる。口を出して押した結果に委ねれば、
 * 拒否として目に見える形で出る。
 */

import { evaluateGuard } from '@kaninabe/runtime/engine';
import type { GuardEnv, GuardExprData } from '@kaninabe/runtime/engine';

/**
 * その規則が、渡した事実の下で**確実に成り立たない**とは言えないか。
 *
 * @param guard - `access_spec` の `when` を写した AST（無条件なら `undefined`）
 * @param env - 画面がすでに描画している事実（`state` / `{集約}.state` など）
 * @returns 口を出してよければ true（成立するか、評価できないとき）
 */
export function passesPreflight(guard: GuardExprData | undefined, env: GuardEnv): boolean {
  if (guard === undefined) return true;
  return evaluateGuard(guard, env) !== false;
}

/**
 * 編集規則の表のうち、**フィールド名の型を保つ**形。
 *
 * 生成物（`{entity}.writes.ts`）は `as const` なので、`by` も `fields` も文字列リテラルである。
 * `WriteTable` として受けると `string` に潰れてしまい、画面が「どの入力欄を並べるか」を
 * 型で扱えなくなる（フィールド名がただの文字列になる）。**ロール名もリテラルのまま通す** —
 * その表に存在しないロール（綴り違いを含む）を渡す呼び出しが型エラーになる。
 */
export interface WriteRulesOf<R extends string, F extends string> {
  /** 編集規則の並び（`access_spec` の `writes`）。 */
  readonly rules: readonly {
    /** 編集を許可するロールID。 */
    readonly by: R;
    /** この規則が許可するフィールド名。 */
    readonly fields: readonly F[];
    /** 編集の前提条件（`writes[].when`）。省略は「無条件」。 */
    readonly guard?: GuardExprData;
  }[];
}

/**
 * いま編集できるフィールドを、生成された編集規則の表から導く。
 *
 * 画面が「どの入力欄を出すか」を決める唯一の手段である。**画面はフィールド名の一覧も
 * 状態名も持たない** — 規則の `by` と `when` に当てはまるものだけが並ぶので、`writes` を
 * 変えれば画面の入力欄も一緒に変わる。
 *
 * 先読みしてよい条件（`when` が「その行について画面が既に描画している事実」だけで決まること）は
 * `passesPreflight` と同じであり、評価できない規則のフィールドは**出す側に倒す**
 * （隠すと「評価漏れ = 入力欄が消える」という静かな壊れ方になる）。
 *
 * @param table - 生成された編集規則の表（`domain/generated/{entity}.writes.ts`）
 * @param role - 実行者が対象に対して持つと画面が言えるロール（`writes[].by` に実在するもの）
 * @param env - 画面がすでに描画している事実（`state` など）
 * @returns 並べてよいフィールド名（規則の宣言順、重複なし）
 */
export function writableFields<R extends string, F extends string>(
  table: WriteRulesOf<R, F>,
  // `NoInfer` が要る。付けないとロール名の側からも R が推論され、綴り違いを渡しても
  // 「そういうロールもある表」として型が広がってしまう（＝検査が効かない）。
  role: NoInfer<R>,
  env: GuardEnv,
): readonly F[] {
  const found = new Set<F>();
  for (const rule of table.rules) {
    if (rule.by !== role) continue;
    if (!passesPreflight(rule.guard, env)) continue;
    for (const field of rule.fields) found.add(field);
  }
  return [...found];
}
