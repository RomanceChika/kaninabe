/**
 * ローカル Supabase の**surface が応答するまで待つ**(readiness の待ち合わせ)。
 *
 * ## なぜ要るのか
 *
 * `supabase db reset` はサービスを作り直すので、コマンドが返った時点ではまだ全部が
 * 応答できるとは限らない。**REST(PostgREST)は先に上がり、認証(GoTrue)は数秒遅れる** ——
 * 速い手元では次のテストが走り出すまでに間に合うが、遅い runner では間に合わず、
 * 認証の口を叩いた最初のテストが Kong の 502(上流が応答しない旨のエラー)で落ちる。
 * **同じコードが手元で緑・CI で赤**になる形であり、
 * 実際に `samples:db` の CI ジョブがこれで赤くなった(2026-09-23)。
 *
 * 症状は「テストの失敗」ではなく「上流が応答しない」なので、テスト側をいくら読んでも
 * 原因に辿り着かない。待ち合わせを**作り直した直後の 1 か所**に置き、上限を超えたら
 * **どの口が応答しなかったか**を報告して赤くする(黙って進めて後段を不可解に落とさない)。
 *
 * ## 見る口は 2 つ
 *
 * REST だけでは足りない —— この穴はまさに「REST は応答するのに認証は応答しない」時間帯で
 * 起きる。逆に認証だけでも足りない(スキーマを読むのは REST である)。**両方が 200 を
 * 返して初めて「上がった」**とする。
 *
 * 時計と `fetch` は引数で受ける(単体で実行できるようにするため)。この口は実 DB を使う
 * テスト基盤の共有部品であり、統合テストの globalSetup と 4 題材の通し実行の両方が呼ぶ ——
 * 待ち合わせを 2 つ持つと、片方だけ直す非対称ができる。
 */

/** 応答を確かめる口 1 つ(名前は診断に出る)。 */
export interface ServiceProbe {
  /** 診断に出る名前(何が応答しなかったかを人が読む)。 */
  readonly name: string;
  /** 叩く URL。 */
  readonly url: string;
}

/** 待ち合わせの調整(既定は実時間・実 fetch)。 */
export interface WaitOptions {
  /** 口を叩く実装(既定はグローバルの `fetch`)。 */
  readonly fetchImpl?: typeof fetch;
  /** 待つ実装(既定は `setTimeout`)。 */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 時刻(既定は `Date.now`)。 */
  readonly now?: () => number;
  /** 叩く間隔(ミリ秒)。 */
  readonly intervalMs?: number;
  /** 諦めるまでの上限(ミリ秒)。 */
  readonly timeoutMs?: number;
}

/** 待ち合わせの結末。 */
export interface WaitResult {
  /** 全部の口が応答したか。 */
  readonly ok: boolean;
  /** 待った時間(ミリ秒)。 */
  readonly waitedMs: number;
  /** 応答しなかった口の診断(通ったときは空)。 */
  readonly problems: readonly string[];
}

/** 既定の間隔(1 秒)。 */
const DEFAULT_INTERVAL_MS = 1_000;

/**
 * 待ちの上限(既定 180 秒)。`db reset` 後の GoTrue の再起動は手元で 2〜5 秒だが、CI の runner では
 * 60 秒を超えることがある(2026-09-25 の samples-db ジョブで 2 回連続、別の題材で 60.8 秒待って 502 のまま
 * = 上限 60 秒では足りない実測)。180 秒はその 3 倍で、超えたら「上がらない」と判断して診断つきで赤にする
 * (見積もりではなくハングを止めるための上限)。待った秒数は毎回印字されるので、実測が伸びれば見える。
 */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * ローカルスタックで応答を確かめる口の全数。
 *
 * @param apiUrl API のベース URL(`supabase status` の `API_URL`)
 * @returns 口(REST と認証)
 */
export function localServiceProbes(apiUrl: string): readonly ServiceProbe[] {
  const base = apiUrl.replace(/\/+$/, '');
  return [
    { name: 'REST(PostgREST)', url: `${base}/rest/v1/` },
    { name: '認証(GoTrue)', url: `${base}/auth/v1/health` },
  ];
}

/** その口が 200 を返すか(落ちた理由は診断の文にする)。 */
async function probe(
  target: ServiceProbe,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(target.url, {
      headers: { apikey: apiKey },
    });
    if (response.ok) return null;
    return `${target.name} が ${String(response.status)} を返しました(${target.url})`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${target.name} に繋がりません: ${reason}(${target.url})`;
  }
}

/**
 * 全部の口が 200 を返すまで待つ。
 *
 * @param args 叩く口・API キー・調整
 * @param args.probes 叩く口の一覧
 * @param args.apiKey surface を叩くための apikey
 * @param args.options 待ち方の調整(間隔・上限・時計・fetch の差し替え)
 * @returns 通ったか・待った時間・応答しなかった口の診断
 */
export async function waitForServices(args: {
  readonly probes: readonly ServiceProbe[];
  readonly apiKey: string;
  readonly options?: WaitOptions;
}): Promise<WaitResult> {
  const options = args.options ?? {};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)));
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = now();
  let problems: string[] = [];
  for (;;) {
    problems = [];
    for (const target of args.probes) {
      const problem = await probe(target, args.apiKey, fetchImpl);
      if (problem !== null) problems.push(problem);
    }
    if (problems.length === 0)
      return { ok: true, waitedMs: now() - started, problems: [] };
    // **上限は「待った時間」で測る** —— 回数で測ると、口が遅いときに上限が伸びる。
    if (now() - started >= timeoutMs)
      return { ok: false, waitedMs: now() - started, problems };
    await sleep(intervalMs);
  }
}

/**
 * 待ち合わせの結末を 1 行にする(印字する側が文を組み立てないため)。
 *
 * @param result 待ち合わせの結末
 * @param timeoutMs 諦めるまでの上限(診断に出す)
 * @returns 人が読む 1 行 + 診断の行
 */
export function describeWait(
  result: WaitResult,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): readonly string[] {
  const waited = (result.waitedMs / 1000).toFixed(1);
  if (result.ok)
    return [`ローカル Supabase の面が応答しました(待ち ${waited} 秒)`];
  return [
    `ローカル Supabase の面が ${String(Math.round(timeoutMs / 1000))} 秒以内に応答しませんでした` +
      `(待ち ${waited} 秒)。db reset の直後はサービスが作り直されるので、遅い実行環境では` +
      `認証(GoTrue)が REST より遅れて上がる`,
    ...result.problems.map((problem) => `  - ${problem}`),
  ];
}
