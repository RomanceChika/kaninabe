/**
 * **題材が生成したものが、その題材で実際に回るか**の 1 つの表(fix27 A2。表の持ち主はこのモジュール。照らしは `sample-coverage-check.ts`)。
 *
 * 題材ごとに「生成物 → 回る段・回った回数(it の件数・見た相手の数)・n/a の理由」を持つ。行の鍵は 5 種類:
 *
 * | 鍵 | 何の行か | 回数 |
 * |---|---|---|
 * | `verify:pre-app` | 通し実行が実装の木を置く前に回す verify(実装の木を読む段が飛ぶ。その段は生成の後に回し直す) | 回し直す検査の数 |
 * | `check:{検査 ID}` | 生成の後の木で回し直す検査(段の宣言 `onGeneratedTree` から導く部分集合。`generated-tree.ts`) | 見た相手の数 |
 * | `test:{生成器}` | 題材に生成した試験(生成器ごと。実 DB の要らないものは配線の段、要るものは実 DB の段で実行する) | 通った it の数 |
 * | `guard:require-assertions` | 「assertion が 0 の it は実行時に赤」が題材の木の設定で効くこと(assertion の無い it を置いて実行し、赤になる数。`assertion-probe.ts`) | 赤になった it の数(1) |
 * | `lint:eslint` | 生成物と手書きに掛ける ESLint の規則(未対応。段 2 で @kaninabe/lint-config へ移してから回す) | 0 |
 *
 * 掴む順の逆順の実 DB の試験(`突合:rollback-retry-parity.test.ts`)は、本文が手書きの RPC を持つ題材ごとに回し、持たない題材は条件つきの n/a
 * (条件 `no-handwritten-rpc` は題材の data_table の宣言から数える。現れたのに回っていなければ赤)。
 *
 * 構造の突合(`*-parity.test.ts`)の回る組と回らない理由も、この表の 1 種類として下に持つ({@link PARITY_FIRED_PAIRS} /
 * {@link PARITY_SKIPPED_PAIRS}。点検 26 回目 A26-1 から)。
 *
 * **赤にするもの(双方向)**: 生成したのに 0 回の行(n/a・ホストに無い部品の理由が無いのに 0)・生成したのに行の無い生成物・生成物が無くなったのに残る行・
 * 回数の食い違い・n/a の条件が崩れた行(有料の連携が現れた・時刻起点のジョブが現れた・名指したホストに無い部品が変わった)。n/a は免除の口ではなく、
 * 条件つきの事実である(条件は閉じた語 NaCondition)。
 * 条件が成り立つ間は生成しない試験(`na.ungenerated`。時刻起点のジョブが無い題材の Cron の起動口の試験)は、条件が成り立つのに生成されたら赤(見るものの無い試験)・
 * 条件が崩れたのに生成されなければ赤。
 *
 * 表の値は「直した後の今の実物」で決めた(2026-11-13)。生成器・題材・検査を足すときは、この表を同じ変更で書き換える(書き換えの差分がレビューに出る)。
 *
 * 置き場は題材の通し実行の側(`__tests__/samples/`)で、行の型と照らしは仕組みの側(`lib/targets/supabase/samples/sample-coverage-check.ts`)が持つ
 * (表の値は題材の住所と部品の名前を持つので、仕組みのコードに置かない)。
 */

import type { CoverageRow } from '../../lib/targets/supabase/samples/sample-coverage-check.js';

/** 回し直す前の verify の行(どの題材も同じ)。 */
const PRE_APP: CoverageRow = { stage: 'pre-app', gate: 'pre-commit', runs: 2 };

/** ESLint の行(どの題材も同じ。未対応)。 */
const ESLINT: CoverageRow = { stage: 'lint', gate: '未対応', runs: 0, pending: '未対応・段 2(fix28 で枠の lint の配線を @kaninabe/lint-config へ移し、生成器が題材の木に設定を書いてから merge-check で回す)' };

/** 有料の口の行(どの題材も有料の連携を持たない)。 */
const X8_NA: CoverageRow = { stage: 'generated-tree', gate: 'pre-commit', runs: 0, na: { reason: '題材に spend: paid の連携が無い(見る相手が無い)', when: 'no-paid-integration' } };

/** 生成の後の木の J2(回数 = 生成した HTTP の入口 + リクエスト前段)。 */
function j2(runs: number): CoverageRow {
  return { stage: 'generated-tree', gate: 'pre-commit', runs };
}

/** 実 DB の要らない生成した試験(配線の段)。 */
function wiring(runs: number, extra: Partial<CoverageRow> = {}): CoverageRow {
  return { stage: 'wiring', gate: 'merge-check と夜間', runs, ...extra };
}

