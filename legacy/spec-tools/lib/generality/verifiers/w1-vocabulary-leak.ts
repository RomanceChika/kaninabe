/**
 * W1: 仕組み側コード(legacy/spec-tools/lib の体系全体 + app 側の仕組みに近い層)に、仕様が宣言した
 * id(集約・ロール・状態・イベント・語彙 id)と一致する文字列リテラルが無いこと(閉世界)。
 *
 * 「軸は仕組み、語はアプリ」(dsl-extension-triage.md §軸と語)の執行点である。書きたく
 * なったら、それは軸の宣言が足りないサイン —— 実際に `STATE_SETTLES`(settles の語彙)・
 * `AUDIENCE_RECIPIENT`(通知の宛先種別)・`STAFF_ROLE_ID` / `GATE_SUBJECTS` の `role_staff`
 * (認証の関門)・`allStaff()`(特権判定)・`globalRole()`(グローバルロールの解決)・
 * `BYPASS_ROLE`(RLS バイパスロールの決め打ち。3 箇所で重複)・`SYSTEM_ROLE_ID`
 * (内部実行ロールの決め打ち)・`notificationAudience() === 'public_channel'`
 * (通知の宛先語を outbound 判定に直接使う)がこの形で仕組み側に固定されていた
 * (束⑫a・⑫a2 で仕様側の宣言 / 生成物経由の参照へ移した)。
 *
 * ## 既知の衝突(型の判別子・スキーマのキー名)
 *
 * 誤検出は 2 種類の機構で除く。
 *
 * 1. **`type X = 'a' | 'b';` の形の文字列リテラル型**(`scan.ts` の `collectTypeAliasLiterals`)。
 *    `type World = 'closed' | 'open';`(code-zod.ts の zod スキーマ開閉)・
 *    `type FrontmatterDelimiter = 'none' | 'closed' | 'unclosed';`(parse-markdown.ts の
 *    フロントマター区切り)がこれに当たる —— これらの語は**文字列リテラルではなく型の
 *    判別子**であり、たまたま state ID(`closed`)と綴りが同じだけである。ファイル内に限って
 *    除く(ファイルを跨いで一律に消すと本当の漏れも消えるため)。`const X = [...] as const` から
 *    ユニオン型を導く形(`GATE_SUBJECTS` 等)は対象にしない —— この形は `STATE_SETTLES` の
 *    ような実在した漏れも同じ構文で書けてしまうため、構文だけでは安全に判定できない。
 *
 * 2. **`KNOWN_COLLISIONS`(下記)**: 1 で拾えない、スキーマのキー名(YAML の列名・
 *    `FieldDef` のキー名等)や、複数の仕様カタログが分担する語彙契約が、たまたま別の仕様の
 *    id と綴りが同じでぶつかるケース。**ファイルを絞ったうえで**個別に理由を記す
 *    (この検査自体を無力化しない範囲に効果を限定するため)。各項は `status` を宣言し、
 *    `accepted`(誤検出。直す先が無い)は黙って除き、**`unresolved`(仕組み側の穴として
 *    残っている項)は warning として出す** —— 表の散文が「未解決」と書いているのに機構が
 *    黙らせるだけだと、未解決の項が受理済みと同じ見え方で並ぶ(束 ⑲-1 のレビュー)。
 *
 * **`ReadScope.kind` の `none` は対象語彙から除く**(状態 ID・軸の値の中に `none` が実在する
 * ときの衝突を避けるため)。`none` は「体系側の別の値域(ReadScope.kind)が同じ一般語を
 * 無関係な固定値として持つ」ことが実測で分かっている語であり、`ReadScope.kind` は
 * discriminated union の判別子としてリテラル比較・分岐に使われる(型としての `'none' | 'own' |
 * 'all' | 'context'` の一員であって、仕様の値域の値ではない)ため、対象語彙から
 * ファイルを問わず一律に除外する(仕様側のどの id も `none` になり得ないなら実害は無い実測をしてある)。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { allMachines } from '../../model/types.js';
import { scanVocabularyLiterals, type VocabularyScanHit } from '../scan.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

export const VERIFIER_ID = 'W1';

/**
 * 体系側の別の値域と衝突することが実測済みの一般語(`ReadScope.kind` の判別子)。
 * ファイルを問わず対象語彙から除く。
 */
const GENERIC_COLLISIONS = new Set(['none']);

