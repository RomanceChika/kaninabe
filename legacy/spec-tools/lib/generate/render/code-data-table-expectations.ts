/**
 * data_table → 期待スキーマ表(`app/src/domain/generated/data-table-expectations.ts`)の生成器。
 *
 * テーブル仕様(data_table)が宣言する DB 固有の実装判断 — インデックス・外部キーの
 * ON DELETE・トリガ・関数の帰属・非導出 CHECK・列の既定値 — を「実 DB に存在すべき実体の完全集合
 * (閉世界)」として写す。統合テスト(data-table-parity)が pg_catalog と突き合わせ、
 * 「宣言にあるのに DB に無い」「DB にあるのに宣言に無い」の両方を落とす
 * (rls-expectations + policy-parity と同じ流儀。ARCH-SP-BE-0001 §テーブル仕様)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { createHash } from 'node:crypto';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import { frameworkFunctionDecls, frameworkTriggerDecls } from '../../world/index.js';
import { frameworkTriggersOf } from '../../sql/framework-guards.js';
import { parseFires, updatedColumnsOf } from '../../model/trigger-fires.js';
import { triggerBodySource } from '../../sql/ddl-guards.js';
import { generatedTriggers } from '../../sql/ddl-triggers.js';
import { conditionWordsOf } from '../../sql/trigger-condition-words.js';
import { sendLimitBody } from '../../sql/send-limit.js';
import { ceilingDeclsOf } from '../../model/data/ceiling-plan.js';
import { refCounterpartDeclsOf } from '../../model/data/ref-check-shape.js';
import { invariantEdgeGapsOf } from '../../sql/ddl-ref-check-edges.js';
import { usecaseCompositeFunctions } from '../../usecase/composite.js';
import { inboundRpcFunctions } from '../../inbound/inbound-functions.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { expectationTypeLines } from './code-data-table-expectation-types.js';
import { registryLines } from './code-data-table-registries.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待スキーマ表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'data-table-expectations.ts');

/**
 * **本文が生成物になるトリガ関数**の名前 → その本文の md5。
 *
 * 生成した本文が実 DB に当たっていない(古い migration のまま・手で書き換えた)ことは、関数の
 * 名前の実在だけでは保証できない —— 定型 RPC の本文を `rpc-parity` が見ているのと同じ粒度を、
 * トリガにも与える。手書きと宣言された関数(`functions[].handwritten`)はここに載らない
 * (載せる本文が無いので、突合は実在までである)。
 *
 * @param spec テーブル仕様
 * @param domain ドメイン仕様
 * @param tables 全 data_table(写し元の物理テーブル名を引く)
 * @returns 関数名 → 本文の md5
 */
function generatedBodyMd5(
  spec: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  // 設計図が持つ執行点(`framework-guards.ts`)の本文も生成物である(製品の隔離の門の見張りが「生成物でない」を md5 の有無で読む。点検 D25s3-2)。
  for (const trigger of [...generatedTriggers(spec, domain, tables), ...frameworkTriggersOf(spec)]) {
    found.set(
      trigger.function.name,
      createHash('md5').update(triggerBodySource(trigger.function)).digest('hex'),
    );
  }
  // 送信の上限の本文も生成物である(`sql/send-limit.ts`。migration の `$$` の内側 = `prosrc` と同じ字面)。
  for (const fn of spec.functions) {
    if (fn.kind !== 'send_limit' || fn.sendLimit === undefined) continue;
    found.set(fn.name, createHash('md5').update(sendLimitBody(fn.name, fn.sendLimit)).digest('hex'));
  }
  return found;
}

/**
 * **本文が生成物になるトリガ関数**の名前 → 定義者の権限で実行するか。
 *
 * ここが正であって仕様の宣言ではない —— 生成物の権限は生成器の計画が決める
 * (読み直すトリガだけ `definer`。`ddl-guards.ts`)。仕様が重ねて宣言することは T17 が止める。
 * 設計図が持つ執行点(`framework-guards.ts`)も同じ表に載る —— DDL に出るのは同じ 1 本である。
 *
 * @param spec テーブル仕様
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 関数名 → 定義者権限か
 */
function generatedSecurityDefiner(
  spec: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): ReadonlyMap<string, boolean> {
  const found = new Map<string, boolean>();
  for (const trigger of [...generatedTriggers(spec, domain, tables), ...frameworkTriggersOf(spec)]) {
    found.set(trigger.function.name, trigger.function.securityDefiner === true);
  }
  return found;
}

