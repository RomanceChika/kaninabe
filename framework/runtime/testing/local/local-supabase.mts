import { execFileSync } from 'node:child_process';
import type { DbLock } from './db-lock.mjs';
import { requireStackMark } from './stack-mark.mjs';
import { withPathOutsideRoot } from './search-path.mjs';
import { SUPABASE_CLI_VERSION } from './supabase-cli-version.mjs';

/**
 * ローカル Supabase の起動と接続情報の解決。
 *
 * 統合テストは「1 コマンドで完結すること」が成立条件なので（integration.md 3節）、
 * 起動していなければここで起動し、鍵はコミットせずに CLI から取得する。
 */

/**
 * **CLI を実行する場所は利用側が渡す。**
 *
 * ここは仕組み側のパッケージであり、第 2 段では利用側の `node_modules/` の中に居る ——
 * 自分の置き場から利用側の根は数えられない（ADR-0013 の規律）。**目印から探すのも同じ穴である**
 * ：`supabase/config.toml` という綴りは「その製品が Supabase の設定をどこに置くか」という
 * 製品の宣言であり、仕組み側に写せば答えが 2 つになる（束 ①-c-b のレビュー指摘）。
 *
 * 渡し方は 2 つとも製品の側にある。
 *   - 統合テスト: vitest の `provide`（`supabaseRoot`。`schemaProbeQuery` と同じ経路）
 *   - E2E・走査: 製品の設定が自分の根から算出して渡す
 */
export type SupabaseRoot = string;

/** CLI の版を確かめたか（1 プロセスにつき 1 回で足りる）。 */
let cliVersionChecked = false;

/** `supabase status -o json` の出力のうち、ここで使う項目。 */
export interface SupabaseStatus {
  readonly API_URL: string;
  readonly ANON_KEY: string;
  readonly SERVICE_ROLE_KEY: string;
  /** Postgres への直接接続文字列。カタログ（pg_policies 等）を読むテストが使う。 */
  readonly DB_URL: string;
}


/**
 * globalSetup からワーカーへ配る値の型（vitest の `provide` / `inject` の口）。
 *
 * 接続情報を解決するのは globalSetup の 1 回だけにし、各ワーカーはこれを受け取る
 * （[setup-env.mts](./setup-env.mts)）。ここに宣言を置くのは、配る値の形の正が
 * `SupabaseStatus` そのものだからである。
 */
declare module 'vitest' {
  interface ProvidedContext {
    readonly supabaseStatus: SupabaseStatus;
    /**
     * 「マイグレーション適用済み」の目印（`/rest/v1/` に続く問い合わせ）。
     *
     * **値は利用側の設定が宣言する** —— どの表が在れば適用済みと言えるかはその製品の事情で、
     * 仕組み側は表の名前を 1 つも持たない（[global-setup.mts](./global-setup.mts) が読む）。
     */
    readonly schemaProbeQuery: string;
    /**
     * Supabase CLI を実行する場所（その製品の `supabase/` を持つディレクトリ）。
     *
     * **値は利用側の設定が宣言する** —— 仕組み側は製品の根も、その目印の綴りも持たない。
     */
    readonly supabaseRoot: SupabaseRoot;
  }
}

/**
 * Supabase CLI を名前で引く間だけ、PATH から根の中と `node_modules` を落とす（`npm run` の下では依存の同じ名前の bin が先に当たるため。点検 9 回目 C9-5）。
 *
 * @param root - Supabase CLI を実行する場所（その製品の根）
 * @param run - PATH を絞った間に回すこと
 * @returns `run` の戻り値
 */
export function withSupabaseCli<T>(root: SupabaseRoot, run: () => T): T {
  return withPathOutsideRoot([root], run);
}

