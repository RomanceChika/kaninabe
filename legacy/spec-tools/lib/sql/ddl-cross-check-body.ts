/**
 * 別の集約の列との等式を見る制約トリガの**本文**(`cross-check-plan.ts` の計画を字面にする)。
 *
 * 2 つの形がある(どちらも**コミット時に、いまの行を読み直して**見る。`new` は文の時点の姿でしかない):
 *
 * | 側 | 本文 | なぜ |
 * |---|---|---|
 * | `host`(参照の欄を持つ行) | **相手の行を `for share` で押さえてから**、結合して条件を破る行が無いかを見る | 相手の行を同時に書き換える取引と直列化する(下記) |
 * | `referenced`(参照される行) | その行を指す行を結合して、条件を破るものが無いかを見る | 相手の行を書き換えた取引は、その行の行ロックを持ったままコミット時の検査に入る(新しい文の snapshot で host の確定した行を見る = read committed。repeatable read・serializable は拒否) |
 *
 * ## ロックと隔離(同時実行で条件が破れない理由)
 *
 * 2 つの取引 A(従業員の会社を変える)と B(その従業員を責任者にした店舗を作る)が同時に走ると、
 * 互いの未コミットの変更を見られないので、**どちらの検査も通って両方コミットできる**(書き込みの歪み)。
 * 防ぎ方は、host 側の検査が相手の行を **`for share`** で押さえることである。
 *
 * - A が先に UPDATE した場合: A の行ロック(`for no key update`)と B の `for share` が衝突し、B は A の
 *   コミットまで待つ。待ったあとの検査(新しい文なので新しい snapshot)は A の変更を見て拒否する。
 * - B の検査が先に `for share` を取った場合: A の UPDATE が B のコミットまで待ち、A のコミット時の検査は
 *   B の店舗を見て拒否する。
 * - **repeatable read は検査の前に拒否する**(`invalid_transaction_state`・トリガ名も不変条件 ID も載せない。
 *   `ddl-isolation-guard.ts`・天井のトリガと同じ実装)。取引の最初の snapshot が古いままだと、参照される側の検査
 *   (`for share` を取らず結合だけ)は、snapshot の後に確定した host の行を見落とす —— host の行が相手の行を
 *   更新しない(`for share` は行バージョンを変えない)ので、40001(直列化失敗)にもならない。
 *   支えるのは、文ごとに新しい snapshot を取る read committed だけである(serializable も断る —— SSI は**関わる取引の全部**が
 *   serializable のときだけ検出し、混在を運用に任せると破れる。点検 D25s-3)。
 *
 * 外部キーの検査が取る `for key share` は `for no key update` と衝突しないので、これで代わりにはならない。
 * 本文は定義者の権限で走る(`security definer` + `search_path` の固定)—— RLS が効いた接続から読むと 0 行になり、
 * 条件を確かめずに素通りするため。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { CROSS_CHECK_WORDS } from '../messages/messages-ddl.js';
import { isolationGuardLines } from './ddl-isolation-guard.js';
import { sqlLiteral } from './guard-to-sql.js';
import { HOST_ALIAS, OTHER_ALIAS, type CrossCheckPlan } from './cross-check-plan.js';

/** 全テーブルが持つ主キー列(結合と読み直しの鍵)。 */
const KEY = 'id';

/** `raise exception` が出す SQLSTATE(制約違反と同じ分類にする)。 */
const ERRCODE = 'check_violation';

/**
 * 拒否の `raise exception` 文(文面は `using message` で渡す)。
 *
 * 文面は `{トリガ名}: {不変条件 ID}: {statement}` で、`constraint` にトリガ名を載せる —— 呼び出し側の
 * 写像(制約名 → 不変条件 ID)が名前から不変条件を引く。`statement` に `%` が入っても書式として解釈されない
 * (`raise exception '…'` の第 1 引数は書式文字列)。
 *
 * @param name トリガ名(= 制約名)
 * @param invariantId 不変条件 ID(無ければ空)
 * @param statement 不変条件の文言(無ければ空)
 * @returns SQL の行
 */
export function refusalLines(name: string, invariantId: string, statement: string): readonly string[] {
  return [
    '    raise exception using',
    `        message = ${sqlLiteral(`${name}: ${invariantId}: ${statement}`)},`,
    `        errcode = ${sqlLiteral(ERRCODE)},`,
    `        constraint = ${sqlLiteral(name)};`,
  ];
}

/** 結合(`t` が参照の欄で `r` を指す)。 */
function joinLines(plan: CrossCheckPlan): readonly string[] {
  return [
    `from public.${plan.host.table} ${HOST_ALIAS}`,
    `join public.${plan.other.table} ${OTHER_ALIAS} on ${OTHER_ALIAS}.${KEY} = ${HOST_ALIAS}.${plan.refColumn}`,
  ];
}

/**
 * plpgsql の本文。
 *
 * @param plan 生成できる計画
 * @param trigger トリガ名
 * @param expression 結合した 2 つの行を読む正準表記の式(`COALESCE(…, false)` で閉じてある)
 * @returns 本文の行
 */
export function crossBodyOf(plan: CrossCheckPlan, trigger: string, expression: string): readonly string[] {
  const own = plan.side === 'host' ? HOST_ALIAS : OTHER_ALIAS;
  const where = `where ${own}.${KEY} = new.${KEY}`;
  const lock =
    plan.side === 'host'
      ? [
          // 相手の行を押さえる(待ち合わせ)。次の文は新しい snapshot で最新の姿を読む。
          'perform 1',
          ...joinLines(plan).map((line) => `    ${line}`),
          `    ${where}`,
          `    for share of ${OTHER_ALIAS};`,
        ]
      : [];
  return [
    // 隔離の水準の拒否は検査の前(repeatable read の古い snapshot では、先に確定した相手の行を結合が見落とす)。
    ...isolationGuardLines(CROSS_CHECK_WORDS.isolationRefusal),
    ...lock,
    'if exists (',
    '    select 1',
    ...joinLines(plan).map((line) => `    ${line}`),
    `    ${where} and not (${expression})`,
    ') then',
    ...refusalLines(trigger, plan.invariant.id, plan.invariant.statement),
    'end if;',
    'return null;',
  ];
}
