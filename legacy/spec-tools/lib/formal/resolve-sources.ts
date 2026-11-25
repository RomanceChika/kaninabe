/**
 * 写し元の宣言を**実ファイルへ解決する**段取り(C24 の第 1 段の I/O 側)。
 *
 * `SOURCE:` はパスの**閉包**(そのファイルと相対 import の推移的閉包。`semantics/import-closure.ts`)を、
 * `SOURCE-FN:` は**その関数を定義する最新番号の migration**(1 本の本文)を解決する。
 * どちらの形かを知っているのはここだけで、判定は `source-lines.ts` が持つ。
 */

import { computeClosure, sha256Of } from '../semantics/import-closure.js';
import type { ClosureFile, SourceReader } from '../semantics/import-closure.js';
import type { MigrationFile } from './migration-function.js';
import { latestDefinition } from './migration-function.js';
import type { ResolvedSource } from './source-lines.js';
import type { SourceDeclaration } from './types.js';
import { sourceAliasOf } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import { migrationPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/** 解決に要る I/O。 */
export interface SourceIo {
  /** リポジトリルート相対のパス → 本文(読めなければ null)。 */
  readonly read: SourceReader;
  /**
   * 宣言された hash を作った時点の閉包のファイル(旧い側)を復元する。復元できなければ null。
   * **hash が食い違ったときだけ**呼ぶ(動いたファイルを名指すための材料。git の履歴から引く)。
   * 閉包の辿り方(`@/…` の行き先)は作業ツリー側と同じでなければならない(呼び出し側が根を渡す)。
   */
  readonly recall: (declaration: SourceDeclaration) => readonly ClosureFile[] | null;
}

/** `SOURCE:` 1 件を閉包へ解決する(食い違うときだけ旧い閉包を復元して付ける。`@/…` は実装の木に解く)。 */
function resolvePath(declaration: SourceDeclaration, io: SourceIo, roots: ProductRoots, layout: ProductLayout): ResolvedSource {
  const closure = computeClosure(declaration.target, io.read, sourceAliasOf(layout, roots));
  if (closure === null) return { kind: 'missing', reason: 'そのパスにファイルがありません' };
  const broken = closure.unresolved[0];
  if (broken !== undefined) {
    return {
      kind: 'missing',
      reason: `閉包を辿れません(${broken.from} の import「${broken.specifier}」に実体がありません。ほか ${closure.unresolved.length - 1} 件)`,
    };
  }
  const fresh = { kind: 'ok' as const, path: declaration.target, sha256: closure.hash, closure: closure.files };
  return closure.hash === declaration.sha256 ? fresh : { ...fresh, previous: io.recall(declaration) };
}

/**
 * 宣言の並びを解決する。
 *
 * @param declarations `.tla` から読み取った宣言
 * @param migrations 読み込んだ migration の並び(`SOURCE-FN:` の解決に使う)
 * @param io 本文を読む口と、旧い閉包を復元する口
 * @param roots 製品が宣言した根(migration の置き場・実装の木の位置)
 * @param layout 置き場の配置(閉包の別名の import `@/…` の綴りと行き先 = 実装のソースの根を引く。アプリの枠の後段が与える)
 * @returns 宣言の target → 解決結果
 */
export function resolveSources(
  declarations: readonly SourceDeclaration[],
  migrations: readonly MigrationFile[],
  io: SourceIo,
  roots: ProductRoots,
  layout: ProductLayout,
): Map<string, ResolvedSource> {
  const resolved = new Map<string, ResolvedSource>();
  for (const declaration of declarations) {
    if (declaration.kind === 'path') {
      resolved.set(declaration.target, resolvePath(declaration, io, roots, layout));
      continue;
    }
    const file = latestDefinition(migrations, declaration.target);
    if (file === null) {
      resolved.set(declaration.target, {
        kind: 'missing',
        reason: 'その関数を create (or replace) function で定義する migration が 1 本もありません',
      });
      continue;
    }
    const relative = migrationPath(roots, file);
    const text = io.read(relative);
    resolved.set(
      declaration.target,
      text === null
        ? { kind: 'missing', reason: `${relative} を読めません` }
        : { kind: 'ok', path: relative, sha256: sha256Of(text) },
    );
  }
  return resolved;
}
