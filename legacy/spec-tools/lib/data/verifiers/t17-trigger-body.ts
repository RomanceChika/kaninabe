/**
 * T17 **トリガ関数の本文の出どころ**(`functions[].handwritten` / 生成できること)の検査。
 *
 * ARCH-SP-BE-0001 §テーブル仕様 の要求(束 ㉖):
 *   - `kind: trigger` の関数は、**本文が生成物である**か、**`handwritten`(理由つきの手書き)**を
 *     宣言するかの**どちらか**である。どちらでもない関数は「本文がどこにあるか誰も言えない」状態で
 *     あり、空の DB に生成物だけを当てて起こした系では**誰もその列を埋めず・誰も条件を確かめない**。
 *   - 生成できる形は 3 家族しかない —— 祖先の列の写しを埋めるもの(`supplies` が全部写し)・
 *     同じ行の日時列 ± 定数の幅で埋めるもの(`derives` が通る)・条件を課すもの
 *     (宣言した不変条件の `formal` が自表の列だけの `check`、参照の欄が指す行の列を定数・順序で比べる `check` / `state_dependency`
 *     (`model/data/ref-check-shape.ts`。fix25s。どちらも `fires` の `update of` が本文の読む自表の列の全部を並べること)、または 2 つの集約の列の一致の `check` —— 後者は
 *     **両端の表にトリガが要り**、片側だけの宣言はここが error にする。`sql/cross-check-plan.ts`)である。
 *     (4 つ目の家族 —— 未ログインの作成の天井 —— は data_table でなく access_spec の `abuse` から出るので、ここでは宣言しない。
 *     同名の宣言は R5-4 が二重として止める。)
 *   - 生成できないなら、**生成できない理由を報告したうえで** `handwritten` を書く。
 *
 * ## なぜ error なのか(`checks[]` の (e) が warning なのと違う)
 *
 * `checks[]` の「実在しない執行点である」は**仕様として成り立つ状態**(まだ執行点を持てない)
 * なので warning である。こちらは違う —— **宣言そのものが「この関数は実在する」と言っている**
 * (`functions[]` の和集合が public の関数の完全集合であり、`data-table-parity` の閉世界が
 * それを実 DB と突き合わせる)。実在すると宣言した関数の本文がどこにあるか言えないのは
 * 宣言の欠落であり、書く場所は 1 行だけある。
 *
 * **免除リストではない。** 根拠は仕様の中の宣言そのもので、別の台帳に書き足せる口はどこにも
 * 無い(`checks[].handwritten` / `functions[].handwritten` と同じ形)。理由が空なら
 * パーサーが止める。
 *
 * ## 権限の宣言は**手書きの本文だけが持てる**(束 §17)
 *
 * `functions[].security`(`definer` / `invoker`)は「その関数を誰の権限で実行するか」であり、
 * **本文が生成物のトリガ関数では生成器の計画が正**である(読み直すトリガだけ `definer`。
 * `ddl-guards.ts` の `DdlTriggerFunction.securityDefiner`)。仕様が重ねて宣言すると正が 2 つに
 * なるので、ここが error で止める —— `bodyMd5` を仕様に書かないのと同じ線引きである。
 * 逆向き(手書きなのに宣言が無い)は error にしない: **省略は `invoker` という意味を持つ宣言**
 * であり、それが実 DB と食い違えば `data-table-parity` が `prosecdef` の突合で落とす。
 *
 * ## 名指しは機械が見る(束 ㉖ の独立レビュー D1)
 *
 * `handwritten` は `{ migration, reason }` のマッピングであり、**`migration` が実在し、その本文に
 * 関数名の字面があること**をここが見る。自由文 1 行だったあいだ、23 本のうち 1 本が関数名を
 * 1 文字も含まない migration を宣言していて誰も捕まえなかった —— 「手で書いた」という宣言の
 * 根拠が本当にそこにあるかを言えないなら、宣言は嘘を許す。`supabase/migrations` が無い構成
 * (仕様だけを持つ fixture)ではこの下位検査を何も見ない(K1 / J3 と同じ扱い)。
 *
 * 名指しの指摘は手書きの migration(実装の木)との突合なので `grounding: 'implementation'` を付ける。
 * 生成が migration の置き場を作った直後は手書きの本文がまだ無いのが普通で、そこで生成を止めると
 * 2 回目の生成(`generate --check`)が 1 回目の出力のせいで止まる。本文の出どころが言えない
 * 指摘(`finding`)は仕様だけで決まるので印を付けず、生成を止める。
 */

