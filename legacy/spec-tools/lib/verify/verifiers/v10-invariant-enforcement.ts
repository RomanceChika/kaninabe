/**
 * V10 不変条件の執行チェック。
 *
 * domain-spec-writing.md の V10:「各 invariant に enforced_by が 1 つ以上あり、ref が実在する」。
 * 「不変条件を書いたのに何も守っていない」を防ぐのが目的なので、宣言の存在に加えて
 * 機械的に実在確認できる参照(kind: guard のイベント ID)を見る。
 *
 * formal を持たない不変条件(集計制約など DSL の守備範囲外のもの)は、機械が形を検証できない。
 * その代わりに「**実際に守っている実体**がある」ことの宣言を必須とし、
 * enforced_by に application / trigger / db_constraint が 1 つ以上あることを要求する。
 *
 * `db_constraint` を認めるのは、**DB の制約はトリガーと同じ層の執行**だからである
 * (どちらも「アプリを通らない書き込みでも守られる」側にいる)。当初は application / trigger
 * だけを認めていたが、それは「制約名を機械が確かめられない」ことを理由にした線ではなく、
 * 単に実物が無かったための線だった —— 実物 (INV-VENUE-002: 参照されている会場は消せない) が
 * 出て、その**実体は `data_table` の `foreign_keys[].on_delete` として宣言され、
 * data-table-parity が実 DB と突き合わせている**ことが分かった。ref の綴りが検査されないのは
 * trigger と同じ既知の穴であり、この 3 つの間に差は無い。
 *
 * さらに `kind: guard` の執行点については「挙げたガードがこの不変条件に**触れてすらいない**」
 * だけを警告する(下限の検査。checkGuardRelevance の doc コメントに限界を明記)。
 *
 * **DB の執行点の名前(`db_constraint` / `trigger` の ref)は 1 つの不変条件だけが宣言する。**
 * 制約名から不変条件が 1 つに決まらないと DB が拒否した理由を人に返せないためで、集約をまたぐ
 * 検査なので v10-invariant-constraint-owner.ts に分けてある(以前はこの前提を生成器が例外で
 * 守っており、verify が緑のまま generate が落ちていた)。
 *
 * `kind: application` の ref(純粋関数名 / zod スキーマ名)については 2 つを見る ——
 *
 *   1. **実在する export 名か**(`checkApplicationRefExists`)。綴り違い・リネーム後の消し忘れ。
 *   2. **呼び出し口があるか**(`checkApplicationRefCalled`)。宣言した名前がどこからも呼ばれて
 *      いなければ、その不変条件は**誰も守っていない**。export と単体テストは残るので 1 だけ
 *      では緑のまま通る —— 束 ⑰-3 で操作の実装が仕様からの生成物になったとき、
 *      INV-INQUIRY-002(問い合わせのスパム防止の天井)と INV-MEMBER-007(運営スタッフの下限)が
 *      まさにこの形で黙って無効になった(呼んでいた手書きの operation が消え、純関数とその
 *      テストだけが残った)。V10 も Y10 も A15 も鳴らなかったので、2 つ目の下限をここに置く。
 *
 * 中身が本当にその不変条件を守っているかは判定しない ―― kind: guard の ref 実在検査と同じ
 * 下限の線である。判定の材料は `app/src` の走査結果(ctx.applicationRefs。I/O は
 * application-ref-scan.ts)であり、ファイルパスまでは見ない(H2 が `パス::関数名` を見るのとは
 * 違う ―― ここの `ref` は識別子だけを指す語彙のため)。
 *
 * formal ブロックそのものの接地(`keys` / `max` / 式のパースとパス / 充足性)は
 * v10-invariant-formal.ts、共有の索引と Finding ファクトリは v10-invariant-index.ts にある。
 *
 * @oversize 超える理由: V10 は「不変条件に執行点があり、その ref が実在する」の 1 検査で、執行点の種類
 *   (guard・application・trigger・db_constraint)ごとの判定を 1 か所に並べ、抜けを一覧で見られる形に
 *   してある。application の ref の 2 つの下位検査(実在・呼び出し口)も同じ検査の一部である。
 * @split-review 割る案と結果: application の ref の 2 つの下位検査(`checkApplicationRefExists` ・
 *   `checkApplicationRefCalled`。以前の `v10-invariant-application-ref.ts`)を別のファイルに割る案を検討した。
 *   この 2 つを呼ぶのは本体の `checkInvariant` だけで、ほかの検証器や生成器は直接読まない。`kind` ごとの判定を
 *   1 つの関数が順に呼ぶ形なので、application だけが別ファイルだと、種類ごとの判定を並べて抜けを見る目的が
 *   切れる。formal の接地(`v10-invariant-formal.ts`)・制約名の所有・null 比較は、別の欄を見る検査なので
 *   既に別のファイルである。
 */

