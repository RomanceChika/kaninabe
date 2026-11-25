/**
 * PATH の濾し(`searchPathOutsideRoot`)の表。道具の側(`lib/io/safe-path.ts`)のユニットテストと、config:doctor の実行器の写し
 * (`app/scripts/config/probe-guard.ts`)との一致テストが同じ表を読む(7 回目 C7-3・C7-6)。根は `/r`、実体は `SEARCH_PATH_LINKS` の偽の表で引く。
 */

/** 偽の実体の表(リンクの代わり)。無い場所は投げる。 */
export const SEARCH_PATH_LINKS: Readonly<Record<string, string>> = {
  '/r': '/r',
  '/usr/bin': '/usr/bin',
  '/opt/homebrew/bin': '/opt/homebrew/bin',
  '/link-into-root': '/r/tools',
  '/link-into-modules': '/elsewhere/node_modules/x/bin',
  '/rx/bin': '/rx/bin',
  '/link-upper': '/R/tools',
  '/link-upper-modules': '/x/Node_Modules/y',
};

/**
 * 偽の実体の口。
 *
 * @param target 引くパス
 */
export function fakeRealpath(target: string): string {
  const found = SEARCH_PATH_LINKS[target];
  if (found === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return found;
}

/** [名前, PATH の要素, 残るもの]。 */
export const SEARCH_PATH_CASES: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ['人が入れた CLI の置き場は残す(順も)', ['/opt/homebrew/bin', '/usr/bin'], ['/opt/homebrew/bin', '/usr/bin']],
  ['製品の木の node_modules/.bin', ['/r/app/node_modules/.bin', '/usr/bin'], ['/usr/bin']],
  ['道具の木の node_modules/.bin(npm --prefix legacy/spec-tools run が足す)', ['/r/legacy/spec-tools/node_modules/.bin', '/usr/bin'], ['/usr/bin']],
  ['根より上の階層の node_modules/.bin', ['/home/u/node_modules/.bin', '/node_modules/.bin', '/usr/bin'], ['/usr/bin']],
  ['根の中の別の置き場', ['/r/bin', '/r', '/usr/bin'], ['/usr/bin']],
  ['空の要素・相対の要素(作業ディレクトリ = 根の中)', ['', '.', 'bin', './x', '/usr/bin'], ['/usr/bin']],
  ['リンクで根の中を指す', ['/link-into-root', '/usr/bin'], ['/usr/bin']],
  ['リンクで依存の置き場を指す', ['/link-into-modules', '/usr/bin'], ['/usr/bin']],
  ['綴りに .. を含んで根の中へ戻る', ['/usr/../r/bin', '/usr/bin'], ['/usr/bin']],
  ['根と接頭辞が同じだけの兄弟(/rx)は残す', ['/rx/bin'], ['/rx/bin']],
  ['無い場所は残す(実行ファイルを持たない)', ['/nope/bin'], ['/nope/bin']],
  ['大文字小文字だけ違う綴りの根の中(C7-3)', ['/R/bin', '/r/BIN', '/R', '/usr/bin'], ['/usr/bin']],
  ['全角の綴りの根の中(NFKC で畳む)', ['/ｒ/bin', '/usr/bin'], ['/usr/bin']],
  ['大文字の NODE_MODULES', ['/x/NODE_MODULES/.bin', '/usr/bin'], ['/usr/bin']],
  ['リンクの実体が大文字違いで根の中', ['/link-upper', '/usr/bin'], ['/usr/bin']],
  ['リンクの実体が大文字違いの依存の置き場', ['/link-upper-modules', '/usr/bin'], ['/usr/bin']],
  ['大文字違いの兄弟(/RX)は残す', ['/RX/bin'], ['/RX/bin']],
  ['全部落ちれば空', ['/r/bin', ''], []],
];

/**
 * 根の綴りを変える表(8 回目 C8-6: APFS は `ß` / `ẞ` を `ss` と同じ名前とみなす)。[名前, 根, PATH の要素, 残るもの]。
 * 根の実体は偽の表に無い(綴りで比べる)。
 */
export const SEARCH_PATH_ROOT_CASES: readonly (readonly [string, string, readonly string[], readonly string[]])[] = [
  ['根が ss で、PATH が ß の綴り', '/home/Jess/Repo', ['/home/Je\u00df/Repo/bin', '/usr/bin'], ['/usr/bin']],
  ['根が ss で、PATH が ẞ の綴り', '/home/Jess/Repo', ['/home/JE\u1e9e/Repo/bin', '/usr/bin'], ['/usr/bin']],
  ['根が ß で、PATH が SS の綴り', '/home/Je\u00df/Repo', ['/home/JESS/Repo/bin', '/usr/bin'], ['/usr/bin']],
  ['ß の綴りの node_modules ではないもの(畳んでも名前が違う)は残す', '/home/Jess/Repo', ['/home/Je\u00dfica/bin'], ['/home/Je\u00dfica/bin']],
  ['ss を含むだけの兄弟(/home/Jess/Repo2)は残す', '/home/Jess/Repo', ['/home/Je\u00df/Repo2/bin'], ['/home/Je\u00df/Repo2/bin']],
];
