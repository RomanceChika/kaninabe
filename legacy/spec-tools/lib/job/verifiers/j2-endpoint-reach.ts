/**
 * J2(続き)Cron の起動口と走査の接地 — 起動口が宣言した実装に届き、`fires` / `due_from` が実装に接地している。
 *
 * J2 本体が見るのは「`endpoint` の Route Handler と `implementation` のファイルが**実在する**」までだった。
 * 起動口が**何を呼ぶか**・走査が**どのイベントを起こすか**・**どの列で絞るか**は、どの宣言とも突き合わされず、
 * 宣言を実装から静かに剥がしても全部緑だった(網の穴探し 2026-10-06。M07 = 締切の口が料金の確定を呼ぶ・
 * M05 = 2 本の `fires` の入れ替え・M04 = `due_from` だけ別の列)。この検査が見るのは 3 点である。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | 起動口(`endpoint` の Route Handler)が**呼んでいる import の閉包が `implementation` に届く** | 起動口が別の走査を呼んでいても、カタログの行は「その口はこの実装」と言い続ける |
 * | `fires: E` の走査の `implementation` が、actions の `scans[event=E].implementation` に**届く**(同じ実装か、閉包で届く) | 「どの走査がどのイベントを起こすか」は jobs.md と actions/README.md の 2 か所に書かれる。2 か所を突き合わせないと食い違いを誰も見ない |
 * | `due_from: {entity}.{field}` の列が、起動口と実装の閉包の中に**期限の比較の列名のリテラルとして現れる** | 仕様の「いつ」が実装の読み取り口の絞り込みに接地していること(`due-columns.ts`) |
 *
 * 閉包の解決は C24 の鮮度の hash と**同じ部品**(`semantics/import-closure.ts`)である。**実装の木が
 * 実在する環境でだけ**見る(J2 本体と同じ。仕様だけのリポジトリは時刻起点のジョブを宣言できる)。
 *
 * **起動口の閉包は「呼ばれている束縛」から始める。** import の辺だけで閉包を作ると、起動口が実装を 2 本
 * import して片方だけ呼ぶ形・使わない import が 1 本ある形で、呼んでいない実装にも届いて緑になる(独立レビュー m07a)。
 * そこで起動口の import のうち**値として使われているもの**(`semantics/used-imports.ts`)だけを起点にし、その先は
 * 全部の辺を辿る。**見えない側**: 起動口から先の中で、呼んでいない import が実装に届く形(索引ファイルが全実装を
 * 束ねる形など)は、閉包が広がって届いたことになる。起動口を呼ぶ統合テスト(composition の `__tests__`)が持つ。
 *
 * `due_from` の読み取り口は DI の外(infrastructure)にあり、`implementation`(operation 層)の閉包からは
 * 届かない。届くのは**起動口の閉包**(Route Handler → composition → infrastructure)なので、探す範囲は
 * 起動口と実装の閉包の和である。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import { httpEntryPath, sourceAliasOf } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { computeClosure } from '../../semantics/import-closure.js';
import type { Closure, SourceReader } from '../../semantics/import-closure.js';
import { usedImportSpecifiers } from '../../semantics/used-imports.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { Finding } from '../../kernel/finding.js';
import { dueComparedColumns, DUE_COMPARATORS } from '../due-columns.js';
import type { JobDecl, JobSpecModel } from '../../model/job/types.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** 本文を読んで列名を拾うソースの拡張子(TS / JS)。 */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** J2 の指摘を組み立てる。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** J2(起動口の接地)の入力。 */
export interface EndpointReachInput {
  readonly jobs: JobSpecModel;
  /** 読み込み済みの action_spec(`scans` の宣言元)。無い環境では `fires` の突合を飛ばす。 */
  readonly actions: ActionSpecModel | undefined;
  /** リポジトリルートの絶対パス。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(起動口の位置と、import の `@/…` の行き先 = ソースの根を引く。アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/** 閉包を求める道具(リポジトリルートの実ファイルを読み、同じ入口の閉包を使い回す)。 */
interface Reach {
  /** 入口の閉包(読めない入口は null)。 */
  closureOf(entry: string): Closure | null;
  /** 入口が**呼んでいる**import だけを起点にした閉包(読めない入口は null)。 */
  calledClosureOf(entry: string): Closure | null;
  /** ファイル 1 本の期限の比較の列名(読めなければ空)。 */
  columnsOf(file: string): ReadonlySet<string>;
}

/** 実ファイルを読む閉包の道具を作る。 */
function reachOf(repoRoot: string, roots: ProductRoots, layout: ProductLayout): Reach {
  const read: SourceReader = (relative) => tryReadText(path.join(repoRoot, relative));
  const alias = sourceAliasOf(layout, roots);
  const closures = new Map<string, Closure | null>();
  const calledClosures = new Map<string, Closure | null>();
  const columns = new Map<string, ReadonlySet<string>>();
  return {
    closureOf: (entry) => {
      if (!closures.has(entry)) closures.set(entry, computeClosure(entry, read, alias));
      return closures.get(entry) ?? null;
    },
    calledClosureOf: (entry) => {
      if (!calledClosures.has(entry)) {
        const text = read(entry);
        const used = text === null ? undefined : usedImportSpecifiers(entry, text);
        calledClosures.set(entry, computeClosure(entry, read, alias, used));
      }
      return calledClosures.get(entry) ?? null;
    },
    columnsOf: (file) => {
      if (!columns.has(file)) {
        const text = read(file);
        columns.set(file, text === null ? new Set() : dueComparedColumns(file, text));
      }
      return columns.get(file) ?? new Set();
    },
  };
}

/** 閉包に入口以外も含めて、このファイルが入っているか。 */
function reaches(closure: Closure, file: string): boolean {
  return closure.files.some((entry) => entry.path === file);
}

/**
 * 起動口と走査の接地を検証する。
 *
 * @param input ジョブカタログ・走査の宣言・リポジトリルート
 * @returns 違反のリスト
 */
export function verifyEndpointReach(input: EndpointReachInput): Finding[] {
  const catalog = input.jobs.catalog;
  if (catalog === null || !appGrounded(input.repoRoot, input.roots.app)) return [];
  const reach = reachOf(input.repoRoot, input.roots, input.layout);
  const declared = declaredImplementations(catalog.jobs, input.actions);
  return catalog.jobs
    .filter((decl) => decl.schedule !== undefined)
    .flatMap((decl) => [
      ...checkEndpoint(decl, input, reach, declared),
      ...checkFires(decl, input, reach),
      ...checkDueFrom(decl, input, reach),
    ]);
}

/** 宣言された実装(ジョブの `implementation` と scans の `implementation`)。「届いた別の実装」の名指しの母集合。 */
function declaredImplementations(jobs: readonly JobDecl[], actions: ActionSpecModel | undefined): ReadonlySet<string> {
  const files = new Set<string>();
  for (const decl of jobs) {
    if (decl.schedule !== undefined) files.add(decl.schedule.implementation);
  }
  for (const scan of actions?.scans ?? []) files.add(scan.implementation);
  return files;
}

/** 起動口の Route Handler の位置(`endpoint` が無ければ null)。 */
function routeOf(decl: JobDecl, input: EndpointReachInput): string | null {
  const endpoint = decl.schedule?.endpoint;
  return endpoint === undefined ? null : httpEntryPath(input.layout, input.roots, endpoint);
}

/** 起動口が呼んでいる import の閉包が `implementation` に届くか。 */
function checkEndpoint(
  decl: JobDecl,
  input: EndpointReachInput,
  reach: Reach,
  declared: ReadonlySet<string>,
): Finding[] {
  const schedule = decl.schedule;
  const route = routeOf(decl, input);
  if (schedule === undefined || route === null) return [];
  // 実在しない口・実装は J2 本体が指摘する(ここでは重ねて鳴らさない)。
  if (!isFile(path.join(input.repoRoot, route)) || !isFile(path.join(input.repoRoot, schedule.implementation))) return [];
  const closure = reach.calledClosureOf(route);
  if (closure === null || reaches(closure, schedule.implementation)) return [];
  const others = closure.files.map((file) => file.path).filter((file) => file !== route && declared.has(file));
  const imported = reach.closureOf(route);
  const importedOnly = imported !== null && reaches(imported, schedule.implementation);
  return [
    j2Finding({
      message:
        `ジョブ ${decl.id} の起動口 ${route} が呼んでいる import をたどっても implementation ${schedule.implementation} に届きません` +
        (importedOnly ? '(import はしているが、呼んでいない)' : '') +
        (others.length === 0 ? '' : `(届いた別の実装: ${others.join(', ')})`),
      location: decl.location,
      suggestion:
        '起動口が呼ぶ実装をカタログの implementation に合わせる(起動口が別の走査を呼んでいれば、' +
        'Cron はカタログの宣言と違うものを実行する。import しただけで呼んでいない実装は数えない)。実装を意図して変えたなら implementation を直す',
      counterexample: {
        job: decl.id,
        route,
        implementation: schedule.implementation,
        reached: others.join(', '),
        imported_but_not_called: importedOnly ? 'yes' : 'no',
      },
      grounding: 'implementation',
    }),
  ];
}

/** `fires` の走査の実装が、actions の `scans` の実装に届くか。 */
function checkFires(decl: JobDecl, input: EndpointReachInput, reach: Reach): Finding[] {
  const schedule = decl.schedule;
  const fires = schedule?.fires;
  if (schedule === undefined || fires === undefined || input.actions === undefined) return [];
  const scan = input.actions.scans.find((candidate) => candidate.event === fires);
  if (scan === undefined) {
    return [
      j2Finding({
        message: `ジョブ ${decl.id} の fires ${fires} を起こす走査が action_spec の scans にありません`,
        location: decl.location,
        suggestion:
          'actions/README.md の scans に event と implementation を足す(「どの走査がどのイベントを起こすか」は ' +
          'jobs.md と scans の 2 か所に書かれ、片方だけだと食い違いが誰にも見えない)',
        counterexample: { job: decl.id, fires },
      }),
    ];
  }
  if (!isFile(path.join(input.repoRoot, schedule.implementation))) return [];
  const closure = reach.closureOf(schedule.implementation);
  if (closure === null || reaches(closure, scan.implementation)) return [];
  const otherScans = input.actions.scans
    .filter((candidate) => candidate.event !== fires && reaches(closure, candidate.implementation))
    .map((candidate) => candidate.event);
  return [
    j2Finding({
      message:
        `ジョブ ${decl.id} の fires ${fires} の走査は scans では ${scan.implementation} だが、` +
        `ジョブの implementation ${schedule.implementation} はそこに届きません` +
        (otherScans.length === 0 ? '' : `(届く別の走査: ${otherScans.join(', ')})`),
      location: decl.location,
      suggestion:
        'jobs.md の fires と actions/README.md の scans のどちらかが別の走査を指している。' +
        '同じ走査を指すように、fires か implementation かを直す',
      counterexample: {
        job: decl.id,
        fires,
        job_implementation: schedule.implementation,
        scan_implementation: scan.implementation,
        reached_scans: otherScans.join(', '),
      },
    }),
  ];
}

/** `due_from` の列が、起動口と実装の閉包の期限の比較に現れるか。 */
function checkDueFrom(decl: JobDecl, input: EndpointReachInput, reach: Reach): Finding[] {
  const schedule = decl.schedule;
  const dueFrom = schedule?.dueFrom;
  if (schedule === undefined || dueFrom === undefined) return [];
  const separator = dueFrom.indexOf('.');
  if (separator <= 0) return [];
  const column = dueFrom.slice(separator + 1);
  const route = routeOf(decl, input);
  const entries = [route, schedule.implementation].filter(
    (entry): entry is string => entry !== null && isFile(path.join(input.repoRoot, entry)),
  );
  if (entries.length === 0) return [];
  const files = new Set(
    entries.flatMap((entry) => (entry === route ? reach.calledClosureOf(entry) : reach.closureOf(entry))?.files.map((file) => file.path) ?? []),
  );
  const found = [...files].some((file) => CODE_FILE.test(file) && reach.columnsOf(file).has(column));
  if (found) return [];
  return [
    j2Finding({
      message:
        `ジョブ ${decl.id} の due_from ${dueFrom} の列 ${column} が、起動口と実装の import の閉包のどこにも` +
        `期限の比較(${[...DUE_COMPARATORS].join(' / ')})の列名として現れません`,
      location: decl.location,
      suggestion:
        `走査の読み取り口が ${column} で絞っていること(例: .lte('${column}', now))を確かめ、` +
        'due_from を実際に絞る列に合わせる。列名を定数から引く形にしていると接地を読めない(列名はその場にリテラルで置く)',
      counterexample: { job: decl.id, due_from: dueFrom, column, searched_files: String(files.size) },
      grounding: 'implementation',
    }),
  ];
}
