/**
 * テーブル仕様の検査(T 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `DATA_STEPS` を上から回すだけで、検査を足すときに触るのはここ(と検証器そのもの)である。
 * 並びは**違反の並び**を決める(従来の実行順のまま)。ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する(綴りを 2 か所に書かない)。
 * 全検査の表(`lib/compose/all-checks.ts`)は `DATA_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { unusableOf, type CatalogInput, type InputGapNote } from '../kernel/input-state.js';
import { T0_VERIFIER_ID } from '../model/data/loader.js';
import type { IndexRequirementsResult } from '../relations/index-requirements/index.js';
import { narrowStepInput, type DataBackingKind, type DataRunInput, type DataStepInput } from './input.js';
import { VERIFIER_ID as T1, verifyEntityConsistency } from './verifiers/t1-entity-consistency.js';
import { VERIFIER_ID as T2, verifyIndexExpectations } from './verifiers/t2-index-expectations.js';
import { VERIFIER_ID as T3, verifyDataTableTestTrace } from './verifiers/t3-test-trace.js';
import { VERIFIER_ID as T4, verifyTenantCanaries } from './verifiers/t4-tenant-canary.js';
import { VERIFIER_ID as T5, verifyExclusionGrounding } from './verifiers/t5-exclusion-grounding.js';
import { VERIFIER_ID as T6, verifyRpcMigration } from './verifiers/t6-rpc-migration.js';
import { verifyPoliciesMigration } from './verifiers/t7-policies-migration.js';
import { VERIFIER_ID as T7 } from './verifiers/t7-rls-helpers.js';
import { VERIFIER_ID as T8, verifyRlsWorlds } from './verifiers/t8-rls-world.js';
import { VERIFIER_ID as T9, verifySuppliesDeclared } from './verifiers/t9-supplies-declared.js';
import { VERIFIER_ID as T10, verifyContextReadable } from './verifiers/t10-context-readable.js';
import { VERIFIER_ID as T11, verifyEqWorlds } from './verifiers/t11-eq-world.js';
import { VERIFIER_ID as T12, verifyDdlMigration } from './verifiers/t12-ddl-migration.js';
import { surfacePlatformOf } from './verifiers/t12-surface-naming-input.js';
import { VERIFIER_ID as T13, verifySequenceGrounding } from './verifiers/t13-sequence-grounding.js';
import { VERIFIER_ID as T14, verifyRpcArgTypes } from './verifiers/t14-rpc-arg-types.js';
import { VERIFIER_ID as T15, verifySuppliedMechanism } from './verifiers/t15-supplied-mechanism.js';
import { VERIFIER_ID as T16, verifyCheckExpression } from './verifiers/t16-check-expression.js';
import { VERIFIER_ID as T17, verifyTriggerBody } from './verifiers/t17-trigger-body.js';
import { VERIFIER_ID as T18, verifyCompositeEnforces } from './verifiers/t18-composite-enforces.js';
import { VERIFIER_ID as T19, verifyRealizedBy } from './verifiers/t19-realized-by.js';
import { VERIFIER_ID as T20, verifyWriteKinds } from './verifiers/t20-write-kinds.js';
import { VERIFIER_ID as T21, verifyCascadeClosure } from './verifiers/t21-cascade-closure.js';
import { VERIFIER_ID as T22, verifyEventWrites } from './verifiers/t22-event-writes.js';
import { VERIFIER_ID as T23, verifyUniqueIndexGrounding } from './verifiers/t23-unique-index-grounding.js';
import { VERIFIER_ID as T24, verifyPersonalCopyErasure } from './verifiers/t24-personal-copy-erasure.js';
import { VERIFIER_ID as T27, verifyLockDecls } from './verifiers/t27-lock-decls.js';
import { VERIFIER_ID as T28, verifyCopyOwnerMemory } from './verifiers/t28-copy-owner-memory.js';
import { VERIFIER_ID as T25, verifyPersonalPlaceholders } from './verifiers/t25-personal-placeholder.js';
import { VERIFIER_ID as T26, verifySendLimits } from './verifiers/t26-send-limit.js';

/**
 * 段が**ほかの種類の入力**に依る部分の宣言(どの入力に依るか・使えないと見ていないこと)。
 *
 * 段が飛ぶ(または一部の判定を出さない)条件は、ここに宣言した入力の状態だけである。**未選択は「裏づけが無い」という事実**
 * (その種類を採っていない製品に、裏づけに依る判定は元から無い)で、実行ログは何も言わない。**阻害は「分からない」**で、
 * 依る判定は出さず(欠けた事実から判定を導かない)、`dataStepGaps` が「阻害 — …は見ていません」の行にする。
 * **宣言した種類だけが段から見える**(`dataStep` が `narrowStepInput` で絞り、型も `K` に絞る)ので、宣言と実際の読み取りはずれない。
 */
