/**
 * T16 宣言 CHECK の**式の出どころ**と、**DB の執行点の接地**
 * (data_table の `checks[]` ⇔ invariant_spec の `formal` / `enforced_by`)。
 *
 * `checks[]` の行が `invariant` だけを宣言しているとき、条件式の正は invariant_spec にあり、
 * 生成器がそれを行の CHECK に反映する(`lib/sql/check-expression.ts`)。この検証器が見るのは
 * **式の出どころが 1 つに決まっているか**と、**反映できないなら理由が言えるか**である。
 *
 *   - (a) `invariant` が実在すること(実在しない ID を宣言する行は、由来も式も持たない)
 *   - (b) `rule` と `invariant` の**両方**があり、`formal` から式を反映できるのに
 *     `rule` がそれと違う → **error**。同じ制約の式が 2 か所にあって食い違っている状態であり、
 *     どちらが正かを読む手がかりがどこにも無い
 *   - (c) `handwritten`(手書きの migration が作る執行点)の宣言が形として成り立つこと ——
 *     理由が空でない・`rule` と同時に宣言しない・`invariant` を宣言する行にだけ書ける
 *   - (d) `invariant` だけを宣言する行で式を反映できない → **warning** で**反映できない理由**を報告する
 *   - (e) 逆向き: `enforced_by` の `ref`(`kind: db_constraint` と **`kind: trigger`** の
 *     2 種)が、**どの data_table の宣言にも無い** → **warning**。「宣言した執行点が実在しない」を
 *     宣言する目である(T5 が排他制約について error で見ているものの、制約の種類を問わない版)。
 *     トリガまで見るのは、**本文が生成物でない執行点**(`kind: trigger` の関数)を宣言から
 *     外したときに、その不変条件が「誰にも守られていない」ことを報告し続けるためである
 *     —— fixture 3 題材で 7 本が実際にその状態だった(束 ③-4 の実測。トリガ本文の生成が
 *     入るまで執行点は無い)
 *
 * (d) と (e) の警告は `reason`(理由の区分。語は `check-reasons.ts`)を明示の欄で持つ。拡張候補の台帳が
 * 「形式定義が DSL の写像の外(数の上限・状態依存・形式定義なし)= 仕組みが組めない」と「書けるのに宣言していない =
 * 製品が直せる」を分けるために読む(`lib/extension/scope.ts`)。反例の `formal`(形式定義の種別。無ければ空)は
 * 人が読む事実として残す。
 *
 * (d) と (e) を黙らせないのが R-3(triage-null-literal-3 §4-4)への答えである ——
 * 「宣言した執行点が実在しない」ことを誰も報告しないまま、fixture の一致の証明が
 * **執行点の無い DB の上で緑**になっていた。反映できないこと自体は誤りではない(別集約の欄を
 * 見る条件の執行点はトリガである)が、**どれが反映されていないかは毎回言える**ようにする。
 *
 * **(e) が error ではなく warning なのは、執行点が無いこと自体は仕様として成り立つから**で
 * ある —— 「まだ執行点を持てない」(語彙が足りない・トリガ本文が生成物でない)は実際にある
 * 状態であり、そこを error で塞ぐと逃げ道は「嘘の宣言を書く」しか無くなる。警告は消えないので、
 * 執行点が生えた日に自然に消える。
 *
 * **実 DB との突合は (e) の代わりにならない。** `ddl-parity` の閉世界が見るのは
 * **data_table が宣言した名前が DB に在るか**であり、`handwritten` を宣言する行(= 名前は
 * 宣言にある)の嘘はそこで error になる。ところが (e) の穴は**宣言そのものが無い**状態なので、
 * 突合の母集合に最初から入らない —— **そこを報告できるのは T16 だけ**である
 * (独立レビュー C-4)。
 */

import { allMachines } from '../../model/types.js';
import type { InvariantDef, SpecModel, StateMachineSpec } from '../../model/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { ceilingDeclsOf } from '../../model/data/ceiling-plan.js';
import { checkExpressionOf } from '../../sql/check-expression.js';
import { derivedChecks } from '../../sql/ddl-checks.js';
import { primaryKeyName } from '../../sql/ddl-plan.js';
import { foreignKeyName } from '../../sql/ddl-placement.js';
import type { Finding } from '../../kernel/finding.js';
import { T16_REASONS, groundingReasonOf, referencesOtherAggregate } from '../check-reasons.js';
import { carrierAggregateNames } from '../invariant-carriers.js';
import type { DataCheckDecl, DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T16';

/** T16 の指摘を組み立てる。 */
function t16(severity: Finding['severity'], args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity, ...args };
}

