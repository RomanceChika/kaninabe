/**
 * J2(続き)HTTP の入口の閉世界 — 実装の木の**全ての入口(Route Handler)が、宣言のどれかに分類される**。
 *
 * 実装の木の HTTP の入口は「ジョブの `endpoint`(Cron が叩く口)・生成された受信口・認証の `callback`(OAuth の帰り道)・送信の連携の `endpoints`
 * (その連携を使う手書きの口)」のどれかであるべきだが、これまでは手書きの口を宣言する置き場が無く、カタログに載らない口に認可なしの `GET` を足しても全部緑だった
 * (網の穴探し 2026-10-06 m01f)。宣言の全数は `job/entry-declarations.ts` が 1 か所で作る(衝突の検査 `j2-entry-collision.ts` と同じ材料)。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | 実装の木の入口のファイルが、**宣言された URL のどれかに当たる** | 宣言に載らない口は、認可の検査も衝突の検査も届かない |
 * | **1 本の URL に結べない入口**(動的なセグメントの下・ルーティングに使わない名前の下)が無い | URL を名指せないので、どの宣言にも当たりようがない(宣言の側も、そういう URL は置き場にならないとして J2 が退ける) |
 * | 入口のファイルが**配置の受ける綴り**(`entryFileName`。Next.js では `route.ts`)である | 口を数える検査は置き場の綴り 1 つで読むので、`route.tsx` / `route.js` は実行時に口になるのに出どころの関門・GET / HEAD の禁止・生成の見張りテストから消える(5 回目 C5-4・B5-1)。入口の候補(`entryOf`)は枠が要求を受けて実行するファイルの全種類(Next.js ではメタデータのルートの動的な形 `opengraph-image.tsx` / `sitemap.ts` なども。6 回目 C6-2) |
 * | 枠が別の口の根に選ぶ置き場(`forbiddenRoots`。Next.js では Pages Router の置き場と、走査の根より優先される App Router の根)が無く、枠の設定の既定の export が鍵の許可表の中だけ(`frameConfig`。構文木で読む。Next.js では `pageExtensions`・`rewrites` などを載せない。7 回目 C7-4) | 走査の根だけを歩く閉世界は、Pages Router の API ルートや、走査の根より優先される根の下の口を見られない(6 回目 C6-5・B6-2。置き場の表は配置が持つ) |
 * | 製品の `package.json` の最上位の欄と `tsconfig.json` の `paths` / `baseUrl` が許可表の中だけ(`module-resolution-config.ts`。7 回目 B7-2) | `imports` の `#…`・`paths` の別名は束ねる道具が自分のソースに解くのに、import の閉包(X8・J2 の届く先)は辿らない。別名を足した時点で止める |
 * | 入口の全部の HTTP メソッドが**出口の関所 `guardRoute` で包まれている**(`export const GET = guardRoute(…)` の形だけ。外の行き先の表は認証の `start` の口だけ。`j2-entry-guard.ts`) | 転送の主の守りは実行時の関所で、包んだ口にしか効かない(点検 10 回目 B10-1。綴りを追う lint の規則は兄弟の書き方を取りこぼす) |
 * | 入口の export が**名前を数えられる形**だけで書かれている(分割代入の `export const { GET } = …`・`export * from`・CommonJS の `exports.GET` が無い) | メソッドを数える検査(J2 の GET / HEAD の禁止・出どころの関門・X8・生成の見張りテスト)は export の名前を構文木から数える。数えられない形は実行時には口になりうるのに検査に見えない(4 回目 C4-6。fail-closed) |
 * | 認証の `callback` と送信の連携の `endpoints` の**入口が実在する** | 宣言だけで口が無いのは死んだ経路(ジョブの `endpoint` の実在は J2 本体、受信口は生成物の鮮度が見る — ここは重ねない) |
 *
 * 走査は**URL のセグメントを一つも飛ばさない**(ドット始まり・`build` / `coverage` の名前の下の入口も数える。飛ばすのはパッケージの置き場と、配置が宣言するビルドの出力だけ)。
 * 宣言した口の不在も、未宣言の判定と同じ走査の結果を URL で突き合わせて見る。**走査で読めなかった場所があれば**、完全な走査と同じ「指摘 0」に見せず結果の `unreadable` に挙げる
 * (読めた部分の分類は出すが、宣言した口の不在は言わない。実行ログが「阻害」で名指す)。
 *
 * 入口の集め方は**置き場の配置の `http-entry` の逆引き**(`classify`)である(キーに結べる入口は `keyOf`、結べないものまで拾うのは `entryOf` — 配置が与える)。
 * 「どの宣言にも当たらない」の判定は**宣言を読めた分だけ**で、読めない種類(外部連携・認証・ジョブが阻害)があるときは**判定しない**(宣言された口を
 * 未宣言と誤って言わない。見ていないことは呼び手が実行ログで言う)。**実装の木が実在する環境でだけ**見る(仕様だけのリポジトリは宣言だけを持てる)。
 */

