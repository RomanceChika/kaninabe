/**
 * **口の本体が、閉じる要求で何にも触れずに閉じたか**を観測するテストの道具(生成した配線の見張りテストが使う。製品の実行時には読まない)。
 *
 * ## 何を確かめたいのか
 *
 * cookie で認証する口は「出どころを確かめられない要求を、**認証・DB・外部の呼び出しより先に**閉じる」と約束する。
 * 戻り値が 403 であることだけを見ると、先に副作用を起こしてから 403 を返す実装(関門の後置)・関門の結果を捨てる実装・
 * 関門をコメントに書いただけの実装が、奥の守り(セッションの adapter の二重の確認など)が 403 を返す限り緑になる。
 *
 * ## どう観測するか(モジュールの差し替えはしない)
 *
 * この仕組みはテストでのモジュールの差し替え(`vi.mock` の類)を禁じている(注入点にテスト用の実装を渡す)。Route Handler は
 * 枠が決めた形(`POST(request)`)で注入点を持てないので、**口の外側の境界**で観測する:
 *
 *   1. **外への呼び出し** … グローバルの `fetch` を「記録して拒む」ものに差し替える(認証基盤・DB(PostgREST)・外部の API は、
 *      この構成ではどれも `fetch` を通る)。**口を読み込む前に**差し替える(`installNetworkProbe` → `import`)ので、
 *      読み込みのときに `fetch` を掴むクライアントも記録に入る
 *   2. **要求の文脈を要る呼び出し** … 認証(`cookies()` / `headers()`)は、要求の文脈の外では例外を投げる。閉じる要求で
 *      例外が出たら、関門より先に何かが走った証拠として数える
 *   3. **本文の読み取り** … 要求の本文を読んだか(`bodyUsed`)
 *   4. **閉じた応答が関門のものか** … 状態と本文が関門の応答(`crossOriginRefusal`)と同じか。奥の守りが別の形の 403 で閉じた
 *      (= 関門が働かずに奥まで進んだ)ものを見分ける
 *
 * 限界: `fetch` を通らない外への呼び出し(DB への直のソケット・子プロセス)と、例外を投げずに要求の文脈の外でも動く副作用は観測しない。
 * 字面の側(最初の文で関門を呼び、その結果を返す形)は J2 が構文木で見る。判定の語(理由の綴り)は英数字の短い印で、日本語の文言は生成テストの側が持つ。
 */

/** 外への呼び出しの記録 1 件の綴り(`fetch:{ホスト}`。相対の URL は `fetch:relative`)。 */
export type TouchedNetwork = string;

/** グローバルの `fetch` を差し替えた観測の口。 */
export interface NetworkProbe {
  /** 記録の写し(重複なし・最初に触れた順)。 */
  touched(): readonly TouchedNetwork[];
  /** 記録を空にする。 */
  clear(): void;
  /** グローバルの `fetch` を元に戻す(2 度目以降は何もしない)。 */
  dispose(): void;
}

/** 呼び出しの行き先(ホストだけ。値やパスは記録に残さない)。 */
function targetOf(input: unknown): TouchedNetwork {
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  return URL.canParse(url) ? `fetch:${new URL(url).host}` : 'fetch:relative';
}

/**
 * グローバルの `fetch` を「記録して拒む」ものに差し替える。口を読み込む**前に**呼ぶ。
 *
 * @returns 観測の口(使い終えたら `dispose` を呼ぶ)
 */
export function installNetworkProbe(): NetworkProbe {
  const original = globalThis.fetch;
  const records: TouchedNetwork[] = [];
  let disposed = false;
  globalThis.fetch = (input) => {
    const target = targetOf(input);
    if (!records.includes(target)) records.push(target);
    return Promise.reject(new Error('route-isolation: fetch is blocked while observing a handler'));
  };
  return {
    touched: () => [...records],
    clear: () => {
      records.length = 0;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      globalThis.fetch = original;
    },
  };
}

/** 口の 1 回の呼び出しの観測。 */
export interface HandlerObservation {
  /** 応答のステータス(戻り値が `Response` でなければ null)。 */
  readonly status: number | null;
  /** 応答が関門の閉じる応答と同じ状態のとき、その本文(それ以外は null。流れる本文を待たない)。 */
  readonly refusalBody: string | null;
  /** 例外で落ちたならその理由(落ちなければ null)。 */
  readonly thrown: string | null;
  /** 呼び出しの間の外への呼び出し(重複なし)。 */
  readonly touched: readonly TouchedNetwork[];
  /** 要求の本文を読んだか。 */
  readonly bodyUsed: boolean;
}

/** 関門の閉じる応答の形(状態と本文)。 */
export interface RefusalShape {
  readonly status: number;
  readonly body: string;
}

/**
 * 関門の閉じる応答の形を写す(生成テストは `crossOriginRefusal(宣言)` を渡す)。
 *
 * @param refusal - 関門の閉じる応答
 * @returns 状態と本文
 */
export async function refusalShapeOf(refusal: Response): Promise<RefusalShape> {
  return { status: refusal.status, body: await refusal.text() };
}

/**
 * 記録を空にしてから口を 1 回呼び、何に触れたかを観測する。
 *
 * @param handler - 口(`POST` などの本体)
 * @param request - 送る要求
 * @param probe - 観測の口(口を読み込む前に `installNetworkProbe` で作ったもの)
 * @param refusal - 関門の閉じる応答の形(この状態の応答だけ本文を読む)
 * @returns 観測
 */
export async function observeHandler(handler: (request: Request) => unknown, request: Request, probe: NetworkProbe, refusal: RefusalShape): Promise<HandlerObservation> {
  probe.clear();
  let result: unknown;
  let thrown: string | null = null;
  try {
    result = await handler(request);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const touched = probe.touched();
  const response = result instanceof Response ? result : null;
  const refusalBody = response !== null && response.status === refusal.status ? await response.text() : null;
  return { status: response?.status ?? null, refusalBody, thrown, touched, bodyUsed: request.bodyUsed };
}

/**
 * 閉じる要求として、関門が何にも触れずに閉じたか。理由の印は `threw:{理由}` / `status:{値}` / `not-guard-refusal` / `touched:{行き先}` / `body-read`。
 *
 * @param observation - 観測
 * @param refusal - 関門の閉じる応答の形
 * @returns 正しく閉じていなければ理由の並び(空 = 外へ呼ばず、例外も出さず、本文を読まず、関門と同じ応答で閉じた)
 */
export function refusalLeaks(observation: HandlerObservation, refusal: RefusalShape): readonly string[] {
  const statusLeak = observation.thrown === null && observation.status !== refusal.status ? [`status:${String(observation.status)}`] : [];
  const shapeLeak = observation.status === refusal.status && observation.refusalBody !== refusal.body ? ['not-guard-refusal'] : [];
  return [
    ...(observation.thrown === null ? [] : [`threw:${observation.thrown}`]),
    ...statusLeak,
    ...shapeLeak,
    ...observation.touched.map((target) => `touched:${target}`),
    ...(observation.bodyUsed ? ['body-read'] : []),
  ];
}

/**
 * 関門を通って本体へ進んだか(対照に使う。閉じる応答と区別できる何かが起きた = 外へ呼んだ・例外を出した・本文を読んだ・別の応答を返した)。
 *
 * @param observation - 観測
 * @param refusal - 関門の閉じる応答の形
 * @returns 本体へ進んだなら true
 */
export function passedGuard(observation: HandlerObservation, refusal: RefusalShape): boolean {
  return refusalLeaks(observation, refusal).length > 0;
}
