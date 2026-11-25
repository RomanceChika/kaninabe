/**
 * CLI 結線(読み込み → 台帳 → 各群)の既知解テスト。
 *
 * BACKLOG「CLI の結線テスト → 既知解テスト」への対応。
 *
 * 各検証器(V1〜V12 / A1〜A12 / Q1〜Q7 / S1〜S10 …)はそれぞれ自分の unit テストを持つが、
 * それらは全部 `SpecModel` / `QueryInput` / `ScreenSpecModel` を**インメモリで組み立てて**
 * 検証器へ直接渡す(model-builder.ts / screen-builder.ts / query-builder.ts)。
 * つまり「ファイルを読む」「群を正しい順で呼ぶ」「見つけた Finding を集計する」という
 * **配線そのもの**(`lib/model/loader.ts` / `lib/compose/verify-pipeline.ts` / `cli/verify-docs.ts`)は、
 * どの unit テストからも一度も通らない。配線を誰かが壊しても(例: `ALL_VERIFIERS` から 1 行
 * 消す、群の呼び出しを 1 つコメントアウトする)、既存のテストは全部緑のままになる —
 * これが「黙って緑」になる TCB(Trusted Computing Base)の穴である。
 *
 * ここでは**実ファイルシステムの壊れた仕様 fixture 束**を、CLI と同じ入口
 * (`runAllVerifications`)に読ませ、**エラー件数が既知の値から動かないこと**を見る。
 * 件数が 0 になった(または大きく減った)ら、検査パイプライン自体が壊れたと判定してよい。
 *
 * fixture は使い回す — 各ローダー(`loader.test.ts` 群)が既に持つ「壊れた仕様」の
 * fixture ディレクトリ(`domain-invalid` / `actions-invalid` / `queries-invalid` /
 * `screens-invalid`)を、CLI が期待する相対配置(`{root}/domain` /
 * `{root}/backend/actions` / `{root}/backend/queries` / `{root}/frontend`)に
 * 組み直して 1 本のツリーにする(新しい fixture を増やさない。壊れ方の正はローダー側の
 * テストが持ち続ける)。T/N/J/K/H/Z/X/U/G/M 群はソースが無ければ黙ってスキップされる
 * (A 群と同じ設計)ので、この最小版では V/A/Q/S の 4 群(＋台帳・ドメイン検証)だけを
 * 対象にする。
 */

import { TEST_VERIFY_INPUTS } from '../helpers/platform.js';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import type { Finding } from '../../lib/kernel/finding.js';
import { TEST_ROOTS, writeProductDeclaration } from '../helpers/product-roots.js';
import type { SpecKind } from '../../lib/model/product/uses.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/**
 * スキーマは妥当(Q0 を通る)だが、projection に実在しない列を書いた query_spec(Q1 違反)。
 *
 * `fixtures/queries-invalid` はスキーマ違反(Q0)だけを持つ束であり、Q1〜Q7(意味検証)を
 * 1 件も踏まない(この行が無いと `runQueries` の呼び出しをまるごと外しても総数が動かない
 * ことを確認した)。source は domain-invalid が持つ `entry`(id / price / state の 3 列)。
 */
const BROKEN_SEMANTIC_QUERY = `---
doc_type: query_spec
scope: backend
id: query-entry-broken-semantic

name: broken_semantic
for: [member]
source: entry
scope_used: all
returns: many
paging: none
projection: [id, not_a_real_field]

test_cases:
  - id: TC-ENTRY-BROKEN_SEMANTIC-001
    type: integration
    covers: [success]
    spec_ids: [query-entry-broken-semantic]
    implementation: app/src/composition/__tests__/entry/broken_semantic.test.ts::x
---

# Q1 違反(存在しない列を projection に書いた)フィクスチャ
`;

