/**
 * J3 pg_cron ジョブの接地(Supabase の後段が登録する検査。pg_cron は Supabase の拡張) — カタログの `scheduler: database` 行と `supabase/migrations` の
 * `cron.schedule(...)` 呼び出しの双方向一致。
 *
 * job-spec-writing.md / ARCH-0001 の要求(pg_cron 例外):
 *   - `scheduler: database` のジョブは、どこかの migration に同じジョブ名(id)・同じ cron 式で
 *     `cron.schedule('{id}', '{cron}', ...)` が書かれていること
 *   - migration にある pg_cron 登録は、すべてカタログに `scheduler: database` の行を持つこと
 *
 * J2(ホストの Cron の登録との突合)と対になる検証器である。J2 が `scheduler: host` だけを見るのに
 * 対し、J3 は `scheduler: database` だけを見る —— **「どこで時計が鳴るか」で突合先が
 * 完全に分かれる**ことが `scheduler` を持つ理由そのものである。
 *
 * migration は追記専用の歴史であり、同じジョブ名が複数ファイルに現れうる
 * (再スケジュールは新しい migration で unschedule → schedule し直す運用のため)。
 * その場合は**ファイル名(≒適用順)が最後のものを現在の登録とみなす**
 * (migrations.md の採番規則により、ファイル名の辞書順 = 適用順)。
 *
 * **仕様だけの段の製品では突合しない** —— migration の置き場も実装の木(`roots.app`)も無いとき(`pgCronUnchecked`)。
 * 仕様だけを先に書いて、まだ何も生成していない製品を登録の欠けで止めない。実装の木が在るのに置き場が無いなら突合する
 * (置き場の綴りの誤りを黙って緑にしない。全件が登録の欠けとして赤になる)。置き場が在れば、空でも突合する。
 * 突合しなかったことは、この後段が登録する一言(`skipped`)を J 群の実行ログが名指す。
 */

import path from 'node:path';
import { appGrounded, isDirectory, toRelative, walkFiles } from '../../../io/paths.js';
import { tryReadText } from '../../../io/read-text.js';
import type { Finding } from '../../../kernel/finding.js';
import { absentFor } from '../../../kernel/scope-owner.js';
import { JOB_CATALOG_ID } from '../../../model/job/parse-jobs.js';
import type { JobDecl, JobSpecModel } from '../../../model/job/types.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { specPath } from '../../../model/product/paths.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'J3';

/** pg_cron の登録が住んでいる場所(製品が宣言した migration の置き場そのもの)。 */

/** `cron.schedule('name', 'cron式', ...)` の呼び出しを拾う(先頭 2 引数だけを見る)。 */
const CRON_SCHEDULE_RE = /cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g;

/** J3 の指摘を組み立てる。 */
function j3Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** migration ファイル 1 本内で見つかった pg_cron 登録 1 件。 */
export interface PgCronEntry {
  readonly name: string;
  readonly cron: string;
  /** 見つかったファイル(リポジトリルート相対。反例のメッセージに使う)。 */
  readonly file: string;
}

/**
 * `supabase/migrations/*.sql` を走査して pg_cron の登録を集める。
 *
 * 同名のジョブが複数ファイルに現れたら、ファイル名(辞書順 = 適用順)が最後のものを採用する
 * (`walkFiles` は名前順で返すため、後勝ちの `Map.set` で自然に最新が残る)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param migrationsRoot 製品が宣言した migration の置き場(リポジトリルート相対)
 * @returns 見つかった登録の一覧(ジョブ名の重複なし)
 */
export function readPgCronEntries(repoRoot: string, migrationsRoot: string): readonly PgCronEntry[] {
  const dir = path.join(repoRoot, migrationsRoot);
  const files = walkFiles(dir, (name) => name.endsWith('.sql'));
  const byName = new Map<string, PgCronEntry>();
  for (const file of files) {
    const text = tryReadText(file);
    if (text === null) continue;
    for (const match of text.matchAll(CRON_SCHEDULE_RE)) {
      const name = match[1];
      const cron = match[2];
      if (name === undefined || cron === undefined) continue;
      byName.set(name, { name, cron, file: toRelative(repoRoot, file) });
    }
  }
  return [...byName.values()];
}

/** J3 の入力。 */
export interface PgCronParityInput {
  readonly jobs: JobSpecModel;
  /** リポジトリルートの絶対パス(migration ファイルの実在確認に使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(migration の置き場)。 */
  readonly roots: ProductRoots;
}

