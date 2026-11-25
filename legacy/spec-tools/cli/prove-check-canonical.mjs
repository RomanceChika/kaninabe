/**
 * 「不変条件から生成した CHECK の式が、Postgres の**正準表記**そのものか」を実 DB で
 * 測り直す道具(`npm run prove:checks`)。
 *
 * ## 何のための道具か
 *
 * `lib/sql/check-expression.ts` が返す字面は「流せる SQL」ではなく
 * **`pg_get_constraintdef` が `CHECK (…)` の内側に印字する形**でなければならない ——
 * 突合(`ddl-parity`)も冪等の判定(`ddl-migration.ts` の定義一致ガード)も**文字列で**
 * 比べるからである。その「同じである」は**実 DB に当てて読み直す**以外に確かめようが無い。
 *
 * ユニットテスト(`__tests__/unit/sql/check-expression.test.ts`)が固定しているのは
 * **測った結果の字面**であり、測り方そのものではない。ここはその測り方を残す ——
 * **Postgres の版が変われば正準表記は変わりうる**ので、版を上げた日にこの 1 本を回せば
 * 「どの式のどこが変わったか」がそのまま出る。
 *
 * ## 何を見るか
 *
 * 全題材(ホスト + fixture)の invariant_spec から `formal.type: check` を集め、
 * `checkExpressionOf` で式に写し、**scratch スキーマの一時表**にその CHECK を張って
 * `pg_get_constraintdef` を読み直して突き合わせる。表の列は entity_spec の欄を
 * `columnType` で写しただけのもので、**アプリの行は 1 行も触らない**(スキーマごと落とす)。
 *
 * 写せない式(別集約の欄・`now`・集合・日時のリテラル・`check` 以外の `formal.type`)は
 * **理由つきで飛ばす** —— 飛ばした数も報告する(黙って母集合から外さない)。
 *
 * ## 検査ではない
 *
 * **CI にも pre-commit にも入れない**(実 DB が要る)。`prove:api-views` と同じ位置づけで、
 * 「1 回の測定を後から再現するための道具」である。
 *
 * 使い方:
 *   npm run prove:checks            # 全題材
 *   npm run prove:checks -- rooms   # 題材を絞る
 *
 * 接続は `SUPABASE_DB_URL`(未設定ならローカル Supabase の既定)。
 * 終了コード: 字面が 1 つも食い違わなければ 0、1 つでも違えば 1。
 */

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { repoRootOrExit, withoutRootOption } from './repo-root.js';
import { loadSpecModel } from '../lib/model/loader.js';
import { loadDataTableSpecModel } from '../lib/model/data/loader.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { findEntitySpec } from '../lib/semantics/domain-lookup.js';
import { checkExpressionOf } from '../lib/sql/check-expression.js';
import { columnType } from '../lib/sql/sql-types.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root` の説明は `ROOT_OPTION_HELP`)。 */
const REPO_ROOT = repoRootOrExit('prove:checks', process.argv.slice(2));

// `pg` は**ワークスペースの依存**(`@kaninabe/runtime` が宣言している)であって道具(`@kaninabe/spec-tools`)の依存ではない
// (`prove-api-viewdef.mjs` と同じ扱い)。
const { Client } = createRequire(path.join(REPO_ROOT, 'package.json'))('pg');

/** 測る先(実行の最後に落とす)。 */
const SCRATCH_SCHEMA = 'check_canonical_probe';

/**
 * ホストの製品 → 仕様の木の場所。名前も場所も**根の宣言**(`product.md`)から取る
 * (読めなければホストは測らない。fixture の 5 題材だけが残る)。
 */
const hostRoots = loadProductRoots(REPO_ROOT).model.roots;
const HOST_SUBJECT = hostRoots === null || hostRoots.name === null ? {} : { [hostRoots.name]: hostRoots.specs };

/** 題材 → 仕様の木の場所(ホストと fixture)。 */
const SUBJECTS = {
  ...HOST_SUBJECT,
  archive: 'legacy/spec-tools/__tests__/fixtures/samples/archive/docs/specs',
  expenses: 'legacy/spec-tools/__tests__/fixtures/samples/expenses/docs/specs',
  library: 'legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs',
  rooms: 'legacy/spec-tools/__tests__/fixtures/samples/rooms/docs/specs',
  stores: 'legacy/spec-tools/__tests__/fixtures/samples/stores/docs/specs',
};

/**
 * 測る対象 1 件。
 *
 * @typedef {{ subject: string, table: string, invariant: string, expression: string,
 *   columns: { name: string, type: string }[] }} Target
 */

/**
 * 飛ばした 1 件(写せない式)。
 *
 * @typedef {{ subject: string, invariant: string, reason: string }} Skipped
 */

/**
 * 題材 1 つから、測る対象と飛ばした理由を集める。
 *
 * @param {string} subject 題材の名前
 * @param {string} specs 仕様の木の場所(リポジトリルート相対)
 * @returns {{ targets: Target[], skipped: Skipped[] }} 対象と、飛ばしたもの
 */
