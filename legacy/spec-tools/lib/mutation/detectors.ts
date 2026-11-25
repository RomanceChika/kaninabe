/**
 * 変異を**捕る側**の目録(束 ⑳-5c)。どれも「モデルから観測できるものの指紋」を取るだけである。
 *
 * 7 つの目を並べる。どれも実 DB を使わない —— 実 DB で実行する変異は CI に入れない(設計 §1)。
 *
 * | 検査 | 何を見ているか | 実 DB で何が起きるか |
 * |---|---|---|
 * | `rpc_body` | 定型 RPC の本文(**執行点**)| 本文が変われば RPC が通す / 拒む組み合わせが変わる |
 * | `ddl` | 表の DDL と権限の本文(**執行点**。列・CHECK・索引・外部キー・ACL)| 制約や権限が変われば DB が受け入れる行・できることが変わる |
 * | `rls_policy` | RLS ポリシーの本文(**執行点**)| 述語が変われば返る行集合が変わる |
 * | `rls_world` | RLS の world の設計図(挙動テストの**期待の入力**)| オラクルが計算する可視集合が変わる |
 * | `equivalence` | 一致の証明の**期待**(engine の判定。軸は変異前のまま)| 生成テストの期待が変わる |
 * | `verify` | `verify` の Finding | 仕様の検査が赤 / warning になる |
 * | `risk` | 危ない形の検査(R 群)の Finding | 役の根拠の欄の書き手・上限の無い欄の検査が赤になる |
 *
 * **なぜ `rls_world` が「オラクルそのもの」ではないのか。** オラクル
 * (`@kaninabe/runtime/testing/rls/oracle`)は実行時パッケージに出たので、依存としては docs からも
 * 呼べる。呼ばないのは、オラクルが「設計図 × 実 DB の行 × 実行者」の純関数であり、変異の実行には
 * 実 DB の行も実行者の world も無いからである —— 変異が動かせるのは**入力である設計図**だけで、
 * 設計図が変われば期待も変わる。ここが見ているのはその入力である。オラクル自身を回す目
 * (パッケージから呼んで world を組む入口)は申し送りに残す。
 *
 * 純関数であり throw しない(生成器が前提の破れで止まる場合は `matrix.ts` が指紋に畳む)。
 * **アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { ALL_VERIFIERS } from '../verify/verifiers/index.js';
import { REACHABILITY_VERIFIER_IDS } from '../verify/z3-reachability.js';
import { rpcBodiesGenerator } from '../generate/render/code-rpc-bodies.js';
import { ddlGenerator } from '../generate/render/code-ddl.js';
import { grantsGenerator } from '../generate/render/code-grants.js';
import { rlsPoliciesGenerator } from '../generate/render/code-rls-policies.js';
import { rlsWorldsGenerator } from '../generate/render/code-rls-worlds.js';
import { resultAggregatesOf } from '../results/cases.js';
import { engineTablesOf } from '../results/decide.js';
import type { DocGenerator } from '../gen-kit/generator.js';
import type { MutationDetector, MutationSubject } from './types.js';
import type { VerifyContext } from '../check-api/contract.js';
import type { CatalogInput } from '../kernel/input-state.js';
import { verifyGroundWriters } from '../risk/verifiers/r2-ground-writers.js';
import { verifyFieldBounds } from '../risk/verifiers/r10-field-bounds.js';
import { verifyAbuse } from '../risk/verifiers/r5-abuse.js';

/** 生成器 1 つの出力を指紋にする(ファイル名順で並べ、本文をそのまま連ねる)。 */
function generatedFingerprint(generator: DocGenerator, model: SpecModel, subject: MutationSubject): string {
  return generator
    .generate(model, subject.context)
    .map((section) => `${section.file}\n${section.content}`)
    .sort()
    .join('\n----\n');
}

/** 定型 RPC の本文(執行点)。 */
const rpcBody: MutationDetector = {
  id: 'rpc_body',
  title: '定型 RPC の本文(執行点)',
  fingerprint: (model, subject) => generatedFingerprint(rpcBodiesGenerator, model, subject),
};

/**
 * 表の DDL と権限の本文(執行点)。
 *
 * 列・NOT NULL・CHECK・索引・外部キー・排他制約がここに出る。**不変条件の `formal` が
 * 生成物に反映される唯一の経路**でもあり(`checks[]` が `invariant` だけを宣言する行)、
 * 束 ㉓ まではこの目が無かったので、式を壊しても誰も気づかなかった。
 *
 * **権限の生成器も同じ 1 つの目で見る。** 権限は表の DDL から系に 1 本へ切り出されたが
 * (`grants-migration.ts`)、壊れたときに起きることは同じ「DB が受け入れることが変わる」で
 * あり、置き場が分かれたことを変異の目録に持ち込む理由は無い —— 可視性(`reads`)の変異は
 * ACL の期待に出るので、この目がそれを捕る。
 */
const ddl: MutationDetector = {
  id: 'ddl',
  title: '表の DDL と権限の本文(執行点)',
  fingerprint: (model, subject) =>
    [ddlGenerator, grantsGenerator].map((generator) => generatedFingerprint(generator, model, subject)).join('\n===\n'),
};

/** RLS ポリシーの本文(執行点)。 */
const rlsPolicy: MutationDetector = {
  id: 'rls_policy',
  title: 'RLS ポリシーの本文(執行点)',
  fingerprint: (model, subject) => generatedFingerprint(rlsPoliciesGenerator, model, subject),
};

/** RLS の world の設計図(挙動テストの期待の入力)。 */
const rlsWorld: MutationDetector = {
  id: 'rls_world',
  title: 'RLS の world の設計図(挙動テストの期待の入力)',
  fingerprint: (model, subject) => generatedFingerprint(rlsWorldsGenerator, model, subject),
};

