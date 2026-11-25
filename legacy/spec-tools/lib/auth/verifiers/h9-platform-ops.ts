/**
 * H9 プラットフォーム操作の宣言 — `platform_ops` の閉世界(ASVS V7.4.5・V7.5.2・V10.4.9 の「画面から叩く」口)。
 *
 * 認証フロー仕様の `platform_ops` は、認証基盤が持つ操作(セッションの一覧・終了など)を**画面から叩くための閉じた一覧**である。
 * 画面の `platform_ops:` が参照する(S20 / S21)。形(キー・`kind` / `actor` / `args` / `binding` の書き方)は H0 が見る。
 * ここは 1 ファイルの中で閉じない**意味の閉世界**を見る。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | 操作 id の重複が無い・同じ `port.method` を 2 つの操作が配線しない | 画面の参照と配線が 1 対 1 でなければ、どの操作を呼んだのか宣言から決まらない |
 * | `actor.role` が roles.md に実在する | 実行者の資格の正はロール。実在しないロールは誰も実行できない宣言になる |
 * | `needs: current_session` は本人の `do` だけ | 「いまの端末」は本人のセッションの概念。ロールの操作は引数(`keep_self`)で表す |
 * | 型つきの自由入力に `string` が無い | 識別子(メンバー ID・セッション ID)を自由入力にすると、他人の ID を渡せる。識別子は `from: row` の欄だけ |
 * | 本人の操作の `from: row` が、本人の読み(`actor: self` の `read`)の行から来る | 本人の操作が引数に取れる ID は、本人のセッションから導いた行のものだけ。別の人の行は取れない |
 * | `from: row` の `of` が宣言した読みなら、`kind: read` で `field` が返す欄に居る | 行の欄が実在しなければ、ボタンが渡す値が決まらない |
 * | `returns` が `shapes` に居る・欄名に秘密を指す語が無い | 返す欄は閉じた集合で、トークンなどを画面へ流さない(語彙は製品の `secret_field_words`。体系は語を持たない) |
 *
 * 配線先(`binding`)との**明示の対応表**(`params` / `result` / `platform_ports` / `shapes` の `row` と `fields`)の過不足・型の一致は `h9-platform-mapping.ts`、
 * 配線先の TypeScript の形(メソッド・引数・戻り値・結果の union の理由・行の型)との突合は `h9-platform-binding-source.ts`(構文木)が見る。
 * 宣言の無い製品は何も見ない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { AuthFlowSpec } from '../../model/auth/types.js';
import type { AuthPlatformOps, PlatformArg, PlatformOpDecl } from '../../model/auth/platform-ops.js';
import { findRole } from '../../semantics/domain-lookup.js';
import { verifyPlatformMapping } from './h9-platform-mapping.js';
import { verifyPlatformBindingSource } from './h9-platform-binding-source.js';
import type { PlatformBindingSource } from './h9-platform-binding-source.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H9';

/** H9 の指摘を組み立てる。 */
function h9(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { severity: 'error', verifier: VERIFIER_ID, ...args };
}

/**
 * `platform_ops` の閉世界を検証する。
 *
 * @param auth 読み込み済みの認証フロー仕様(null なら H0 が指摘済み)
 * @param domain ドメイン仕様(`actor.role` の実在を引く)
 * @param source 配線先を読む入力(実装の木と置き場の配置。省略は構文木との突合をしない —— 対応表の整合だけ)
 * @returns 違反のリスト
 */
export function verifyPlatformOps(auth: AuthFlowSpec | null, domain: SpecModel, source?: PlatformBindingSource): Finding[] {
  const section = auth?.platformOps;
  if (section === undefined) return [];
  return [
    ...checkUniqueness(section),
    ...verifyPlatformMapping(section),
    ...(source === undefined ? [] : verifyPlatformBindingSource(section, source)),
    ...section.ops.flatMap((op) => [...checkActor(op, domain), ...checkNeeds(op), ...checkReturns(op, section), ...op.args.flatMap((arg) => checkArg(op, arg, section))]),
    ...checkShapeWords(section),
  ];
}

/** id の重複・同じ配線先の重複。 */
function checkUniqueness(section: AuthPlatformOps): Finding[] {
  const findings: Finding[] = [];
  const ids = new Set<string>();
  const bindings = new Map<string, string>();
  for (const op of section.ops) {
    if (ids.has(op.id)) {
      findings.push(h9({ message: `操作 ${op.id} が重複しています`, location: op.location, suggestion: '重複した操作を消す(画面の platform_ops と配線の相手が 1 つに決まらない)', counterexample: { op: op.id } }));
    }
    ids.add(op.id);
    const target = `${op.binding.port}.${op.binding.method}`;
    const earlier = bindings.get(target);
    if (earlier !== undefined && earlier !== op.id) {
      findings.push(
        h9({
          message: `操作 ${op.id} は ${earlier} と同じ配線先 ${target} です`,
          location: op.location,
          suggestion: '操作ごとに別のメソッドへ配線する(同じメソッドを 2 つの操作が呼ぶと、権限表・確認の要否が宣言どおりに分けられない)',
          counterexample: { op: op.id, earlier, binding: target },
        }),
      );
    }
    bindings.set(target, earlier ?? op.id);
  }
  return findings;
}

