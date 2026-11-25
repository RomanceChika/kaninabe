/**
 * vitest の setupFiles の**先頭**に置く実行時の止め(点検 23 回目 C23-1)。テストのワーカーの `process.env` から `GIT_` で始まる変数を全部消す。
 *
 * pre-commit の中で回るテストは、git がフックに渡した `GIT_DIR` / `GIT_INDEX_FILE` などを継ぐ。テストのコードが子のプロセスを
 * どの綴りで起こしても(`execSync('git …')`・`sh -c`・`require('child_process')`・包む部品 …)、子は `process.env` を継ぐので、
 * ここで消せば全部の子が本物のリポジトリを指さない。静的な閉世界(テストの側の子の環境は隔離の口で作る)は、この止めの後ろの 2 本目の線である。
 *
 * 木にある vitest の設定の全部が setupFiles の先頭にこれを載せることは、検証器の木の開発用リポジトリだけの閉世界(`test-git-guard.test.ts`)が見る。
 * 本体は `without-git-env.mts`(ここは呼ぶだけ)。
 */

import { dropGitEnv } from './without-git-env.mts';

dropGitEnv(process.env);
