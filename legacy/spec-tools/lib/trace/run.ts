/**
 * トレース検証(A 群)の実行口。
 *
 * app/ の走査を行い、構築した入力を ALL_TRACE_VERIFIERS に流すところまでをまとめる。
 * CLI はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。
 *
 * action_spec の読み込み(A0)と テストケース ID 台帳の構築は CLI が行う。台帳は全仕様種を
 * 母集合とする 1 つの索引であり、1 箇所で 1 回だけ作って各群へ配る(A6 の orphan 判定も
 * A9 の一意性検査も同じ台帳を見る)。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { TcRegistry } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';
import type { CatalogRunInput, TraceInput } from './input.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import { inputValue, unusableOf, type CatalogInput, type CheckRun, type InputGapNote, type UnusableInput } from '../kernel/input-state.js';
import type { SpecKind } from '../model/product/uses.js';
import type { GuardServices } from '../guard/ast.js';
import { scanAppTests } from './scan.js';
import { expandEachTags } from './expand-each.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { ALL_TRACE_VERIFIERS } from './verifiers/index.js';
import { isInputStateVerifier, isPartialInputVerifier } from './verifier.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** 登録済みの検査器 ID(実行ログの範囲表記の母集合)。 */
const TRACE_VERIFIER_IDS: readonly string[] = ALL_TRACE_VERIFIERS.map((verifier) => verifier.id);

