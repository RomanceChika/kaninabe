/**
 * 本の HTML が読む、ただ 1 つの script(`assets/book.js` として書き出す)。
 *
 * 本は script が無くても全部読める(折りたたみは `<details>`、用語の説明は CSS で出る)。script が足すのは 3 つだけ:
 *
 * - **表示モード**(ざっくり / くわしく / レビューする): `data-mode-open` を持つ折りたたみを、モードに合わせて開け閉めする。
 *   人が自分で開け閉めした折りたたみは、そのページの間はモードで動かさない。
 * - **暗い面の切り替え**: `html` の `dark` クラス。既定は端末の設定。
 * - **全文検索**: 上の帯に入力欄を足す。索引(`assets/search.json`)は入力欄を最初に触ったときに `fetch` で読み、一致した節を一覧に出す。
 *   要素は DOM の API だけで作り、索引の字は `textContent` で置く(`innerHTML` は使わない)。`file://` では `fetch` が通らないので、その旨を一行で出す。
 *
 * 表示モードと暗い面は、選んだ値を `localStorage` に覚える(読めない環境では既定のまま)。ページの内容(仕様の文字列)は読まず、
 * 生成器が付けた `data-*` の属性(検索の索引への前置きは帯の `data-root`)と、固定のクラス名だけを読む。CSP は `script-src 'self'` なので、インラインの script は置かない。
 * **アプリの語彙は 1 語も持たない。**
 */