/**
 * ファイルを絞った既知の衝突。スキーマのキー名(YAML 列名・DSL の固定フィールド名)や、
 * 複数カタログが分担する語彙契約が、別の仕様の id と綴りが同じでぶつかるケース。
 *
 * `filePatterns` は `hit.file` に対する部分一致(いずれか 1 つで可)。
 */
export interface KnownCollision {
  readonly words: readonly string[];
  readonly filePatterns: readonly string[];
  /**
   * その項をどう扱うか。
   *
   *   - `accepted` … 衝突は誤検出であり、直す先が無い(スキーマのキー名・型の判別子)。
   *     Finding は出さない。
   *   - `unresolved` … **仕組み側の穴として残っている**(受理ではなく報告)。Finding を
   *     消さずに **warning** で出す —— 散文だけを事実に合わせて機構は黙らせるままだと、
   *     未解決の項が受理済みと同じ見え方で表に並ぶ(束 ⑲-1 のレビュー)。Y10 の uncovered と
   *     同じ思想で、狭めた母集合を黙って通さない。⑲-2 でこの項を消すと warning も消えるので、
   *     消し込みが機械で追える。
   */
  readonly status: 'accepted' | 'unresolved';
  readonly reason: string;
}

/** 既知の衝突の表の型(`matchVocabularyHits` が表を引数で受けられるようにするための名前)。 */
export type KnownCollisions = readonly KnownCollision[];

/**
 * 既知の衝突の表。**`status: 'unresolved'` の項は 1 つも無い**(体系側に直書きしていた語の項は、
 * 「同一トランザクションで実現される」を語彙の `in_transaction` 宣言から読む形にして消した)。
 * 未解決を報告する機構(`unresolved`)は、次に穴が見つかった日のために残してある。
 */
