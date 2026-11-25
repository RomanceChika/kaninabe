import { defineConfig } from 'vitepress'
import { withSidebar } from 'vitepress-sidebar'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { fileURLToPath } from 'node:url'
import { BOOK_MARKDOWN_OPTIONS } from './markdown-options'
import { SAFE_GRAY_MATTER_OPTIONS, assertNoExecutableFrontmatter } from './frontmatter-guard'
import { installBodyGuard } from './body-guard'

// vitepress-sidebar は自前の gray-matter で全 md の頭を読む(エンジンを渡せない)ので、読む前に gray-matter の既定のエンジンを
// 差し替え、言語指定つきの頭と VitePress の取り込み(<!--@include:-->。取り込みの先は既定の gray-matter で読まれる)を拒む。
assertNoExecutableFrontmatter(fileURLToPath(new URL('..', import.meta.url)))

export default withMermaid(withSidebar(
  defineConfig({
    title: 'kaninabe docs',
    description: '仕様駆動開発フレームワーク実験場のドキュメント体系 - ルール・仕様書',

    srcDir: '.',
    outDir: '.vitepress/dist',

    srcExclude: [
      '**/template.md',
      '**/template.*.md',
      'node_modules/**',
      '.vitepress/**',
    ],

    // README.md を index.md として扱う（ディレクトリリンク ./foo/ が foo/README.md を解決できるようにする）
    rewrites: {
      'README.md': 'index.md',
      ':path(.*)/README.md': ':path/index.md',
    },

    ignoreDeadLinks: true,

    // 開発サーバ(`vitepress dev`)の待ち受けは loopback だけに固定する(既定に頼らない)。外の機械から届く経路を閉じる。
    // 開発者のブラウザ経由の経路(別 origin の読み取り・DNS rebinding・WebSocket)は vite の CORS・Host・トークンの検査が断る。
    // 両方を実行で確かめる試験は legacy/spec-tools/__tests__/unit/theme/docs-dev-server.test.ts(受け入れ表 dependency-accepted.md の理由)。
    vite: { server: { host: '127.0.0.1' } },

    // 図の描画は strict に固定する(ラベルの HTML を無害化し、クリックの関数呼び出しと指令による設定の上書きを許さない)。
    mermaid: { securityLevel: 'strict' },

    markdown: {
      ...BOOK_MARKDOWN_OPTIONS,
      // VitePress 自身の gray-matter は js / coffee のエンジンを eval する。実行するエンジンを拒む。
      frontmatter: SAFE_GRAY_MATTER_OPTIONS,
      theme: { light: 'github-light', dark: 'github-dark' },
      // 本文の関所(C5-1): 本文は v-pre で包み、描画した本文の全ページを許可表に当てる(Vue の式・指令・SFC の
      // 巻き上げ・コード片の取り込み <<< を拒む)。mermaid の部品は withMermaid がこの関数の前に付ける。
      config: (md) => {
        installBodyGuard(md)
      },
    },

    themeConfig: {
      nav: [
        { text: 'ホーム', link: '/README' },
        {
          text: 'Rules',
          items: [
            { text: 'meta', link: '/rules/meta/README' },
            { text: 'principles', link: '/rules/principles/README' },
            { text: 'architecture', link: '/rules/architecture/README' },
            { text: 'process', link: '/rules/process/README' },
            { text: 'decisions', link: '/rules/decisions/README' }
          ]
        },
        { text: 'Specs', link: '/specs/README' }
      ],

      search: {
        provider: 'local',
        options: {
          locales: {
            root: {
              translations: {
                button: {
                  buttonText: '検索',
                  buttonAriaLabel: '検索'
                },
                modal: {
                  noResultsText: '結果が見つかりません',
                  resetButtonTitle: 'リセット',
                  footer: {
                    selectText: '選択',
                    navigateText: '移動',
                    closeText: '閉じる'
                  }
                }
              }
            }
          }
        }
      },

      lastUpdated: {
        text: '最終更新',
        formatOptions: {
          dateStyle: 'short',
          timeStyle: 'short'
        }
      },

      outline: {
        level: [2, 3],
        label: '目次'
      }
    }
  }),
  [
    {
      documentRootPath: '.',
      scanStartPath: 'rules',
      resolvePath: '/rules/',
      useTitleFromFileHeading: true,
      useFolderTitleFromIndexFile: true,
      useFolderLinkFromIndexFile: true,
      hyphenToSpace: true,
      capitalizeFirst: true,
      collapsed: true,
      excludeByGlobPattern: ['**/template.md', '**/template.*.md'],
      sortMenusByFrontmatterOrder: true,
      sortMenusOrderByDescending: false
    },
    {
      documentRootPath: '.',
      scanStartPath: 'specs',
      resolvePath: '/specs/',
      useTitleFromFileHeading: true,
      useFolderTitleFromIndexFile: true,
      useFolderLinkFromIndexFile: true,
      hyphenToSpace: true,
      capitalizeFirst: true,
      collapsed: true,
      excludeByGlobPattern: ['**/template.md', '**/template.*.md'],
      sortMenusByFrontmatterOrder: true,
      sortMenusOrderByDescending: false
    }
  ]
))