import type { SpecModel, InvariantDef, EnforcementDef } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier, VerifyContext } from '../../check-api/contract.js';
import { FORMAL_PARSE } from '../../guard/ast.js';
import type { DomainEnv } from '../../guard/ast.js';
import { buildAggregateEnv } from '../../semantics/domain-env.js';
import { resolveEntityPath } from '../../model/path-resolve.js';
import { checkFormal, formalExpressions } from './v10-invariant-formal.js';
import { buildIndex, DOTTED_REF_PATTERN, finding } from './v10-invariant-index.js';
import type { SpecIndex } from './v10-invariant-index.js';
import { checkConstraintOwners } from './v10-invariant-constraint-owner.js';
import { checkNullTests } from './v10-invariant-null-test.js';

/** kind: guard の ref が `machine.event` 形式で、かつ実在するイベントを指すかを見る。 */
function checkGuardEnforcement(
  invariant: InvariantDef,
  enforcement: EnforcementDef,
  index: SpecIndex,
): Finding | undefined {
  const matched = DOTTED_REF_PATTERN.exec(enforcement.ref);
  if (matched === null) {
    return finding(
      invariant,
      `enforced_by(kind: guard)の ref "${enforcement.ref}" が "機械名.イベント名" 形式ではありません`,
      'ドメインイベント ID は {state_machine}.{event} 形式で書きます(例: entry.submit)',
      { ref: enforcement.ref, expected_format: '{machine}.{event}' },
    );
  }
  const [, machineName = '', eventId = ''] = matched;
  const events = index.machineEvents.get(machineName);
  if (events === undefined) {
    return finding(
      invariant,
      `enforced_by(kind: guard)の ref "${enforcement.ref}" が参照する状態機械 ${machineName} は未定義です`,
      `states.md に state_machine: ${machineName} を定義するか、ref を実在する機械のイベントへ直してください`,
      { ref: enforcement.ref, missing_machine: machineName },
    );
  }
  if (!events.has(eventId)) {
    return finding(
      invariant,
      `enforced_by(kind: guard)の ref "${enforcement.ref}" が参照するイベント ${eventId} は ${machineName} に存在しません`,
      `${machineName} の events に ${eventId} を定義するか、ref を実在するイベント(${[...events.keys()].join(', ')})へ直してください`,
      { ref: enforcement.ref, machine: machineName, missing_event: eventId },
    );
  }
  return undefined;
}

/**
 * `entities` と `involves` に挙げた集約名が実在するかを見る。
 *
 * `involves` は A7 が「別集約の create / delete / 全遷移に義務を配る」ための引き当てに使う
 * (required-coverage-lookup.ts の `invariantsInvolving`)。`entities` も同じ引き当て
 * (`inv.entities.includes(entry.entity)`)と、計画の世界の行(`plan-scenario-rows.ts`)・
 * 不変条件の印(`operation-plan-marks.ts`)に使われる。どちらも綴り違いの集約名は
 * 「義務が誰にも配られないまま緑」を生むため、ここで接地を検査する。
 */
