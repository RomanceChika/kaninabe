/**
 * 題材 `library` の利用者カードの状態(`patron.card`: valid / expired / revoked)で役を絞る形 —— E1 / E2 の
 * 2 つ目の実例(ADR-0018)。
 *
 * fixture 本体は書き換えず、一時ツリーの写しに次の 2 つを足して本物の仕組みを通す。
 *
 * - `patron` を `claim: patron.card == valid` で絞る(利用者のロールが立つのは**カードが有効なときだけ**)
 * - `patron.card` に `session: true`(claim が指せるのはセッションに載る欄だけ)
 *
 * 見るのは次の点である。検証が通ること(V24 が止めない)・生成物の型検査が通ること・生成された SQL に
 * 条件が出ること・**実行時のロール解決の表と実行計画に条件が出ること**・生成ユニットテストのセッションが
 * 条件を満たす値で埋まること・world が**条件を満たす人 / 満たさない人**を分けて立て、state / enum の欄に
 * `true` を置かないこと。条件を足していない fixture の生成物には、どれも現れない(宣言しなければ変わらない)。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import type { SampleRun } from './harness.js';

/** 一時ツリーの写しに足す変更(fixture 本体は変えない)。 */
const REWRITE = {
  'docs/specs/domain/roles.md': (text: string): string =>
    text.replace(
      '    kind: authenticated_default\n  - id: librarian',
      '    kind: authenticated_default\n    claim: patron.card == valid\n  - id: librarian',
    ),
  'docs/specs/domain/patron/entity.md': (text: string): string =>
    text.replace(
      '    type: enum([valid, expired, revoked])\n    required: true\n',
      '    type: enum([valid, expired, revoked])\n    required: true\n    session: true\n',
    ),
};

/** 生成物のうち、パスがこの断片を含むものを連結して返す。 */
function generated(run: SampleRun, fragment: string): string {
  return [...run.generatedFiles.entries()]
    .filter(([file]) => file.includes(fragment))
    .map(([, content]) => content)
    .join('\n');
}

