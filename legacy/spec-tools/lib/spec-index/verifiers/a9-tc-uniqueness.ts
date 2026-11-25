/**
 * A9 テストケース ID の台帳検査。
 *
 * action-spec-writing.md / query-spec-writing.md の「テストケース ID は**全仕様を通じて一意**」を
 * 執行する唯一の検査である。ID は仕様・テストコード・レビュー記録・issue をつなぐ識別子であり、
 * 2 つの仕様が同じ ID を宣言すると、`@tc` から仕様への逆引きが 1 つに定まらなくなる
 * (どちらの仕様が「そのテストで守られている」のかが言えない)。
 *
 * 以前はこの検査が仕様種ごとに分かれており(A6 が action_spec の中、Q6 が query_spec の中)、
 * **種をまたいだ重複だけが誰にも見えない**という穴があった。母集合が 1 つである以上、
 * 検査も 1 つでなければならない — それがテストケース ID 台帳と A9 である。
 * 仕様種が増えても、台帳に写し取る関数が 1 本増えるだけでこの検査は変わらない。
 */

import type { Finding, SpecIndexVerifier } from '../verifier.js';
import { specIndexFinding } from '../verifier.js';
import type { TcDuplicate, TcRegistry, TcRegistryEntry, TcRetiredReuse } from '../../testcase/types.js';

/** A9: テストケース ID が全仕様を通じて一意か、欠番が再利用されていないかを検証する。 */
export const tcUniquenessVerifier: SpecIndexVerifier = {
  id: 'A9',
  title: 'テストケース ID の台帳 — ID が全仕様(仕様種をまたいで)一意・欠番は再利用しない',

  verify(registry: TcRegistry): Finding[] {
    return [
      ...registry.duplicates().map(duplicateFinding),
      ...registry.retiredReuses().map(retiredReuseFinding),
    ];
  },
};

/**
 * 同じ ID を宣言している 2 件以上の箇所を 1 件の違反にまとめる。
 *
 * 位置は先に読み込まれた宣言に付けつつ、反例には**全宣言箇所**を並べる
 * (どちらか一方だけを見せると「もう片方はどこか」を人間が探すことになるため)。
 * 対処では特定の仕様を名指ししない — 読み込み順は「どちらが先に書かれたか」ではないので、
 * どちらを振り直すかは書いた人にしか決められない。
 */
function duplicateFinding(duplicate: TcDuplicate): Finding {
  const first = duplicate.entries[0];
  return specIndexFinding('A9', {
    message: `テストケース ID ${duplicate.tcId} が複数の仕様で宣言されています`,
    location: first?.location ?? { file: '(不明)' },
    suggestion:
      'ID は全仕様(action_spec / query_spec)を通じて一意にする。どちらか(後から足した方)の' +
      '連番を、その仕様で使われている最大値の次に振り直す(番号は追記専用なので詰め直さない)。' +
      '宣言箇所は反例の declared_in を参照',
    counterexample: {
      test_case: duplicate.tcId,
      declared_in: duplicate.entries.map(place).join(' / '),
    },
  });
}

/** 反例に出す宣言箇所の表記(どの仕様種のどの仕様が、どのファイルで宣言したか)。 */
function place(entry: TcRegistryEntry): string {
  return `${entry.specKind} ${entry.specId}(${entry.specFile})`;
}

/**
 * 欠番にした ID が再利用されている 1 件を Finding にする。
 *
 * action-spec-writing.md §test_cases「id の番号は追記専用にする…廃止したケースの番号は
 * 欠番のまま残す」の違反。以前は「◯◯は欠番」という散文コメントでしか残っておらず、
 * その番号が後から別のケースに再利用されても機械には見えなかった(retired: を新設した理由)。
 */
function retiredReuseFinding(reuse: TcRetiredReuse): Finding {
  const first = reuse.reusedBy[0];
  return specIndexFinding('A9', {
    message: `テストケース ID ${reuse.tcId} は欠番(retired)にした後、再利用されています`,
    location: first?.location ?? reuse.retiredAt,
    suggestion:
      '欠番にした ID は永久に使わない(番号は追記専用)。新しいケースには、その仕様で使われている' +
      '最大値の次の連番を振り直す。誤って retired にしただけなら retired から取り除く',
    counterexample: {
      test_case: reuse.tcId,
      retired_at: `${reuse.retiredAt.file}${reuse.retiredAt.pointer === undefined ? '' : `#${reuse.retiredAt.pointer}`}`,
      reused_in: reuse.reusedBy.map(place).join(' / '),
    },
  });
}