describe('検査パイプラインの既知解テスト(CLI結線: 読み込み→台帳→各群)', () => {
  /** 一時ツリーのルート(宣言を置いた親。**消すのはここ**)。 */
  let repo: string;
  let root: string;
  let findings: readonly Finding[];
  let modelBuilt: boolean;
  let ledgerCandidateCount: number | null;

  beforeAll(async () => {
    // **一時ツリーも 1 つの製品である。** 宣言を直下に置き、仕様の木はその宣言が指す位置に組む
    // —— 仕組みは「宣言を上へ探す」ことでリポジトリルートを決めるからである(束 ①-a)。
    repo = mkdtempSync(join(tmpdir(), 'verify-pipeline-canary-'));
    // 一時ツリーが持つ種類(action / query / screen + chrome)だけを採る。
    writeProductDeclaration(repo, ['actions', 'queries', 'screens']);
    root = join(repo, TEST_ROOTS.specs);
    mkdirSync(join(root, 'backend'), { recursive: true });
    cpSync(join(FIXTURES, 'domain-invalid'), join(root, 'domain'), { recursive: true });
    cpSync(join(FIXTURES, 'actions-invalid'), join(root, 'backend', 'actions'), { recursive: true });
    cpSync(join(FIXTURES, 'queries-invalid'), join(root, 'backend', 'queries'), { recursive: true });
    cpSync(join(FIXTURES, 'screens-invalid', 'screens'), join(root, 'frontend', 'screens'), {
      recursive: true,
    });
    cpSync(join(FIXTURES, 'screens-invalid', 'chrome'), join(root, 'frontend', 'chrome'), {
      recursive: true,
    });
    // `queries-invalid` だけだと Q0(スキーマ)止まりで Q1〜Q7(意味検証)に 1 件も届かない
    // (試験済み: runQueries の呼び出しを丸ごと外しても総数が変わらなかった)。
    // Q1(列の実在)を確実に踏む、スキーマは妥当な1本をここに直接書く。
    mkdirSync(join(root, 'backend', 'queries', 'entry'), { recursive: true });
    writeFileSync(
      join(root, 'backend', 'queries', 'entry', 'broken_semantic.md'),
      BROKEN_SEMANTIC_QUERY,
    );

    const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: join(root, 'domain') });
    findings = result.findings;
    modelBuilt = result.modelBuilt;
    ledgerCandidateCount = result.extensionLedger.ledger?.candidates.length ?? null;
  });

  afterAll(() => {
    // **消すのは一時ツリーの親である。** 仕様の木だけを消すと宣言と `docs/` が毎回残る
    // (harness.ts が「誰も消せない経路を作らない」に長い注釈を割いているのと同じ種類の後退)。
    rmSync(repo, { recursive: true, force: true });
  });

  it('壊れているのはファイルの中身であって構造ではないので、モデルは構築できる', () => {
    expect(modelBuilt).toBe(true);
  });

  it('4群(ドメイン検証・A・Q・S)のそれぞれが実際に Finding を出している(0件のまま黙って通っていない)', () => {
    // 「エラーがちょうど N 件出るはず」の N は群ごとに見る — 1 つの群の穴を、
    // 別の群のエラーで隠さないため(合計だけを見ると、ある群が丸ごと呼ばれなくなっても
    // 他の群のエラーで合計が 0 にならず、この検査が黙って通ってしまう)。
    const domainVerifierIds = new Set([
      'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12',
    ]);
    const byGroup = {
      domain: findings.filter((finding) => domainVerifierIds.has(finding.verifier)),
      a: findings.filter((finding) => /^A\d+$/.test(finding.verifier)),
      q: findings.filter((finding) => /^Q\d+$/.test(finding.verifier)),
      s: findings.filter((finding) => /^S\d+$/.test(finding.verifier)),
    };

    for (const [group, groupFindings] of Object.entries(byGroup)) {
      expect(groupFindings.length, `群 ${group} の Finding が 0 件です(検査が呼ばれていない疑い)`).toBeGreaterThan(0);
    }
  });

  it('拡張候補の台帳が配線されている(仕組み自身の台帳を読めて、W5 は 1 件も出さない)', () => {
    // 台帳は仕組み自身のパッケージにあり、検証する製品(この一時ツリー)に依らず読める。
    expect(ledgerCandidateCount).toBeGreaterThan(0);
    expect(findings.filter((finding) => finding.verifier === 'W5')).toEqual([]);
  });

  it('既知解: 総 Finding 件数が実測値から動いていない(増減したら配線を疑って調べる)', () => {
    // この数は「正しい」目標値ではなく、いまの fixture 束に対する実測の固定である。
    // 増減そのものが悪いわけではない(検証器を1つ足せば当然増える) — この行の役目は
    // 「0件になっていないか」「大きく食い違っていないか」に人の目を向けさせることであり、
    // fixture か検証器を意図して変えたら、実測し直してこの数を更新してよい。
    expect(findings.length).toBe(EXPECTED_FINDING_COUNT);
  });
});

/**
 * 群ごとの**配線の見張り**(上の既知解の木とは別の、エラーなしで読める木)。
 *
 * 上の木は壊れた仕様を持つので、A 群は**読めなかった仕様があって阻害**になり、A 群の Finding は読み込みの診断(A0)だけになる
 * —— A0 は読み込んだ側が足すので、`findings.push(...trace.findings)` を潰しても件数も「4 群が出している」も動かない(独立レビュー e7)。
 * ここでは題材の仕様の木(読み込みの error なし)を 1 箇所だけ変えて、**検査器 1 本が違反を出す**木を群ごとに作り、
 * その違反(群の 0 番を除く)が全体の Finding に届いていることを見る。配線の 1 行を潰すと、その群の行が赤になる。
 */