/** 実 DB に当てる生成した試験。 */
function db(runs: number): CoverageRow {
  return { stage: 'db', gate: 'merge-check と夜間', runs };
}

/**
 * ブラウザ側の守りの配線の試験(どの題材も 5 本。関門を外すと 1 本が赤)。cookie で認証する口が無い題材では、その口を見る 1 本(表が空で何も見ずに通る)を生成しない —
 * 生成器は見るものの無い試験を出さない(出す試験には、落ちうる assertion が 1 つ以上ある)。
 */
const BROWSER_DEFENSE = wiring(5, { refusal: 1 });

/** 時刻起点のジョブが無い題材の Cron の起動口の試験: 見張る口が 0 本で何も見ずに通るので生成しない(時刻起点のジョブが現れたのに生成されなければ赤)。 */
const CRON_NOT_GENERATED = wiring(0, { na: { reason: '時刻起点のジョブが無く、見張る口が 0 本(生成しない。時刻起点のジョブが現れたら生成が要る)', when: 'no-scheduled-job', ungenerated: true } });

/** assertion を 1 つも持たない it が題材の木の設定で赤になる(`expect.requireAssertions`。生成した試験の全部に効く実行時の守り)。 */
const ASSERTION_GUARD = wiring(1);

/** 掴む順の逆順の実 DB の試験の行の鍵(`突合:{ファイル名}`)と、手書きの RPC が無い題材の n/a(どの題材も同じ)。 */
const ROLLBACK_KEY = '突合:rollback-retry-parity.test.ts';
const ROLLBACK_NA: CoverageRow = {
  stage: 'db', gate: 'merge-check と夜間', runs: 0,
  na: { reason: '題材に本文が手書きの RPC が無い(わざと逆順に掴む手書きの RPC とぶつける相手が無い。現れたら、その題材の木で逆順の実 DB の試験を回す)', when: 'no-handwritten-rpc' },
};

/** 題材 → 行の鍵 → 行。 */
export const SAMPLE_COVERAGE: Readonly<Record<string, Readonly<Record<string, CoverageRow>>>> = {
  archive: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(1), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE, 'test:code-cron-route-tests': CRON_NOT_GENERATED, 'test:code-operation-tests': wiring(36),
    'test:code-equivalence-tests': db(8), 'test:code-eq-save-tests': db(5), 'test:code-rls-behaviour-tests': db(17),
  },
  dual_actors: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(1), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE,
  },
  expenses: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(1), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE, 'test:code-cron-route-tests': CRON_NOT_GENERATED,
    'test:code-operation-tests': wiring(49, { absent: { modules: ['domain/computes/claimTotalAmount'], reason: '計算値の純関数(claimTotalAmount)は製品が手で書く部品で、題材にもホストにも無い(それを呼ぶ操作の試験は読み込みで落ちる)' } }),
    'test:code-equivalence-tests': db(13), 'test:code-eq-save-tests': db(5), 'test:code-rls-behaviour-tests': db(19),
  },
  library: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(1), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE, 'test:code-cron-route-tests': CRON_NOT_GENERATED, 'test:code-operation-tests': wiring(76),
    'test:code-equivalence-tests': db(18), 'test:code-eq-save-tests': db(11), 'test:code-rls-behaviour-tests': db(22),
  },
  rooms: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(1), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE, 'test:code-operation-tests': wiring(64),
    'test:code-equivalence-tests': db(18), 'test:code-eq-save-tests': db(5), 'test:code-rls-behaviour-tests': db(22),
  },
  stores: {
    'verify:pre-app': PRE_APP, 'guard:require-assertions': ASSERTION_GUARD, 'check:J2': j2(2), 'check:X8': X8_NA, 'lint:eslint': ESLINT, [ROLLBACK_KEY]: ROLLBACK_NA,
    'test:code-browser-defense-tests': BROWSER_DEFENSE,
    'test:code-cron-route-tests': wiring(0, { absent: { modules: ['app/api/stocktake/remind/route'], reason: 'ジョブ stocktake_reminder_scan の起動口(route.ts)は製品が手で書く口で、題材にもホストにも無い' } }),
    'test:code-operation-tests': wiring(82),
    'test:code-equivalence-tests': db(24), 'test:code-eq-save-tests': db(10), 'test:code-rls-behaviour-tests': db(66),
  },
};

