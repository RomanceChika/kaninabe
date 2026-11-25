/**
 * fixture 4 題材のガード式が全部 SQL に写ることの回帰(束 ⑳-1)。
 *
 * 翻訳器(`lib/sql/guard-to-sql.ts`)は製品の形を前提にしていないか —— 別題材の仕様に
 * 現れる式(状態遷移の `guard`・許可規則の `when`・文脈依存ロールの `binding`)を全部通して
 * 確かめる。**生成物には載せない**。ここで見るのは「写せるか」と「字面が黙って変わらないか」
 * だけであり、意味の一致は実 DB の差分テストが見る
 * (`legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts`)。
 *
 * fixture のための特別扱いを翻訳器に足してはならない(samples/harness.ts と同じ規律)。
 * ここが落ちたら、落ちたのは題材ではなく仕組みの一般性である。
 *
 * **測っていないこと**: 届き方(`reach`)の判定そのもの。ここでは題材の語を知らない素朴な
 * 解決器(binding が名指しするエンティティ = 対象の行、claim の相手 = 同名の表)を渡している
 * ので、「部屋から見れば 1 段・予約から見れば 2 段」という段数の違いは踏んでいない。段数を
 * 決めるのは呼ぶ文脈(⑳-3)であり、その判定はそこで測る。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSpecModel } from '../../lib/model/loader.js';
import { parseGuard } from '../../lib/guard/parser.js';
import { guardToSql } from '../../lib/sql/guard-to-sql.js';
import { rolesToSql, type RoleSqlBindings } from '../../lib/sql/roles-to-sql.js';
import { buildAggregateValueKindEnv, buildValueKindEnv } from '../../lib/semantics/domain-env.js';
import type { ValueKindEnv } from '../../lib/guard/comparison-typing.js';
import type { PathRef } from '../../lib/guard/ast.js';
import type { SpecModel } from '../../lib/model/types.js';

/** fixture の置き場(samples/harness.ts と同じ位置)。 */
const SAMPLES_ROOT = fileURLToPath(new URL('../fixtures/samples/', import.meta.url));

/** 5 題材。business-system-forms.md の行を分担して踏んでいる。 */
const SAMPLES = ['archive', 'expenses', 'library', 'rooms', 'stores'] as const;

/**
 * 題材ごとの式の本数(状態遷移の guard + 許可規則の when + ロールの binding)。
 *
 * **固定するのは本数だけ**である。式の中身は題材の仕様が持っており、ここに書き写すと
 * 二重の正になる。本数が動いたら、題材が変わったか、集め方が変わったかのどちらかである。
 */
const EXPECTED_EXPRESSION_COUNT: Readonly<Record<string, number>> = {
  archive: 7, // 状態遷移のテナント境界(V26。点検 3 回目 A3-1)で、文書管理者(claim)の遷移 3 本の guard に部署の項を足した
  expenses: 8,
  library: 6, // 予約・貸出を本人の名前に限るのは作成の縛り(actor-bound.ts)で、when には重ねて書かない
  rooms: 6,
  stores: 15, // 書き込みのテナント境界(V26)で、作成・編集・削除の when に `{列} == actor.company_id` を 7 本、続く追補(入力で受ける親の結び)でさらに 2 本足した。遷移の境界(A3-1)で注文の取消の guard を 1 本足した(移動の取消は既存の guard に項を足しただけ)
};

/** 式 1 本と、それがどこから来たか(落ちたときに場所が分かるように持つ)。 */
interface GuardSource {
  readonly where: string;
  readonly source: string;
  /** 裸の欄・欄の種別を引く集約。ロールの binding は起点が定まらないので undefined。 */
  readonly aggregate: string | undefined;
}

/** モデルからガード式の生文字列を全部集める。 */
function collectGuards(model: SpecModel): readonly GuardSource[] {
  const found: GuardSource[] = [];
  for (const role of model.roles.roles) {
    if (role.binding === undefined) continue;
    found.push({ where: `roles.${role.id}.binding`, source: role.binding, aggregate: undefined });
  }
  for (const [name, specs] of model.aggregates) {
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        if (event.guard !== undefined) {
          found.push({
            where: `${name}.${machine.machine}.${event.id}.guard`,
            source: event.guard,
            aggregate: name,
          });
        }
      }
    }
    const access = specs.access;
    if (access === undefined) continue;
    const rules = [...access.creates, ...access.writes, ...access.deletes];
    for (const rule of rules) {
      if (rule.when === undefined) continue;
      found.push({ where: `${name}.access.${rule.by}.when`, source: rule.when, aggregate: name });
    }
  }
  return found;
}