/**
 * その関数を**定義者の権限で実行するか**の期待(1 本につき 1 つの正から取る)。
 *
 * | 種別 | 正 |
 * |---|---|
 * | `rpc` / `helper` / `send_limit` | **必ず `definer`**(種別の意味そのもの) |
 * | `trigger`(本文が生成物) | **生成器の計画** |
 * | `trigger`(手書き) | 仕様の `security`(**省略は `invoker`**) |
 *
 * @param fn 関数の宣言
 * @param generated 生成物の権限(名前 → 定義者権限か)
 * @returns 定義者の権限で実行するか
 */
/** 更新の列の名指し(小文字・昇順。列を名指さない更新は 'all'・更新で発火しなければ null)。 */
function updateOfColumns(fires: string): readonly string[] | 'all' | null {
  const columns = updatedColumnsOf(fires);
  return columns === null || columns === 'all' ? columns : [...columns].sort();
}

function securityDefinerOf(fn: DataFunctionDecl, generated: ReadonlyMap<string, boolean>): boolean {
  if (fn.kind !== 'trigger') return true;
  return generated.get(fn.name) ?? fn.security === 'definer';
}

/** 照らす語をリテラルに写す(不変条件を名指さなければ null。照らせなければ理由だけを運び、語と列は空)。 */
function conditionLiteral(words: ReturnType<typeof conditionWordsOf>): LiteralValue {
  if (words === null) return null;
  if (words.unreadable !== null) {
    return { invariant: words.invariant, unreadable: words.unreadable, premise: [], requires: [], premiseColumns: [], requiresColumns: [], vocabulary: [] };
  }
  return {
    invariant: words.invariant,
    unreadable: null,
    premise: words.premise.map((word) => [...word]),
    requires: words.requires.map((word) => [...word]),
    premiseColumns: [...words.premiseColumns],
    requiresColumns: [...words.requiresColumns],
    vocabulary: [...words.vocabulary],
  };
}

/** 1 テーブル分の宣言を、突合テストが読むリテラルに写す(突合しない宣言は落とす)。 */
function tableLiteral(
  spec: DataTableSpec,
  extraFunctions: readonly DataFunctionDecl[],
  bodies: ReadonlyMap<string, string>,
  security: ReadonlyMap<string, boolean>,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): LiteralValue {
  // **未ログインの作成の天井**(access_spec の `creates[].abuse` から生成されるトリガと関数)も、宣言されたものと同じ閉世界に載る。
  const ceiling = ceilingDeclsOf(spec, domain);
  // **参照の欄が指す行を読む条件の相手の端**(自表の執行点と不変条件の formal から生成されるトリガと関数。fix25s)も同じ。
  const counterparts = refCounterpartDeclsOf(spec, domain, tables);
  return {
    internal: spec.internal,
    indexes: spec.indexes.map((index) => ({
      name: index.name,
      columns: [...index.on],
      unique: index.unique,
      partial: index.where !== undefined,
      where: index.where ?? null,
    })),
    exclusions: spec.exclusions.map((exclusion) => ({
      name: exclusion.name,
      keys: [...exclusion.keys],
      range: [...exclusion.range],
      partial: exclusion.where !== undefined,
      where: exclusion.where ?? null,
    })),
    foreignKeys: spec.foreignKeys.map((fk) => ({
      column: fk.column,
      references: fk.references,
      onDelete: fk.onDelete,
    })),
    // **設計図が持つ執行点も同じ閉世界に載る**(束 ③-2 の前提)。仕組みが自分で持つ表の
    // 追記専用トリガは宣言の正が `world/framework-triggers.ts` にあるだけで、実 DB に在るべき実体としては
    // 宣言されたトリガと区別が無い —— 載せないと「DB にあって宣言に無い」で落ちる。
    triggers: [...spec.triggers, ...frameworkTriggerDecls(spec), ...ceiling.triggers, ...counterparts.triggers].map((trigger) => ({
      name: trigger.name,
      functionName: trigger.functionName,
      deferred: trigger.deferred,
      // 発火の細部も突合の対象にする(`pg_trigger.tgtype` と比べられる形に割る)。
      // 宣言が無ければ null —— 突合しないのは「宣言が無い」ときだけである。
      // 更新の列の名指し(`of …`)も運ぶ(`pg_trigger.tgattr` と比べる。列の更新で発火することを宣言の検査 T28 が当てにする)。
      fires: trigger.fires === undefined ? null : { ...parseFires(trigger.fires), updateOf: updateOfColumns(trigger.fires) },
      // 宣言した不変条件の前提・条件を本文と `when (…)` で照らす語(`sql/trigger-condition-words.ts`。点検 20 回目の後の P3)。
      conditions: conditionLiteral(conditionWordsOf(trigger, spec, domain)),
    })),
    functions: [...spec.functions, ...frameworkFunctionDecls(spec), ...ceiling.functions, ...counterparts.functions, ...extraFunctions].map((fn) => ({
      name: fn.name,
      args: [...fn.args],
      kind: fn.kind,
      securityDefiner: securityDefinerOf(fn, security),
      bodyMd5: bodies.get(fn.name) ?? null,
      lookup: [...(fn.lookup ?? [])],
    })),
    checks: spec.checks.map((check) => check.name),
    defaults: { ...spec.defaults },
  };
}