function collect(subject, specs) {
  const options = { repoRoot: REPO_ROOT };
  const root = path.join(REPO_ROOT, specs);
  const { model } = loadSpecModel(path.join(root, 'domain'), options);
  const tables = loadDataTableSpecModel(path.join(root, 'backend/data/tables'), options).model;
  if (model === null || tables === null) return { targets: [], skipped: [] };
  /** @type {Target[]} */
  const targets = [];
  /** @type {Skipped[]} */
  const skipped = [];
  for (const table of tables.tables) {
    const entity = table.entity === undefined ? null : findEntitySpec(model, table.entity);
    if (entity === null) continue;
    for (const specsOfAggregate of model.aggregates.values()) {
      for (const invariant of specsOfAggregate.invariants?.invariants ?? []) {
        if (!invariant.entities.includes(entity.entity)) continue;
        const written = checkExpressionOf(invariant.id, entity, model);
        if (!written.ok) {
          skipped.push({ subject, invariant: invariant.id, reason: written.reason });
          continue;
        }
        targets.push({
          subject,
          table: table.table,
          invariant: invariant.id,
          expression: written.expression,
          columns: entity.fields.map((field) => ({ name: field.name, type: columnType(field.type) })),
        });
      }
    }
  }
  return { targets, skipped };
}

/**
 * 一時表に CHECK を張って `pg_get_constraintdef` を読み直す。
 *
 * @param {InstanceType<typeof Client>} client 接続済みのクライアント
 * @param {readonly Target[]} targets 測る対象
 * @returns {Promise<{ target: Target, printed: string, identical: boolean }[]>} 結果
 */
async function prove(client, targets) {
  const results = [];
  await client.query(`drop schema if exists ${SCRATCH_SCHEMA} cascade`);
  await client.query(`create schema ${SCRATCH_SCHEMA}`);
  try {
    let index = 0;
    for (const target of targets) {
      index += 1;
      const relation = `${SCRATCH_SCHEMA}.probe_${index}`;
      const constraint = `probe_${index}_check`;
      const columns = target.columns.map((column) => `${column.name} ${column.type}`).join(', ');
      await client.query(`create table ${relation} (${columns})`);
      await client.query(`alter table ${relation} add constraint ${constraint} check (${target.expression})`);
      const read = await client.query(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
           join pg_namespace n on n.oid = c.connamespace
          where n.nspname = $1 and c.conname = $2`,
        [SCRATCH_SCHEMA, constraint],
      );
      const printed = read.rows[0]?.definition ?? '';
      results.push({ target, printed, identical: printed === `CHECK (${target.expression})` });
    }
  } finally {
    await client.query(`drop schema if exists ${SCRATCH_SCHEMA} cascade`);
  }
  return results;
}

/**
 * 結果を印字して、食い違った件数を返す。
 *
 * @param {readonly { target: Target, printed: string, identical: boolean }[]} results 測った結果
 * @param {readonly Skipped[]} skipped 写せなかったもの
 * @param {string} version 実 DB の版
 * @returns {number} 字面が食い違った件数
 */
function report(results, skipped, version) {
  console.log(`prove:checks: ${version}`);
  console.log('');
  for (const result of results) {
    const verdict = result.identical ? '一致' : '**違う**';
    console.log(`  [${result.target.subject}] ${result.target.invariant} (${result.target.table}): ${verdict}`);
    if (!result.identical) {
      console.log(`    生成: CHECK (${result.target.expression})`);
      console.log(`    印字: ${result.printed}`);
    }
  }
  if (skipped.length > 0) {
    console.log('');
    console.log(`  写せないので測らなかったもの(${skipped.length} 件。理由つきで飛ばす):`);
    for (const entry of skipped) console.log(`    [${entry.subject}] ${entry.invariant}: ${entry.reason}`);
  }
  const different = results.filter((result) => !result.identical).length;
  console.log('');
  console.log(`prove:checks: ${results.length} 本を測り、正準表記が一致 ${results.length - different} 本 / 違う ${different} 本`);
  return different;
}

/**
 * 実行の入口。
 *
 * @returns {Promise<number>} 終了コード
 */
async function main() {
  const only = withoutRootOption(process.argv.slice(2)).filter((arg) => !arg.startsWith('--'));
  const names = Object.keys(SUBJECTS).filter((name) => only.length === 0 || only.includes(name));
  if (names.length === 0) {
    console.error(`prove:checks: 題材は ${Object.keys(SUBJECTS).join(' / ')} のどれかです`);
    return 1;
  }
  /** @type {Target[]} */
  const targets = [];
  /** @type {Skipped[]} */
  const skipped = [];
  for (const name of names) {
    const found = collect(name, SUBJECTS[name]);
    targets.push(...found.targets);
    skipped.push(...found.skipped);
  }
  if (targets.length === 0) {
    console.error('prove:checks: 測れる式が 1 本もありません(formal.type: check が無いか、全部写せません)');
    return 1;
  }
  const connectionString =
    process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const version = (await client.query('select version() as version')).rows[0]?.version ?? '(版が読めません)';
    return report(await prove(client, targets), skipped, version) === 0 ? 0 : 1;
  } finally {
    await client.end();
  }
}

process.exit(await main());
