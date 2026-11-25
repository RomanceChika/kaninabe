/**
 * 適用済み migration の不変性(C23)の判定部。
 *
 * migration は**追記専用の歴史**である(migrations.md §不変則)。共有された時点で凍結し、
 * 直したくなったら**新しい番号のファイルに書く**。この規約は 2026-09 まで「執行者: 無し
 * (規約のみ)」であり、レビューで見つけるほかなかった —— 外部レビュー の外部レビュー①の指摘である。
 *
 * ここが見るのは 1 つだけ: **基点のコミットに存在する `supabase/migrations/*.sql` が、
 * 比較先で変更・削除・改名されていないこと**。基点の決め方(pre-commit は HEAD、CI は
 * push の前コミット)は `migration-diff.ts`、git の呼び出しと印字は CLI
 * (`cli/check-migrations.ts`)の仕事で、ここは `git diff --name-status` の出力を
 * 受け取る純粋関数だけを持つ。
 *
 * 追加(`A`)は当然通る。**未コミットのファイルはそもそも基点に存在しない**ので、
 * 生成器が同名の migration を何度書き直しても、コミットするまでは自由である
 * (migrations.md の「例外: まだコミットしていない場合は自由に直してよい」と同じ線)。
 */
import type { ProductRoots } from '../model/product/types.js';

/**
 * 検査の対象になるファイルの接頭辞(製品が宣言した migration の置き場)。
 *
 * 末尾のスラッシュを足すのは「その置き場の中のファイル」だけを見るためである。
 */
export function migrationDir(roots: ProductRoots): string {
  return `${roots.migrations}/`;
}

/** `git diff --name-status` の 1 行(改名は旧名と新名の 2 つのパスを持つ)。 */
export interface FileChange {
  /** git の状態文字(`A` / `M` / `D` / `R100` / `C75` / `T` …)。 */
  readonly status: string;
  /** 基点側のパス(改名・複製なら旧名)。 */
  readonly path: string;
  /** 比較先のパス(改名・複製のときだけ)。 */
  readonly renamedTo?: string;
}

/** 凍結を破った 1 件。 */
export interface FrozenViolation {
  /** 基点に存在する migration のパス。 */
  readonly file: string;
  /** 破り方。 */
  readonly kind: '変更' | '削除' | '改名';
  /** 改名先(`kind: 改名` のときだけ)。 */
  readonly renamedTo?: string;
}

/**
 * `git diff --name-status -z` の出力を解析する。
 *
 * `-z` を使うのは、パスに空白や日本語が混じっても壊れないようにするためである
 * (レコードは NUL 区切り。改名・複製だけ「状態 → 旧名 → 新名」の 3 レコードになる)。
 *
 * @param raw `git diff --name-status -z` の標準出力そのまま
 * @returns 変更の一覧(対象ディレクトリで絞る前の全件)
 */
export function parseNameStatus(raw: string): FileChange[] {
  const records = raw.split('\0').filter((record) => record !== '');
  const changes: FileChange[] = [];
  let index = 0;
  while (index < records.length) {
    const status = records[index];
    index += 1;
    if (status === undefined) break;
    const path = records[index];
    index += 1;
    if (path === undefined) break;
    if (status.startsWith('R') || status.startsWith('C')) {
      const renamedTo = records[index];
      index += 1;
      if (renamedTo === undefined) break;
      changes.push({ status, path, renamedTo });
      continue;
    }
    changes.push({ status, path });
  }
  return changes;
}

/** 検査対象の migration ファイルか(`supabase/migrations/*.sql`)。 */
function isMigration(file: string, roots: ProductRoots): boolean {
  return file.startsWith(migrationDir(roots)) && file.endsWith('.sql');
}

/**
 * 凍結を破った変更だけを取り出す。
 *
 * 判定は状態文字だけで決まる —— `M`(内容の変更。**コメントだけの修正も含む**)・
 * `T`(ファイル種別の変更)は「変更」、`D` は「削除」、`R` は「改名」。
 * `A`(追加)と `C`(複製 = 旧ファイルはそのまま残る)は通す。
 *
 * @param changes `parseNameStatus` の結果(全ファイル)
 * @returns 凍結を破った migration の一覧(基点側のパス順)
 */
export function frozenViolations(changes: readonly FileChange[], roots: ProductRoots): FrozenViolation[] {
  const violations: FrozenViolation[] = [];
  for (const change of changes) {
    if (!isMigration(change.path, roots)) continue;
    if (change.status.startsWith('M') || change.status.startsWith('T')) {
      violations.push({ file: change.path, kind: '変更' });
      continue;
    }
    if (change.status.startsWith('D')) {
      violations.push({ file: change.path, kind: '削除' });
      continue;
    }
    if (change.status.startsWith('R')) {
      violations.push(
        change.renamedTo === undefined
          ? { file: change.path, kind: '改名' }
          : { file: change.path, kind: '改名', renamedTo: change.renamedTo },
      );
    }
  }
  return [...violations].sort((a, b) => a.file.localeCompare(b.file));
}

/** 破り方ごとの直し方(反例 = 「新しい番号のファイルに書く」)。 */
const REMEDY: Readonly<Record<FrozenViolation['kind'], string>> = {
  変更:
    '直したい中身は**新しい番号の migration に書く**' +
    '(関数は `create or replace`・列や制約は `alter table`・データ訂正は新しい `update`)。' +
    '生成 migration なら仕様側の `migration:` / `policies_migration:` の連番を採番し直す',
  削除:
    '適用済みの歴史は消せない。効果を打ち消したいなら' +
    '**新しい番号の migration で打ち消す**(`drop` / `alter` を新しいファイルに書く)',
  改名:
    'ファイル名も歴史の一部である(番号がどの内容を指すかが時点で変わってしまう)。' +
    '**旧ファイルは名前ごと戻し、新しい番号のファイルを足す**',
};

/**
 * 違反の報告文を組み立てる(1 件 3 行 —— 何が・どこで・どう直すか)。
 *
 * @param violations `frozenViolations` の結果
 * @param base 基点の説明(例: `HEAD`・`abc1234`)。どこと比べた結果かを人に返すため
 * @returns 出力する行の並び(空なら呼び出し側は何も出さない)
 */
export function formatViolations(
  violations: readonly FrozenViolation[],
  base: string,
): string[] {
  if (violations.length === 0) return [];
  const lines = [
    `C23 適用済み migration の不変性: ${violations.length} 件(基点 ${base} に存在するファイルを動かしています)`,
  ];
  for (const violation of violations) {
    const where =
      violation.renamedTo === undefined ? violation.file : `${violation.file} → ${violation.renamedTo}`;
    lines.push(`  - [${violation.kind}] ${where}`);
    lines.push(`    直し方: ${REMEDY[violation.kind]}`);
  }
  lines.push(
    '  正: docs/rules/process/backend/system/standards/conventions/migrations.md §不変則' +
      '(コミット前のファイルは対象外 —— 凍結するのは共有された時点である)',
  );
  return lines;
}