import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { unusableOf } from '../../kernel/input-state.js';
import type { CatalogInput, UnusableInput } from '../../kernel/input-state.js';
import { appGrounded, toRelative } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import { unreadableRouteExports } from '../../semantics/route-exports.js';
import { walkTree } from '../../io/walk-tree.js';
import type { WalkFs } from '../../io/walk-tree.js';
import type { AuthSpecModel } from '../../model/auth/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { httpEntryPath, layoutScan, normalizeUrlPath, sourceAliasOf } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { entryDeclarationsOf, isMalformedEndpoint } from '../entry-declarations.js';
import { outsideScanFindings, resolutionConfigFindings } from './j2-entry-outside.js';
import { entryGuardFindings } from './j2-entry-guard.js';
import type { EntryDeclaration } from '../entry-declarations.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** J2(入口の閉世界)の入力(リポジトリルートは I/O のため呼び出し側が渡す)。 */
export interface EntryClosedInput {
  readonly jobs: JobSpecModel;
  /** 外部連携カタログの入力の状態(阻害なら受信口と送信の連携の口を知れないので、未宣言の判定を出さない)。 */
  readonly external: CatalogInput<ExternalCatalogSpec>;
  /** 読み込み済みの認証フロー仕様(読めない = ファイルはあるが中身を構築できない、なら未宣言の判定を出さない。無い環境は認証の口を持たない)。 */
  readonly auth: AuthSpecModel | undefined;
  /** リポジトリルートの絶対パス。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(`http-entry` の逆引きと置き場。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
  /** 走査が使うファイルシステムの口(省略は実の fs。読めない状況を作るテストが差し替える)。 */
  readonly fs?: WalkFs;
}

/**
 * 実行の状態。
 *   - `ran` … 実装の木を走査した
 *   - `no_tree` … 実装の木が実在しない(仕様だけのリポジトリ・まだ木を組んでいない製品)。見るものが無い
 *   - `no_placement` … 実装の木はあるが、配置が `http-entry` の逆引きを持たない(走査の根を決められない)
 */
export type EntryClosedStatus = 'ran' | 'no_tree' | 'no_placement';

/** J2(入口の閉世界)の結果。 */
export interface EntryClosedResult {
  readonly findings: Finding[];
  readonly status: EntryClosedStatus;
  /**
   * 宣言を読めず、「どの宣言にも当たらない」を判定しなかった種類(阻害)。空なら判定した。
   * 実行ログが種類ごとに 1 行で言う(宣言された口を未宣言と言わないための保留であり、見ていないことの申告)。
   */
  readonly withheld: readonly UnusableInput[];
  /**
   * 走査で読めなかった場所(リポジトリルート相対。走査の根・子のディレクトリ)。空なら完全な走査。空でなければ、読めなかった部分の入口は見ていない
   * (**完全な走査の「指摘 0」と同じに見せない** — 実行ログが名指す)。見ていないので、宣言した口の不在も判定しない(読めなかった部分にあるかもしれない)。
   * 実装の木そのものが無い(ENOENT)のは読めなかったとは数えない。
   */
  readonly unreadable: readonly string[];
}

