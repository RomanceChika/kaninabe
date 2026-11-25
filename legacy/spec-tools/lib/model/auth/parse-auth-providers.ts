/**
 * auth_spec の `providers`(このシステムが受け入れるサインインの方式)と `local_only`(ローカルの設定でだけ開けてよい方式)の読み取り。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形(リストであること・`providers` が空でないこと・要素がスネークケースの語であること・
 * 重複が無いこと・2 つのリストが重ならないこと)に限る。宣言とプラットフォームの設定の突合(宣言に無い方式が開いていないか)は、
 * プラットフォームの後段が登録する検査 H5 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord } from '../yaml-reader.js';
import type { YamlReader } from '../yaml-reader.js';
import type { LocalOnlyDecl } from './types.js';

/** 方式の語(スネークケース。プラットフォームの設定の綴りに合わせる)。 */
const PROVIDER_ID = /^[a-z][a-z0-9_]*$/;

/** `providers` の書き方の案内。 */
const PROVIDERS_SUGGESTION =
  'providers にこのシステムが受け入れるサインインの方式を並べる(語はプラットフォームの設定の綴りに合わせる)。' +
  '宣言に無い方式がプラットフォームの設定で開いていると H5 が止める';

/** `local_only` の書き方の案内。 */
const LOCAL_ONLY_SUGGESTION =
  'local_only は "- method / reason" のリストで書く(ローカル〔開発・テスト〕の設定でだけ開けてよい方式と、その理由。本番では開けない方式だけ)';

/** 方式の語を読み、形に合わない・重複した要素を落として違反にする。 */
function validWords(listed: readonly string[], key: string, root: YamlReader, reporter: SpecReporter): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const [index, word] of listed.entries()) {
    if (!PROVIDER_ID.test(word)) {
      reporter.error(root.pointer(key), `${key}[${index}] ${word} がスネークケースの語ではありません`, 'プラットフォームの設定の綴りに合わせた小文字の語で書く(例: discord)', { provider: word });
      reporter.dropRows();
      continue;
    }
    if (seen.has(word)) {
      reporter.error(root.pointer(key), `${key} の ${word} が重複しています`, '重複した要素を削除する', { provider: word });
      reporter.dropRows();
      continue;
    }
    seen.add(word);
    words.push(word);
  }
  return words;
}

/** 読み取りの結果。 */
export interface ParsedProviders {
  /** 受け入れるサインインの方式(宣言順)。 */
  readonly providers: readonly string[];
  /** ローカルの設定でだけ開けてよい方式と理由(宣言順。無ければ空)。 */
  readonly localOnly: readonly LocalOnlyDecl[];
}

/** `local_only` の要素 1 件を読む(`method` は方式の語・`reason` は空でない文字列。書けない鍵は綴り間違いとしてエラー)。 */
function readLocalOnly(root: YamlReader, reporter: SpecReporter): LocalOnlyDecl[] {
  const entries: LocalOnlyDecl[] = [];
  const items = root.optionalList('local_only', LOCAL_ONLY_SUGGESTION);
  eachRecord(items, 'local_only', reporter, LOCAL_ONLY_SUGGESTION, (item, index) => {
    item.rejectUnknownKeys(['method', 'reason'], 'local_only の要素', '書けるのは method / reason だけ');
    const method = item.requiredString('method', 'method にローカルでだけ開けてよい方式の語を書く');
    const reason = item.requiredString('reason', 'reason にローカルでだけ開けてよい理由を書く(例: 何のために開けるのか)');
    if (method === null || reason === null) {
      reporter.dropRows();
      return;
    }
    if (reason.trim() === '') {
      reporter.error(root.pointer('local_only'), `local_only[${index}] ${method} の reason が空です`, 'reason に理由を書く(理由の無い「ローカルでだけ開けてよい」は、免除の穴になる)', { method });
      reporter.dropRows();
      return;
    }
    entries.push({ method, reason });
  });
  return entries;
}

/**
 * `providers`(必須・空不可)と `local_only`(任意)を読む。サインインの方式を宣言しない認証フローは、開いている口の全数を仕様から言えない。
 * 2 つのリストに同じ語が載ることは許さない(本番で開けるのか開けないのかが割れる)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 */
export function parseProviders(root: YamlReader, reporter: SpecReporter): ParsedProviders {
  const providers = validWords(root.requiredStringList('providers', PROVIDERS_SUGGESTION, false) ?? [], 'providers', root, reporter);
  const entries = readLocalOnly(root, reporter);
  const methods = validWords(entries.map((entry) => entry.method), 'local_only', root, reporter);
  const seen = new Set<string>();
  const localOnly = entries.filter((entry) => {
    if (!methods.includes(entry.method) || seen.has(entry.method)) return false;
    seen.add(entry.method);
    if (!providers.includes(entry.method)) return true;
    reporter.error(root.pointer('local_only'), `local_only の ${entry.method} は providers にも載っています`, '本番で開ける方式なら providers だけに、ローカルでだけ開ける方式なら local_only だけに書く', { provider: entry.method });
    reporter.dropRows();
    return false;
  });
  return { providers, localOnly };
}
