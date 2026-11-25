/**
 * ジョブカタログの行の `ends_sessions` / `platform_call`(セッションを終える効果の宣言)の読み取り。
 *
 * 行の他のキーとは読み取りの規則が違う(`source: outbox` の行だけが書け、2 つのキーが対で要る)ので `parse-jobs.ts` から割った。
 * 匿名化の行の `platform_call`(認証基盤の個人データを消す呼び出し。点検 14 回目 A14-5)は `anonymizes` と対で、`parseAnonymizeCall` が読む。
 * 認証基盤の消去を管理 API に任せる製品は、代わりに `platform_job`(コミットの後に走るキューのジョブ)を書く(`parseAnonymizeJob`)。
 * 集約の実在・遷移の発火元・RPC の実在と呼び出しは J7 / T19 が見る(ここは 1 ファイルの中で閉じる形だけ)。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { JobSource } from './types.js';
import { SNAKE } from './parse-vocabulary.js';

/** 読んだ宣言(2 つのキーは対)。 */
export interface EndsSessionsDecl {
  readonly endsSessions: string;
  readonly platformCall: string;
}

const KEYS = ['ends_sessions', 'platform_call'] as const;

/**
 * 匿名化の行の `platform_call` を読む(`anonymizes` を持つ行だけが、`ends_sessions` なしで書ける)。
 *
 * @param item 行の読み手
 * @param id ジョブ ID
 * @param reporter 違反の記録先
 * @returns RPC 名(無ければ undefined。読めなければ記録して null)
 */
export function parseAnonymizeCall(item: YamlReader, id: string, reporter: SpecReporter): string | undefined | null {
  if (!item.has('platform_call')) return undefined;
  const call = item.requiredString('platform_call', 'platform_call に認証基盤の個人データを消す呼び出しを本文に持つ RPC の名前(スネークケース。引数は uuid 1 つ)を書く');
  if (call === null) return null;
  if (SNAKE.test(call)) return call;
  reporter.error(item.pointer('platform_call'), `ジョブ ${id} の platform_call ${call} がスネークケースではありません`, 'スネークケースに直す', { job: id, key: 'platform_call', value: call });
  return null;
}

/**
 * 匿名化の行の `platform_job` を読む(認証基盤の個人データをコミットの後のジョブで消す形の名指し)。
 * `platform_call` と併記はできない(どちらが消すのかが決まらない)。
 *
 * @param item 行の読み手
 * @param id ジョブ ID
 * @param reporter 違反の記録先
 * @returns ジョブ ID(無ければ undefined。読めなければ記録して null)
 */
export function parseAnonymizeJob(item: YamlReader, id: string, reporter: SpecReporter): string | undefined | null {
  if (!item.has('platform_job')) return undefined;
  const job = item.requiredString('platform_job', 'platform_job に認証基盤の個人データを消すキューのジョブの ID を書く');
  if (job === null) return null;
  if (item.has('platform_call')) {
    reporter.error(item.pointer('platform_job'), `ジョブ ${id} に platform_call と platform_job が両方書かれています`, '認証基盤を消す経路を 1 つにする(同じトランザクションの RPC か、コミットの後のジョブか)', { job: id });
    return null;
  }
  if (SNAKE.test(job)) return job;
  reporter.error(item.pointer('platform_job'), `ジョブ ${id} の platform_job ${job} がスネークケースではありません`, 'スネークケースに直す', { job: id, key: 'platform_job', value: job });
  return null;
}

/**
 * `ends_sessions`(対象の集約)と `platform_call`(認証基盤の呼び出しを持つ RPC)を読む。
 *
 * @param item 行の読み手
 * @param id ジョブ ID
 * @param source 行の出どころ(`outbox` の行だけが書ける)
 * @param reporter 違反の記録先
 * @returns 宣言(どちらのキーも無ければ undefined。書けない・読めない行は記録して null = 行ごと落とす)
 */
export function parseEndsSessions(
  item: YamlReader,
  id: string,
  source: JobSource,
  reporter: SpecReporter,
): EndsSessionsDecl | undefined | null {
  const present = KEYS.filter((key) => item.has(key));
  if (present.length === 0 || (!item.has('ends_sessions') && item.has('anonymizes'))) return undefined;
  if (source !== 'outbox') {
    reporter.error(
      item.pointer(present[0] ?? 'ends_sessions'),
      `${source} のジョブ ${id} にセッションを終える宣言(${present.join(' / ')})が書かれています`,
      'セッションを終える効果は書き込みと同一トランザクションで実現される outbox の効果である(source: outbox に直すか、キーを消す)',
      { job: id, keys: present.join(',') },
    );
    return null;
  }
  const target = item.requiredString('ends_sessions', 'ends_sessions にセッションを終える対象のアカウントの集約の id(スネークケース)を書く');
  const call = item.requiredString('platform_call', 'platform_call に認証基盤の呼び出しを本文に持つ RPC の名前(スネークケース。引数は uuid 1 つ)を書く');
  if (target === null || call === null) return null;
  for (const [key, value] of [['ends_sessions', target], ['platform_call', call]] as const) {
    if (!SNAKE.test(value)) {
      reporter.error(item.pointer(key), `ジョブ ${id} の ${key} ${value} がスネークケースではありません`, 'スネークケースに直す', { job: id, key, value });
      return null;
    }
  }
  return { endsSessions: target, platformCall: call };
}