/**
 * 宣言 CHECK の式の出どころを検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyCheckExpression(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  const invariants = new Map<string, InvariantDef>();
  const hostNames = new Map<string, ReadonlySet<string>>();
  for (const [aggregate, specs] of domain.aggregates) {
    const own = new Set([aggregate, ...(specs.entity === undefined ? [] : [specs.entity.entity])]);
    for (const invariant of specs.invariants?.invariants ?? []) {
      invariants.set(invariant.id, invariant);
      hostNames.set(invariant.id, own);
    }
  }
  const carrierNames = carrierAggregateNames(domain, dataTables);
  return [
    ...dataTables.tables.flatMap((table) =>
      table.checks.flatMap((check) => checkRow(check, table, domain, invariants)),
    ),
    ...[...invariants.values()].flatMap((invariant) =>
      grounding(
        invariant,
        carrierNames.get(invariant.id) ?? hostNames.get(invariant.id) ?? new Set<string>(),
        constraintNames(domain, dataTables),
        triggerNames(domain, dataTables),
      ),
    ),
  ];
}

/**
 * その表が DB に持つ**制約の名前**の全数。`enforced_by: kind: db_constraint` の `ref` が
 * 指せるのはここに並ぶものだけである(トリガは `kind: trigger`、アプリの関数は
 * `kind: application` が受け持つ)。
 *
 * | 出どころ | 名前 |
 * |---|---|
 * | data_table の `checks[]` / `indexes[]` / `exclusions[]` | 宣言された名前そのまま |
 * | **外部キー**(data_table は名前を書かない) | `ddl-placement.ts` の `foreignKeyName` |
 * | **主キー**(宣言に現れない) | `ddl-plan.ts` の `primaryKeyName` |
 * | **entity_spec から導出する CHECK**(宣言に現れない) | `ddl-checks.ts` の `derivedChecks` |
 *
 * **宣言に現れない 3 種を落とすと偽の warning が出る** —— 導出 CHECK も主キーも外部キーも
 * れっきとした `pg_constraint` の行であり、不変条件がそれを執行点として名指すのは正しい
 * (独立レビュー C-3)。どれも**名前の正は生成器の関数 1 本**から引き、規約をここに写さない。
 */
function constraintNames(domain: SpecModel, dataTables: DataTableSpecModel): ReadonlySet<string> {
  const machines: ReadonlyMap<string, StateMachineSpec> = new Map(
    allMachines(domain).map((ref) => [ref.machine.machine, ref.machine]),
  );
  const names = new Set<string>();
  for (const table of dataTables.tables) {
    for (const check of table.checks) names.add(check.name);
    for (const index of table.indexes) names.add(index.name);
    for (const exclusion of table.exclusions) names.add(exclusion.name);
    for (const fk of table.foreignKeys) names.add(foreignKeyName(table.table, fk.column));
    names.add(primaryKeyName(table.table));
    const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
    for (const field of entity?.fields ?? []) {
      for (const derived of derivedChecks(field, table.table, machines)) names.add(derived.name);
    }
  }
  return names;
}

/**
 * data_table が宣言した**関数**の名前の全数。
 *
 * `enforced_by: kind: trigger` の `ref` が指せるのはここに並ぶものだけである ——
 * 規約(domain-spec-writing.md §enforced_by)が `ref` に書くのは**トリガ関数名**であり、
 * トリガの名前(`triggers[].name`)ではない。**`triggers[].name` を母集合に入れない**のは、
 * 名前と関数が違う表(`name: foo` / `function: bar`)で `ref: foo` と書く誤りを
 * 素通りさせるだけだからである(題材の製品の 22 本はすべて `functions[].name` で接地する。
 * 独立レビュー 束 ③-4 の観点 6)。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 宣言された関数名の集合
 */
function triggerNames(domain: SpecModel, dataTables: DataTableSpecModel): ReadonlySet<string> {
  const names = new Set<string>();
  for (const table of dataTables.tables) {
    // 未ログインの作成の天井(access_spec の abuse から生成されるトリガ関数)も、宣言されたものと同じ実在の執行点。
    for (const fn of [...table.functions, ...ceilingDeclsOf(table, domain).functions]) names.add(fn.name);
  }
  return names;
}

/** (e) `enforced_by` の `ref`(制約 / トリガ)が data_table のどこにも無い。 */
function grounding(
  invariant: InvariantDef,
  ownNames: ReadonlySet<string>,
  constraints: ReadonlySet<string>,
  triggers: ReadonlySet<string>,
): Finding[] {
  const formal = invariant.formal?.kind ?? '';
  const crossesAggregates =
    invariant.formal?.kind === 'check' && referencesOtherAggregate(invariant.formal.expr, ownNames);
  const missing = invariant.enforcedBy.filter(
    (enforcement) =>
      (enforcement.kind === 'db_constraint' && !constraints.has(enforcement.ref)) ||
      (enforcement.kind === 'trigger' && !triggers.has(enforcement.ref)),
  );
  return missing.map((enforcement) =>
    t16('warning', {
      message: `${invariant.id}: 執行点 ${enforcement.ref} は data_table のどの宣言にも無い(実在しない執行点である)`,
      location: enforcement.location,
      suggestion:
        'その執行点を data_table に宣言する(行の条件なら checks[]・鍵の一意なら indexes[]・' +
        '期間の重なりなら exclusions[]・別の行を見る条件なら triggers[])。まだ執行点を持てないなら、' +
        '持てない理由を仕様の側に書き残したうえでこの警告を残す —— 消すために嘘の宣言を書かない',
      counterexample: { invariant: invariant.id, ref: enforcement.ref, kind: enforcement.kind, formal },
      reason: groundingReasonOf(enforcement.kind, formal, crossesAggregates, invariant.formalOutside !== undefined),
    }),
  );
}