/**
 * 題材 → その題材で回る構造の突合(ファイル名。名前順。点検 26 回目 A26-1)。
 *
 * 分類(`db-parity.ts`)は、突合の本文が題材の宣言しない名前を名指せば「実行しません」として外し、理由を印字するだけで rc は 0 のままだった。
 * fix25s で 6 題材の全部から data-table-parity が黙って外れ、別の突合が 1 本足されて合計の本数は元に戻ったので、数でも気づけなかった。
 * そこで「題材 × 突合」の対ごとに回る組を固定し、前に回っていた対が外れたら赤・表に無い対が新しく回り始めたら赤にする(合計の本数では見ない)。
 */
export const PARITY_FIRED_PAIRS: Readonly<Record<string, readonly string[]>> = {
  archive: [
    'api-parity.test.ts', 'create-key-lock-parity.test.ts', 'data-table-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts',
    'isolation-gate-parity.test.ts', 'lock-order-parity.test.ts', 'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    'trigger-advisory-parity.test.ts',
  ],
  expenses: [
    'api-parity.test.ts', 'create-key-lock-parity.test.ts', 'data-table-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts',
    'isolation-gate-parity.test.ts', 'lock-order-parity.test.ts', 'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    'trigger-advisory-parity.test.ts',
  ],
  library: [
    'api-parity.test.ts', 'create-key-lock-parity.test.ts', 'data-table-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts',
    'isolation-gate-parity.test.ts', 'lock-order-parity.test.ts', 'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    'trigger-advisory-parity.test.ts',
  ],
  rooms: [
    'api-parity.test.ts', 'create-key-lock-parity.test.ts', 'data-table-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts',
    'isolation-gate-parity.test.ts', 'lock-order-parity.test.ts', 'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    'trigger-advisory-parity.test.ts',
  ],
  stores: [
    'api-parity.test.ts', 'create-key-lock-parity.test.ts', 'data-table-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts',
    'isolation-gate-parity.test.ts', 'lock-order-parity.test.ts', 'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    'trigger-advisory-parity.test.ts',
  ],
};

/**
 * どの題材でも回らない突合 → 理由(題材の宣言では回せない根拠。点検 fix26 D26-3)。題材ごとの表 {@link PARITY_SKIPPED_PAIRS} の行の中身である。
 * 分類が導く理由(本文が名指す題材の宣言しない名前・一時ツリーに無い部品)は機械の側の事実で、ここに書くのは**なぜその対を回さなくてよいか**
 * (照らす相手が見本のアプリにしか無い・照らしの本体を宣言へ移す前・一時ツリーが部品を写さない)。
 */
const HOST_ONLY_PARITY: Readonly<Record<string, string>> = {
  'auth-erasure-parity.test.ts': '認証の残りの消去(erase_auth_remainder)は見本のアプリのメンバーの消去の手続きで、題材は認証の消去を宣言しない(照らす相手が無い)',
  'erase-parity.test.ts': '消去の連鎖の照らしが見本のアプリのメンバー・枠・参加者の表と erase_member を名指す(題材は消去の手続きを宣言しない)',
  'pg-cron-parity.test.ts': '見本のアプリのジョブのカタログの関数を名指す。題材はジョブのカタログを持たない(照らす相手が無い)',
  'public-surface-parity.test.ts': '公開面の閉じた表が見本のアプリの表・関数を名指す(題材は公開面の閉じた表を持たない)',
  'row-parity.test.ts': '行の zod の生成物(@/domain/generated/*.schema)を一時ツリーが写さない(題材の通し実行は行の型の生成物を作らない)',
  'rpc-types-parity.test.ts': '生成した DB の型(@/infrastructure/supabase/database.functions)を一時ツリーが写さない(題材の通し実行は DB の型を生成しない)',
  'sequence-acl-parity.test.ts': '採番の器の権限の照らしが見本のアプリの is_staff / members を名指す(題材は採番の器の権限の閉じた表を持たない)',
  'usecase-rpc-parity.test.ts': '保存点の複合の照らしが見本のアプリの表・トリガを名指す(題材の保存点は生成した一致の証明が受け持つ)',
};

/**
 * 題材 → その題材で**回らない**構造の突合 → 理由(点検 fix26 D26-3)。回る組 {@link PARITY_FIRED_PAIRS} と合わせて、題材 × 突合の全部の対を閉じる ——
 * 回らない対に理由が無ければ赤、理由の行が回り始めたら赤(表から消す)。
 */
export const PARITY_SKIPPED_PAIRS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.keys(PARITY_FIRED_PAIRS).map((sample) => [sample, {
    ...HOST_ONLY_PARITY,
    // 掴む順の逆順の実測が回らない理由は、題材の表の n/a の行(条件つき)が正。ここへ写して理由の表と 1 か所で閉じる
    'rollback-retry-parity.test.ts': SAMPLE_COVERAGE[sample]?.[ROLLBACK_KEY]?.na?.reason ?? '',
  }]),
);

