/**
 * ジョブ仕様検証(J 群)の実行口。
 *
 * ローダー(J0)が構築したカタログを検証器(J1〜J7)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は job-spec-writing.md。
 *
 * **J2 の Cron の登録の突合・J3・J4 は後段が登録する検査**(`target-checks.ts` の口の表。ホストの Cron の登録・DB 内のスケジューラの登録・
 * ホストの頻度制約は具体のスタックの語を持つので、コアは持たない)。束ね役は登録された検査を口に当て、**当たらなかった口は実行せず**
 * `missingTargetChecks`(未実施)で返す(黙って緑にしない。実行ログが名指す)。後段が理由つきで**対象外と宣言した口**は `notApplicableTargetChecks` で別に返す
 * (未実施に数えない)。並びは従来のまま(J1 → J2 の接地 → J2 の登録の突合 → … → J3 → J4 → J5 → J6 → J7)。
 * **口の表(`JOB_CHECK_SLOTS`)の全口が実行の順に載っていること**は `__tests__/unit/job/run-targets.test.ts` が固定する(表と実行の順が食い違えば赤)。
 * 実行の順は `checks.ts` の `JOB_STEPS` が持ち(コアの検査と並ぶ順 = 違反の並びを 1 か所で読める)、ここはその順に回すだけである。
 */

import { appGrounded } from '../io/paths.js';
import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { JobSpecModel } from '../model/job/types.js';
import { verifyEntryCollision } from './verifiers/j2-entry-collision.js';
import { verifyEntryClosedWorld } from './verifiers/j2-entry-closed.js';
import type { EntryClosedResult, EntryClosedStatus } from './verifiers/j2-entry-closed.js';
import { verifyScanOrigin } from './verifiers/j2-scan-origin.js';
import type { ScanOriginResult } from './verifiers/j2-scan-origin.js';
import { JOB_STEPS } from './checks.js';
import { resolveJobChecks } from './target-checks.js';
import type { JobTargetRegistry, NotApplicableJobSlot, UnfilledJobSlot } from './target-checks.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { ProductRoots } from '../model/product/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import { unusableOf } from '../kernel/input-state.js';
import type { CatalogInput, UnusableInput } from '../kernel/input-state.js';

/** runJobVerification の入力。 */
export interface JobRunInput {
  /**
   * 生成の後の木の回し直し(段の宣言 `onGeneratedTree` の段だけを回す。題材の通し実行が使う。fix27 A2)。省略は全部の段。
   */
  readonly generatedTreeOnly?: boolean;
  /** 構築済みのドメイン仕様モデル(effects と fires / due_from の照合先)。 */
  readonly domain: SpecModel;
  /** 読み込み済みのジョブカタログ(J0 はローダーが済ませてある)。 */
  readonly jobs: JobSpecModel;
  /** リポジトリルートの絶対パス(実装・Route Handler・Cron 設定の実在確認に使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木・migration の置き場)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(Route Handler の位置・ソースの根を引く。アプリの枠の後段が与える。実装の木を持たない製品は空の配置でよい)。 */
  readonly layout: ProductLayout;
  /**
   * 外部連携カタログの入力の状態(受信口の URL を HTTP の入口の衝突の主張に入れるための材料)。**未選択**は受信口が事実として無いので何も言わず、
   * **阻害**は受信口の主張を作れない(ジョブどうしの衝突だけ見る。見ていないことは `entryGaps` で返す)。
   */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 読み込み済みの action_spec(`scans` の宣言元。無い環境では `fires` と `scans` の突合を飛ばす)。 */
  readonly actions?: ActionSpecModel;
  /**
   * 読み込み済みの認証フロー仕様(`scans` の発火元のうちサインイン時の同期の実行 = `sign_in[].runs` の宣言元)。
   * 無い環境は `runs` を持たないものとして数える。
   */
  readonly auth?: AuthSpecModel;
  /** 読み込み済みの画面仕様(HTTP の入口の衝突に、画面の `route` を役割をまたぐ主張として入れる。無い環境は画面の主張なし)。 */
  readonly screens?: ScreenSpecModel;
  /**
   * 後段が登録した検査(Cron の登録の突合・DB 内のスケジューラの登録の突合・ホストの頻度制約)と、選んだ後段(`jobTargetsOf(選んだ後段)`)。
   * 必須である(渡し忘れは型が止める。`NO_JOB_TARGETS` は「後段なし」で、受け持つ検査は未実施と報告される)。
   */
  readonly jobTargets: JobTargetRegistry;
}