/**
 * 一致の証明の期待(engine の判定)。
 *
 * **軸は変異前の目録から取り、判定だけを変異後のモデルから組む**(申し送り 1)。
 */
const equivalence: MutationDetector = {
  id: 'equivalence',
  title: '一致の証明の期待(engine の判定 ✅ / ❌ と理由)',

  fingerprint(model: SpecModel, subject: MutationSubject): string {
    const tables = engineTablesOf(model, subject.guards, subject.actions ?? null);
    const lines: string[] = [];
    for (const aggregate of resultAggregatesOf(subject.catalog, tables)) {
      for (const operation of aggregate.operations) {
        for (const found of operation.cases) {
          lines.push(
            [
              operation.op,
              found.state ?? '',
              found.actor,
              found.array,
              found.field ?? '',
              found.axis.map((axis) => `${axis.key}=${axis.label}`).join(','),
              found.decision.allowed ? 'ok' : found.decision.reason,
              found.decision.allowedRoles.join('/'),
              found.decision.guardSource ?? '',
            ].join('|'),
          );
        }
      }
      lines.push(...aggregate.problems.map((problem) => `problem|${aggregate.aggregate}|${problem}`));
    }
    return lines.join('\n');
  },
};

/** 題材の入力(あれば読込済み・無ければ未選択)。製品の宣言を持たない呼び手(変異の指紋)専用で、選択の推定ではなく題材の形の写しである。 */
function loadedOrUnselected<T>(value: T | null | undefined): CatalogInput<T> {
  return value === undefined || value === null ? { state: 'unselected', findings: [] } : { state: 'loaded', value, findings: [] };
}

/**
 * `verify` の Finding(仕様の検査)。
 *
 * **母集合は V 群だけ**である。A 群を入れないのは意図であり、手加減ではない —— A 群には
 * 「その宣言に執行点が無い」ことを報告する検査(A17 / A18)があり、その Finding は**壊した式を
 * そのまま引用している**。式を落とせば Finding の字面も変わるので、A 群を指紋に混ぜると
 * **「引用が変わった」だけで「捕った」に数えられる** —— 執行の挙動は 1 ビットも変わっていないのに
 * 検査が効いているように見える、いちばん危ない空振りの緑になる。A18 が報告している漏れは
 * 「捕った」ではなく**報告された漏れ**として別に数える(`lib/mutation/exemptions.ts`)。
 *
 * **到達性(V21)も同じ理由で外す。** ここは `withZ3Reachability` を噛ませていない(指紋は
 * 同期で取る契約なので噛ませられない)ため、V21 は「答えの表が配線されていません」しか
 * 言えない。その文面に機械名や状態 ID が入っていれば、状態・イベントを足す / 消す / 改名する
 * 変異が**執行の挙動を 1 ビットも変えないまま「捕った」に化ける** —— A 群を外したのと
 * まったく同じ構図である。V21 自身も文面から名前を落としてあるが(v21-bounded-reachability.ts)、
 * 二重に守る:母集合から外し、外れていることをテストが実測する。
 *
 * 充足性の判定は**自作の列挙器のまま**である(`subject.guards`)。ここが取るのは指紋であって
 * 判定の正ではなく、指紋は同期で取る契約になっている。列挙器が `unknown` を返す式では
 * 「捕った」が減る方向(保守側)に寄るだけなので、二重の正にはならない。
 */
const verify: MutationDetector = {
  id: 'verify',
  title: '`verify` の Finding(仕様の検査)',

  fingerprint(model: SpecModel, subject: MutationSubject): string {
    const ctx: VerifyContext = {
      guards: subject.guards,
      roots: subject.context.roots,
      // 変異の題材は製品の宣言(`uses`)を持たない。あるものは読込済み・無いものは採っていない(= 判定の母集合が空)として渡す
      // —— 指紋が取るのは判定の字面だけで、入力の状態の報告(実行ログ)は取らない。
      actions: loadedOrUnselected(subject.actions),
      dataTables: loadedOrUnselected(subject.dataTables),
    };
    return ALL_VERIFIERS.filter((verifier) => !REACHABILITY_VERIFIER_IDS.includes(verifier.id))
      .flatMap((verifier) => verifier.verify(model, ctx))
      .map((finding) => `${finding.verifier}|${finding.severity}|${finding.message}`)
      .sort()
      .join('\n');
  },
};

/**
 * 危ない形の検査(R 群)の Finding(役の根拠の欄の書き手・上限の無い欄・未ログインの書き込みの歯止め)。
 *
 * 変異の題材は認証フロー・外部連携・ユースケースを持たないので、内部実行の入口はジョブのカタログだけで追う
 * (変異の前後で同じ材料なので、指紋の差は変異そのものから出る)。
 */
const risk: MutationDetector = {
  id: 'risk',
  title: '危ない形の検査(R 群)の Finding',

  fingerprint(model: SpecModel, subject: MutationSubject): string {
    const run = verifyGroundWriters({
      model,
      actions: subject.actions,
      dataTables: subject.dataTables,
      catalogs: { auth: undefined, external: undefined, jobs: subject.jobs?.catalog ?? undefined, dataTables: subject.dataTables },
      blockedSources: [],
    });
    return [...run.findings, ...verifyFieldBounds(model), ...verifyAbuse(model, subject.dataTables)]
      .map((finding) => `${finding.verifier}|${finding.severity}|${finding.message}`)
      .sort()
      .join('\n');
  },
};

/** 検査の全数(対応表の列の順序もこの順)。 */
export const ALL_MUTATION_DETECTORS: readonly MutationDetector[] = [
  rpcBody,
  ddl,
  rlsPolicy,
  rlsWorld,
  equivalence,
  verify,
  risk,
];