/** 走査で見つけた入口と、読めなかった場所。 */
export interface Found {
  readonly entries: FoundEntry[];
  /** リポジトリルート相対。 */
  readonly unreadable: string[];
}

/** 実装の木で見つけた入口のファイル 1 つ。 */
export interface FoundEntry {
  /** リポジトリルート相対のファイルパス。 */
  readonly file: string;
  /** 逆引きが返した URL。1 本の URL に結べない入口は null。 */
  readonly url: string | null;
}

/** J2 の指摘を組み立てる。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 宣言を読めなかった種類(未宣言の判定を保留する理由)を集める。未選択は「事実として無い」なので入れない。 */
function withheldOf(input: EntryClosedInput): UnusableInput[] {
  const gaps: UnusableInput[] = [];
  const external = unusableOf(input.external, 'external');
  if (external?.state === 'blocked') gaps.push(external);
  if (input.auth?.available === true && input.auth.flow === null) gaps.push({ input: 'auth', state: 'blocked', reason: 'load-failed' });
  if (input.jobs.available && input.jobs.catalog === null) gaps.push({ input: 'jobs', state: 'blocked', reason: 'load-failed' });
  return gaps;
}

/**
 * 実装の木の入口のファイルを集める(名前順)。**URL のセグメントになりうる名前のディレクトリを一つも飛ばさない**(ドット始まりも `build` / `coverage` も歩く)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param scan 配置の逆引きの走査(`dir` は製品の根を接いだ形 = リポジトリルート相対)
 * @param fs 走査が使うファイルシステムの口(省略は実の fs)
 */
export function foundEntries(repoRoot: string, scan: NonNullable<ReturnType<typeof layoutScan>>, fs?: WalkFs): Found {
  const dir = path.join(repoRoot, scan.dir);
  const walked = walkTree(dir, fs);
  const found: FoundEntry[] = [];
  for (const absolute of walked.files) {
    const relative = toRelative(dir, absolute);
    const url = scan.keyOf(relative);
    // 入口かどうかは配置が決める(キーに結べない入口まで数えるため)。配置が宣言しなければ、キーに結べるものだけが入口。
    const entry = scan.entryOf === undefined ? url !== null : scan.entryOf(relative);
    if (entry) found.push({ file: toRelative(repoRoot, absolute), url });
  }
  return { entries: found, unreadable: walked.unreadable.map((unread) => toRelative(repoRoot, unread)) };
}

/** 配置の受ける綴りでない入口の指摘。 */
function misspelledFinding(entry: FoundEntry, expected: string): Finding {
  return j2Finding({
    message:
      `HTTP の入口になるファイル ${entry.file} は ${expected} の綴りではありません。` +
      `HTTP の入口は ${expected} だけを受けます(ほかの綴りの Route Handler や、要求を受けて実行される別の種類のファイル(メタデータのルートの動的な形など)は、実行時には口になるのに、出どころの関門・GET / HEAD の禁止・有料の口の包み・生成の見張りテスト・宣言との突き合わせが読みません)`,
    location: { file: entry.file },
    suggestion: `同じ場所の ${expected} に書き直す(ESM の \`export const POST = guardRoute(async (request: Request) => …)\` の形で)。画像などを配るなら静的なファイル(\`icon.png\` など)にする。入口でないファイルなら名前を変えるか消す`,
    counterexample: { file: entry.file, expected },
    grounding: 'implementation',
  });
}

/** どの宣言にも当たらない入口の指摘。 */
function undeclaredFinding(entry: FoundEntry & { readonly url: string }): Finding {
  return j2Finding({
    message: `HTTP の入口 ${entry.url}(${entry.file})が、どの宣言にも当たりません(ジョブの endpoint・受信の連携・認証の口(callback・start・logout)・送信の連携の endpoints のいずれでもない)`,
    location: { file: entry.file },
    suggestion:
      '口の持ち主の宣言に URL を書く —— Cron が叩く口ならジョブの endpoint(jobs.md)・OAuth の帰り道なら callback・サインインの開始なら start・ログアウトなら logout(auth.md)・外部サービスを使う手書きの口ならその連携の endpoints(external.md)。' +
      'どれでもない口は消す(宣言の無い口には、認可の検査も衝突の検査も届かない)',
    counterexample: { url: entry.url, file: entry.file },
    grounding: 'implementation',
  });
}