/** `actor.role` が roles.md に実在する。 */
function checkActor(op: PlatformOpDecl, domain: SpecModel): Finding[] {
  if (op.actor.kind !== 'role' || findRole(domain, op.actor.role) !== null) return [];
  return [
    h9({
      message: `操作 ${op.id} の actor のロール ${op.actor.role} が roles.md にありません`,
      location: op.location,
      suggestion: 'specs/domain/roles.md に定義されたロール ID を書く(実行者の資格の正はロール。実在しないロールは誰も実行できない)',
      counterexample: { op: op.id, role: op.actor.role },
    }),
  ];
}

/** `needs: current_session` は本人の `do` だけ。 */
function checkNeeds(op: PlatformOpDecl): Finding[] {
  if (!op.needsCurrentSession || (op.actor.kind === 'self' && op.kind === 'do')) return [];
  return [
    h9({
      message: `操作 ${op.id} の needs: current_session は、本人(actor: self)の kind: do にだけ書けます`,
      location: op.location,
      suggestion: 'needs を消す(「いまの端末」は本人のセッションの概念。ロールの操作で自分を残すなら、keep_self のような型つきの入力で表す)',
      counterexample: { op: op.id, actor: op.actor.kind, kind: op.kind },
    }),
  ];
}

/** `returns` が `shapes` に居る。 */
function checkReturns(op: PlatformOpDecl, section: AuthPlatformOps): Finding[] {
  if (op.returns === undefined || section.shapes.some((shape) => shape.name === op.returns)) return [];
  return [
    h9({
      message: `読み ${op.id} の returns ${op.returns} が shapes にありません`,
      location: op.location,
      suggestion: `shapes に "${op.returns}: { fields: [...] }" を宣言する(返す欄は閉じた集合で宣言する。トークンなどの欄は宣言できない)`,
      counterexample: { op: op.id, returns: op.returns, shapes: section.shapes.map((shape) => shape.name).join(', ') },
    }),
  ];
}

/** 引数 1 つ。 */
function checkArg(op: PlatformOpDecl, arg: PlatformArg, section: AuthPlatformOps): Finding[] {
  if (arg.kind === 'typed') {
    return arg.type === 'string'
      ? [
          h9({
            message: `操作 ${op.id} の引数 ${arg.name} は string の自由入力です`,
            location: arg.location,
            suggestion: '識別子(メンバー ID・セッション ID)は "from: row" の欄だけから受ける(自由入力にすると他人の ID を渡せる)。文字列の入力が要るなら、型を bool / int にするか、入力の宣言を拡張する判断を先にする',
            counterexample: { op: op.id, arg: arg.name, actor: op.actor.kind },
          }),
        ]
      : [];
  }
  const source = section.ops.find((candidate) => candidate.id === arg.of);
  if (op.actor.kind === 'self' && (source === undefined || source.kind !== 'read' || source.actor.kind !== 'self')) {
    return [
      h9({
        message: `本人の操作 ${op.id} の引数 ${arg.name} の出どころ ${arg.of} が、本人の読み(actor: self の kind: read)ではありません`,
        location: arg.location,
        suggestion: '本人の操作が引数に取れるのは、本人のセッションから導いた行(actor: self の read の返す行)の欄だけ。別の人の行を出どころにしない',
        counterexample: { op: op.id, arg: arg.name, of: arg.of },
      }),
    ];
  }
  if (source === undefined) return []; // 出どころが query_spec の id なら、画面の reads に居ることを S20 が見る
  const fields = section.shapes.find((shape) => shape.name === source.returns)?.fields;
  if (source.kind !== 'read') {
    return [h9({ message: `操作 ${op.id} の引数 ${arg.name} の出どころ ${arg.of} は kind: read ではありません`, location: arg.location, suggestion: 'of には行を返す read の操作か、画面の reads の query_spec の id を書く', counterexample: { op: op.id, arg: arg.name, of: arg.of } })];
  }
  if (fields === undefined || fields.includes(arg.field)) return []; // shapes の欠落は returns の検査が言う
  return [
    h9({
      message: `操作 ${op.id} の引数 ${arg.name} の field ${arg.field} が、${arg.of} の返す欄にありません`,
      location: arg.location,
      suggestion: `field は ${source.returns ?? ''} の欄(${fields.join(' / ')})のどれかにする`,
      counterexample: { op: op.id, arg: arg.name, of: arg.of, field: arg.field },
    }),
  ];
}

/** 欄名に秘密を指す語(`secret_field_words`)を含む欄が無い。 */
function checkShapeWords(section: AuthPlatformOps): Finding[] {
  return section.shapes.flatMap((shape) =>
    shape.fields.flatMap((field) => {
      const word = section.secretWords.find((candidate) => field.toLowerCase().includes(candidate));
      return word === undefined
        ? []
        : [
            h9({
              message: `shapes の ${shape.name} の欄 ${field} は秘密を指す語 ${word} を含みます`,
              location: shape.location,
              suggestion: '画面へ返す欄にトークン・秘密を含めない(認証基盤の表の欄を絞る)。欄を消すか、秘密でない名前の別の欄にする',
              counterexample: { shape: shape.name, field, word },
            }),
          ];
    }),
  );
}