function checkInvolves(invariant: InvariantDef, index: SpecIndex): Finding[] {
  const findings: Finding[] = [];
  const named: readonly (readonly ['entities' | 'involves', readonly string[]])[] = [
    ['entities', invariant.entities],
    ['involves', invariant.involves ?? []],
  ];
  for (const [key, entities] of named) {
    for (const entity of entities) {
      if (index.entityFields.has(entity)) continue;
      findings.push(
        finding(
          invariant,
          `${key} の ${entity} は未定義の集約です`,
          `entity.md に entity: ${entity} を定義するか、${key} を実在する集約名へ直してください`,
          { [key]: entities.join(', '), missing_entity: entity },
        ),
      );
    }
  }
  return findings;
}

/** formal の代わりに「守っている実体」として認める執行の種別。 */
const SUBSTANTIVE_KINDS: readonly EnforcementDef['kind'][] = [
  'application',
  'trigger',
  'db_constraint',
];

/**
 * formal を持たない不変条件が、実体のある執行を宣言しているかを見る。
 * enforced_by 自体が空のケースは別のチェックが報告するので、ここでは扱わない。
 *
 * 認めないのは `guard` だけである —— ガードは**その遷移を通る書き込み**しか守らず、
 * 形を機械が検証できない不変条件の唯一の守りにするには弱い(直接 UPDATE で破れる)。
 */
function checkFormalLessEnforcement(invariant: InvariantDef): Finding | undefined {
  if (invariant.formal !== undefined || invariant.enforcedBy.length === 0) return undefined;
  const kinds = invariant.enforcedBy.map((enforcement) => enforcement.kind);
  if (kinds.some((kind) => SUBSTANTIVE_KINDS.includes(kind))) return undefined;
  return finding(
    invariant,
    'formal が無い(集計制約など DSL の守備範囲外の)不変条件は application / trigger / db_constraint での執行宣言が必須です',
    'enforced_by に kind: application(制約を隔離した純粋関数名)・kind: trigger・kind: db_constraint の' +
      'いずれかを追加してください。DSL で表現できる制約なら formal を書きます',
    { formal: '(なし)', enforced_by_kinds: kinds.join(', ') },
  );
}

/**
 * ガード式 1 本が参照するフィールドを `{エンティティ}.{フィールド}` の集合にする。
 * 解決できないパスと予約語(actor / now)は落とす — ここは「関与しているか」の判定であり、
 * 参照の実在は checkFormalPaths / V2 の担当だからである。
 */
function referencedFields(
  source: string,
  model: SpecModel,
  origin: string,
  ctx: VerifyContext,
): ReadonlySet<string> {
  const fields = new Set<string>();
  // 読むだけの口なので `formal` の `is null` も読める側で開ける(置き場の規則は V2 が守る)。
  const parsed = ctx.guards.parse(source, FORMAL_PARSE);
  if (!parsed.ok) return fields;
  for (const path of ctx.guards.collectPaths(parsed.expr)) {
    const resolved = resolveEntityPath(model, origin, path, '起点');
    if (resolved.kind === 'field') fields.add(`${resolved.entity}.${resolved.field}`);
  }
  return fields;
}

/**
 * `kind: guard` の執行点が、その不変条件に**触れてすらいない**場合を警告する(C-9)。
 *
 * これは**下限の検査**である。「ガード式が不変条件を本当に守っているか」の判定はしない
 * (それは含意の証明であり、v1 の列挙ベース検証の範囲を超える)。ここが拾うのは
 * 「関与フィールドが 1 つも現れないガードを執行点として挙げている」という、明らかに無関係な
 * 宣言だけである。したがって error ではなく warning とする。
 *
 * **適用範囲は formal が `check` / `state_dependency` の不変条件に限る**。この 2 つは条件の
 * 全体がガード式で書ける(= 執行点のガードが条件を担い得る)ためである。`uniqueness` /
 * `cardinality` は複数行にまたがる集計であってガード式では原理的に表せず、そこでの
 * `kind: guard` は「アプリ側の早期チェックが走る遷移」を指す正当な宣言なので対象にしない
 * (domain-spec-writing.md の INV-ENTRY-001 の例がまさにこの形)。
 *
 * 通り抜けるもの(既知の限界): 関与フィールドが 1 つでも出てくれば通る。条件の向きが逆でも、
 * 比較する値が違っても通る。「執行の宣言は人間の善意」という性質は消えていない。
 */