/** 書き出す script の本文(生成器の定数。仕様の文字列は入らない)。 */
export const BOOK_CLIENT_SCRIPT = `// このファイルは全体が生成物である(npm run generate が全置換する)。手で編集しない。
(function () {
  'use strict';
  var MODE_KEY = 'book-display-mode';
  var THEME_KEY = 'book-theme';
  var MODES = ['brief', 'full', 'sign'];
  var root = document.documentElement;

  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 覚えられなくても読める */ }
  }

  // 暗い面
  function applyTheme(dark) {
    root.classList.toggle('dark', dark);
    var button = document.querySelector('.bf-theme');
    if (button) button.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  var savedTheme = load(THEME_KEY);
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme === null ? prefersDark : savedTheme === 'dark');

  document.addEventListener('DOMContentLoaded', function () {
    var themeButton = document.querySelector('.bf-theme');
    if (themeButton) {
      themeButton.hidden = false;
      applyTheme(root.classList.contains('dark'));
      themeButton.addEventListener('click', function () {
        var next = !root.classList.contains('dark');
        applyTheme(next);
        save(THEME_KEY, next ? 'dark' : 'light');
      });
    }

    // 全文検索(索引 assets/search.json は最初に入力欄を触ったときに読む。要素は DOM の API だけで作る)
    var bar = document.querySelector('.bf-bar');
    var tools = document.querySelector('.bf-bar-tools');
    if (bar && tools) {
      var base = bar.getAttribute('data-root') || './';
      var LIMIT = 20;
      var NOTE_FAILED = '検索は \`npm run book:open\` で開いたときだけ使える。';
      var index = null;
      var loading = false;
      var failed = false;
      var shown = [];
      var cursor = -1;

      var box = document.createElement('div');
      box.className = 'bf-search';
      var input = document.createElement('input');
      input.type = 'search';
      input.className = 'bf-search-input';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', '本の中を探す');
      input.setAttribute('placeholder', '本の中を探す( / )');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', 'bf-search-list');
      var panel = document.createElement('div');
      panel.className = 'bf-search-panel';
      panel.hidden = true;
      var list = document.createElement('ul');
      list.className = 'bf-search-list';
      list.id = 'bf-search-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', '検索の結果');
      var note = document.createElement('p');
      note.className = 'bf-search-note';
      note.hidden = true;
      panel.appendChild(list);
      panel.appendChild(note);
      box.appendChild(input);
      box.appendChild(panel);
      tools.insertBefore(box, tools.firstChild);

      function closePanel() {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        cursor = -1;
      }
      function openPanel() {
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }
      function setCursor(next) {
        var items = list.children;
        if (cursor >= 0 && items[cursor]) items[cursor].setAttribute('aria-selected', 'false');
        cursor = next;
        if (cursor >= 0 && items[cursor]) {
          items[cursor].setAttribute('aria-selected', 'true');
          input.setAttribute('aria-activedescendant', items[cursor].id);
          if (items[cursor].scrollIntoView) items[cursor].scrollIntoView({ block: 'nearest' });
        } else {
          input.removeAttribute('aria-activedescendant');
        }
      }
      function snippet(text, terms) {
        var lower = text.toLowerCase();
        var at = -1;
        for (var i = 0; i < terms.length && at < 0; i++) at = lower.indexOf(terms[i]);
        if (at < 0) return text.slice(0, 80);
        var from = Math.max(0, at - 20);
        return (from > 0 ? '…' : '') + text.slice(from, from + 80) + (from + 80 < text.length ? '…' : '');
      }
      function search(query) {
        var whole = query.toLowerCase();
        var terms = whole.split(/\\s+/).filter(function (term) { return term !== ''; });
        var head = [];
        var rest = [];
        for (var i = 0; i < index.length && head.length < LIMIT; i++) {
          var item = index[i];
          var title = (item.page + ' ' + item.heading).toLowerCase();
          var all = title + ' ' + item.text.toLowerCase();
          var hit = all.indexOf(whole) >= 0 || terms.every(function (term) { return all.indexOf(term) >= 0; });
          if (!hit) continue;
          (title.indexOf(whole) >= 0 ? head : rest).push(item);
        }
        return head.concat(rest).slice(0, LIMIT).map(function (item) { return { item: item, terms: terms }; });
      }
      function render() {
        var query = input.value.trim();
        while (list.firstChild) list.removeChild(list.firstChild);
        shown = [];
        cursor = -1;
        input.removeAttribute('aria-activedescendant');
        note.hidden = true;
        if (query === '') { closePanel(); return; }
        if (failed) {
          note.textContent = NOTE_FAILED;
          note.hidden = false;
          openPanel();
          return;
        }
        if (index === null) { closePanel(); return; }
        shown = search(query);
        if (shown.length === 0) {
          note.textContent = '見つからなかった。';
          note.hidden = false;
        }
        shown.forEach(function (found, position) {
          var li = document.createElement('li');
          li.id = 'bf-search-option-' + position;
          li.className = 'bf-search-item';
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          var link = document.createElement('a');
          link.className = 'bf-search-link';
          link.href = base + found.item.href;
          link.tabIndex = -1;
          var page = document.createElement('span');
          page.className = 'bf-search-page';
          page.textContent = found.item.page;
          link.appendChild(page);
          if (found.item.heading !== '' && found.item.heading !== found.item.page) {
            var heading = document.createElement('span');
            heading.className = 'bf-search-heading';
            heading.textContent = found.item.heading;
            link.appendChild(heading);
          }
          var excerpt = snippet(found.item.text, found.terms);
          if (excerpt !== '') {
            var text = document.createElement('span');
            text.className = 'bf-search-snippet';
            text.textContent = excerpt;
            link.appendChild(text);
          }
          li.appendChild(link);
          list.appendChild(li);
        });
        openPanel();
      }
      function load() {
        if (index !== null || loading || failed) return;
        loading = true;
        fetch(base + 'assets/search.json')
          .then(function (response) {
            if (!response.ok) throw new Error('status');
            return response.json();
          })
          .then(function (data) {
            if (!Array.isArray(data)) throw new Error('shape');
            index = data;
            loading = false;
            render();
          })
          .catch(function () {
            failed = true;
            loading = false;
            render();
          });
      }
      function go(position) {
        var found = shown[position];
        if (found) window.location.href = base + found.item.href;
      }

      input.addEventListener('focus', function () { load(); if (input.value.trim() !== '') render(); });
      input.addEventListener('input', function () { load(); render(); });
      input.addEventListener('keydown', function (event) {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (shown.length === 0) return;
          event.preventDefault();
          if (panel.hidden) openPanel();
          var step = event.key === 'ArrowDown' ? 1 : -1;
          setCursor(cursor < 0 ? (step > 0 ? 0 : shown.length - 1) : (cursor + step + shown.length) % shown.length);
        } else if (event.key === 'Enter') {
          if (shown.length === 0) return;
          event.preventDefault();
          go(cursor >= 0 ? cursor : 0);
        } else if (event.key === 'Escape') {
          if (!panel.hidden) { event.preventDefault(); closePanel(); }
        }
      });
      document.addEventListener('click', function (event) {
        if (!box.contains(event.target)) closePanel();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
        var target = event.target;
        var tag = target && target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
        event.preventDefault();
        input.focus();
      });
    }

    // 表示モード
    var folds = Array.prototype.slice.call(document.querySelectorAll('details.bf-fold'));
    var touched = new WeakSet();
    var applying = false;
    folds.forEach(function (fold) {
      fold.addEventListener('toggle', function () { if (!applying) touched.add(fold); });
    });
    function opens(mode, fold) {
      if (fold.hasAttribute('data-default-open')) return true;
      var kind = fold.getAttribute('data-kind');
      if (mode === 'full') return true;
      if (mode === 'sign') return kind === 'sign';
      return false;
    }
    function applyMode(mode) {
      applying = true;
      folds.forEach(function (fold) { if (!touched.has(fold)) fold.open = opens(mode, fold); });
      applying = false;
      Array.prototype.forEach.call(document.querySelectorAll('.bf-mode-button'), function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-mode') === mode ? 'true' : 'false');
      });
    }
    var savedMode = load(MODE_KEY);
    var current = MODES.indexOf(savedMode) >= 0 ? savedMode : 'brief';
    Array.prototype.forEach.call(document.querySelectorAll('.bf-mode'), function (group) { group.hidden = false; });
    Array.prototype.forEach.call(document.querySelectorAll('.bf-mode-button'), function (button) {
      button.addEventListener('click', function () {
        var mode = button.getAttribute('data-mode');
        if (MODES.indexOf(mode) < 0) return;
        save(MODE_KEY, mode);
        applyMode(mode);
      });
    });
    applyMode(current);
  });
})();
`;
