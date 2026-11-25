/**
 * T6 **生成する関数の本文の出どころ**(`functions[].migration` / `handwritten`)の検査。
 *
 * ARCH-SP-BE-0001 §書き込み RPC の形 の要求(束 ⑳-2・束 ⑳-4a):
 *   - `kind: rpc` の定型 5 形(composite 以外)は、`migration`(本文は生成物)か
 *     `handwritten`(理由つきの手書き)の**どちらか一方**を必ず宣言する。
 *   - `migration` は `kind: rpc` なら `{14 桁}_rpc_{関数名}.sql`、`kind: helper` なら
 *     `{14 桁}_helper_{関数名}.sql`、`kind: send_limit` なら `{14 桁}_{関数名}.sql`(関数名が `send_limit_` で始まる。T26)の形で、
 *     **全 data_table・全種別を通して一意**。
 *   - `shape: composite` はどちらも宣言できない(定型に乗らない本文は生成の対象ではない)。
 *   - `kind: helper` の `migration` は `role`(どのロールを判定するか)と対で宣言する ——
 *     対であること・ロールの実在・関数名との一致は T7 が見る(RLS の検査の一部だからである)。
 *
 * **なぜ名前を仕様に書かせるのか。** migration は追記専用の歴史であり、生成物で上書きできる
 * のは「まだ適用していないファイル」だけである。ファイル名を宣言にしておけば、SQL が変わる
 * 変更をしたときに**名前を新しくする**という 1 手で「旧ファイルは歴史として残し、新ファイルを
 * 生成する」が成立する(migrations.md §生成 migration。Y7 と同じ規則の RPC 版)。
 *
 * **なぜ `composite` への降格を逃げ道にしないのか。** 降格すると許可列・楽観的並行制御の
 * 突合(rpc-parity)まで一緒に失われる。形は定型のまま「本文だけ手書き」と宣言できる欄を
 * 別に置くことで、免除の範囲を本文だけに閉じている。
 *
 * **生成器の前提もここが見る。** `code-rpc-bodies` は前提が破れたとき `preconditionFailure('T6')`
 * を報告して止まる —— 示された側がその判定を持っていないと、「verify は緑なのに generate が
 * 落ちる」形になる(generator-precondition.ts の docstring)。そこで**本文の組み立てと同じ
 * 写像**(`collectRpcFacts`)をここから呼び、(a) 表が entity を持つ (b) 全引数の役目が規約から
 * 決まる (c) `p_expected_{集約}_{列}` の条件先まで参照が辿れる (d) 遷移なら動かす機械と状態列が関数名から 1 つに
 * 決まる(`rpc-transition-machine.ts`。本文が手書きの遷移も見る)を verify の段で落とす。
 * 判定を書き写さないので、生成器と検査器が食い違うことがない(guard-sql-parity と同じ流儀)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { collectRpcFacts } from '../../sql/rpc-facts.js';
import { fkCheckOrderProblems } from '../../sql/rpc-fk-check-order.js';
import { transitionTargetOf } from '../../sql/rpc-transition-machine.js';
import type { DataFunctionDecl, DataTableSpecModel, DataTableSpec } from '../../model/data/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { checkInputsReach } from './t6-input-reach.js';
import { checkTransitionColumnsDeclared } from './t6-transition-columns.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T6';

/** 生成 migration の名前の中ほど(種別と、どの関数の本文かが名前から読める)。 */
const INFIX: Readonly<Record<string, string>> = { rpc: '_rpc_', helper: '_helper_', send_limit: '_' };

/** 本文を生成する形(composite は定型に乗らないので生成しない。code-rpc-bodies と同じ集合)。 */
const GENERATED_SHAPES = ['create', 'update', 'delete', 'transition'] as const;

/** 本文を生成する形。 */
type GeneratedShape = (typeof GENERATED_SHAPES)[number];

/** T6 の指摘を組み立てる。 */
function t6Finding(args: Omit<Finding, 'verifier' | 'severity'> & { severity?: Finding['severity'] }): Finding {
  return { verifier: VERIFIER_ID, severity: args.severity ?? 'error', ...args };
}

