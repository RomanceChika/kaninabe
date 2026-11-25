/**
 * 「生成した surface が、それまで手書きだった surface と同じものか」を実 DB で 1 回だけ確かめる道具
 * (`npm run prove:api-views`)。
 *
 * ## 何のための道具か
 *
 * 手書きの SQL を生成物に置き換えるとき、進め方は 1 つに決まっている ——
 * **既存と同じものを生成してから差し替える**(DDL 生成の設計。経緯は非公開の開発記録)。そのためには
 * 「生成した字面が、いま DB に在るものと同じ意味か」を**当てる前に**言い切れなければならない。
 * この CLI はその 1 回きりの確かめを再現可能にするためにある。
 *
 * ## 何を見るか
 *
 * 引数で渡した**手書きの migration**(後のファイルの定義が勝つ)から `create view api.X …` を
 * 拾い、scratch スキーマへそのまま流して `pg_get_viewdef(…, true)` を新旧で突き合わせる。
 * 正準表記なので括弧・別名・空白・`select *` の展開はすべて消え、**残る差だけが本物の差**である。
 * 列の並びが違うだけのときは、式を 1 列 = 1 項に割って順序を無視した比較も出す。
 *
 * ## 検査ではない
 *
 * **CI にも pre-commit にも入れない。** 手書きの側はもう更新されないので、比較する相手が
 * 歴史に固定されている —— 以後の正は生成物であり、実 DB との両方向の突合は統合テスト
 * `api-parity` が持つ。ここは「差し替えた 1 回」の記録を後から再現するための道具である。
 *
 * 使い方:
 *   npm run prove:api-views -- supabase/migrations/20260904000037_api_schema.sql \
 *     supabase/migrations/20260922000257_api_views_comment_columns.sql
 *
 * 接続は `SUPABASE_DB_URL`(未設定ならローカル Supabase の既定)。
 * 終了コード: 差が 1 つも無ければ 0、列の並びだけの差も含めて差があれば 1。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { repoRootOrExit, withoutRootOption } from './repo-root.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root` の説明は `ROOT_OPTION_HELP`)。 */
const REPO_ROOT = repoRootOrExit('prove:api-views', process.argv.slice(2));

// `pg` は**ワークスペースの依存**(`@kaninabe/runtime` が宣言している)であって道具(`@kaninabe/spec-tools`)の依存ではない。
// 名前で解いて位置は綴らない(hoist で居場所が変わる。ADR-0013)。だからこのファイルは .mjs である。
const { Client } = createRequire(path.join(REPO_ROOT, 'package.json'))('pg');

/** 比較のために手書きの定義を流す先(実行の最後に落とす)。 */
const SCRATCH_SCHEMA = 'api_handwritten_probe';

/** 手書きの `create [or replace] view api.X with (security_invoker = true) as … ;` を拾う。 */
const VIEW_RE =
  /create\s+(?:or\s+replace\s+)?view\s+api\.(\w+)\s+with\s+\(security_invoker\s*=\s*true\)\s+as\b([\s\S]*?);\s*\n/gi;

/**
 * 1 ビュー分の突合の結果。
 *
 * @typedef {{ view: string, identical: boolean, sameItems: boolean, handWritten: string, generated: string }} ViewComparison
 */

/**
 * 手書きの migration からビューの定義を集める(後のファイルが勝つ)。
 *
 * @param {readonly string[]} files 手書きの migration(リポジトリルート相対)
 * @returns {Map<string, string>} ビュー名 → `as` の後ろの本文
 */
function collectViews(files) {
  const latest = new Map();
  for (const file of files) {
    const sql = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const match of sql.matchAll(VIEW_RE)) {
      const [, name, body] = match;
      if (name !== undefined && body !== undefined) latest.set(name, body);
    }
  }
  return latest;
}

/**
 * 正準表記を「1 列 = 1 項」に割って並べ替える(列の順序だけの差を見分けるため)。
 *
 * @param {string} definition `pg_get_viewdef` の出力
 * @returns {string[]} 項の並び(整列済み)
 */
