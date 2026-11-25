# a(フロントマターなし)

[実在](./sub/b.md)
[アンカー付き実在](./sub/b.md#節)
[アンカー付きで先が無い](./sub/gone.md#節)
[クエリ付き実在](./sub/b.md?x=1)
[サイトルート](/sub/b.md)
[サイトルートで切れ](/sub/gone.md)
[ディレクトリ(README あり)](./dir/)
[ディレクトリ(README なし)](./nodir/)
[拡張子なし](./sub/b)
[パーセント符号](./sub/with%20space.md)
![切れた画像](./img/none.png)
[参照][r1]

[r1]: ./sub/gone-by-ref.md

[外部](https://example.com/x) [メール](mailto:a@example.com) [ページ内](#a)

```md
[コード内](./in-fence.md)
```

`[インライン](./in-inline.md)`