/** 1 本の URL に結べない入口の指摘。 */
function unroutableFinding(entry: FoundEntry): Finding {
  return j2Finding({
    message: `HTTP の入口のファイル ${entry.file} は 1 本の URL に結べません(動的なセグメントの下・ルーティングに使わない名前の下)。どの宣言でも名指せない口です`,
    location: { file: entry.file },
    suggestion:
      '口を静的な URL の下に置く(動的なセグメントは Cron も外部サービスも 1 本の URL として叩けず、宣言のしようがない)。ルーティングに使わない名前の下のファイルは入口ではないので、置き場を直すか消す',
    counterexample: { file: entry.file },
    grounding: 'implementation',
  });
}

/**
 * 入口のファイルの export に、メソッドを数えられない形(分割代入・`export * from`)があれば指摘する(本文が読めなければ何も言わない —
 * 読めないファイルは Next.js も読めない)。
 */
function unreadableExportFinding(repoRoot: string, entry: FoundEntry): Finding | null {
  const source = tryReadText(path.join(repoRoot, entry.file));
  if (source === null) return null;
  const forms = unreadableRouteExports(entry.file, source);
  if (forms.length === 0) return null;
  const listed = forms.map((form) => `\`${form.text}\``).join(' / ');
  return j2Finding({
    message:
      `HTTP の入口のファイル ${entry.file} に、メソッドを数えられない export があります(${listed})。` +
      '分割代入の export・`export * from`・CommonJS の `exports.X = …` は実行時には GET / POST などの口になりうるのに、口を数える検査(GET / HEAD の禁止・出どころの関門・有料の口の包み・生成の見張りテスト)に見えません',
    location: { file: entry.file },
    suggestion:
      'メソッドは `export const POST = guardRoute(async (request: Request) => …)` の形で名前で export する(出口の関所で包む。' +
      '実装を別のファイルに置くなら、本体をそこから import して関所の中で呼ぶ)',
    counterexample: { file: entry.file, forms: forms.map((form) => form.kind).join(' / ') },
    grounding: 'implementation',
  });
}

/** 実在を確かめる手書きの口の出どころ(認証の口 3 つ・送信の連携の endpoints。ジョブの endpoint は J2 本体が見る)。 */
const HANDWRITTEN_DECLARED: ReadonlySet<EntryDeclaration['origin']> = new Set(['auth_callback', 'auth_start', 'auth_logout', 'external_endpoint']);

/** 宣言した手書きの口に、実装の木の入口が無い指摘(認証の口・送信の連携の endpoints)。 */
function missingFinding(decl: EntryDeclaration, expected: string): Finding {
  return j2Finding({
    message: `${decl.source} に対応する Route Handler がありません`,
    location: decl.location,
    suggestion: `${expected} を作るか、宣言を実在する口へ直す(叩けない口は宣言だけの死んだ経路)`,
    counterexample: { endpoint: decl.url, expected_route: expected },
    grounding: 'implementation',
  });
}

/**
 * 認証の口(帰り道・開始・ログアウト)・送信の連携の endpoints の入口が実在するか(ジョブの endpoint は J2 本体・受信口は生成物の鮮度が見る)。
 * **実在の判定は、未宣言の判定と同じ走査の結果を URL で突き合わせる**(route group の下・`route.js` の実体も同じ入口として数える。置き場の 1 つの綴りの `isFile` では偽の赤になる)。
 *
 * @param found 走査で見つけた入口
 */