const WIRING_BASE = join(FIXTURES, 'samples', 'stores', 'docs', 'specs');
const WIRING_USES: readonly SpecKind[] = [
  'actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'external', 'surface', 'screens', 'usecases',
];

/** 1 つのファイルの 1 箇所を書き換える(無ければ落とす = 反例が反例でなくなるのを防ぐ)。 */
function rewrite(file: string, from: string, to: string): void {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`${file} に ${from} が無い`);
  writeFileSync(file, source.replace(from, to));
}

describe('検査パイプラインの配線の見張り(読み込みの error なしで読める木が、群ごとの検査器に違反を出させる)', () => {
  const wiring: readonly {
    readonly group: string;
    /** 群の 0 番(ローダーの診断)を除いた検査器 ID。 */
    readonly verifier: RegExp;
    readonly break: (specs: string) => void;
  }[] = [
    { group: 'A(トレース)', verifier: /^A([1-9]\d*)$/, break: (specs) => rmSync(join(specs, 'backend', 'actions', 'sales_order', 'cancel.md')) },
    { group: 'S(画面)', verifier: /^S([1-9]\d*)$/, break: (specs) => rmSync(join(specs, 'frontend', 'screens', 'store', 'store_detail.md')) },
    {
      group: 'T(テーブル仕様)',
      verifier: /^T([1-9]\d*)$/,
      break: (specs) => rewrite(join(specs, 'backend', 'data', 'tables', 'stores.md'), 'table: stores', 'table: stores_x'),
    },
    {
      group: 'X(外部連携)',
      verifier: /^X([1-9]\d*)$/,
      break: (specs) => rewrite(join(specs, 'backend', 'external.md'), 'emits: sales_order.pay', 'emits: sales_order.nonexistent'),
    },
    {
      group: 'Y(ユースケース)',
      verifier: /^Y([1-9]\d*)$/,
      break: (specs) => rewrite(join(specs, 'frontend', 'usecases', 'order_intake.md'), 'op: sales_order.create', 'op: sales_order.nonexistent'),
    },
  ];

  it.each(wiring)('$group: 検査器の違反(0 番を除く)が全体の Finding に届く', async ({ verifier, break: breakTree }) => {
    const repo = mkdtempSync(join(tmpdir(), 'verify-pipeline-wiring-'));
    try {
      writeProductDeclaration(repo, WIRING_USES);
      const specs = join(repo, TEST_ROOTS.specs);
      cpSync(WIRING_BASE, specs, { recursive: true });
      breakTree(specs);

      const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: join(specs, 'domain') });

      expect(result.findings.filter((finding) => verifier.test(finding.verifier)).length).toBeGreaterThan(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

/**
 * 実測した既知解(2026-10-07。前回 88 / 2026-09-26)。
 *
 * 更新するとき: このテストを実行して実際の件数を見て書き換える(逆算で先に書かない — この値は
 * 「壊れた fixture を検証器に食わせた結果」であって、狙って作った値ではないため)。
 *
 * 84 → 88 の内訳(束 ①-a。一時ツリーを**宣言を持つ 1 つの製品**として組み直したことの帰結):
 * M1 / M2 が 2 件ずつ増えた —— 仕様の木の位置が宣言から決まるようになったので、M 群が壊れた
 * fixture のフロントマターまで届くようになった(以前は走査ルートを解けずスキップしていた)。
 *
 * 88 → 87 の内訳(部品化 ②-j。action_spec の入力の状態を A 群へ渡した帰結): action_spec が 1 枚も読めず A0 の error が
 * 残る一時ツリーでは、A 群は**阻害**として判定を出さない(読めなかった仕様があるモデルでは検査しない)。
 * この件数は A 群の配線の証拠にならない(A0 は読み込んだ側が足す)。A 群・S / T / X / Y 群の配線は、上の「配線の見張り」が別の木で持つ。
 * 以前は 0 件の部分のモデルで A 群が走り、「全部のイベントが action_spec に無い」という A4 の指摘が 1 件出ていた
 * —— 読めなかった仕様が起こす誤報である。A0 の 9 件は変わらない。
 *
 * 87 → 89 の内訳(黙った既定の総点検の A2): ドメイン仕様が副作用を宣言していれば、その接地先のカタログ(ジョブ・通知)も
 * 採ることを P2 が要求するようになった。この一時ツリーは access_spec が読めない集約(`broken`)を持つので、副作用の有無を
 * 数えられない —— 数えられないときは要求を外さない(壊れた仕様の日に依存の指摘だけが消える形にしない)ので、P2 が 2 件増えた。
 */
const EXPECTED_FINDING_COUNT = 89;
