/**
 * 題材の生成 SQL を**依存順に並べ直し**、一時 workdir の `supabase/` を組む。
 *
 * ## なぜ並べ直すのか
 *
 * 生成 migration のファイル名(= 連番)は仕様が宣言する。宣言された番号は**追記専用の歴史**の
 * ための名前であり、「空の DB に順に当てて通る順序」とは別物である —— 4 題材の宣言では
 * 表の DDL が一番後ろに来るので、宣言の番号どおりに当てるとポリシーが「まだ無い表」に
 * 掛かって落ちる。
 *
 * 当てられる順序は仕様から機械的に決まる: **土台 → 表 → 権限 → 補助関数 → ポリシー →
 * surface のビュー → RPC → 保存点の複合 RPC → 受信口**。種類はファイル名の印(`_ddl_` 等)が示して
 * おり、種類の中の順序は宣言の番号で決まる。**表どうしの順序はもう意味を持たない** ——
 * 外部キーは両側のファイルに存在ガードつきで出るので、どちらが先でも最後には張られる
 * (`lib/sql/ddl-placement.ts`)。
 *
 * ここで振り直す番号は**一時 workdir の中だけ**のものである。リポジトリの
 * `supabase/migrations/` には触らない(適用済みの歴史は凍結されている)。
 */

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stackConfigPath, stackDirPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/**
 * 当てる順序(**依存の向き**)。ファイル名の印で種類が決まる。
 *
 *   - `_api_base` … スキーマと呼び出し主体を解決する関数(RPC を `api` に作る前に要る)
 *   - `_ddl_` … 表そのもの(以降の全部が表に掛かる)
 *   - `_grants` … 表の権限(系に 1 本。`grant … on public.{表}` は表が在ってはじめて通る)
 *   - `_helper_` … RLS 補助関数(ポリシーの述語が呼ぶ)
 *   - `_policies_` … RLS のポリシーと権限
 *   - `_api_view_` … 外から届く surface のビュー(隠し列の述語が補助関数を呼ぶので `_helper_` より後)
 *   - `_rpc_` … 定型 5 形の RPC の本体
 *   - `_usecase_` … 保存点の複合 RPC(定型 RPC と同じ表に掛かる)
 *   - `_inbound_` … 受信口(記録と遷移を 1 トランザクションで起こす RPC)
 *
 * **印の後ろは対象の名前である**(`_ddl_{表}` / `_rpc_{関数}`)。構造の突合の判定
 * (`db-parity.ts`)はここから「この題材が宣言した名前」を引くので、印の表はここ 1 つに置く。
 * **系に 1 本の生成物(`_api_base` / `_grants`)は後ろに名前を持たない**ので、そこからは
 * 名前が 1 つも出ない(引く側が空の名前を捨てる)。
 */
export const MIGRATION_ORDER: readonly string[] = [
  '_api_base',
  '_ddl_',
  '_grants',
  '_helper_',
  '_policies_',
  '_api_view_',
  '_rpc_',
  '_usecase_',
  '_inbound_',
];

/** その名前がどの種類か(順序の添字。印が無ければ最後に回す)。 */
function orderOf(file: string): number {
  const index = MIGRATION_ORDER.findIndex((infix) => file.includes(infix));
  return index === -1 ? MIGRATION_ORDER.length : index;
}

/**
 * 生成物から SQL を取り出し、依存順に並べる。
 *
 * @param generatedFiles 生成物(リポジトリルート相対パス → 内容)
 * @param roots 製品が宣言した根(migration の置き場)
 * @returns 当てる順の `[パス, 内容]`
 */
export function orderMigrations(
  generatedFiles: ReadonlyMap<string, string>,
  roots: ProductRoots,
): readonly (readonly [string, string])[] {
  const sql = [...generatedFiles.entries()].filter(
    ([file]) => file.startsWith(`${roots.migrations}/`) && file.endsWith('.sql'),
  );
  // 種類 → 宣言の番号、の 2 段で並べる(種類の中の順序は宣言がすでに正しい)。
  return sql.sort(([left], [right]) => {
    const kind = orderOf(left) - orderOf(right);
    return kind === 0 ? left.localeCompare(right) : kind;
  });
}

/**
 * 一時 workdir に `supabase/`(設定 + 依存順の migrations + 空のシード)を組む。
 *
 * 設定は**リポジトリのものをそのまま写す** —— `project_id` とポートが同じであることが
 * 「同じローカルスタックを使い回す」ことの条件であり、別の値にすると別のコンテナが上がる。
 *
 * シードを空で置くのは、設定が `./seed.sql` を名指しているためである(無いファイルを
 * 名指した `db reset` は落ちる)。**題材の行は挿さない** —— world を作るのはテストの仕事であり、
 * ここが固定データを置くと「テストが自分で作った world」でなくなる。
 *
 * @param args 一時ルート・リポジトリルート・依存順の migration
 * @returns 置いた migration の名前(当てる順)
 */
export function writeDbWorkdir(args: {
  readonly root: string;
  readonly repoRoot: string;
  readonly migrations: readonly (readonly [string, string])[];
  readonly roots: ProductRoots;
}): readonly string[] {
  const supabase = path.join(args.root, stackDirPath(args.roots));
  mkdirSync(path.join(args.root, args.roots.migrations), { recursive: true });
  cpSync(path.join(args.repoRoot, stackConfigPath(args.roots)), path.join(supabase, 'config.toml'));
  writeFileSync(path.join(supabase, 'seed.sql'), '');
  const placed: string[] = [];
  for (const [index, [file, content]] of args.migrations.entries()) {
    // 宣言の名前から連番だけを差し替える(**種類と対象が読める名前を保つ** —— 落ちたときに
    // `supabase` が示すのはこの名前であり、番号だけの名前にすると何が落ちたか読めない)。
    const name = `${String(index + 1).padStart(14, '0')}_${path.basename(file).replace(/^\d+_/, '')}`;
    writeFileSync(path.join(supabase, 'migrations', name), content);
    placed.push(name);
  }
  return placed;
}