function missingEntries(input: EntryClosedInput, declarations: readonly EntryDeclaration[], found: readonly FoundEntry[]): Finding[] {
  const present = new Set(found.flatMap((entry) => (entry.url === null ? [] : [normalizeUrlPath(entry.url)])));
  const findings: Finding[] = [];
  for (const decl of declarations) {
    if (!HANDWRITTEN_DECLARED.has(decl.origin) || isMalformedEndpoint(decl.url)) continue;
    // 置き場を決められない・キーが形に合わないのは衝突の検査が言う(重ねない)。
    const expected = httpEntryPath(input.layout, input.roots, decl.url);
    if (expected !== null && !present.has(normalizeUrlPath(decl.url))) findings.push(missingFinding(decl, expected));
  }
  return findings;
}

/**
 * 閉世界が実装の木を走査するか(しないなら、その理由)。検査そのものと、回ったことを数える側(題材の通し実行の回し直しの回数。差分点検 S27-2)が
 * 同じ 1 つの判定を使う(数える側が別の条件で数えると、検査が回らなくても回数が合って緑になる)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置
 */
export function entryClosedStatus(repoRoot: string, roots: ProductRoots, layout: ProductLayout): EntryClosedStatus {
  if (!appGrounded(repoRoot, roots.app)) return 'no_tree';
  return layoutScan(layout, roots.app, 'http-entry') === null ? 'no_placement' : 'ran';
}

/**
 * 実装の木の HTTP の入口が、宣言のどれかに分類されることを検証する。
 *
 * @param input 各カタログ・リポジトリルート・根・配置
 * @returns 違反と、実行の状態・判定を保留した理由
 */
export function verifyEntryClosedWorld(input: EntryClosedInput): EntryClosedResult {
  const status = entryClosedStatus(input.repoRoot, input.roots, input.layout);
  const scan = layoutScan(input.layout, input.roots.app, 'http-entry');
  if (status !== 'ran' || scan === null) return { findings: [], status, withheld: [], unreadable: [] };

  const withheld = withheldOf(input);
  const external = input.external.state === 'loaded' ? input.external.value : undefined;
  const declarations = entryDeclarationsOf(input.jobs, external, input.auth);
  // 書き誤りの URL(`//` ・`?` など)は、実装の木の入口の URL とは決して一致しないので、ここで除かなくても未宣言のまま残る。
  const declared = new Set(declarations.map((decl) => normalizeUrlPath(decl.url)));
  const authStartUrls = new Set(declarations.filter((decl) => decl.origin === 'auth_start').map((decl) => normalizeUrlPath(decl.url)));

  const { entries, unreadable } = foundEntries(input.repoRoot, scan, input.fs);
  const findings: Finding[] = [
    ...outsideScanFindings(input.repoRoot, scan),
    ...(input.roots.app === null ? [] : resolutionConfigFindings(input.repoRoot, input.roots.app, sourceAliasOf(input.layout, input.roots))),
  ];
  for (const entry of entries) {
    // 受ける綴りでない入口は、その 1 件だけを言う(宣言との突き合わせは綴りを直してから。置き場の綴りでないので宣言の実在にも数えない)。
    if (scan.entryFileName !== undefined && path.posix.basename(entry.file) !== scan.entryFileName) {
      findings.push(misspelledFinding(entry, scan.entryFileName));
      continue;
    }
    const unreadableExports = unreadableExportFinding(input.repoRoot, entry);
    if (unreadableExports !== null) findings.push(unreadableExports);
    findings.push(...entryGuardFindings(input.repoRoot, entry.file, entry.url !== null && authStartUrls.has(normalizeUrlPath(entry.url))));
    if (entry.url === null) findings.push(unroutableFinding(entry));
    else if (withheld.length === 0 && !declared.has(normalizeUrlPath(entry.url))) findings.push(undeclaredFinding({ ...entry, url: entry.url }));
  }
  // 読めなかった部分があれば、宣言した口の不在は言えない(その口は読めなかった部分にあるかもしれない)。
  const accepted = scan.entryFileName === undefined ? entries : entries.filter((entry) => path.posix.basename(entry.file) === scan.entryFileName);
  if (unreadable.length === 0) findings.push(...missingEntries(input, declarations, accepted));
  return { findings, status: 'ran', withheld, unreadable };
}
