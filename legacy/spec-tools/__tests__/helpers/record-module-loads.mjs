// 子プロセスが読み込んだモジュールの URL を、環境変数 MODULE_LOAD_LOG の指すファイルへ 1 行ずつ追記する。
// `node --import <このファイル> --import tsx cli/…` の形で使う(新しい依存を足さず、Node の同期フック
// `module.registerHooks` だけで実行時の読み込みを記録する。動的 import も `load` を通るので漏れない)。
// 「入口が SQL の層や変異の層を**読み込まない**」ことを、静的な閉包(C28)に加えて実行で確かめるための道具。
//
// **証明の範囲**: これは「この Node の版・この題材・この経路」の観測であり、一般的な隔離の証明ではない。対象外:
//   - worker(`execArgv: []` の worker が読んだモジュールは記録されない)・子プロセスでフックの継承を外す経路
//   - このフックを登録する前に読み込まれたモジュール・ファイル以外の実行(VM / eval)・実行されなかった分岐
//   - `load` を通る前の試行も記録する(ロードの試行のログであり、評価に成功したことの台帳ではない)。
//     CommonJS のキャッシュヒットは `load` を再び通らないので、最初のロードがログにある限り不在の検査は成り立つ。
// 「空の記録を緑にしない」ための対照(同じ記録を全部入りの `generate` から取る)と、静的な閉包の見張りと併せて使う。
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const log = process.env.MODULE_LOAD_LOG;
if (log === undefined || log === '') throw new Error('MODULE_LOAD_LOG が空です');

registerHooks({
  load(url, context, nextLoad) {
    appendFileSync(log, `${url}\n`);
    return nextLoad(url, context);
  },
});