/** runTraceVerification の入力(パスはすべて絶対パス)。 */
export interface TraceRunOptions {
  /**
   * action_spec の**入力の状態**(未選択 / 阻害 / 読込済み。**必須**)。製品が `actions` を採っているか(`uses`)と
   * 読み込みの結果から、呼び手が `catalogInput` で作る。
   *
   * 読込済みでなければ(未選択も阻害も)action_spec を前提とする検査(A1〜A8・A10〜A12 など)は実行しない
   * —— 見ていない集合を「空」と偽って渡さない。**どちらで実行しなかったか**は結果の `actionsGap` が言う
   * (採っていない製品に「action_spec が読めない」と言わず、採ったのに読めない製品に「採っていない」と言わない)。
   * **前提が action_spec でない検査(入力の状態を報告する検査。A13)は、読込済みでなくても実行する**
   * —— actions を採らずジョブだけを採る製品で、A13 の実行も報告も消えないように、起動は検査ごとの前提で決める。
   * 読み込みの診断(A0)は読み込んだ側が全体へ足しており、ここでは二重に数えない。
   */
  readonly actions: CatalogInput<ActionSpecModel>;
  /**
   * 実装の木の絶対パス。存在しなくてよく、**宣言していない製品では null**。
   *
   * 空文字に倒さない —— `join('', 'src')` は相対パス `src` になり、cwd に依存する読みが入る。
   */
  readonly appRoot: string | null;
  /** Finding の location.file の基準にするリポジトリルート。 */
  readonly repoRoot: string;
  /**
   * 仕組みの根の絶対パス(仕組み自身の見張りテストの置き場)。**省略は「渡していない」**で、仕組みの走査は `not_requested`
   * (Z3 が未実施と名指しする。単体テスト用 — CLI は必ず渡す)。製品の `uses`・実装の木・action_spec のどれにも依らず走査する。
   */
  readonly frameworkRoot?: string;
  /** 全仕様種のテストケース ID 台帳(A6 が orphan 判定と突合に使う)。 */
  readonly registry: TcRegistry;
  /**
   * ジョブカタログの入力の状態(A13 の材料。**必須** —— 省略して黙って通る口を残さない)。
   * 製品が `jobs` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る。
   */
  readonly jobs: CatalogInput<JobCatalogSpec>;
  /**
   * テーブル仕様の入力の状態(A15 / A18 / A19 の材料。**必須**)。
   * 製品が `data_tables` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る。
   */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  /** ガード式のパーサー(A14 の材料。省略時 A14 はスキップされる)。 */
  readonly guards?: GuardServices;
  /**
   * 外部連携カタログの入力の状態(A10 が受信の `emits` を発火元として数える。**必須**)。
   * 製品が `external` を採っているか(`uses`)と読み込みの結果から、呼び手が `catalogInput` で作る。
   */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 製品が宣言した根(道案内のパスと実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(アプリの枠の後段が与える。実装の木の走査の根と、実装ファイル → 操作 ID の逆引きを引く)。 */
  readonly layout: ProductLayout;
}

/** 入力の状態を報告する検査 1 本の結果(未実施 / 阻害 / 実行)。 */
export interface TraceCheckRun {
  /** 検査器 ID(例: "A13")。 */
  readonly id: string;
  /** その検査が要る仕様の種類(`uses` の語)。 */
  readonly kind: SpecKind;
  /** 入力の状態つきの結果。`executed` は合格を意味しない(違反は全体の Finding に載る)。 */
  readonly run: CheckRun;
}

/**
 * 使えなかった入力のために見ていないことがあった検査 1 本の結果(`PartialRun.gaps`)。
 * 一部の判定だけが入力の阻害に依る形(A15 / A19 のジョブ)も、検査の全体が入力に依る形(A18 のテーブル仕様)も、この 1 本で言う。
 */
export interface TraceGapRun {
  /** 検査器 ID(例: "A15")。 */
  readonly id: string;
  /** 使えなかった入力と、見ていないこと。 */
  readonly note: InputGapNote;
}

/** runTraceVerification の結果。 */
export interface TraceRunResult {
  readonly findings: Finding[];
  /**
   * action_spec を検査へ渡せたか(入力が読込済みか)。
   * false なら action_spec を前提とする検査(A1〜A8・A10〜A12 など)は実行していない(仕様種に依存しない A9 は
   * 別の実行口で走る)。前提が action_spec でない検査(`checkRuns` に載る)は、false でも実行している。
   */
  readonly actionsAvailable: boolean;
  /**
   * action_spec を渡せなかった理由(未選択 = 製品が採っていない / 阻害 = 採ったのに渡せない)。渡せたなら null
   * (`actionsAvailable` の裏返し)。実行ログが、どちらで実行しなかったかを言い分ける。
   */
  readonly actionsGap: UnusableInput | null;
  /**
   * app/ を走査できたか(action_spec が使えなくても走査は行う)。false なら A2 の実装側検査と A6 はスキップされている
   * (走査できても、`actionsAvailable` が false ならそれらは実行していない)。
   */
  readonly appAvailable: boolean;
  /** 読み込めた action_spec の数(CLI のサマリ表示用)。 */
  readonly actionCount: number;
  /**
   * app/ の走査結果。同じ走査を Q 群でも使えるよう外へ渡す
   * (検証器はファイル I/O をしないため、走査は実行口が 1 度だけ行う)。仕組みの根の走査は `framework` に入れ子で添える。
   */
  readonly tests: ScanWithFramework;
  /**
   * 実行した検査器の ID(登録配列そのまま)。実行ログの範囲表記をここから導く
   * —— 手書きの `A1〜A8` は検査器を足したときに腐る(検査の漏れ探し 2026-09-12 §2)。
   */
  readonly verifierIds: readonly string[];
  /**
   * 入力の状態を報告する検査の結果(実行したものも含む)。未実施・阻害は検査の範囲が縮んだことを
   * 意味するので、実行ログが 1 行ずつ理由つきで出す。読み込みの診断はここに載せるだけで、
   * 全体の Finding へは足さない(読み込んだ側がすでに足している)。
   */
  readonly checkRuns: readonly TraceCheckRun[];
  /**
   * 使えなかった入力(ジョブ・テーブル仕様・外部連携)のために見ていないことがあった検査(A10 / A15 / A18 / A19)。
   * 見ていないことが 1 件でもあるものだけ載る(検査の ID ごとに使えなかった入力の数だけ)。実行ログが 1 行ずつ報告する。
   * 検査全体の阻害(`checkRuns`)と違い、ジョブの阻害は一部の判定だけを出さず、ほかの判定は出している。
   * **外部連携の未選択は載らない**(第 3 の発火元が無いのは事実で、A10 は検査を全部実行している)。
   */
  readonly gapRuns: readonly TraceGapRun[];
}

/**
 * 仕様 ⇔ テストのトレース検証を実行する。
 *
 * app/ が無い環境(仕様だけを持つリポジトリ)でも壊れない。その場合 `appAvailable: false` を返し、
 * app/ の実在を前提とするチェック(A2 の実装側・A6)は実行しない。
 *
 * @param domain 構築済みのドメイン仕様モデル(A1 / A3 / A4 の突合先)
 * @param options 読み込み済みの action_spec・走査対象のパス・テストケース ID 台帳
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runTraceVerification(domain: SpecModel, options: TraceRunOptions): TraceRunResult {
  // **実装の木のテストの走査は action_spec に依らない**(走査の前提は実装の木の根だけ)。action_spec が使えなくても行う —— 以降の群
  // (Q / S / T / Z / H / X / Y)の @tc 突合が、action_spec の巻き添えで止まらないように。
  const scanned = scanAppTests(options.appRoot, options.layout, {
    repoRoot: options.repoRoot,
    ...(options.frameworkRoot === undefined ? {} : { frameworkRoot: options.frameworkRoot }),
  });
  // **ひな形の注釈をここで展開する。** 以降の全群(A / Q / S / T / Z / H / X / Y)は
  // 展開後の注釈だけを読むので、全数ループの形を検査ごとに知らなくてよい。
  const tests = expandEachTags(scanned.scan, options.registry);
  const actions = inputValue(options.actions);
  if (actions === undefined) return withoutActions(options, scanned.findings, tests);

  const findings: Finding[] = [...scanned.findings];
  const input: TraceInput = {
    domain,
    actions,
    tests,
    registry: options.registry,
    roots: options.roots,
    layout: options.layout,
    jobs: options.jobs,
    dataTables: options.dataTables,
    external: options.external,
    ...(options.guards === undefined ? {} : { guards: options.guards }),
  };
  const checkRuns: TraceCheckRun[] = [];
  const gapRuns: TraceGapRun[] = [];
  for (const verifier of ALL_TRACE_VERIFIERS) {
    if (isInputStateVerifier(verifier)) {
      const run = verifier.run(input);
      findings.push(...run.verifierFindings);
      checkRuns.push({ id: verifier.id, kind: verifier.kind, run });
    } else if (isPartialInputVerifier(verifier)) {
      const partial = verifier.runPartial(input);
      findings.push(...partial.findings);
      for (const note of partial.gaps) gapRuns.push({ id: verifier.id, note });
    } else {
      findings.push(...verifier.verify(input));
    }
  }
  return {
    findings,
    actionsAvailable: true,
    actionsGap: null,
    appAvailable: scanned.scan.available,
    actionCount: actions.actions.length,
    tests,
    verifierIds: TRACE_VERIFIER_IDS,
    checkRuns,
    gapRuns,
  };
}

/**
 * action_spec を渡せない(採っていない・採ったのに読めない)製品の実行。
 *
 * action_spec を前提とする検査は実行しない(見ていない集合を「空」と偽って渡さない)。**前提がジョブカタログ
 * (と製品の根)だけの検査は実行する** —— actions を採らずジョブだけを採る製品で A13 が消えると、
 * 採ったジョブの違反が黙って通る。結果は actions がある場合と同じ形(`checkRuns`)で返す。
 * 実装の木のテストの走査は action_spec に依らないので、`tests`(と走査の診断)は actions がある場合と同じに返す。
 */
function withoutActions(options: TraceRunOptions, scanFindings: readonly Finding[], tests: ScanWithFramework): TraceRunResult {
  const input: CatalogRunInput = { roots: options.roots, jobs: options.jobs };
  const findings: Finding[] = [...scanFindings];
  const checkRuns: TraceCheckRun[] = [];
  for (const verifier of ALL_TRACE_VERIFIERS) {
    if (!isInputStateVerifier(verifier)) continue;
    const run = verifier.run(input);
    findings.push(...run.verifierFindings);
    checkRuns.push({ id: verifier.id, kind: verifier.kind, run });
  }
  return {
    findings,
    actionsAvailable: false,
    actionsGap: unusableOf(options.actions, 'actions'),
    appAvailable: tests.available,
    actionCount: 0,
    tests,
    verifierIds: TRACE_VERIFIER_IDS,
    checkRuns,
    gapRuns: [],
  };
}