/**
 * 全 data_table の `kind: rpc` について、本文の出どころの宣言と**生成の前提**を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(本文の組み立てと同じ写像を回すのに要る)
 * @param dataTables 読み込み済みの data_table
 * @param actions 読み込み済みの action_spec(宣言した `input` の欄が本文に届くことを見るのに使う。無ければ見ない)
 * @returns 違反のリスト
 */
export function verifyRpcMigration(domain: SpecModel, dataTables: DataTableSpecModel, actions?: ActionSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      if (INFIX[fn.kind] === undefined) continue;
      if (fn.kind === 'rpc') findings.push(...checkOrigin(fn, table));
      if (fn.migration === undefined) {
        findings.push(...checkHandwrittenTransition(fn, table, domain));
        continue;
      }
      findings.push(...checkShape(fn, table));
      if (fn.kind === 'rpc') findings.push(...checkBuildable(fn, table, domain, dataTables, actions));
      const first = seen.get(fn.migration);
      if (first !== undefined) {
        findings.push(
          t6Finding({
            message: `migration ${fn.migration} が ${first} と重複しています`,
            location: { ...table.location, pointer: `functions.${fn.name}.migration` },
            suggestion: '関数 1 本につき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
            counterexample: { function: fn.name, migration: fn.migration, first },
          }),
        );
        continue;
      }
      seen.set(fn.migration, fn.name);
    }
  }
  return findings;
}

/** 本文の出どころが「生成物」か「理由つきの手書き」のどちらか一方であることを見る。 */
function checkOrigin(fn: DataFunctionDecl, table: DataTableSpec): Finding[] {
  const declared = [fn.migration === undefined ? null : 'migration', fn.handwritten === undefined ? null : 'handwritten'].filter(
    (key): key is string => key !== null,
  );
  if (fn.shape === 'composite') {
    if (declared.length === 0) return [];
    return [
      t6Finding({
        message: `${fn.name} は shape: composite なので ${declared.join(' / ')} を宣言できません`,
        location: { ...table.location, pointer: `functions.${fn.name}` },
        suggestion:
          'composite は定型に乗らない関数であり、本文は最初から手書きである(生成の対象でも免除の対象でもない)。行を削除する',
        counterexample: { function: fn.name, declared: declared.join(', ') },
      }),
    ];
  }
  if (declared.length === 1) return [];
  return [
    t6Finding({
      message:
        declared.length === 0
          ? `${fn.name} は定型 ${fn.shape ?? ''} ですが本文の出どころ(migration / handwritten)の宣言がありません`
          : `${fn.name} が migration と handwritten の両方を宣言しています`,
      location: { ...table.location, pointer: `functions.${fn.name}` },
      suggestion:
        '定型の本文は宣言から決まるので生成する —— 生成先を migration に書く。' +
        '仕様から導けない手順が本文に混じっているなら、その理由を handwritten に書く(どちらか一方)',
      counterexample: { function: fn.name, shape: fn.shape ?? '', declared: declared.join(', ') },
    }),
  ];
}

/** ファイル名が `{14 桁}_{種別}_{関数名}.sql` の形かを見る。 */
function checkShape(fn: DataFunctionDecl, table: DataTableSpec): Finding[] {
  const migration = fn.migration ?? '';
  const expected = `${INFIX[fn.kind] ?? ''}${fn.name}.sql`;
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  if (MIGRATION_SEQUENCE.test(sequence) && migration.slice(index) === expected) return [];
  return [
    t6Finding({
      message: `migration ${migration} が関数 ${fn.name} から導かれる名前になっていません`,
      location: { ...table.location, pointer: `functions.${fn.name}.migration` },
      suggestion:
        `"{14 桁の連番}${expected}" の形に直す` +
        '(名前から「どの関数の本文か」が一意に読めることが、生成先の唯一の手がかり)',
      counterexample: { function: fn.name, migration, expected: `{14 桁}${expected}` },
    }),
  ];
}

