/**
 * V12 スナップショット写像チェック(C-29)。
 *
 * domain-spec-writing.md の V12:「`effects[].snapshot` の写像元・写像先の列が実在し型が一致する。
 * 写像先エンティティの列で写像に現れないものがあれば**警告**」。
 *
 * ## なぜこの検査が要るのか
 *
 * 公開時Fix(迂回パターン P-1)は「公開してよい情報しか列が無い集約を作り、公開の遷移がそこへ写す」
 * という形である。列が無いものは書けないので、`projection` に 1 語足すと内輪の情報が出る、という
 * 第1版の穴は構造的に消える。**ただしその代償として、公開側の集約に列を 1 つ足しても何も鳴らない**
 * (第2版の変異 #10 = C-29a)。足した列は写像に現れないまま `null` で残り、あるいは
 * 「公開側にあるのだから写してよい情報だ」という誤読を誘う。
 *
 * V12 の 3 つの観点はこの穴に対応している。
 *
 * | # | 観点 | severity | 塞ぐもの |
 * |---|------|---------|---------|
 * | ① | 写像先(`to`)のエンティティと列が実在し、型が一致する | error | 綴り違い・型の取り違え |
 * | ② | 写像先の非 auto 列で写像に現れないものがある | **warning** | **変異 #10(公開側に非公開列を足しても鳴らない)** |
 * | ③ | 写像元(`from`)のエンティティと列が実在する | error | 元の列を消したのに写像が残る |
 * | ④ | `do` に `snapshot_` で始まる副作用 ID があるのに `snapshot` を書いていない | **error** | **`snapshot` を書かないことで①〜③をまるごと迂回する穴**(2026-09-04 拡張) |
 * | ⑤ | 写像先(`to`)のエンティティが `mirror: true` を宣言していない / `mirror: true` なのにどの写像先でもない | **error** | **無関係な遷移に `snapshot.to` を書くだけで、その表の削除が破壊的な書き込みから外れる穴** |
 * | ⑥ | 写像元の隠し列を隠した相手が写像先の列を読める / 写像元が個人列なのに写像先が `personal: true` でない | **error** | **隠し列・個人列の約束が写しで切れる穴**(点検 12 回目 A12-2。判定は `semantics/copy-exposure.ts`、受け入れは写像の行の `copy_accept`) |
 *
 * ## ④ が要る理由
 *
 * `effects[].snapshot` は任意欄なので、①〜③はどれも「`snapshot` を書いた行」にしか効かない。
 * 副作用 ID を `snapshot_public_workshop` のように**宣言するだけ**で `snapshot` を書かなければ、
 * この検証器はその行を素通りする — 名前で「スナップショットを作る」と主張していながら、
 * 何を写すかは検査されない。`snapshot_` 接頭辞を「この副作用は行を作る」という合図として
 * 正式に扱い(domain-spec-writing.md)、その合図を出した以上は写像を書かせる。
 *
 * ## 写像元の「実在」であって「接地」ではない
 *
 * ガード式の参照パスは `context` で解決できることまで要求する(V2)が、写像元にはそれを課さない。
 * スナップショットは**子の行の集まり**から写す(催し 1 件 → プログラム項目 N 件)ことがあり、
 * その関係は `context`(1 対 1 の参照パス)では表せないためである。ここで見るのは
 * 「そのエンティティのその列が仕様のどこかに実在するか」までで、どう辿るかは副作用の実装が持つ。
 */

import type { EffectDef, EntitySpec, SnapshotDef, SnapshotFieldMap, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier } from '../../check-api/contract.js';
import { NOW, normalizeType, resolveSource, type Source } from './v12-snapshot-source.js';
import { copyExposureFindings } from '../../semantics/copy-exposure.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { VerifyContext } from '../../check-api/contract.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V12';

/** この接頭辞を持つ副作用 ID は「スナップショット行を作る」という合図(観点④)。 */
const SNAPSHOT_ID_PREFIX = 'snapshot_';

/** V12 の指摘を組み立てる。 */
function finding(severity: Finding['severity'], args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity, ...args };
}

/** エンティティ名 → entity_spec の索引を作る。 */
function entityIndex(model: SpecModel): ReadonlyMap<string, EntitySpec> {
  const index = new Map<string, EntitySpec>();
  for (const specs of model.aggregates.values()) {
    if (specs.entity !== undefined) index.set(specs.entity.entity, specs.entity);
  }
  return index;
}