function columnItems(definition) {
  return definition
    .replace(/^\s*SELECT/i, '')
    .replace(/FROM [\s\S]*$/i, '')
    .split(/,\n(?=\s*(?:[a-z_]+|CASE))/)
    .map((item) => item.replace(/\s+/g, ' ').trim().replace(/,$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * 手書きと生成のビューを実 DB で突き合わせる。
 *
 * @param {InstanceType<typeof Client>} client 接続済みのクライアント
 * @param {Map<string, string>} views ビュー名 → 手書きの本文
 * @returns {Promise<ViewComparison[]>} ビューごとの結果(名前順)
 */
async function compare(client, views) {
  /** @type {ViewComparison[]} */
  const results = [];
  await client.query(`drop schema if exists ${SCRATCH_SCHEMA} cascade`);
  await client.query(`create schema ${SCRATCH_SCHEMA}`);
  try {
    for (const [view, body] of [...views].sort(([a], [b]) => a.localeCompare(b))) {
      await client.query(`create view ${SCRATCH_SCHEMA}.${view} with (security_invoker = true) as ${body}`);
      const handWritten = await definitionOf(client, `${SCRATCH_SCHEMA}.${view}`);
      const generated = await definitionOf(client, `api.${view}`);
      results.push({
        view,
        identical: handWritten === generated,
        sameItems: columnItems(handWritten).join('\n') === columnItems(generated).join('\n'),
        handWritten,
        generated,
      });
    }
  } finally {
    await client.query(`drop schema if exists ${SCRATCH_SCHEMA} cascade`);
  }
  return results;
}

/**
 * そのビューの正準表記。
 *
 * @param {InstanceType<typeof Client>} client 接続済みのクライアント
 * @param {string} view スキーマ修飾したビュー名
 * @returns {Promise<string>} `pg_get_viewdef` の出力
 */
async function definitionOf(client, view) {
  const result = await client.query(
    'select pg_get_viewdef($1::regclass, true) as definition',
    [view],
  );
  return result.rows[0]?.definition ?? '';
}

/**
 * 結果を 1 行ずつ印字して、差のあったビューの数を返す。
 *
 * @param {readonly ViewComparison[]} results ビューごとの結果
 * @returns {number} 正準表記が一致しなかったビューの数
 */
function report(results) {
  for (const result of results) {
    const verdict = result.identical ? '一致' : result.sameItems ? '列の順序だけ違う' : '違う';
    console.log(`  api.${result.view}: ${verdict}`);
    if (!result.identical && !result.sameItems) {
      console.log('--- 手書き ---');
      console.log(result.handWritten);
      console.log('--- 生成 ---');
      console.log(result.generated);
    }
  }
  const identical = results.filter((result) => result.identical).length;
  const ordered = results.filter((result) => !result.identical && result.sameItems).length;
  console.log('');
  console.log(
    `prove:api-views: ${results.length} 本 / 正準表記が一致 ${identical} 本 / 列の順序だけ違う ${ordered} 本`,
  );
  return results.length - identical;
}

/**
 * 実行の入口。
 *
 * @returns {Promise<number>} 終了コード
 */
async function main() {
  const files = withoutRootOption(process.argv.slice(2)).filter((arg) => !arg.startsWith('--'));
  if (files.length === 0) {
    console.error('prove:api-views: 比較する手書きの migration を 1 本以上渡してください');
    console.error('  例: npm run prove:api-views -- supabase/migrations/20260904000037_api_schema.sql');
    return 1;
  }
  const connectionString = process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
  const views = collectViews(files);
  if (views.size === 0) {
    console.error('prove:api-views: 渡された migration に api のビューの定義がありません');
    return 1;
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return report(await compare(client, views)) === 0 ? 0 : 1;
  } finally {
    await client.end();
  }
}

process.exit(await main());