describe('library — 利用者カードの状態で役を絞る', () => {
  let conditioned: SampleRun;
  let plain: SampleRun;

  beforeAll(async () => {
    conditioned = await runSampleSystem('library', { rewrite: REWRITE });
    plain = await runSampleSystem('library');
  }, 300_000);

  it('検証の error は増えない — V24 は止めない(先読みとオラクルが値の集合を読む)', () => {
    const lines = (run: SampleRun): string[] => run.errors.map((finding) => `${finding.verifier}: ${finding.message}`);
    expect(lines(conditioned)).toEqual(lines(plain));
  });

  it('生成物の型検査が通る(行の条件の表・計画・world の型が実行時パッケージの型に合う)', () => {
    expect(conditioned.typecheck.diagnostics).toEqual([]);
    expect(conditioned.typecheck.ok).toBe(true);
  });

  it('ロール解決の表: 既定のログインロールの条件と、含意の先の条件が束に出る(条件の無い版には出ない)', () => {
    const roles = generated(conditioned, 'domain/generated/roles.ts');
    expect(roles).toContain('export const AUTHENTICATED_WHEN: RunRowCondition = deepFreeze({\n  field: \'card\',\n  values: [\'valid\'],\n});');
    expect(roles).toContain('export const ROLE_GATES');
    for (const role of ['librarian', 'loan_owner', 'hold_owner']) {
      expect(roles).toMatch(new RegExp(`ROLE_GATES[^]*  ${role}: \\[\\n    \\{\\n      field: 'card',\\n      values: \\['valid'\\],`));
    }
    const bindings = generated(conditioned, 'runtime-bindings.ts');
    expect(bindings).toContain('authenticatedWhen: AUTHENTICATED_WHEN,');
    expect(bindings).toContain('gates: ROLE_GATES,');
    const before = generated(plain, 'runtime-bindings.ts');
    expect(before).not.toContain('authenticatedWhen');
    expect(before).not.toContain('gates:');
    expect(generated(plain, 'domain/generated/roles.ts')).not.toContain('AUTHENTICATED_WHEN');
  });

  it('実行計画: 手順が認めるロールごとに、併せて満たす行の条件が出る(条件の無い版には出ない)', () => {
    const plans = generated(conditioned, 'operation-plans.ts');
    expect(plans).toMatch(/roleGates: \{\n\s+patron: \[\n\s+\{\n\s+field: 'card',\n\s+values: \['valid'\],/);
    expect(generated(plain, 'operation-plans.ts')).not.toContain('roleGates');
  });

  it('生成ユニットテスト: ログインした実行者のセッションはカードが有効な値で埋まる(全部が条件を満たさない人にならない)', () => {
    const test = generated(conditioned, 'generated/loan/check_out.test.ts');
    expect(test).toContain("card: 'valid',");
    expect(test).not.toContain('card: true');
    expect(generated(plain, 'generated/loan/check_out.test.ts')).not.toContain('card:');
  });

  it('生成ユニットテスト: 根拠はあるのに条件を満たさない実行者(カードが有効でない値)は、未ログインのロールとして拒否される', () => {
    const test = generated(conditioned, 'generated/loan/check_out.test.ts');
    const title = test.indexOf('行の条件を満たさない実行者の');
    expect(title).toBeGreaterThan(0);
    const scene = test.slice(title, test.indexOf('\n  });', title));
    expect(scene).toContain("card: 'expired',");
    expect(scene).toMatch(/kind: 'forbidden',[^]*?role: 'anonymous'/);
    expect(scene).toContain('expect(calls).toHaveLength(0);');
    expect(generated(plain, 'generated/loan/check_out.test.ts')).not.toContain('行の条件を満たさない実行者の');
  });

  it('RLS の world: ロールの根拠に値の集合が出て、条件を満たさない人が足され、欄には条件の外の値が置かれる', () => {
    const worlds = generated(conditioned, 'rls-worlds.ts');
    expect(worlds).toContain("claimField: 'card',\n    claimValues: ['valid'],");
    expect(worlds).toContain("unmet: 'patron',");
    expect(worlds).toContain("card: 'expired',");
    expect(worlds).not.toContain('card: true');
    const before = generated(plain, 'rls-worlds.ts');
    expect(before).not.toContain('unmet');
    expect(before).not.toContain('claimValues');
  });

  it('一致の証明の world: 条件を満たさない人の実行器が解決する配列は未ログインと同じ側(古い一覧は別に持つ)', () => {
    const worlds = generated(conditioned, 'eq-worlds.ts');
    expect(worlds).toMatch(
      /key: 'hold_owner_unmet_patron',[^]*?arrays: \[\n\s+\{\n\s+name: 'from_session',\n\s+roles: \['anonymous'\],\n\s+\},\n\s+\{\n\s+name: 'from_stale',/,
    );
    expect(worlds).not.toContain('card: true');
    expect(generated(plain, 'eq-worlds.ts')).not.toContain('unmet');
  });

  it('一致の証明の world: 条件を満たさない人には、条件を満たしていた頃の古いロール一覧も渡す(DB が配列を信じないことの見張り)', () => {
    const worlds = generated(conditioned, 'eq-worlds.ts');
    // 根拠の束縛だけの人の古い配列は既定のログインロール、claim の人はそれに claim のロールが加わる。
    expect(worlds).toMatch(/key: 'hold_owner_unmet_patron',[^]*?name: 'from_stale',\n\s+roles: \['patron'\],/);
    expect(worlds).toMatch(/key: 'librarian_unmet_patron',[^]*?name: 'from_stale',\n\s+roles: \['patron', 'librarian'\],/);
    expect(generated(plain, 'eq-worlds.ts')).not.toContain('from_stale');
  });

  it('保存点の world: 古いロール一覧を渡す人（_stale_）は、実行器が解決した配列の代わりにそれを渡す', () => {
    const worlds = generated(conditioned, 'eq-worlds.ts');
    const saves = worlds.slice(worlds.indexOf('eqSaveWorlds'));
    expect(saves).toMatch(/key: 'librarian_stale_patron',[^]*?unmet: 'patron',\n\s+staleRoles: \['patron', 'librarian'\],/);
    expect(saves).toMatch(/key: 'librarian_unmet_patron',/);
    expect(saves.match(/staleRoles:/g)?.length).toBeGreaterThan(0);
  });

  it('ハンドブックの結果表: 条件を満たさない人は、どの役の条件を満たさないかを添えた見出しで並ぶ', () => {
    const prose = (run: SampleRun): string =>
      [...run.generatedFiles.entries()]
        .filter(([file]) => file.startsWith('docs/book/') && file.endsWith('.html'))
        .map(([, content]) => content)
        .join('\n');
    expect(prose(conditioned)).toContain('の条件を満たさない');
    expect(prose(plain)).not.toContain('の条件を満たさない');
  });

  it('保存点の world: 条件を満たさない人も立ち、その人の行にはカードが有効でない値が置かれる', () => {
    const worlds = generated(conditioned, 'eq-worlds.ts');
    const saves = worlds.slice(worlds.indexOf('eqSaveWorlds'));
    expect(saves).toMatch(/key: 'librarian_unmet_patron',/);
    expect(saves).toMatch(/unmet: 'patron',/);
    expect(saves).toContain("card: 'expired',");
  });

  it('生成された SQL は骨格・構文の検査を通る(丸括弧・begin/end・権限の 3 行)', () => {
    expect(conditioned.sql.problems).toEqual([]);
  });

  it('利用者の補助関数は 行の実在 AND カードが有効、になる', () => {
    const helper = generated(conditioned, '_helper_is_patron');
    expect(helper).toMatch(/and a\.card in \('valid'\)\);/);
    expect(generated(plain, '_helper_is_patron')).not.toContain('a.card');
  });

  it('利用者の役を使う RPC は 配列の照合 AND 行の実在 AND カードが有効、になる', () => {
    const rpc = generated(conditioned, '_rpc_');
    expect(rpc).toContain("a.card in ('valid')");
    expect(generated(plain, '_rpc_')).not.toContain('a.card');
  });

  it('利用者の役の配列の照合は、必ず行の条件と対になっている(条件を落とすと検査が赤になる)', () => {
    const pairs = (sql: string): { readonly arrays: number; readonly paired: number } => {
      const array = "coalesce('patron' = any(p_actor_roles), false)";
      const withRow = `${array} and exists (select 1 from public.patrons a where a.id = p_actor_id and a.card in ('valid'))`;
      return { arrays: sql.split(array).length - 1, paired: sql.split(withRow).length - 1 };
    };
    const rpc = generated(conditioned, '_rpc_');
    const found = pairs(rpc);
    expect(found.arrays).toBeGreaterThan(0);
    expect(found.paired).toBe(found.arrays);
    // 変異: 行の条件を 1 つ落とした SQL は対が崩れる(この検査が赤になる)。
    const mutated = rpc.replace(" and a.card in ('valid'))", ')');
    expect(pairs(mutated).paired).toBeLessThan(found.arrays);
    // 条件を足していない版には、そもそも条件が出ない。
    expect(pairs(generated(plain, '_rpc_')).paired).toBe(0);
  });

  it('含意する役のポリシーは「自分の根拠 AND 利用者の補助関数」の本文になる(字面ごと)', () => {
    const using = (fragment: string): string[] =>
      generated(conditioned, fragment)
        .split('\n')
        // 許可ポリシーの述語だけを見る(表ごとの制限ポリシー `using ((select …session_alive()))` は別の関門で、ここの対象ではない)。
        .filter((line) => line.includes('using (') && !line.includes('session_alive'))
        .map((line) => line.trim());
    // 借受本人(対象の行の列で立つ役)・予約本人・司書(boolean の claim)のどれにも利用者の条件が足される。
    expect(using('_policies_loans')).toEqual([
      'using ((coalesce(((loans.patron_id) = ((select auth.uid()))), false) and public.is_patron()));',
      'using ((public.is_librarian() and public.is_patron()));',
    ]);
    expect(using('_policies_holds')).toEqual([
      'using ((coalesce(((holds.patron_id) = ((select auth.uid()))), false) and public.is_patron()));',
      'using ((public.is_librarian() and public.is_patron()));',
    ]);
    // 含意の先自身のポリシーは自分の補助関数だけ。条件を足していない版では、含意する役のポリシーも従来の字面。
    expect(using('_policies_patrons')).toEqual([
      'using (public.is_patron());',
      'using ((public.is_librarian() and public.is_patron()));',
    ]);
    const before = generated(plain, '_policies_loans')
      .split('\n')
      .filter((line) => line.includes('using (') && !line.includes('session_alive'))
      .map((line) => line.trim());
    expect(before).toEqual([
      'using (coalesce(((loans.patron_id) = ((select auth.uid()))), false));',
      'using (public.is_librarian());',
    ]);
  });

  it('司書(boolean の claim)の RPC の述語は従来の字面を保ちつつ、含意の先の条件が足される', () => {
    const rpc = generated(conditioned, '_rpc_');
    expect(rpc).toMatch(/a\.is_librarian\) and exists \(select 1 from public\.patrons a where a\.id = p_actor_id and a\.card in \('valid'\)\)/);
  });
});