/**
 * 本文が手書きの遷移 RPC も、**どの機械のどの状態列を動かすか**が名前から決まること。
 *
 * 生成する遷移は `checkBuildable` が同じ判定(`transitionTargetOf`)を通す。手書きの本文でも、実 DB との突合
 * (rpc-parity)・監査ログの語彙・実行計画の RPC 名はこの名前の形に寄りかかるので、決まらない名前を手書きの免除で
 * 残さない。
 *
 * @param fn 関数の宣言
 * @param table その関数の持ち場
 * @param domain ドメイン仕様
 * @returns 違反のリスト
 */
function checkHandwrittenTransition(fn: DataFunctionDecl, table: DataTableSpec, domain: SpecModel): Finding[] {
  if (fn.kind !== 'rpc' || fn.shape !== 'transition' || table.entity === undefined) return [];
  const resolved = transitionTargetOf(fn.name, table.entity, domain);
  if (resolved.ok) return [];
  return [
    t6Finding({
      message: resolved.problem.message,
      location: { ...table.location, pointer: `functions.${fn.name}` },
      suggestion: resolved.problem.suggestion,
      counterexample: resolved.problem.counterexample,
    }),
  ];
}

/** その関数が本文を生成する形か(`kind: rpc` かつ定型)。 */
function generatedShapeOf(fn: DataFunctionDecl): GeneratedShape | null {
  if (fn.shape === undefined) return null;
  return (GENERATED_SHAPES as readonly string[]).includes(fn.shape) ? (fn.shape as GeneratedShape) : null;
}

/**
 * 本文が**実際に組み立てられる**ことを見る(生成器が報告する前提そのもの)。
 *
 * 判定を書き写さず `collectRpcFacts` を呼ぶ —— 本文を作るのと同じ写像なので、
 * ここが緑なら `code-rpc-bodies` は必ず SQL を返す(`preconditionFailure` に落ちない)。
 *
 * @param fn 関数の宣言
 * @param table その関数の持ち場
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table(条件にする集約の表名・遷移の RPC を呼ぶ操作を引く)
 * @param actions action_spec(あれば、作成・編集・遷移の `input` の欄が本文に届くことも見る)
 * @returns 違反のリスト
 */
function checkBuildable(
  fn: DataFunctionDecl,
  table: DataTableSpec,
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  actions: ActionSpecModel | undefined,
): Finding[] {
  const shape = generatedShapeOf(fn);
  if (shape === null) return [];
  const collected = collectRpcFacts({
    name: fn.name,
    params: fn.params,
    args: fn.args,
    shape,
    table,
    domain,
    tableOf: (entity) => dataTables.tables.find((candidate) => candidate.entity === entity)?.table ?? null,
    // action_spec は「人が渡す欄」と監査ログの payload にしか効かず、組み立ての可否は変えない
    // (欄の母集合は entity_spec が持つ)。渡すのは、宣言した欄が本文に届くかを同じ写像で見るためである。
    actions,
    // 全 data_table を渡す(先掴みの計画に閉包の行が入る。生成器と同じ入力で、下の掴みの順の照合を同じ計画の上で見る)。
    tables: dataTables.tables,
  });
  if (collected.ok) {
    const order = fkCheckOrderProblems({ name: fn.name, shape, table }, collected.facts).map((problem) => t6Finding({ message: problem.message, location: { ...table.location, pointer: `functions.${fn.name}` }, suggestion: problem.suggestion, counterexample: problem.counterexample }));
    if (actions === undefined || shape === 'delete') return order;
    return [
      ...order,
      ...checkInputsReach(fn, table, shape, collected.facts, actions, { domain, dataTables }),
      ...(shape === 'transition' ? checkTransitionColumnsDeclared(fn, table, collected.facts, actions, domain) : []),
    ];
  }
  return collected.problems.map((problem) =>
    t6Finding({
      message: problem.message,
      location: { ...table.location, pointer: `functions.${fn.name}` },
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
    }),
  );
}
