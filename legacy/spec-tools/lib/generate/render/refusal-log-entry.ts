/**
 * 生成された **Server Action が拒否を記録する行**(ASVS V16.3.2 / V16.3.3。logging.md §セキュリティの事象)。
 *
 * 単発の操作(`code-operation-app.ts`)と保存点(`code-usecase-app.ts`)の 2 つの生成器が同じ行を引く —— 形が 2 つに割れると、
 * 片方の入口だけ記録が黙って外れる(`mfa-entry.ts` と同じ理由)。
 *
 * 入口の形は 3 つの順序を固定する:
 *   1. **実行者をパースより先に解く**(logging.md「実行者はパースより先に解決しておく」。拒否された入力の記録に「誰が」が無いと、
 *      攻撃と操作ミスの区別が付かない)。要求の識別子も同じ位置で解く。
 *   2. パースの失敗は `invalid_input` として記録して返す(入力値は記録に渡さない)。
 *   3. 実行器の結果が拒否なら 1 行記録して、**結果をそのまま返す**(記録は結果を変えない)。
 *   4. **実行者・セッションのプロフィール・多要素認証の解決が投げたら**(認証基盤が答えないときの `SessionUnreadableError`。負荷のときに
 *      いちばん起きる例外)、同じく一時的な失敗として 1 行記録してから投げ直す(点検 20 回目 B20-3)。実行者が解けていなければ、
 *      記録の実行者は空(`null`)にする —— 行を出さないより、実行者の分からない行を出す。要求の識別子の解決は投げない(読めなければ null)。
 *   5. 実行器が**例外で終わったら**、一時的な失敗(`temporarily_unavailable`)として 1 行記録する(点検 19 回目 O19-2)。記録の欄は拒否と
 *      同じ閉じた欄(操作・実行者・要求の識別子)で、例外の文言は載せない。**コミットの状態が分かる DB の失敗は値で返す**(点検 20 回目 B20-1。
 *      `commit` = `not_committed` / `unknown`。例外のまま投げると Next は digest しか返さず、書けたかどうかが画面に届かない)。それ以外の例外は
 *      スタックを残すために投げ直す(画面の実行器が受けて `unknown` として出す。`runner-core.ts`)。
 *
 * 入口は第 2 引数で**送信の意図**(`ActionIntent`)を受け、形を確かめた冪等キーを組み立ての根へ渡す(押し直しで同じ鍵が届くので、作成の 2 回目は
 * 1 回目の行を返す)。
 *
 * 記録の口(`recordActionRefusal`)と要求の識別子の解決(`resolveRequestId`)は、製品の認証の組み立ての根(配置の `auth-composition`)が
 * 持つ手書きの接続点で、実行者の解決(`resolveActorId`)と同じ場所に住む。無ければ生成された Server Action の型検査が落ちる
 * (記録の口が無い状態で出荷できない。手書きの入口の側は H7 が構文木で見る)。
 */

export { REFUSAL_LOG_EXPORTS } from '../../model/auth/refusal-log.js';

/**
 * Server Action の本文の先頭(実行者と要求の識別子を、パースより先に解く行)。
 *
 * @param operationName 記録に載せる操作の関数名(`settleWidget`)
 * @returns 本文の行
 */
export function actionHeadLines(operationName: string): readonly string[] {
  return [
    // 要求の識別子は投げない(読めなければ null)ので先に解き、実行者の解決が投げた行にも載せる。
    '  const requestId = await resolveRequestId();',
    // 実行者はパースより先に解く(拒否された入力の記録に「誰が」を載せるため。logging.md)。投げたら実行者の空の行を出して投げ直す。
    ...guardedLines('actorId', 'resolveActorId()', `{ operation: '${operationName}', actorId: null, requestId }`),
    `  const entry = { operation: '${operationName}', actorId, requestId };`,
  ];
}

/**
 * 解決の 1 行を、投げたら一時的な失敗として 1 行記録してから投げ直す形で出す(点検 20 回目 B20-3。例外の文言は載せない)。
 *
 * @param binding 受ける変数の名前(`actorClaims`)
 * @param call 解決の呼び出し(`resolveSessionProfile()`)
 * @param context 記録の文脈の式(省略は先頭の行が作る記録の文脈の変数)
 * @returns 本文の行
 */
export function guardedLines(binding: string, call: string, context?: string): readonly string[] {
  const record =
    context === undefined
      ? "    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));"
      : `    recordActionRefusal(${context}, err({ kind: 'temporarily_unavailable' }));`;
  return [
    `  const ${binding} = await ${call}.catch((cause: unknown) => {`,
    record,
    '    throw cause;',
    '  });',
  ];
}

/**
 * セッションのプロフィール(`claim` を持つロールの根拠)を解く行。投げたら記録して投げ直す。
 *
 * @returns 本文の行
 */
export function profileLines(): readonly string[] {
  return guardedLines('actorClaims', 'resolveSessionProfile()');
}

/**
 * パースの失敗を記録して返す行(`parsed` の失敗の分岐。入力値は記録に渡さない)。
 *
 * @returns 本文の行
 */
export function parseFailureLines(): readonly string[] {
  return [
    '  if (!parsed.success) {',
    "    const rejected: ActionResult<never> = err({ kind: 'invalid_input', issues: toFieldIssues(parsed.error) });",
    '    recordActionRefusal(entry, rejected);',
    '    return rejected;',
    '  }',
  ];
}

/**
 * 実行器を呼び、拒否なら記録して、結果をそのまま返す行。DB の失敗は一時的な失敗の値にし、それ以外の例外は記録して投げ直す。
 *
 * @param call 実行器を呼ぶ式(`createX()(actorId, actorClaims, parsed.data, intentKeyOf(intent))`)
 * @returns 本文の行
 */
export function resultLines(call: string): readonly string[] {
  return [
    `  const result = await ${call}.catch((cause: unknown) => {`,
    // 書けたかどうかの分かる DB の失敗は値で返す(下で 1 行記録される)。それ以外は 1 行記録して投げ直す。文言は載せない。
    '    const failed = temporaryFailureOf(cause);',
    '    if (failed !== null) return err(failed);',
    "    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));",
    '    throw cause;',
    '  });',
    '  recordActionRefusal(entry, result);',
    '  return result;',
  ];
}

/** Server Action の引数(入力と、画面の実行器が送る送信の意図)。 */
export const ACTION_PARAMS = 'input: unknown, intent?: unknown';

/** 組み立ての根へ渡す冪等キーの引数(呼び出しの末尾に足す)。 */
export const INTENT_ARG = ', intentKeyOf(intent)';

/** 意図の JSDoc の行。 */
export const INTENT_PARAM_DOC = '@param intent 送信の意図(画面の実行器が送る冪等キー。押し直しでは同じ値。形が違えば使わない)';

/**
 * 意図と DB の失敗の境界の取り込み。
 *
 * @param module 実行時パッケージの意図のモジュール
 * @returns import の行
 */
export function intentImportLine(module: string): string {
  return `import { intentKeyOf, temporaryFailureOf } from '${module}';`;
}