/** `checks[]` の 1 行を見る。 */
function checkRow(
  check: DataCheckDecl,
  table: DataTableSpec,
  domain: SpecModel,
  invariants: ReadonlyMap<string, InvariantDef>,
): Finding[] {
  const location = { ...table.location, pointer: `checks.${check.name}` };
  const findings = [...handwrittenShape(check, table, location)];
  if (check.invariant === undefined) return findings;
  if (!invariants.has(check.invariant)) {
    return [
      ...findings,
      t16('error', {
        message: `CHECK ${check.name} の invariant ${check.invariant} は実在しません`,
        location,
        suggestion: '綴りを直すか、その不変条件を invariants.md に宣言する(由来の無い執行点は何を守っているか読めない)',
        counterexample: { constraint: check.name, invariant: check.invariant },
      }),
    ];
  }
  const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  if (entity === null) return findings;
  const written = checkExpressionOf(check.invariant, entity, domain);
  if (check.rule !== undefined) {
    return [...findings, ...ruleAgreement(check, written, location)];
  }
  if (check.handwritten !== undefined || written.ok) return findings;
  return [
    ...findings,
    t16('warning', {
      message: `CHECK ${check.name}(${check.invariant})の式は DDL に反映されません: ${written.reason}`,
      location,
      suggestion:
        'そのままでよいなら執行点は別の形(トリガ・一意索引・排他制約)であり、data_table 側の宣言を' +
        'そちらへ移す。手書きの migration が作っているなら handwritten に理由を書く。' +
        '行の CHECK に畳める条件なら formal をその形に書き直す',
      counterexample: { constraint: check.name, invariant: check.invariant, reason: written.reason },
      reason: T16_REASONS.checkNotReflected,
    }),
  ];
}

/** (c) `handwritten` の宣言が形として成り立っているか。 */
function handwrittenShape(
  check: DataCheckDecl,
  table: DataTableSpec,
  location: Finding['location'],
): Finding[] {
  const reason = check.handwritten;
  if (reason === undefined) return [];
  if (reason.trim() === '') {
    return [
      t16('error', {
        message: `CHECK ${check.name} の handwritten が空です`,
        location,
        suggestion:
          'handwritten には「式を生成せず手書きの migration に残す」理由そのものを書く' +
          '(理由の無い宣言は免除リストであり、この形は持たない)',
        counterexample: { constraint: check.name, table: table.table },
      }),
    ];
  }
  if (check.rule !== undefined) {
    return [
      t16('error', {
        message: `CHECK ${check.name} は rule と handwritten を同時に宣言しています`,
        location,
        suggestion:
          'rule は「式の正を仕様に置いた」宣言であり、「式は手書きの migration にある」とは両立しない。' +
          'どちらか 1 つにする',
        counterexample: { constraint: check.name, rule: check.rule, handwritten: reason },
      }),
    ];
  }
  if (check.invariant !== undefined) return [];
  return [
    t16('error', {
      message: `CHECK ${check.name} は invariant を宣言せずに handwritten を宣言しています`,
      location,
      suggestion:
        'handwritten は「不変条件の formal から反映できる式を、あえて生成しない」ことの宣言である。' +
        '由来の不変条件が無い行では生成する式がそもそも無いので、宣言を外す',
      counterexample: { constraint: check.name, table: table.table },
    }),
  ];
}

/** (b) `rule` と、`formal` から反映できる式が食い違っていないか。 */
function ruleAgreement(
  check: DataCheckDecl,
  written: ReturnType<typeof checkExpressionOf>,
  location: Finding['location'],
): Finding[] {
  if (!written.ok || check.rule === undefined) return [];
  const rule = `(${check.rule})`;
  // 生成器は `rule` を丸括弧で包んで DDL に出すので、包む前と包んだ後のどちらで書かれていても
  // 「同じ式」と読む(丸括弧の有無は `pg_get_constraintdef` の印字でも消える)。
  if ([squeeze(check.rule), squeeze(rule)].includes(squeeze(written.expression))) return [];
  return [
    t16('error', {
      message: `CHECK ${check.name} の rule が ${check.invariant} の formal から反映できる式と一致しません`,
      location,
      suggestion:
        'rule を消して formal から反映する(式の正を 2 か所に置かない)。手書きの migration に' +
        '残すなら rule ではなく handwritten に理由を書く',
      counterexample: { constraint: check.name, rule, formal: written.expression },
    }),
  ];
}

/** 空白を詰める(SQL の改行・空白の入れ方に依存しないため)。 */
function squeeze(text: string): string {
  return text.replace(/\s+/gu, '');
}
