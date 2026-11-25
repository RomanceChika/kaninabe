/**
 * TLC / pcal.trans を回すための段取りと、**道具の故障の見分け**。
 *
 * 道具が壊れている(jar が壊れている・Java が動かない)ときに「PlusCal の括弧を確かめろ」と
 * 言うのは嘘である —— 直す先が違う。ここは外に出た文字から「これは道具の故障か」を見分け、
 * そうならその stderr をそのまま見せる。
 *
 * 純粋関数であり throw しない(プロセスの起動は CLI の仕事)。
 */

import type { FormalFinding } from './types.js';

/**
 * 道具そのものが動かなかったことを示す字面(JVM とクラスローダが出すもの)。
 *
 * **言語に依らない目印を先に置く。** JVM の文面は OS の言語で変わるので、英語の 1 行だけを
 * 見ていると環境によって当たったり外れたりする(実測: 日本語環境では英語の目印に当たらず、
 * 道具の故障が「PlusCal の括弧を確かめろ」という嘘の診断になった)。呼ぶ側は JVM の言語を
 * 英語に固定し、ここは例外クラス名という**翻訳されない文字列**も併せて見る。
 */
const TOOL_FAILURE = [
  'ClassNotFoundException',
  'NoSuchMethodError',
  'zip file is empty',
  'error occurred during initialization of vm',
  'Could not find or load main class',
  'Invalid or corrupt jarfile',
  'Error: A JNI error has occurred',
  'UnsupportedClassVersionError',
  'NoClassDefFoundError',
  'Unable to access jarfile',
  'command not found',
  'no such file or directory',
];

/** 外に出た行が道具の故障を示しているか。 */
export function looksLikeToolFailure(lines: readonly string[]): boolean {
  const text = lines.join('\n');
  return TOOL_FAILURE.some((marker) => text.toLowerCase().includes(marker.toLowerCase()));
}

/**
 * 道具の故障を Finding にする。
 *
 * @param what 何を回そうとしたか(`pcal.trans` / `tlc2.TLC`)
 * @param jar 使った jar のパス
 * @param lines 外に出た行
 * @returns 1 件の Finding(stderr をそのまま detail に載せる)
 */
export function toolFailureFinding(what: string, jar: string, lines: readonly string[]): FormalFinding {
  const noise = lines.filter((line) => line.trim() !== '').slice(0, 10);
  return {
    severity: 'error',
    message: `${what} が動きませんでした —— これは**道具の故障**であり、モデルの問題ではありません`,
    location: jar,
    suggestion:
      'jar が壊れていないか(sha256)と、Java 21 が動くか(`java -version`)を確かめる。' +
      'CI なら tla2tools.jar の取得の手順を見る',
    detail: noise,
  };
}

/** committed な `.cfg` に性質の行が混ざっていたときの Finding。 */
export function cfgPropertyLineFindings(cfg: string, text: string): FormalFinding[] {
  const offenders = text
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => /^(INVARIANT|INVARIANTS|PROPERTY|PROPERTIES)\b/.test(entry.text));
  if (offenders.length === 0) return [];
  return [
    {
      severity: 'error',
      message: `${cfg}: 定数の組に性質の行が混ざっています(${offenders.map((o) => o.text).join(' / ')})`,
      location: `formal/${cfg}:${offenders[0]?.line ?? 1}`,
      suggestion:
        '性質の行は check:formal が 1 つずつ足して回すので、.cfg には書かない —— ' +
        '書いてあると 1 本の実行で 2 つの性質を同時に見ることになり、**どちらが破れたのかが' +
        '入れ替わる**(答えが別の性質の名前で帰ってくる)。手で回すときだけ一時的に足す',
    },
  ];
}