/** 写像先の列 1 件を検査する(観点①)。 */
function checkTarget(
  map: SnapshotFieldMap,
  source: Source | null,
  target: EntitySpec,
  context: string,
): Finding[] {
  const field = target.fields.find((candidate) => candidate.name === map.to);
  if (field === undefined) {
    return [
      finding('error', {
        message: `${context} の写像先の列 ${target.entity}.${map.to} が実在しません`,
        location: map.location,
        suggestion: `${target.entity} の entity_spec に "${map.to}" を足すか、写像の to を実在する列名へ直す`,
        counterexample: { to: map.to, entity: target.entity },
      }),
    ];
  }
  if (source === null) return [];

  const expected = normalizeType(field.type);
  if (expected !== source.type) {
    return [
      finding('error', {
        message: `${context} の写像 ${map.from} → ${map.to} は型が一致しません(${source.type} → ${expected})`,
        location: map.location,
        suggestion:
          '写像元か写像先のどちらかの型を直す(スナップショットは列の対応表であり、型の変換はここに書けない)',
        counterexample: { from: map.from, to: map.to, from_type: source.type, to_type: expected },
      }),
    ];
  }
  if (field.required && !source.always) {
    return [
      finding('error', {
        message: `${context} の写像先 ${map.to} は必須ですが、写像元 ${map.from} は空になりえます`,
        location: map.location,
        suggestion:
          `写像先の required を外すか、必ず値が入る列を写像元にする` +
          '(空になりうる値を必須列へ写すと、公開の遷移が実行時に落ちる)',
        counterexample: { from: map.from, to: map.to },
      }),
    ];
  }
  return [];
}

/**
 * 写像先の列の覆い漏れを見る(観点②。**変異 #10 を塞ぐのはここ**)。
 *
 * 対象から外すのは `auto: true` の列だけである(採番・作成日時はシステムが供給する)。
 * それ以外の列は、公開側に置いた以上「公開の遷移が何かを入れる」はずであり、
 * 写像に現れないなら宣言と実体が食い違っている。
 */
function checkCoverage(snapshot: SnapshotDef, target: EntitySpec, context: string): Finding[] {
  const mapped = new Set(snapshot.fields.map((map) => map.to));
  const uncovered = target.fields
    .filter((field) => !field.auto && !mapped.has(field.name))
    .map((field) => field.name);
  if (uncovered.length === 0) return [];
  return [
    finding('warning', {
      message: `${context} の写像に現れない ${target.entity} の列があります: ${uncovered.join(', ')}`,
      location: snapshot.location,
      suggestion:
        `写像に "- from: {entity}.{field} / to: ${uncovered[0] ?? ''}" を足すか、` +
        `${target.entity} の entity_spec からその列を消す` +
        '(公開側に置いたのに誰も書かない列は、公開してよい情報の範囲を宣言より広く見せる)',
      counterexample: { entity: target.entity, uncovered: uncovered.join(', ') },
    }),
  ];
}

/** 同じ列へ 2 本の写像が来ていないか。 */
function checkDuplicates(snapshot: SnapshotDef, context: string): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const map of snapshot.fields) {
    if (seen.has(map.to)) {
      findings.push(
        finding('error', {
          message: `${context} の写像先 ${map.to} が 2 回宣言されています`,
          location: map.location,
          suggestion: '1 つの列に写像元は 1 つだけ書く(2 つ書くとどちらが入るか宣言から決まらない)',
          counterexample: { to: map.to },
        }),
      );
    }
    seen.add(map.to);
  }
  return findings;
}

/** 観点⑥: 写像元の隠し列・個人列の約束が写像先でも保たれるか(`now` は列を持たないので、書いた `copy_accept` は腐っている)。 */
function checkExposure(model: SpecModel, map: SnapshotFieldMap, target: EntitySpec, context: string): Finding[] {
  const [entity = '', field = ''] = map.from === NOW ? [] : map.from.split('.');
  return copyExposureFindings(model, {
    verifier: VERIFIER_ID,
    context,
    from: { entity, field },
    to: { entity: target.entity, field: map.to },
    accepts: map.accept ?? [],
    location: map.location,
    acceptHint: '写像の行の copy_accept',
  });
}

/** スナップショット宣言 1 件を検査する。 */
function checkSnapshot(
  model: SpecModel,
  snapshot: SnapshotDef,
  context: string,
  entities: ReadonlyMap<string, EntitySpec>,
  roots: ProductRoots,
): Finding[] {
  const target = entities.get(snapshot.to);
  if (target === undefined) {
    return [
      finding('error', {
        message: `${context} の写像先エンティティ ${snapshot.to} が実在しません`,
        location: snapshot.location,
        suggestion: `${specPath(roots, 'domain', snapshot.to, 'entity.md')} を作るか、to を実在するエンティティ名へ直す`,
        counterexample: { to: snapshot.to },
      }),
    ];
  }

  const findings: Finding[] = [...checkDuplicates(snapshot, context)];
  for (const map of snapshot.fields) {
    const resolved = resolveSource(map, context, entities, roots);
    findings.push(...resolved.findings);
    findings.push(...checkTarget(map, resolved.source, target, context));
    if (resolved.source !== null) findings.push(...checkExposure(model, map, target, context));
  }
  findings.push(...checkCoverage(snapshot, target, context));
  return findings;
}