export interface DataStepRead<K extends DataBackingKind = DataBackingKind> {
  /** 依る入力の種類。 */
  readonly kind: K;
  /** その入力が使えないために見ていないこと(文末。句点は付けない)。 */
  readonly unseen: string;
}

/**
 * 実行の段 1 つ(検査 1 本)。`run` は実行口が配る完全な入力を受け、`dataStep` が宣言した裏づけだけに絞って検証器へ渡す。
 * `derived` は索引の要求(T2 の材料。query_spec と関数の `lookup` から導く。run.ts が 1 回だけ導いて配る)。
 */
export interface DataStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: DataStepInput, derived: IndexRequirementsResult): Finding[];
  /** ほかの種類の入力に依る部分(空ならテーブル仕様だけで決まる段)。 */
  readonly reads: readonly DataStepRead[];
  /**
   * テーブル仕様の**全体**を前提とする段か。true は、表が 1 枚でも欠けたモデルで回すと偽の error(または warning)を生む段
   * (実在するエンティティに表が無い・別の表を引いて確かめる・別の表が持つ宣言に接地する、など)。読み込みで仕様を落としたときは、
   * この段だけ止めて名指す。false は表ごとに自己完結(宣言された表の中身を、ドメイン仕様と突き合わせるだけ)で、読めた分で回す。
   */
  readonly needsWhole: boolean;
}

/** `dataStep` に渡す段の記述。 */
interface DataStepSpec<K extends DataBackingKind> {
  readonly id: string;
  readonly title: string;
  /** 依る裏づけの種類(`run` から見えるのはこの種類だけ)。 */
  readonly reads?: readonly DataStepRead<K>[];
  /** テーブル仕様の全体を前提とする段(既定 false = 表ごとに自己完結)。 */
  readonly needsWhole?: true;
  run(input: DataStepInput<K>, derived: IndexRequirementsResult): Finding[];
}

/**
 * 段を作る。`run` へ渡す入力は、`reads` に宣言した裏づけだけに絞る(宣言に無い種類は型にも実行時にも無い)。
 *
 * @param spec 段の記述
 */
function dataStep<K extends DataBackingKind = never>(spec: DataStepSpec<K>): DataStep {
  const reads = spec.reads ?? [];
  const kinds = reads.map((read) => read.kind);
  return {
    id: spec.id,
    title: spec.title,
    reads,
    needsWhole: spec.needsWhole === true,
    run: (input, derived) => spec.run(narrowStepInput(input, kinds), derived),
  };
}