/** CLI を実行して標準出力を返す（状態確認なので標準エラーは捨てる）。 */
function runCli(args: readonly string[], root: SupabaseRoot): string {
  return withSupabaseCli(root, () =>
    execFileSync('supabase', [...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
}

/** 起動していれば接続情報を返し、起動していなければ `null` を返す。 */
function readStatus(root: SupabaseRoot): SupabaseStatus | null {
  try {
    const parsed: unknown = JSON.parse(runCli(['status', '-o', 'json'], root));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const status = parsed as Partial<SupabaseStatus>;
    if (
      typeof status.API_URL !== 'string' ||
      typeof status.ANON_KEY !== 'string' ||
      typeof status.SERVICE_ROLE_KEY !== 'string' ||
      typeof status.DB_URL !== 'string'
    ) {
      return null;
    }
    return {
      API_URL: status.API_URL,
      ANON_KEY: status.ANON_KEY,
      SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      DB_URL: status.DB_URL,
    };
  } catch {
    return null;
  }
}

/**
 * ローカル Supabase が起動していることを保証し、接続情報を返す。
 *
 * @param root - Supabase CLI を実行する場所（その製品の設定 `supabase/` を持つディレクトリ）
 * @returns API の URL と anon / service role の鍵
 * @throws 相手にする stack の名指しが無い・設定と違うとき(stack-mark.mts)
 */
export function ensureLocalSupabase(root: SupabaseRoot): SupabaseStatus {
  // 名指し(か使い捨ての runner)が無ければ、状態も読まずに止める(共用の stack を黙って起こさない。照らしの持ち主は stack-mark.mts)。
  requireStackMark(root);
  warnOnCliVersionMismatch(root);
  const running = readStatus(root);
  if (running !== null) return running;

  // 起動の進捗は標準エラーに出る。標準出力（接続情報のJSON）は鍵を含むので伏せる。
  withSupabaseCli(root, () => execFileSync('supabase', ['start'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }));
  const started = readStatus(root);
  if (started === null) {
    throw new Error('ローカル Supabase の起動に失敗しました（`supabase start` の出力を確認してください）。');
  }
  return started;
}

/**
 * 接続情報をアプリが読む環境変数に載せる。
 *
 * @param status - `ensureLocalSupabase` の戻り値
 */
export function applyEnv(status: SupabaseStatus): void {
  process.env['SUPABASE_URL'] = status.API_URL;
  process.env['SUPABASE_ANON_KEY'] = status.ANON_KEY;
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = status.SERVICE_ROLE_KEY;
  // アプリは使わない（アプリからの DB アクセスは常に Supabase 経由）。
  // カタログを読む統合テストだけが使う、ローカル専用の接続文字列である。
  process.env['SUPABASE_DB_URL'] = status.DB_URL;
}

/**
 * 手元の CLI の版が固定値（[supabase-cli-version.mts](./supabase-cli-version.mts)）と
 * 違えば警告する。**止めない。**
 *
 * 版がずれていること自体は作業を止める理由にならないが、`supabase start` が突然
 * 巨大な pull を始めたり、`migration up` の挙動が変わったりしたときに、原因を
 * 最初に疑う場所をここで教える（版差で環境を失った実例がある）。
 *
 * 1 プロセスにつき 1 回だけ確かめる（`ensureLocalSupabase` はテストファイルごとに呼ばれる）。
 */
function warnOnCliVersionMismatch(root: SupabaseRoot): void {
  if (cliVersionChecked) return;
  cliVersionChecked = true;
  let actual: string;
  try {
    actual = runCli(['--version'], root).trim();
  } catch {
    // 版が読めない（CLI が無い等）ときは、後続の `status` / `start` が本来のエラーを出す。
    return;
  }
  if (actual === SUPABASE_CLI_VERSION) return;
  process.stderr.write(
    `警告: Supabase CLI の版が固定値と違います（手元 ${actual} / 固定 ${SUPABASE_CLI_VERSION}）。\n` +
      '  正は @kaninabe/runtime の testing/local/supabase-cli-version.mts で、CI（.github/workflows/nightly.yml）も同じ値を使います。\n' +
      '  版が違うと要求する Docker イメージの世代も変わり、`supabase start` が db コンテナを\n' +
      '  作り直して巨大な pull を始めることがあります（`npx supabase` は使わないこと）。\n',
  );
}

/**
 * 未適用の migration をローカル DB に適用する（**実 DB を使う実行の唯一の口**）。
 *
 * 統合テストも E2E も「起動しているローカル Supabase をそのまま使う」ので、新しい
 * migration を書いた直後は **DB だけが古い**状態になりうる。そのとき落ちるのは
 * `usecase-rpc-parity`（生成物と実 DB の本文突合）などであり、症状からは「仕様の問題」と
 * 「適用漏れ」が区別できない。ここで毎回流して、その区別を無くす。
 *
 * 適用済みの版はスキップされるので、差分が無ければ実質 no-op である。
 * **`supabase db reset` は使わない**（スキーマを作り直す必要はなく、reset は
 * 多重起動ガードのロックを一時的に外す・環境ごと作り直す危険がある）。
 *
 * **引数はロックを取った証拠である。** スキーマを触る操作を多重起動ガードの外から起こせると、
 * `shots` / `walk` のような後発の入口が「ロックを取らずに DB を作り替える」経路を静かに作れて
 * しまう（[db-lock.mts](./db-lock.mts) の目的そのものが崩れる）。`DbLock` は
 * `acquireDbLock` だけが作るので、ロックの内側からしか呼べない形になる。
 *
 * @param lock - `acquireDbLock` が返したロック（当てる先の DB もここから取る）
 * @param root - Supabase CLI を実行する場所（その製品の設定 `supabase/` を持つディレクトリ）
 * @throws 適用に失敗した場合（何を試したか・次に何を見るかを添えて止める）
 */
export function applyMigrations(lock: DbLock, root: SupabaseRoot): void {
  requireStackMark(root);
  try {
    withSupabaseCli(root, () => execFileSync('supabase', ['migration', 'up', '--local'], { cwd: root, stdio: 'inherit' }));
  } catch (cause) {
    throw new Error(
      'ローカル DB への migration の適用に失敗しました（`supabase migration up --local`）。\n' +
        `  対象の DB: ${lock.databaseUrl}\n` +
        '  supabase/migrations/ の新しいファイルが適用できない状態です。SQL のエラーなら上の出力に\n' +
        '  理由が出ています。ローカル DB が壊れている場合の作り直し（db reset）は、消える範囲を\n' +
        '  理解したうえで人が判断してください（自動では行いません）。',
      { cause },
    );
  }
}