/**
 * 観点④: `do` に `snapshot_` で始まる副作用 ID があるのに `snapshot` が無ければ違反にする。
 *
 * `snapshot` を書かないことで①〜③をまるごと迂回できる穴を塞ぐ(2026-09-04 拡張)。
 */
function checkNamingRequiresSnapshot(effect: EffectDef, context: string): Finding[] {
  if (effect.snapshot !== undefined) return [];
  const named = effect.do.filter((id) => id.startsWith(SNAPSHOT_ID_PREFIX));
  if (named.length === 0) return [];
  return [
    finding('error', {
      message: `${context} は副作用 ID が "${SNAPSHOT_ID_PREFIX}" で始まる(${named.join(', ')})のに snapshot を書いていません`,
      location: effect.location,
      suggestion:
        `${SNAPSHOT_ID_PREFIX}* は「スナップショット行を作る」という合図であり、` +
        'その副作用は snapshot(写像先エンティティと列の対応表)を必ず書く' +
        '(domain-spec-writing.md §effects[].snapshot)。作らないなら接頭辞の無い ID に変える',
      counterexample: { do: named.join(', ') },
    }),
  ];
}

/**
 * 観点⑤: 写しの宣言(entity_spec の `mirror: true`)と写像先(`snapshot.to`)を双方向で突き合わせる。
 *
 * 写しの表への `delete` は破壊的な書き込みに数えない(元のデータは残る)。その免除を「snapshot.to に名前が出た」ことから
 * 推測すると、無関係な遷移に `snapshot: { to: X }` を書くだけで X の削除が確認の文言から落ちる。免除は宣言(`mirror`)に
 * 置き、宣言と写像の両方が揃っているものだけを写しと認める。
 */
function checkMirrorDeclarations(model: SpecModel, entities: ReadonlyMap<string, EntitySpec>): Finding[] {
  const targets = new Map<string, SnapshotDef>();
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      for (const effect of machine.effects) {
        if (effect.snapshot !== undefined && !targets.has(effect.snapshot.to)) targets.set(effect.snapshot.to, effect.snapshot);
      }
    }
  }
  const findings: Finding[] = [];
  for (const [to, snapshot] of targets) {
    const entity = entities.get(to);
    if (entity === undefined || entity.mirror === true) continue;
    findings.push(
      finding('error', {
        message: `snapshot の写像先 ${to} の entity_spec が mirror: true を宣言していません`,
        location: snapshot.location,
        suggestion:
          `${to} が他の集約の写しなら entity_spec に "mirror: true" を書く。写しでない集約を写像先にしているなら snapshot.to を直す` +
          '(写しの表の削除は破壊的な書き込みに数えないので、写しであることは宣言で言う)',
        counterexample: { to },
      }),
    );
  }
  for (const entity of entities.values()) {
    if (entity.mirror !== true || targets.has(entity.entity)) continue;
    findings.push(
      finding('error', {
        message: `${entity.entity} は mirror: true を宣言していますが、どの state_spec の snapshot.to にも現れません`,
        location: entity.location,
        suggestion: `${entity.entity} を写す遷移の effects に snapshot(to: ${entity.entity})を書くか、写しでないなら mirror を消す`,
        counterexample: { entity: entity.entity },
      }),
    );
  }
  return findings;
}

/** V12: スナップショットの写像が宣言どおりに成立するかを検証する。 */
export const snapshotMappingVerifier: Verifier = {
  id: 'V12',
  title: 'スナップショット写像 — 写像元・写像先の実在と型、写像先の列の覆い',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const entities = entityIndex(model);
    const findings: Finding[] = [...checkMirrorDeclarations(model, entities)];
    for (const specs of model.aggregates.values()) {
      for (const machine of specs.stateMachines) {
        for (const effect of machine.effects) {
          const context = `${machine.machine}.${effect.on} の snapshot`;
          if (effect.snapshot === undefined) {
            findings.push(...checkNamingRequiresSnapshot(effect, context));
            continue;
          }
          findings.push(...checkSnapshot(model, effect.snapshot, context, entities, ctx.roots));
        }
      }
    }
    return findings;
  },
};