/** 実行の順(違反の並びを決める。T11 は action_spec が読込済みのときだけ回る)。 */
export const DATA_STEPS: readonly DataStep[] = [
  dataStep({ id: T1, title: 'テーブル仕様 ⇔ ドメイン仕様の一貫性(実在・表名・重複・閉世界)', needsWhole: true, run: (i) => verifyEntityConsistency(i.domain, i.dataTables, i.roots) }),
  dataStep({ id: T5, title: '排他制約の接地(invariant_spec の exclusion ⇔ data_table の exclusions)', needsWhole: true, run: (i) => verifyExclusionGrounding(i.domain, i.dataTables) }),
  dataStep({ id: T23, title: '一意の不変条件の接地(invariant_spec の uniqueness ⇔ data_table の unique の索引の on / where)', needsWhole: true, run: (i) => verifyUniqueIndexGrounding(i.domain, i.dataTables) }),
  dataStep({
    id: T6,
    title: '生成する関数の本文の出どころ(migration / handwritten)と、input の欄が本文に届くこと',
    needsWhole: true,
    run: (i) => verifyRpcMigration(i.domain, i.dataTables, i.actions),
    reads: [{ kind: 'actions', unseen: '作成・編集の関数で、宣言した input の欄が本文に届くか' }],
  }),
  dataStep({ id: T7, title: 'RLS のポリシー本文と補助関数の出どころ(policies_migration)', needsWhole: true, run: (i) => verifyPoliciesMigration(i.domain, i.dataTables, i.platform) }),
  dataStep({
    id: T12,
    title: '表の DDL・公開スキーマの土台・surface のビュー・権限の出どころ',
    needsWhole: true,
    run: (i) =>
      verifyDdlMigration(i.domain, i.dataTables, i.roots, surfacePlatformOf(i.platform), i.usecases, i.external, i.surface, i.surfaceBlocked),
    reads: [
      { kind: 'usecases', unseen: '公開スキーマの土台より前に当たるべき保存点の migration の順序' },
      { kind: 'external', unseen: '公開スキーマの土台より前に当たるべき受信の migration の順序' },
      { kind: 'surface', unseen: 'surface_spec の宣言(土台・手書きで残すビュー・権限の migration)に依る判定' },
    ],
  }),
  dataStep({ id: T8, title: 'RLS の挙動テストの生成可否(行を置けない表を黙って飛ばさない)', needsWhole: true, run: (i) => verifyRlsWorlds(i.domain, i.dataTables) }),
  dataStep({ id: T9, title: 'トリガが供給する列は entity_spec が「DB が決める値」と宣言する(V17 の逆向き)', run: (i) => verifySuppliesDeclared(i.domain, i.dataTables) }),
  dataStep({ id: T10, title: 'context(X) を与えるロールは X も読める(中継表の RLS は重なる)', run: (i) => verifyContextReadable(i.domain, i.dataTables) }),
  dataStep({ id: T13, title: 'defaults が名指す採番の器は、ちょうど 1 か所で流せる値で宣言されている', needsWhole: true, run: (i) => verifySequenceGrounding(i.dataTables) }),
  dataStep({ id: T14, title: '1 欄ずつ受ける引数の宣言型は、その列の型と一致する', needsWhole: true, run: (i) => verifyRpcArgTypes(i.domain, i.dataTables) }),
  dataStep({ id: T15, title: 'トリガが供給・導出する列を、生成物だけの系で誰が埋めるか', run: (i) => verifySuppliedMechanism(i.domain, i.dataTables) }),
  dataStep({ id: T16, title: '宣言 CHECK の式の出どころと、DB の執行点の接地', needsWhole: true, run: (i) => verifyCheckExpression(i.domain, i.dataTables) }),
  dataStep({
    id: T17,
    title: 'トリガ関数の本文の出どころ(handwritten / 生成できること)',
    run: (i) => verifyTriggerBody(i.domain, i.dataTables, i.repoRoot, i.roots, i.actions),
    reads: [{ kind: 'actions', unseen: '凍らせた列を作成でない操作の computes が書くか' }],
  }),
  dataStep({ id: T18, title: 'composite の関数が執行点になる規則の宣言(enforces)', run: (i) => verifyCompositeEnforces(i.domain, i.dataTables) }),
  dataStep({
    id: T20,
    title: '書き込みの宣言の接地(scrub は個人列を持つ表にだけ・書き込み先は実在する表で自表でない・呼び先は実在する関数)',
    needsWhole: true,
    run: (i) => verifyWriteKinds(i.domain, i.dataTables),
  }),
  dataStep({ id: T21, title: '削除から外部キーの連鎖(cascade / set null)で起きる書き込みも宣言に載る', needsWhole: true, run: (i) => verifyCascadeClosure(i.dataTables) }),
  dataStep({
    id: T19,
    title: '同一トランザクションで実現される効果が、実現する RPC を名指しする(realized_by の過不足と RPC の実在)',
    needsWhole: true,
    run: (i) => verifyRealizedBy(i.domain, i.dataTables, i.jobs),
    reads: [{ kind: 'jobs', unseen: '同一トランザクションで実現される効果が実現する RPC の名指し(realized_by)' }],
  }),
  dataStep({
    id: T22,
    title: '複数のイベントが通る RPC の破壊的な書き込みは、イベントごとに宣言する(event_writes)',
    needsWhole: true,
    run: (i) => verifyEventWrites(i.domain, i.dataTables, i.jobs),
    reads: [{ kind: 'jobs', unseen: 'realized_by で名指されたイベントが RPC を通ること(遷移の RPC を通るイベントは見ている)' }],
  }),
  dataStep({ id: T25, title: '個人列の置換値が列の制約(一意・長さ・空・型)に収まる', needsWhole: true, run: (i) => verifyPersonalPlaceholders(i.domain, i.dataTables) }),
  dataStep({
    id: T27,
    title: '掴みの宣言の接地(トリガの掴む親は直の外部キーの先・写し元の表と列・個人列の写しは写し元を宣言・消去の関所の参照先と印の列)',
    needsWhole: true,
    run: (i) => verifyLockDecls(i.domain, i.dataTables),
  }),
  dataStep({
    id: T28,
    title: '個人列の写しの古い値の持ち主を記録する口(持ち主の列が書ける・行が消せる(写しが cascade で一緒に消えない)写し元の表は remembers_owner のトリガを持ち、行の削除・持ち主の列と写される個人列の更新の全部で発火する)',
    needsWhole: true,
    run: (i) => verifyCopyOwnerMemory(i.domain, i.dataTables, i.jobs),
    reads: [{ kind: 'jobs', unseen: '消去の効果(anonymizes)の集約を直に指す、作った後に書ける持ち主の列' }],
  }),
  dataStep({
    id: T26,
    title: '送信の上限の接地(書き出し先・署名・種別・止める状態・呼ぶ RPC)',
    needsWhole: true,
    run: (i) => verifySendLimits(i.domain, i.dataTables, i.jobs),
    reads: [{ kind: 'jobs', unseen: '送信の上限が数える種別がジョブカタログにあること' }],
  }),
  dataStep({
    id: T24,
    title: '本人への参照を持つ個人列と、消去される個人列の写しは、同じ消去で消える(本人へ届く道の全部が消去の RPC の scrub_via か理由つきの受け入れに載る。本人の行が指す表の個人列も分類する)',
    needsWhole: true,
    run: (i) => verifyPersonalCopyErasure(i.domain, i.dataTables, i.jobs),
    reads: [{ kind: 'jobs', unseen: '消去の効果(anonymizes / realized_by)から導く、本人への参照を持つ個人列と写しの消去' }],
  }),
  dataStep({
    id: T11,
    title: '一致の証明(engine ⇔ RPC)の生成可否',
    needsWhole: true,
    run: (i) =>
      i.actions === undefined
        ? []
        : verifyEqWorlds({
            domain: i.domain,
            guards: i.guards,
            actions: i.actions,
            dataTables: i.dataTables,
            jobs: i.jobs,
            jobsBlocked: i.jobsBlocked,
            ...(i.usecases === undefined ? {} : { usecases: i.usecases }),
          }),
    reads: [
      { kind: 'actions', unseen: '操作ごとの一致の証明(engine ⇔ RPC)を生成できるか' },
      { kind: 'jobs', unseen: '副作用がジョブに依る操作の一致の証明を生成できるか' },
      { kind: 'usecases', unseen: '保存点の一致の証明を生成できるか' },
    ],
  }),
  // 索引の要求(T2)の材料は query_spec と関数の `lookup`。query_spec が使えない(未選択・阻害)ことは、実行結果の `indexGaps` が別に言う。
  dataStep({ id: T2, title: '索引の期待値(query_spec・関数の lookup → data_table の indexes)', needsWhole: true, run: (i, derived) => verifyIndexExpectations(derived, i.dataTables) }),
  dataStep({ id: T3, title: 'テスト突合(data_table ⇔ テスト)', needsWhole: true, run: (i) => verifyDataTableTestTrace(i.domain, i.dataTables, i.registry, i.tests, i.roots, i.layout) }),
  dataStep({ id: T4, title: 'テナント境界の見張りテストの宣言', run: (i) => verifyTenantCanaries(i.domain, i.dataTables, i.registry, i.roots) }),
];