/**
 * 仕様だけの段(migration の置き場も実装の木も無い)で、突合しないか。
 *
 * @param input 検査の入力(リポジトリルートと製品の根)
 * @returns 突合しないなら true
 */
function pgCronUnchecked(input: Pick<PgCronParityInput, 'repoRoot' | 'roots'>): boolean {
  if (isDirectory(path.join(input.repoRoot, input.roots.migrations))) return false;
  return !appGrounded(input.repoRoot, input.roots.app);
}

/**
 * 突合しなかった分の一言(J 群の実行ログに出す。突合した・対象が無いときは null)。
 *
 * @param input 検査の入力
 * @returns 一言(句点なし)か null
 */
export function pgCronSkipped(input: PgCronParityInput): string | null {
  const count = (input.jobs.catalog?.jobs ?? []).filter((decl) => decl.schedule?.scheduler === 'database' && decl.schedule.cron !== undefined).length;
  if (count === 0 || !pgCronUnchecked(input)) return null;
  return `${input.roots.migrations} と実装の木が無いため、scheduler: database のジョブ ${count} 件の J3 の cron.schedule の突合はスキップ`;
}

/**
 * カタログの `scheduler: database` 行を、migration の `cron.schedule` 登録に接地させる。
 *
 * @param input 読み込み済みのジョブカタログとリポジトリルート
 * @returns 違反のリスト
 */
export function verifyPgCronParity(input: PgCronParityInput): Finding[] {
  const catalog = input.jobs.catalog;
  if (catalog === null) return [];

  const declared = catalog.jobs.filter(
    (decl): decl is JobDecl & { schedule: NonNullable<JobDecl['schedule']> } =>
      decl.schedule?.scheduler === 'database' && decl.schedule.cron !== undefined,
  );
  if (pgCronUnchecked(input)) return [];
  const registered = readPgCronEntries(input.repoRoot, input.roots.migrations);
  const findings: Finding[] = [];
  const declaredNames = new Set<string>();

  for (const decl of declared) {
    const cron = decl.schedule.cron;
    // フィルタで cron !== undefined を確認済みだが、型はプロパティアクセス越しに
    // 保持されないため、ここでもう一度絞ってから使う。
    if (cron === undefined) continue;
    declaredNames.add(decl.id);
    const match = registered.find((entry) => entry.name === decl.id);
    if (match === undefined) {
      const unregistered = j3Finding({
        message: `ジョブ ${decl.id}(scheduler: database)が ${input.roots.migrations} の cron.schedule に登録されていません`,
        location: decl.location,
        suggestion:
          `新しい migration に select cron.schedule('${decl.id}', '${cron}', $$ ... $$) を書く` +
          '(job-spec-writing.md §scheduler。pg_cron はトリガのみ・業務ロジックを含めない)',
        counterexample: { job: decl.id, cron },
      });
      findings.push(absentFor({ kind: 'catalog', id: JOB_CATALOG_ID }, unregistered));
      continue;
    }
    if (match.cron !== cron) {
      findings.push(
        j3Finding({
          message: `ジョブ ${decl.id} の schedule ${cron} が ${match.file} の cron.schedule 登録(${match.cron})と違います`,
          location: decl.location,
          suggestion:
            '新しい migration で cron.unschedule してから cron.schedule し直すか(migration は追記専用の歴史)、' +
            'カタログ側の schedule を実際の登録に合わせる',
          counterexample: { job: decl.id, catalog: cron, migration: match.cron },
        }),
      );
    }
  }

  const catalogLocation = declared[0]?.location ?? catalog.location;
  for (const entry of registered) {
    if (declaredNames.has(entry.name)) continue;
    findings.push(
      j3Finding({
        message: `${entry.file} の pg_cron 登録 ${entry.name}(${entry.cron})がジョブカタログに scheduler: database として宣言されていません`,
        location: catalogLocation,
        suggestion:
          `${specPath(input.roots, 'backend/jobs.md')} の該当ジョブに scheduler: database / schedule: "${entry.cron}" を足す` +
          '(pg_cron に登録したのに仕様のどこにも現れない状態は暗黙の挙動そのものである)',
        counterexample: { name: entry.name, cron: entry.cron },
      }),
    );
  }
  return findings;
}
