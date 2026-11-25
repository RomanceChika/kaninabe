/**
 * fast-check の種を決める(vitest の setupFiles)。fast-check の既定は実行ごとに乱数の種なので、固定しないと CI と pre-commit が固定にならない。
 *
 * 既定は固定で、取り込みの定型(`merge-check.sh`)だけが環境変数 `FUZZ_SEED` で毎回新しい種を渡す(無作為の検査の語彙の `book-fuzz.ts` と同じ変数)。
 * 赤の報告には fast-check が種を出す。赤になった種は、直してからその性質のテストの反例の表に足す。
 */

import fc from 'fast-check';

/** 既定の種。 */
const DEFAULT_SEED = 20_261_101;

const fromEnvironment = Number(process.env['FUZZ_SEED'] ?? '');
fc.configureGlobal({ seed: Number.isInteger(fromEnvironment) && fromEnvironment > 0 ? fromEnvironment : DEFAULT_SEED });