function checkGuardRelevance(
  invariant: InvariantDef,
  enforcement: EnforcementDef,
  index: SpecIndex,
  model: SpecModel,
  aggregate: string,
  ctx: VerifyContext,
): Finding | undefined {
  if (invariant.formal?.kind !== 'check' && invariant.formal?.kind !== 'state_dependency') return undefined;
  const matched = DOTTED_REF_PATTERN.exec(enforcement.ref);
  if (matched === null) return undefined;
  const [, machineName = '', eventId = ''] = matched;
  const event = index.machineEvents.get(machineName)?.get(eventId);
  if (event === undefined) return undefined;

  const involved = new Set<string>();
  for (const [, source] of formalExpressions(invariant.formal)) {
    for (const field of referencedFields(source, model, aggregate, ctx)) involved.add(field);
  }
  if (involved.size === 0) return undefined;

  const guarded = event.guard === undefined
    ? new Set<string>()
    : referencedFields(event.guard, model, event.aggregate, ctx);
  if ([...involved].some((field) => guarded.has(field))) return undefined;

  return finding(
    invariant,
    `enforced_by(kind: guard)の ref "${enforcement.ref}" が指すガードに、この不変条件が関与するフィールド` +
      `(${[...involved].join(', ')})が 1 つも現れません`,
    `${enforcement.ref} のガードに条件を書き足すか、実際に守っている執行点へ ref を直してください。` +
      'DSL で表せない条件を人手で守っているなら kind: application(隔離した純粋関数名)または kind: trigger で宣言します',
    {
      // レポーターが反例を `, ` で連結するため、複数値は [a | b] の形にして境界を保つ。
      ref: enforcement.ref,
      involved_fields: `[${[...involved].join(' | ')}]`,
      guard: event.guard ?? '(なし)',
    },
    'warning',
  );
}

/** 不変条件 1 件を検証する。env は行内制約の充足性判定に使う、その集約から見た変数ドメイン。 */
function checkInvariant(
  invariant: InvariantDef,
  index: SpecIndex,
  env: DomainEnv,
  ctx: VerifyContext,
  model: SpecModel,
  aggregate: string,
): Finding[] {
  const findings: Finding[] = [];
  if (invariant.enforcedBy.length === 0) {
    findings.push(
      finding(
        invariant,
        'enforced_by がありません(何がこの不変条件を守るのか宣言されていません)',
        'enforced_by に kind(db_constraint / trigger / guard / application)と ref を 1 つ以上書いてください',
        { statement: invariant.statement, enforced_by: '(空)' },
      ),
    );
  }
  const formalLess = checkFormalLessEnforcement(invariant);
  if (formalLess !== undefined) findings.push(formalLess);
  findings.push(...checkInvolves(invariant, index));
  for (const enforcement of invariant.enforcedBy) {
    if (enforcement.kind === 'application') {
      const applicationResult = checkApplicationRefExists(invariant, enforcement, ctx);
      if (applicationResult !== undefined) findings.push({ ...applicationResult, grounding: 'implementation' });
      const calledResult = checkApplicationRefCalled(invariant, enforcement, ctx);
      if (calledResult !== undefined) findings.push({ ...calledResult, grounding: 'implementation' });
      continue;
    }
    if (enforcement.kind !== 'guard') continue;
    const result = checkGuardEnforcement(invariant, enforcement, index);
    if (result !== undefined) {
      findings.push(result);
      continue;
    }
    const relevance = checkGuardRelevance(invariant, enforcement, index, model, aggregate, ctx);
    if (relevance !== undefined) findings.push(relevance);
  }
  findings.push(...checkFormal(invariant, aggregate, index, model, env, ctx));
  findings.push(...checkNullTests(invariant, model, aggregate, ctx.guards));
  return findings;
}