/**
 * 題材に依らない素朴な写像。
 *
 * 裸の欄(`state`)は対象の行の列、`{entity}.{field}` はその名前のままの列、`actor.{欄}` は
 * 実行者の引数、`contains` は呼び側が持つ真偽の式 —— どれも**題材の語を 1 つも知らない**
 * 規則である。裸の欄が来るのは許可規則の `when`(対象は 1 つに決まっているので前置しない)で
 * あり、**式には 1 段と 2 段の両方の書き方が現れる**(4 題材が実測した)。
 */
const column = (ref: PathRef): string | null => {
  const [root, ...rest] = ref.segments;
  if (root === undefined) return null;
  if (rest.length === 0) return `subject.${root}`;
  if (rest.length !== 1) return null;
  return root === 'actor' ? `p_actor_${rest[0] ?? ''}` : ref.segments.join('.');
};

/** その題材の欄の種別を引く写像(呼び側の責務。題材の語は 1 つも知らない)。 */
function bindingsFor(kinds: ValueKindEnv) {
  return {
    column,
    valueKind: (ref: PathRef) => kinds.get(ref.segments.join('.')) ?? null,
    contains: (ref: PathRef, element: PathRef): string =>
      `${ref.segments.join('_')}_has_${element.segments.join('_')}`,
  };
}

/**
 * ロールの翻訳に渡す素朴な解決器。
 *
 * binding が名指しするエンティティを**対象の行そのもの**、claim の相手を**同名の表**として
 * 解く。どちらも題材の語を知らない規則であり、ここで見たいのは `bindingEntities` / `reach` /
 * `claim` / `contains` の経路が 4 題材の宣言で踏めるかどうかである。
 */
function roleBindings(kinds: ValueKindEnv): RoleSqlBindings {
  return {
    actorId: 'p_actor_id',
    actorRoles: 'p_actor_roles',
    reach: (entity) => ({ kind: 'row', alias: entity }),
    actorRow: (entity) => ({ table: entity }),
    valueKind: (ref) => kinds.get(ref.segments.join('.')) ?? null,
  };
}

describe('fixture 4 題材のガード式が SQL に写る', () => {
  for (const name of SAMPLES) {
    it(`${name} の全ての式が述語になる`, () => {
      const loaded = loadSpecModel(path.join(SAMPLES_ROOT, name, 'docs/specs/domain'));
      expect(loaded.model).not.toBeNull();
      if (loaded.model === null) return;
      const model = loaded.model;
      const guards = collectGuards(model);
      expect(guards).toHaveLength(EXPECTED_EXPRESSION_COUNT[name] ?? -1);
      for (const guard of guards) {
        const parsed = parseGuard(guard.source);
        expect(parsed.ok, `${guard.where}: ${guard.source}`).toBe(true);
        if (!parsed.ok) continue;
        const kinds =
          guard.aggregate === undefined
            ? buildValueKindEnv(model)
            : buildAggregateValueKindEnv(model, guard.aggregate);
        const translated = guardToSql(parsed.expr, bindingsFor(kinds));
        expect(translated.ok, `${guard.where}: ${guard.source}`).toBe(true);
        if (!translated.ok) continue;
        // 全域(NULL を返さない)であること = 式全体がちょうど 1 回閉じられていること。
        expect(translated.sql.startsWith('coalesce(')).toBe(true);
        expect(translated.sql.endsWith(', false)')).toBe(true);
      }
    });
  }
});

/** 題材 1 つのロール定義を読む。 */
function rolesOf(name: string): SpecModel['roles']['roles'] {
  const loaded = loadSpecModel(path.join(SAMPLES_ROOT, name, 'docs/specs/domain'));
  if (loaded.model === null) throw new Error(`${name} の仕様を読めません`);
  return loaded.model.roles.roles;
}

describe('fixture 4 題材のロールが SQL に写る', () => {
  for (const name of SAMPLES) {
    it(`${name} の全ロールが述語になる`, () => {
      const loaded = loadSpecModel(path.join(SAMPLES_ROOT, name, 'docs/specs/domain'));
      expect(loaded.model).not.toBeNull();
      if (loaded.model === null) return;
      const model = loaded.model;
      const roles = model.roles.roles;
      const by = roles.map((role) => role.id);
      const translated = rolesToSql(by, roles, roleBindings(buildValueKindEnv(model)));
      expect(translated.ok, `${name}: ${by.join(' / ')}`).toBe(true);
      if (!translated.ok) return;
      expect(translated.sql).toContain('p_actor_roles');
      expect(translated.sql).toContain('p_actor_id');
    });
  }

  it('3 種の根拠がどれも 4 題材のどこかに現れる(踏んでいない経路を残さない)', () => {
    const all = SAMPLES.flatMap((name) => [...rolesOf(name)]);
    expect(all.some((role) => role.kind !== undefined)).toBe(true);
    expect(all.some((role) => role.claim !== undefined)).toBe(true);
    expect(all.some((role) => role.binding !== undefined)).toBe(true);
  });
});