const KNOWN_COLLISIONS: KnownCollisions = [
  {
    words: ['anonymous', 'system'],
    filePatterns: ['model/types-role.ts', 'render/code-roles.ts', 'model/role-hierarchy.ts'],
    status: 'accepted',
    reason:
      '`ROLE_KINDS`(role_spec の `kind` の値域)と、その生成物のキー名対応表 `KEY_OF` は' +
      'フレームワーク固定の語彙(GATE_SUBJECTS・AUTH_AXIS_KINDS 等と同じ性質)であり、' +
      '「未ログイン」「システム」という 3 スロットの**呼び名**そのものである。このアプリが' +
      'グローバルロールの id にも同じ綴り(anonymous / system)を選んだ(可読性のための' +
      '意図的な選択。domain-spec-writing.md §role_spec)ために衝突する。`role-hierarchy.ts` の' +
      '`systemRoleId()` はこの `kind: system` の 1 語だけを持つ薄いラッパーであり、これを' +
      '足すことで**残りの全呼び出し箇所が識別子(`systemRoleId(roles)`)経由になり、リテラルを' +
      '複製しない**(GLOBAL_ROLES と同じ「1 箇所にだけ語を書く」設計)。役割 ID そのものは' +
      'この 3 ファイル以外の仕組み側コードで一切リテラルとして書かない。',
  },
  {
    words: ['required'],
    filePatterns: ['model/parse-entity.ts', 'trace/types-ux.ts', 'semantics/operation-attributes.ts'],
    status: 'accepted',
    reason:
      '`FIELD_KEYS`(entity_spec の fields[] に書けるキー名の allowlist)と' +
      '`ACTION_UX_CONFIRM_VALUES`(action_spec の `ux.confirm` の値域。フレームワーク固定の' +
      '2 値。semantics/operation-attributes.ts の方針の導出はこの値と比較する。検証の Y5 も' +
      '画面の生成も同じ導出を読む)はどちらも DSL 自身のスキーマであり、' +
      'config カタログの `requirement` 語彙が(このアプリの選択で)たまたま同じ綴りを選んだだけである。',
  },
  {
    words: ['accept'],
    filePatterns: [
      'usecase/parse-usecase.ts',
      'model/parse-access.ts',
    ],
    status: 'accepted',
    reason:
      'DSL 自身のスキーマのキー名(`accept:` = **warning の理由つき受け入れ**)であり、固定の ' +
      'allowlist の一部として文字列に現れる。usecase_spec の `accept: [{ metric, reason }]`(Y5 の' +
      '予算超過。ADR-0011 §6)と、access_spec の `accept: [{ by, filter, reason }]`(V20 の' +
      'テナント境界の宣言漏れ。束 ⑲-2a)の 2 つで、**同じ 1 つの流儀**である(新しい衝突ではない)。' +
      'たまたま `invitation.accept`(招待の受諾。by: system の内部実行イベント)と綴りが同じだけで、' +
      'どちらのパーサーもドメインイベント ID を分岐条件として比較していない。',
  },
  {
    words: ['confirm'],
    filePatterns: ['trace/parse-action.ts', 'auth/parse-auth-platform-ops.ts'],
    status: 'accepted',
    reason:
      '`ux.confirm`(action_spec)と `platform_ops[].confirm`(auth_spec。ADR-0019)は DSL 固定のキー名で、' +
      'workshop.confirm(イベント ID)とは無関係にたまたま綴りが同じ。',
  },
  {
    words: ['endpoint'],
    filePatterns: ['job/parse-schedule.ts', 'auth/parse-auth-callback.ts'],
    status: 'accepted',
    reason:
      '`SCHEDULE_ONLY_KEYS`(job_spec の `source: schedule` 行のキー名)と auth_spec の `callback` のキー名(`CALLBACK_KEYS`。どちらも DSL 固定で、' +
      'HTTP の入口の URL を指すので綴りをそろえた)であり、config カタログの `kind` 語彙がたまたま同じ綴りを選んだだけである。',
  },
  {
    words: ['submit'],
    filePatterns: ['render/screen-form-plan.ts'],
    status: 'accepted',
    reason:
      '画面の部品のフォーム(`kind: form`)の**葉の名前**(送信ボタン `submit`)は仕組みが決める固定語であり、' +
      '部品の testid の後ろに付く(`{部品}.submit`)。製品の状態機械のイベント ID が同じ綴り(`submit`)を選ぶことが' +
      'あるために衝突する(拒否の表示 `error` ほかの葉の名前は、いまは製品の語と重ならないので宣言しない — ' +
      '重なったらここに足す)。確認ダイアログの実行ボタンの葉(以前の `confirm_bar.confirm`)は、確認の器を重ね表示' +
      '(`overlays`)に統一したので生成器の語ではなくなった(`ConfirmDialog` の部品の語)。葉の名前の正は ' +
      '`screen-form-plan.ts` の定数 1 か所(フォームの本体と葉の表が同じ定数を見る)で、**綴りを隠す迂回はしない**' +
      '(宣言して受理する)。表・詳細・操作を載せる表の生成物の葉の名前(`empty` / `row` / `column` / `save` / ' +
      '`row_error`)は別の置き場(`screen-read-plan.ts` / `screen-operation-plan.ts` の定数)にあり、いまは製品の語と' +
      '重ならないので宣言しない — 重なったらその定数の置き場をこの項の filePatterns に、綴りを words に足す。',
  },
  {
    words: ['optional_degrades', 'production_only', 'required'],
    filePatterns: ['external/verifiers/x2-config-grounding.ts'],
    status: 'accepted',
    reason:
      'config_spec の `requirement` 語彙(このアプリの選択)だが、この 3 語の対応表は' +
      'external-spec-writing.md と config-spec-writing.md の両方が定める規約契約であり、' +
      'ファイル冒頭のコメントで意図的な決め打ちと明記されている。',
  },
];

/** そのヒットに当たる既知の衝突の項(無ければ undefined)。 */
function knownCollisionOf(hit: VocabularyScanHit, collisions: KnownCollisions): KnownCollision | undefined {
  return collisions.find(
    (entry) => entry.words.includes(hit.literal) && entry.filePatterns.some((pattern) => hit.file.includes(pattern)),
  );
}