import path from 'node:path';
import { isDirectory } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import type { SpecModel } from '../../model/types.js';
import { checkTriggerOf } from '../../sql/ddl-check-triggers.js';
import { crossCheckOf } from '../../sql/cross-check-plan.js';
import { unreadableConditionFindings } from './t17-trigger-conditions.js';
import { copiedColumnsOf } from '../../world/index.js';
import { generatedCopiesOf } from '../../sql/ddl-copy-triggers.js';
import { derivationProblemsOf } from '../../sql/derive-problems.js';
import { freezeProblemsOf } from '../../sql/ddl-freeze-triggers.js';
import type { ActionSpec, ActionSpecModel } from '../../model/trace/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel, DataTriggerDecl } from '../../model/data/types.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T17';


/** T17 の指摘を組み立てる。 */
function t17(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * 全 data_table の `kind: trigger` について、本文の出どころを検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(本文の組み立てと同じ写像を回すのに要る)
 * @param dataTables 読み込み済みの data_table
 * @param repoRoot リポジトリルートの絶対パス(省略時は本文を読まない)
 * @param roots 製品が宣言した根(migration の置き場)
 * @param actions action_spec(凍らせた列を作成でない操作の computes が書くかを見る。無ければ見ない)
 * @returns 違反のリスト
 */
export function verifyTriggerBody(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  repoRoot: string | undefined,
  roots: ProductRoots,
  actions?: ActionSpecModel,
): Finding[] {
  if (!dataTables.available) return [];
  const migrations = repoRoot === undefined ? null : path.join(repoRoot, roots.migrations);
  const dir = migrations !== null && isDirectory(migrations) ? migrations : null;
  return [
    ...dataTables.tables.flatMap((table) =>
      table.functions
        .filter((fn) => fn.kind === 'trigger')
        .flatMap((fn) => checkFunction(fn, table, domain, dir, roots, dataTables.tables, actions?.actions ?? [])),
    ),
    ...crossBothEnds(domain, dataTables.tables),
    // 不変条件を名指すのに本文と照らせないトリガ(warning。点検 21 回目 C21-4。本体は t17-trigger-conditions.ts)。
    ...unreadableConditionFindings(VERIFIER_ID, domain, dataTables.tables),
  ];
}

/** 両端の欠けの 1 件(宣言した側と、欠けている側)。 */
interface MissingEnd {
  readonly table: DataTableSpec;
  readonly trigger: DataTriggerDecl;
  readonly id: string;
  readonly side: string;
  readonly lacks: string;
  readonly entity: string;
}

/**
 * 別の集約の列との等式は**両端の表にトリガが要る**(片側だけでは、守っていない側から条件が破れる)。
 *
 * 生成できる宣言(`crossCheckOf` が ok)の側を数え、もう一方の端に同じ不変条件を宣言するトリガが無ければ
 * error にする。`V26` や T16 は「その不変条件を名指す執行点が実在するか」しか見ないので、片側だけの宣言を
 * 執行点つきとして数えてしまう —— その抜けをここで止める。手書きの本文を持つ側(`handwritten`)は
 * 生成物ではないので、数えるのは本文が生成物の側だけである。
 */
function crossBothEnds(domain: SpecModel, tables: readonly DataTableSpec[]): Finding[] {
  const declared = new Map<string, Set<string>>();
  const pending: MissingEnd[] = [];
  for (const table of tables) {
    for (const trigger of table.triggers) {
      const fn = table.functions.find((candidate) => candidate.name === trigger.functionName);
      if (fn?.handwritten !== undefined) continue;
      const judged = crossCheckOf(trigger, table, domain, tables);
      if (judged.kind !== 'ok') continue;
      const { plan } = judged;
      const sides = declared.get(plan.invariant.id) ?? new Set<string>();
      sides.add(plan.side);
      declared.set(plan.invariant.id, sides);
      const lacks = plan.side === 'host' ? 'referenced' : 'host';
      const entity = lacks === 'host' ? plan.host.entity.entity : plan.other.entity.entity;
      pending.push({ table, trigger, id: plan.invariant.id, side: plan.side, lacks, entity });
    }
  }
  return pending
    .filter((entry) => declared.get(entry.id)?.has(entry.lacks) !== true)
    .map((entry) =>
      t17({
        message:
          `${entry.id}(別の集約の列との等式)は両端の表にトリガが要るが、${entry.entity} の側に宣言が無い ` +
          `(${entry.table.table} の ${entry.trigger.name} は${entry.side === 'host' ? '行の側' : '相手の側'}だけを守る)`,
        location: { ...entry.table.location, pointer: `triggers.${entry.trigger.name}` },
        suggestion:
          `${entry.entity} の表に、同じ invariant を宣言する after の制約トリガ(deferred: true)と functions[] の ` +
          `kind: trigger を足す(fires は${entry.lacks === 'host' ? '挿入と、式が読む列・参照の欄の更新' : '式が読む列の更新'})。` +
          '片側だけだと、守っていない側の更新で条件が破れる',
        counterexample: { invariant: entry.id, declaredSide: entry.side, missingSide: entry.lacks, table: entry.table.table },
      }),
    );
}

/** 関数 1 本を見る。 */
function checkFunction(
  fn: DataFunctionDecl,
  table: DataTableSpec,
  domain: SpecModel,
  migrationsDir: string | null,
  roots: ProductRoots,
  tables: readonly DataTableSpec[],
  actions: readonly ActionSpec[],
): Finding[] {
  if (fn.handwritten !== undefined) return namedMigration(fn, table, migrationsDir, roots);
  const trigger = table.triggers.find((candidate) => candidate.functionName === fn.name);
  if (trigger === undefined) {
    return [finding(fn, table, 'この関数を実行するトリガが triggers[] に宣言されていない(発火しない関数である)')];
  }
  const reason = generationProblem(trigger, table, domain, tables, actions);
  if (reason !== null) return [finding(fn, table, reason)];
  return declaredSecurity(fn, table);
}

/**
 * 本文が生成物のトリガ関数に `security` を重ねて宣言していないか。
 *
 * @param fn 関数の宣言(ここに来るのは本文を生成できるものだけ)
 * @param table テーブル仕様(位置に使う)
 * @returns 違反のリスト
 */
function declaredSecurity(fn: DataFunctionDecl, table: DataTableSpec): Finding[] {
  if (fn.security === undefined) return [];
  return [
    t17({
      message: `トリガ関数 ${fn.name} は本文が生成物なので security を宣言できません`,
      location: { ...table.location, pointer: `functions.${fn.name}.security` },
      suggestion:
        '行を削除する(生成物の権限は生成器の計画が決める —— いまの行を読み直すトリガだけ ' +
        'security definer で、new だけを見るトリガは security invoker である)。' +
        '値を変えたいなら、変わるのは本文の形のほうである',
      counterexample: { function: fn.name, table: table.table, security: fn.security },
    }),
  ];
}

/**
 * その宣言から本文を生成できないなら、その理由(生成できるなら `null`)。
 *
 * **判定は生成器と同じ 1 本である** —— 値を供給するトリガは `ddl-copy-triggers.ts`、
 * 条件を課すトリガは `ddl-check-triggers.ts` に聞く。書き写すと片方だけが直る。
 */
function generationProblem(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
  actions: readonly ActionSpec[],
): string | null {
  if (trigger.derives !== undefined) {
    const problems = derivationProblemsOf(trigger, table, domain);
    return problems.length === 0 ? null : problems.map((entry) => entry.reason).join(' / ');
  }
  // 凍結(点検 fix26 2 回目)。凍らせた列を書き換える宣言があれば、生成できない理由として赤にする(宣言の値だけを読む)。
  if (trigger.freezes !== undefined) {
    const problems = freezeProblemsOf(trigger, table, domain, actions);
    return problems.length === 0 ? null : problems.map((entry) => entry.reason).join(' / ');
  }
  if (trigger.supplies.length > 0) {
    const entity = table.entity;
    if (entity !== undefined && generatedCopiesOf(trigger, entity, domain) !== null) return null;
    const solved = new Set(
      (entity === undefined ? [] : copiedColumnsOf(domain, entity, trigger.invariant)).map(
        (copy) => copy.column,
      ),
    );
    const unsolved = trigger.supplies.filter((column) => !solved.has(column));
    if (unsolved.length > 0) {
      return (
        `supplies の列 ${unsolved.join(' / ')} が「祖先の列の写し」として解けない` +
        '(1 列でも導出できないと本文は出さない —— 部分的な本文は手書きの本文と衝突する)'
      );
    }
    return 'fires に表名を書いている(生成が on {表} を付けるので、宣言の側に書くと二重になる)';
  }
  const built = checkTriggerOf(trigger, table, domain, tables);
  return built.ok ? null : built.reason;
}

/**
 * `handwritten` が名指した migration が実在し、その本文に関数名の字面があるか。
 *
 * @param fn 関数の宣言
 * @param table テーブル仕様(位置に使う)
 * @param migrationsDir migration のディレクトリ(読めない構成では null = 何も見ない)
 * @returns 違反のリスト
 */
function namedMigration(
  fn: DataFunctionDecl,
  table: DataTableSpec,
  migrationsDir: string | null,
  roots: ProductRoots,
): Finding[] {
  const named = fn.handwrittenMigration;
  if (migrationsDir === null || named === undefined) return [];
  const location = { ...table.location, pointer: `functions.${fn.name}.handwritten.migration` };
  const text = tryReadText(path.join(migrationsDir, named));
  if (text === null) {
    return [
      t17({
        message: `トリガ関数 ${fn.name} の handwritten が名指した migration ${named} は実在しません`,
        location,
        suggestion:
          `${roots.migrations}/ にあるファイル名をそのまま書く(その関数の本文を作っている migration)。` +
          '名前が違うと「手で書いた」という宣言の根拠がどこにも無い',
        counterexample: { function: fn.name, migration: named },
        grounding: 'implementation',
      }),
    ];
  }
  if (text.includes(fn.name)) return [];
  return [
    t17({
      message: `migration ${named} に ${fn.name} の字は 1 つもありません(その本文を作っていません)`,
      location,
      suggestion:
        'その関数の本文を作っている migration を名指す(`create [or replace] function public.{関数名}` が' +
        'ある側。同じ束の別のファイルや、トリガだけを作り直したファイルを名指していないか確かめる)',
      counterexample: { function: fn.name, migration: named },
      grounding: 'implementation',
    }),
  ];
}

/** 本文の出どころが言えないことの指摘。 */
function finding(fn: DataFunctionDecl, table: DataTableSpec, reason: string): Finding {
  return t17({
    message: `トリガ関数 ${fn.name} の本文がどこにも無い(生成もできない): ${reason}`,
    location: { ...table.location, pointer: `functions.${fn.name}` },
    suggestion:
      '本文が手書きの migration にあるなら handwritten に { migration, reason } を書く' +
      '(migration はその本文を作っているファイル名。T17 が実在と関数名の字面を見る)。' +
      '生成に乗せたいなら、値を供給するトリガは supplies の列を全部「祖先の列の写し」の' +
      '不変条件で宣言し、条件を課すトリガは宣言する不変条件の formal を自表の列だけの check にする',
    counterexample: { function: fn.name, table: table.table, reason },
  });
}