/** runJobVerification の結果。 */
export interface JobRunResult {
  readonly findings: Finding[];
  /** カタログがあったか。false なら J1 / J2 は実行していない。 */
  readonly available: boolean;
  /** 読み込めたジョブの件数(CLI のサマリ表示用)。 */
  readonly jobCount: number;
  /** うち時刻で起きるものの件数。 */
  readonly scheduledCount: number;
  /**
   * app/ の木があるか。false なら J2 の実装・Route Handler・Cron 登録の突合は飛んでいる
   * (`fires` / `due_from` は仕様だけで判定できるので常に見る)。飛ばしたことを CLI の
   * scope 行に出すためにここで持ち帰る(束 ⑲-1)。
   */
  readonly appGrounded: boolean;
  /**
   * 認証仕様が読めず、`scans` の発火元を判断できなかったイベント(CLI の scope 行に出す。
   * 読めるときと auth.md が無いときは空)。
   */
  readonly scanOriginUnchecked: readonly string[];
  /**
   * 後段が登録しなかったので実行していない検査の口(口の表の並び。未実施。カタログが無いときは空 = カタログが無いことが先に言われる)。
   * 実行ログが「ホストの後段がこの構成に無い」/「ホストの後段 <名前> がこの検査を登録していない」と名指す。
   */
  readonly missingTargetChecks: readonly UnfilledJobSlot[];
  /**
   * 外部連携が阻害で、受信口との URL の衝突を見られなかったこと(阻害のときだけ 1 件。実行ログが行で言う)。
   * ジョブのカタログが無いときも、入口の衝突を実行している(実装の木がある)なら持ち帰る(見出しが画面の route の分だけと言い分ける)。
   */
  readonly entryGaps: readonly UnusableInput[];
  /** 後段が理由つきで対象外と宣言した口(口の表の並び。未実施には数えない。実行ログが別の行で言う)。 */
  readonly notApplicableTargetChecks: readonly NotApplicableJobSlot[];
  /**
   * HTTP の入口の衝突(J2 の続き。受信口と画面の route の取り合い)を実行したか。**ジョブのカタログの有無に依らず**、実装の木を宣言していれば実行する
   * (カタログが無いとき `available` が false でも、この検査は回る。実行ログが「スキップ」の一言で隠さないために持ち帰る)。
   */
  readonly entryCollisionRan: boolean;
  /**
   * HTTP の入口の閉世界(J2 の続き。実装の木の全入口が宣言に当たる)の実行の状態。**ジョブのカタログの有無に依らず**求める
   * (`no_tree` = 実装の木が実在しない・`no_placement` = 配置が入口の逆引きを持たない)。
   */
  readonly entryClosed: EntryClosedStatus;
  /** 宣言を読めず、閉世界の「どの宣言にも当たらない」を判定しなかった種類(阻害。空なら判定した。実行ログが種類ごとに 1 行で言う)。 */
  readonly entryClosedWithheld: EntryClosedResult['withheld'];
  /** 閉世界の走査で読めなかった場所(リポジトリルート相対。空なら完全な走査。実行ログが「阻害」で名指す)。 */
  readonly entryClosedUnreadable: EntryClosedResult['unreadable'];
  /** 後段が登録した検査のうち、この木で突合しなかった分の一言(後段が言う。口の表の並び。実行ログが見出しに添える)。 */
  readonly targetSkips: readonly string[];
}