function w1(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** ドメイン仕様(SpecModel)から、仕組み側コードが持ってはいけない全 id を集める。 */
export function collectDomainVocabulary(model: SpecModel): ReadonlySet<string> {
  const words = new Set<string>();
  for (const [aggregate, specs] of model.aggregates) {
    words.add(aggregate);
    for (const machine of specs.stateMachines) {
      for (const state of machine.states) words.add(state);
      for (const event of machine.events) words.add(event.id);
      for (const id of Object.keys(machine.settlesVocabulary)) words.add(id);
    }
  }
  for (const role of model.roles.roles) words.add(role.id);
  // allMachines は集約ごとの重複を避けた列挙(念のため二重に回しても Set なので安全)。
  for (const { machine } of allMachines(model)) {
    for (const state of machine.states) words.add(state);
    for (const event of machine.events) words.add(event.id);
  }
  for (const word of GENERIC_COLLISIONS) words.delete(word);
  return words;
}

/**
 * 走査結果のうち、値域と一致するものだけを Finding にする(純粋関数。テスト用に分離)。
 *
 * 宣言の無い漏れは 1 ヒット = 1 error。`status: 'unresolved'` の既知の衝突は**項ごとに 1 件の
 * warning** にまとめる(消し込みの単位は表の項であり、ヒットの数ではないため)。
 *
 * 既知の衝突の表は引数で差し替えられる(既定は `KNOWN_COLLISIONS`。表が 1 項も未解決を持たない間も、
 * 未解決を報告する機構をテストが固定できるようにするため)。
 */
export function matchVocabularyHits(
  hits: readonly VocabularyScanHit[],
  vocabulary: ReadonlySet<string>,
  collisions: KnownCollisions = KNOWN_COLLISIONS,
): Finding[] {
  const findings: Finding[] = [];
  const unresolved = new Map<KnownCollision, VocabularyScanHit[]>();
  for (const hit of hits) {
    if (!vocabulary.has(hit.literal)) continue;
    const known = knownCollisionOf(hit, collisions);
    if (known === undefined) {
      findings.push(leak(hit));
      continue;
    }
    if (known.status === 'accepted') continue;
    const collected = unresolved.get(known);
    if (collected === undefined) unresolved.set(known, [hit]);
    else collected.push(hit);
  }
  for (const [entry, entryHits] of unresolved) findings.push(unresolvedCollision(entry, entryHits));
  return findings;
}

/** 宣言の無い漏れ(error)。 */
function leak(hit: VocabularyScanHit): Finding {
  return w1({
    message: `${hit.file}:${hit.line} に仕様の語 "${hit.literal}" と一致する文字列リテラルがあります`,
    location: { file: hit.file, pointer: `L${hit.line}` },
    suggestion:
      '仕組み側のコードは仕様が宣言した id(集約・ロール・状態・イベント・語彙 id)を' +
      '文字列として持たない(軸は仕組み、語はアプリ — dsl-extension-triage.md §軸と語)。' +
      '値域の値を仕様側に宣言し、生成物・引数から読む形にする',
    counterexample: { file: hit.file, line: String(hit.line), literal: hit.literal },
  });
}

/**
 * `status: 'unresolved'` の既知の衝突 1 項ぶんの warning(受理ではなく報告)。
 *
 * @param entry 表の項
 * @param hits その項が黙らせているヒット(1 件以上)
 * @returns warning の Finding(場所は最初のヒット。ヒットの総数と全箇所を反例に載せる)
 */
function unresolvedCollision(entry: KnownCollision, hits: readonly VocabularyScanHit[]): Finding {
  const first = hits[0];
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message:
      `未解決の既知の衝突 "${entry.words.join(' / ')}" が仕組み側に ${hits.length} 箇所あります` +
      '(KNOWN_COLLISIONS の status: unresolved = 受理ではなく報告)',
    location: first === undefined ? { file: '' } : { file: first.file, pointer: `L${first.line}` },
    suggestion:
      'この語を仕組み側から消す道(軸を仕様側の宣言に開く・語彙を生成物から読む)を通したら、' +
      'w1-vocabulary-leak.ts の KNOWN_COLLISIONS からその項を削る(項が消えればこの warning も' +
      '消えるので、消し込みが機械で追える)。まだ開けないなら理由を項に書いたまま残す',
    counterexample: {
      words: entry.words.join(' / '),
      occurrences: String(hits.length),
      at: hits.map((hit) => `${hit.file}:${hit.line}`).join(', '),
    },
  };
}

/**
 * 仕組み側コードの文字列リテラルを検査する。
 *
 * @param model 構築済みのドメイン仕様モデル(集約・ロール・状態・イベント・settles の語彙の母集合)
 * @param catalogVocabulary カタログ系の語彙軸 id(通知の medium/audience/mention・
 *   ジョブの kind/on_failure・設定の kind/requirement/used_by。無ければ空)
 * @param repoRoot リポジトリルートの絶対パス(走査の起点)
 * @param roots 製品が宣言した根(走査範囲の位置)
 * @param layout 置き場の配置(走査範囲の層と土台の表の宣言元)
 * @returns 違反のリスト
 */
export function verifyVocabularyLeak(
  model: SpecModel,
  catalogVocabulary: ReadonlySet<string>,
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
): Finding[] {
  const vocabulary = new Set([...collectDomainVocabulary(model), ...catalogVocabulary]);
  for (const word of GENERIC_COLLISIONS) vocabulary.delete(word);
  return matchVocabularyHits(scanVocabularyLiterals(repoRoot, roots, layout), vocabulary);
}
