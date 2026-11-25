/**
 * 実 DB の足場が**名指しの無い stack に触れない**既定(安全の束 safety1 (a)。この仕組みの持ち主)。
 *
 * 統合の globalSetup・E2E・題材の通し実行(samples:db)・開発の道具は、ローカル Supabase を起動し・作り直し(`db reset`)・migration を当てる。
 * 以前は印(`ST_EXPECT_PROJECT_ID`)が無ければ照らしを飛ばし、その場の設定が指す stack(手元では同じ機械の別の作業も使う共用の stack)を
 * そのまま相手にした —— 使い捨てで包まずに起こした `samples:db` が、共用の stack を題材 6 つ分作り直した(2026-11-16 の事故 2 回目)。
 * そこで既定を赤の側に変える: 次のどれかが無ければ、CLI を 1 つも回さずに赤。
 *
 * - **名指し**: `ST_EXPECT_PROJECT_ID` があり、設定の `project_id` がそれと同じ(照らしの本体は [expected-project.mts](./expected-project.mts))。
 *   使い捨ての stack の道具は自分で付ける。共用の stack で回すのは、人が自分で `ST_EXPECT_PROJECT_ID=<設定の project_id>` を付けたときだけ(入口はこの 1 本)。
 * - **CI の使い捨ての機械**: GitHub がホストする runner(`GITHUB_ACTIONS=true` かつ `RUNNER_ENVIRONMENT=github-hosted`)。機械ごと使い捨てなので、
 *   名指しが無くても共用の stack は無い。自前の runner(`self-hosted`)は手元の機械でありうるので含めない。
 *
 * 依存は `node:` の標準と照らしの本体だけ(道具が素の node から読むため)。
 */

import { EXPECT_PROJECT_ENV, refuseUnexpectedProject } from './expected-project.mjs';

/** 足場が読む環境の 3 つ(呼び側の環境から渡す。既定は `process.env`)。 */
export interface StackMarkEnv {
  /** 名指しの project_id(`ST_EXPECT_PROJECT_ID`)。 */
  readonly expected: string | undefined;
  /** `GITHUB_ACTIONS`(GitHub の runner なら `true`)。 */
  readonly githubActions: string | undefined;
  /** `RUNNER_ENVIRONMENT`(GitHub がホストする runner なら `github-hosted`)。 */
  readonly runnerEnvironment: string | undefined;
}

/**
 * 今のプロセスの環境から読む(読む名前はここ 1 か所)。
 *
 * @returns 足場が読む環境の 3 つ
 */
export function stackMarkEnv(): StackMarkEnv {
  return {
    expected: process.env['ST_EXPECT_PROJECT_ID'],
    githubActions: process.env['GITHUB_ACTIONS'],
    runnerEnvironment: process.env['RUNNER_ENVIRONMENT'],
  };
}

/**
 * GitHub がホストする使い捨ての runner か。
 *
 * @param env - 足場が読む環境
 * @returns 両方の印があれば true
 */
export function onHostedRunner(env: StackMarkEnv): boolean {
  return env.githubActions === 'true' && env.runnerEnvironment === 'github-hosted';
}

/**
 * 名指しも使い捨ての runner も無ければ、止める 1 行を返す(どちらかがあれば null。名指しの値の照らしは別 = `refuseUnexpectedProject`)。
 *
 * @param env - 足場が読む環境
 * @returns 止める 1 行か null
 */
export function stackMarkRefusal(env: StackMarkEnv): string | null {
  if (env.expected !== undefined && env.expected !== '') return null;
  if (onHostedRunner(env)) return null;
  return (
    `ローカル Supabase を起動する・作り直す・migration を当てる前に止めました: どの stack を相手にするかの名指し(${EXPECT_PROJECT_ENV})がありません。` +
    '使い捨ての stack で回すときは、使い捨ての stack の道具を通してください(道具が名指しを付けます)。' +
    `人が共用の stack で回すときだけ、自分で ${EXPECT_PROJECT_ENV}=<Supabase の設定の project_id> を付けてください`
  );
}

/**
 * `root` で回す CLI の前の照らし: 名指しか使い捨ての runner が要り、名指しがあれば設定の `project_id` がそれと同じであること。
 *
 * @param root - Supabase CLI を実行する場所(その下の Supabase の設定を読む)
 * @param env - 足場が読む環境(既定は今のプロセスの環境)
 * @throws 名指しが無い・名指しと設定が違う・設定が読めないとき
 */
export function requireStackMark(root: string, env: StackMarkEnv = stackMarkEnv()): void {
  const refusal = stackMarkRefusal(env);
  if (refusal !== null) throw new Error(refusal);
  refuseUnexpectedProject(root, env.expected);
}
