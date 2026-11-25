import { execFileSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';
import { assertDockerResponds } from './docker-alive.mjs';
import { acquireDbLock, releaseDbLock, type DbLock } from './db-lock.mjs';
import { applyEnv, applyMigrations, ensureLocalSupabase, withSupabaseCli } from './local-supabase.mjs';
import type { SupabaseRoot } from './local-supabase.mjs';
import { requireStackMark } from './stack-mark.mjs';
import { describeWait, localServiceProbes, waitForServices } from './supabase-ready.mjs';

/**
 * 統合テストのグローバルセットアップ。
 *
 * ローカル Supabase を起動し、`supabase/migrations/` が適用済みであることを保証する
 * （integration.md 3節「起動していない場合は自動起動する」）。
 *
 * あわせて**多重起動を止める**。統合テストは 1 つの実 DB を共有し、しかも
 * `db reset` / `migration up` という破壊的な操作から始まるため、2 つ走ると
 * 片方のデータが消え、落ち方も再現しない（「別のエージェントが同時に走っていた」は
 * テストの失敗として現れず、原因不明の不安定として現れる）。
 *
 * ガードの実体（advisory lock とそのキー）は [db-lock.mts](./db-lock.mts) にあり、
 * **E2E スモークと共有している**（同じ DB を破壊的に使う実行どうしは互いを排除する）。
 */

/**
 * マイグレーションで適用されるはずのものが在るかを REST 越しに確認する。
 *
 * **問い合わせの文字列は利用側が渡す。** どの表が在れば「適用済み」と言えるかはその製品の
 * 事情であり、仕組み側は表の名前を 1 つも持たない（`RuntimeBindings` と同じ裏返し。
 * 渡し方は vitest の `provide` で、宣言は利用側の設定にある）。
 *
 * @param url - API のベース URL
 * @param serviceRoleKey - RLS を越えて確かめるための鍵
 * @param probeQuery - `/rest/v1/` に続く問い合わせ（例: `{表}?select={列}&limit=1`）
 * @returns 応答が ok なら true
 */
async function schemaApplied(url: string, serviceRoleKey: string, probeQuery: string): Promise<boolean> {
  const response = await fetch(`${url}/rest/v1/${probeQuery}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  return response.ok;
}

/**
 * 利用側が `provide` で宣言した値を取り出す（無ければ何が足りないかを言って止める）。
 *
 * **仕組み側は製品の事情を 1 つも持たない。** どの表が在れば「適用済み」と言えるか
 * (`schemaProbeQuery`)も、CLI をどこで実行するか(`supabaseRoot`)も製品の宣言である
 * （`RuntimeBindings` と同じ裏返し。ADR-0013）。
 *
 * @param project - vitest のプロジェクト（`provide` の宣言を持っている）
 * @param key - 取り出す宣言の名前
 * @param example - 足りないときに見せる書き方
 * @returns 宣言された文字列
 * @throws 宣言が無いとき
 */
function declaredString(project: TestProject, key: 'schemaProbeQuery' | 'supabaseRoot', example: string): string {
  const declared = project.config.provide?.[key];
  if (typeof declared === 'string' && declared.length > 0) return declared;
  throw new Error(
    `統合テストの設定に provide.${key} がありません（例: \`provide: { ${key}: ${example} }\`）。` +
      'これは製品の事情なので、仕組み側は持ちません。',
  );
}

/**
 * `supabase db reset` の直後に、surface（REST と認証）が応答するまで待つ。
 *
 * 待てなかったら**診断つきで落とす** — 進めても後段が「上流が応答しない」で落ちるだけで、
 * そのときテストの中身をいくら読んでも原因に辿り着かない。
 *
 * @param apiUrl - API のベース URL
 * @param anonKey - surface を叩くための apikey
 */
async function waitForServicesOrThrow(apiUrl: string, anonKey: string): Promise<void> {
  const ready = await waitForServices({ probes: localServiceProbes(apiUrl), apiKey: anonKey });
  const lines = describeWait(ready);
  if (ready.ok) {
    console.log(lines.join('\n'));
    return;
  }
  throw new Error(lines.join('\n'));
}

/** 取れなかったときのメッセージ（局面ごとに、何が起きたのかを言い切る）。 */
const CONFLICT_AT_START =
  '別の実 DB テストが実行中です（同じローカル Supabase を使う `npm run test:integration` / `npm run test:e2e` が二重に走っています）。' +
  '先に走っているほうの終了を待ってから、もう一度実行してください。';

/**
 * `supabase db reset` の**後**に出る競合のメッセージ。
 *
 * `db reset` は接続を切るため、advisory lock はセッションごと一時的に解放される。
 * その隙に別の実行が入り込むと、こちらの DB は既に相手に触られている可能性がある。
 */
const CONFLICT_AFTER_RESET =
  'スキーマ再作成（supabase db reset）の最中に別の実 DB テストが入り込みました（reset は接続を切るため、' +
  'その間だけ多重起動ガードのロックが外れます）。DB の状態が信用できないので中断します。' +
  '同時実行が終わったことを確認して、もう一度実行してください。';

/**
 * テスト実行前に一度だけ走るセットアップ。
 *
 * **接続情報の解決（`supabase status`）はここ 1 回だけである。** 以前はワーカー側の
 * `setup-env.mts` が自分で解決していたため、テストファイルごとに CLI を起動していた
 * （144 ファイル × 数百 ms が `setup` の大半を占めていた）。解決した値は vitest の
 * `provide` でワーカーへ配り、ワーカーは `inject` で受け取るだけにする
 * （globalSetup はテスト本体と別プロセス／スレッドなので、`process.env` では届かない）。
 *
 * @param project - vitest のプロジェクト（`provide` でワーカーへ値を配るのに使う）
 * @returns 全テスト終了後に走る後始末（ロックの解放）
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Docker が固まっていると、この先の CLI が黙って返ってこない。先に原因を言い切って落とす。
  assertDockerResponds();
  const root: SupabaseRoot = declaredString(project, 'supabaseRoot', '"/path/to/your/repo"');
  const status = ensureLocalSupabase(root);
  applyEnv(status);
  project.provide('supabaseStatus', status);

  // スキーマを触る前にロックを取る（破壊的な操作が並行しないことがこのガードの目的）。
  let lock: DbLock = await acquireDbLock(status.DB_URL, CONFLICT_AT_START);

  const probeQuery = declaredString(project, 'schemaProbeQuery', '"{表}?select={列}&limit=1"');
  if (!(await schemaApplied(status.API_URL, status.SERVICE_ROLE_KEY, probeQuery))) {
    // 作り直す直前に、名指しがあり設定が名指しの stack を指したままかを見る(道具が設定を戻した後に走り続けた命令が、共用を作り直さない。C20-1・safety1)。
    requireStackMark(root);
    withSupabaseCli(root, () => execFileSync('supabase', ['db', 'reset'], { cwd: root, stdio: 'inherit' }));
    // **作り直した直後は、まだ全部の口が応答しない。** REST は先に上がり、認証（GoTrue）は
    // 数秒遅れる — 速い手元では間に合うが、遅い実行環境ではテストの最初の
    // `auth.admin.*` が Kong の 502（上流が応答しない旨のエラー）で落ちる。ここで reset を
    // 挟まない CI の統合ジョブでは露見しないが、穴は同じ
    // なので同じ待ち合わせ（supabase-ready.mts）を通す。
    await waitForServicesOrThrow(status.API_URL, status.ANON_KEY);
    // reset で接続が切れていれば、ロックもそこで外れている。取り直して、
    // その隙に別の実行が入り込んでいないことを確かめる。
    await releaseDbLock(lock, true);
    lock = await acquireDbLock(status.DB_URL, CONFLICT_AFTER_RESET);
  }
  // スキーマの「存在」だけでは新しいマイグレーションの取り込み漏れを検出できない
  // （テーブルが 1 つでもあれば ok になってしまう）。適用済みの版はスキップされるので、
  // 常に流して差分だけを適用する（口は local-supabase.mts の applyMigrations 1 つ。
  // E2E の db-guard.mts も同じ口を通る）。
  applyMigrations(lock, root);

  return () => releaseDbLock(lock, true);
}