/**
 * 段が裏づけに読む入力のうち、**阻害**のものについて、見ていないことを段ごとに返す(未選択は事実なので返さない)。
 * 段の `reads` の宣言から導くので、段を足したときに宣言すれば報告が付く。
 *
 * @param input 実行口の入力(裏づけの入力の状態)
 * @param steps 報告する段(既定は全段。部分のモデルで回した段だけを報告するときに絞る)
 * @returns 検査器 ID と、見ていないことの記録(段の並びの順)
 */
export function dataStepGaps(
  input: DataRunInput,
  steps: readonly DataStep[] = DATA_STEPS,
): readonly { readonly id: string; readonly note: InputGapNote }[] {
  return steps.flatMap((step) =>
    step.reads.flatMap((read) => {
      const state: CatalogInput<unknown> = input[read.kind];
      const gap = unusableOf(state, read.kind);
      return gap === null || gap.state === 'unselected' ? [] : [{ id: step.id, note: { gap, consequence: `${read.unseen}は見ていません` } }];
    }),
  );
}

/**
 * T 群の全検査(ローダーの T0 を含む。全検査の表が読む)。
 * T7 の補助関数の側・T12 の下位の検査(公開スキーマの土台・surface・権限)は、同じ ID のまま上の段の中で呼ばれる。
 */
export const DATA_CHECKS: readonly CheckEntry[] = [
  { id: T0_VERIFIER_ID, title: 'data_table のスキーマ適合(ローダーが実施)' },
  ...DATA_STEPS,
];