/** 期待スキーマ表のファイル全体を組み立てる。 */
function renderFile(
  tables: readonly DataTableSpec[],
  composites: readonly { readonly table: string; readonly fn: DataFunctionDecl }[],
  domain: SpecModel,
): string {
  const byTable: Record<string, LiteralValue> = {};
  for (const spec of tables) {
    byTable[spec.table] = tableLiteral(
      spec,
      composites.filter((composite) => composite.table === spec.table).map((composite) => composite.fn),
      generatedBodyMd5(spec, domain, tables),
      generatedSecurityDefiner(spec, domain, tables),
      domain,
      tables,
    );
  }
  const internals = tables.filter((spec) => spec.internal).map((spec) => spec.table);

  return [
    generatedHeader(tables.map((spec) => spec.location.file)),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    ...expectationTypeLines(),
    '',
    docComment([
      'テーブルごとの期待スキーマの完全集合(閉世界)。',
      '',
      'キーの集合そのものが「public スキーマに存在すべきテーブルの完全集合」であり、',
      'ここに無いテーブルが DB にあれば突合テストが落ちる(逆も落ちる)。',
      '列・型・NOT NULL はここに無い — その正は entity_spec で、row-parity(strict な rowSchema)が守る。',
      'checks は entity_spec の導出でない CHECK 制約の実在だけを見る(導出分は宣言しない)。',
    ]),
    'export const dataTableExpectationsByTable: Readonly<Record<string, DataTableExpectation>> =',
    `  ${frozen(renderLiteral(byTable, 1))};`,
    '',
    docComment([
      'access_spec を持たない内部テーブル(読み取りポリシー 0 本 = 全不可視が期待)。',
      'policy-parity がこの表を「誰にも読ませないテーブル」の正として使う(手書きの重複を持たない)。',
    ]),
    `export const internalTables: readonly string[] = ${frozen(renderLiteral(internals))};`,
    '',
    docComment([
      '不変条件の書き込みの端のうち、どの DB の執行点も発火しないもの(`formal` が check / state_dependency の全部。',
      '判定は legacy/spec-tools/lib/sql/ddl-ref-check-edges.ts の invariantEdgeGapsOf)。',
      'data-table-parity が、製品の理由つきの閉じた表と両方向に照らす(載っていない端も、要らなくなった行も赤)。',
    ]),
    `export const invariantEdgeGaps: readonly { readonly invariant: string; readonly table: string; readonly edge: string }[] = ${frozen(
      renderLiteral(invariantEdgeGapsOf(domain, tables).map((gap) => ({ invariant: gap.invariant, table: gap.table, edge: gap.edge }))),
    )};`,
    '',
    ...registryLines(tables, domain),
  ].join('\n');
}

/**
 * 全 data_table から期待スキーマ表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/data-table-expectations.ts`(全体生成)。
 */
export const dataTableExpectationsGenerator: DocGenerator = {
  id: 'code-data-table-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const dataTables = ctx.dataTables;
    if (dataTables === undefined || !dataTables.available || dataTables.tables.length === 0) return [];
    const composites = [
      ...usecaseCompositeFunctions({
        domain: model,
        actions: ctx.actions ?? null,
        dataTables,
        usecases: ctx.usecases,
      }),
      // 受信の RPC(external_spec の受信の行から生成する関数)も同じ閉世界に載せる。
      ...inboundRpcFunctions({ domain: model, dataTables, external: ctx.external, roots: ctx.roots }),
    ];
    return [
      { file: outputFile(ctx.roots), content: renderFile(dataTables.tables, composites, model), wholeFile: true },
    ];
  },
};