/** V10: 不変条件が実際に執行されるよう宣言されているかを検証する。 */
export const invariantEnforcementVerifier: Verifier = {
  id: 'V10',
  title: '不変条件の執行 — enforced_by の存在と ref の実在',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const index = buildIndex(model);
    const findings: Finding[] = [];
    for (const [aggregate, specs] of model.aggregates) {
      const invariants = specs.invariants?.invariants ?? [];
      if (invariants.length === 0) continue;
      const env = buildAggregateEnv(model, aggregate);
      for (const invariant of invariants) {
        findings.push(...checkInvariant(invariant, index, env, ctx, model, aggregate));
      }
    }
    // 執行点の名前の一意性は集約をまたぐので、ループの外で 1 回だけ見る。
    findings.push(...checkConstraintOwners(model));
    return findings;
  },
};

/**
 * `kind: application` の ref が、実装(app/src)の export 名として実在するかを見る。
 *
 * `ctx.applicationRefs` が無い(app/ を走査できない・単体テスト)構成では何も見ない
 * (K1 が env 未走査で何も見ないのと同じ扱い)。
 */
function checkApplicationRefExists(
  invariant: InvariantDef,
  enforcement: EnforcementDef,
  ctx: VerifyContext,
): Finding | undefined {
  if (ctx.applicationRefs === undefined || ctx.applicationRefs.exportedNames.has(enforcement.ref)) {
    return undefined;
  }
  return finding(
    invariant,
    `enforced_by(kind: application)の ref "${enforcement.ref}" は app/src に export された関数・定数として実在しません`,
    `${enforcement.ref} という名前で export した純粋関数(または zod スキーマ)を app/src に置くか、` +
      '実在する名前へ ref を直してください(リネーム・削除の消し忘れの可能性があります)',
    { ref: enforcement.ref },
  );
}

/**
 * `kind: application` の ref に**呼び出し口があるか**を見る。
 *
 * 「どこからも呼ばれていない執行点」は、宣言だけがあって何も守っていない。テスト
 * (`__tests__` / `*.test.ts`)と生成物は走査の対象外なので、単体テストが残っていることは
 * 呼び出し口の根拠にならない —— それがこの検査の要点である(執行が消えたとき、真っ先に
 * 残るのが単体テストだからである)。doc コメントの中の言及も数えない(走査がコメントと
 * 文字列を落としてから数える)。
 *
 * 名前が実在しない場合はここでは何も言わない(checkApplicationRefExists が先に報告する)。
 */
function checkApplicationRefCalled(
  invariant: InvariantDef,
  enforcement: EnforcementDef,
  ctx: VerifyContext,
): Finding | undefined {
  const refs = ctx.applicationRefs;
  if (refs === undefined || !refs.exportedNames.has(enforcement.ref)) return undefined;
  if (refs.referencedNames.has(enforcement.ref)) return undefined;
  return finding(
    invariant,
    `enforced_by(kind: application)の ref "${enforcement.ref}" は app/src のどこからも呼ばれていません` +
      '(宣言だけがあって、この不変条件を実際に守っているものがありません)',
    `${enforcement.ref} を実行経路から呼ぶか、執行点を実体のある宣言へ移してください` +
      '(集計を数える判定なら DB のコミット時評価 = deferrable な制約トリガに寄せて ' +
      '"kind: trigger" を宣言するのが定石です。ADR-0012 §1)。' +
      '単体テストが残っていることは呼び出し口の根拠になりません',
    { ref: enforcement.ref, call_sites: '0' },
  );
}