/**
 * ジョブカタログの検証(J1〜J7)を実行する。
 *
 * カタログが無い環境では検証をスキップし、その旨を報告できる形で返す
 * (ジョブ仕様をまだ開設していないリポジトリでも壊れない)。
 *
 * @param input ドメインモデル・ジョブカタログ・リポジトリルート
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runJobVerification(input: JobRunInput): JobRunResult {
  const entryCollisionRan = input.roots.app !== null;
  const externalGap = unusableOf(input.external, 'external');
  // 外部連携が阻害なら受信口の主張を作れない(未選択は受信口が事実として無い)。ジョブのカタログの有無に依らない。
  const entryGaps = externalGap?.state === 'blocked' ? [externalGap] : [];
  const closed = closedWorldOf(input);
  if (!input.jobs.available) {
    // ジョブのカタログを採らない製品。J2 の接地・Cron の登録の突合は見るものが無いが、HTTP の入口の衝突(受信口と画面の route)と閉世界はジョブに依らないので見る。
    return {
      findings: [...entryFindingsOf(input), ...closed.findings],
      available: false,
      jobCount: 0,
      scheduledCount: 0,
      appGrounded: appGrounded(input.repoRoot, input.roots.app),
      scanOriginUnchecked: [],
      // 入口の衝突を実行しない(実装の木が無い)ときは、受信口を見られなかったと言う相手が無い。
      entryGaps: entryCollisionRan ? entryGaps : [],
      missingTargetChecks: [],
      notApplicableTargetChecks: [],
      entryCollisionRan,
      entryClosed: closed.status,
      entryClosedWithheld: closed.withheld,
      entryClosedUnreadable: closed.unreadable,
      targetSkips: [],
    };
  }
  const jobs = input.jobs.catalog?.jobs ?? [];
  const origin: ScanOriginResult =
    input.actions === undefined
      ? { findings: [], unchecked: [] }
      : verifyScanOrigin({ jobs: input.jobs, actions: input.actions, auth: input.auth });
  const targets = resolveJobChecks(input.jobTargets);
  const checkInput = { domain: input.domain, jobs: input.jobs, repoRoot: input.repoRoot, roots: input.roots };
  const context = { checkInput, targets, origin, entry: entryFindingsOf(input), closed };
  return {
    findings: JOB_STEPS.filter((step) => input.generatedTreeOnly !== true || step.onGeneratedTree === true).flatMap((step) => step.run(input, context)),
    available: true,
    jobCount: jobs.length,
    scheduledCount: jobs.filter((decl) => decl.source === 'schedule').length,
    appGrounded: appGrounded(input.repoRoot, input.roots.app),
    scanOriginUnchecked: origin.unchecked,
    entryGaps,
    missingTargetChecks: targets.missing,
    notApplicableTargetChecks: targets.notApplicable,
    entryCollisionRan,
    entryClosed: closed.status,
    entryClosedWithheld: closed.withheld,
    entryClosedUnreadable: closed.unreadable,
    targetSkips: [...targets.byId.values()].flatMap((check) => check.skipped?.(checkInput) ?? []),
  };
}

/** HTTP の入口の衝突(J2 の続き)。外部連携が読み込めたときだけ受信口の主張を作る(未選択・阻害は受信口を主張に入れない)。 */
function entryFindingsOf(input: JobRunInput): Finding[] {
  const external = input.external.state === 'loaded' ? input.external.value : undefined;
  return verifyEntryCollision({
    jobs: input.jobs,
    external,
    roots: input.roots,
    layout: input.layout,
    ...(input.screens === undefined ? {} : { screens: input.screens }),
    ...(input.auth === undefined ? {} : { auth: input.auth }),
  });
}

/** HTTP の入口の閉世界(J2 の続き)。宣言を読めない種類があるときは、未宣言の判定を保留する(実行ログが言う)。 */
function closedWorldOf(input: JobRunInput): EntryClosedResult {
  return verifyEntryClosedWorld({ jobs: input.jobs, external: input.external, auth: input.auth, repoRoot: input.repoRoot, roots: input.roots, layout: input.layout });
}
