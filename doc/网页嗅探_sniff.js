/**
 * Legado 内置浏览器「网页书籍嗅探」注入脚本（PoC / 可直接复用）
 *
 * 用法：在 WebViewActivity.onPageFinished 里
 *   webView.evaluateJavascript(SNIFF_JS) { value -> PageBookSniffer.analyze(value) }
 * 返回：JSON 字符串（evaluateJavascript 会再包一层 JSON 字符串，Kotlin 侧需两次解析）
 *
 * 结构：{ title, url, site, meta, chapters[], contentSelector, contentText, nextUrl, pageType }
 * 约束：只读 DOM，不改页面、不发请求；真正的落库由 Kotlin 侧完成。
 */
(function () {
  var CHAPTER_RE = /第\s*[0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节回卷集部篇]|序章|楔子|正文(?!完|结)|番外|尾声|后记|终章/;
  var NEXT_RE = /下一[页章节]|下页|next\s*(page|chapter)?/i;

  function absUrl(u) {
    try { return new URL(u, location.href).href; } catch (e) { return ''; }
  }
  function text(el) { return (el && (el.innerText || el.textContent) || '').trim(); }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s)
      : String(s).replace(/([^\w-])/g, '\\$1');
  }
  function cssPath(el) {
    if (!el) return null;
    if (el.id) return '#' + cssEscape(el.id);
    var parts = [], cur = el, guard = 0;
    while (cur && cur.nodeType === 1 && parts.length < 6 && guard++ < 20) {
      var seg = cur.tagName.toLowerCase();
      if (typeof cur.className === 'string' && cur.className.trim()) {
        var cls = cur.className.trim().split(/\s+/)
          .filter(function (c) { return /^[a-zA-Z][\w-]*$/.test(c); }).slice(0, 2);
        if (cls.length) seg += '.' + cls.map(cssEscape).join('.');
      }
      var p = cur.parentElement;
      if (p) {
        var same = [].filter.call(p.children, function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) seg += ':nth-of-type(' + ([].indexOf.call(same, cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = p;
    }
    return parts.join(' > ');
  }
  function metaContent(sel) {
    var el = document.querySelector(sel);
    return el ? (el.getAttribute('content') || text(el)).trim() : '';
  }

  // 1) 章节候选链接
  var seen = {}, chapters = [];
  var anchors = document.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length && chapters.length < 800; i++) {
    var a = anchors[i];
    var t = text(a).replace(/\s+/g, ' ').slice(0, 80);
    if (!t || !CHAPTER_RE.test(t)) continue;
    var u = absUrl(a.getAttribute('href'));
    if (!u || u.indexOf(location.origin) !== 0) continue;   // 只取同源，避免导航/广告
    if (u === location.href || seen[u]) continue;
    seen[u] = 1;
    chapters.push({ title: t, url: u });
  }

  // 2) 正文候选：文本密度最高的块（排除 nav/header/footer/script/style）
  var best = null, bestScore = 0;
  var blocks = document.querySelectorAll('div,article,section,main,td');
  for (var j = 0; j < blocks.length; j++) {
    var el = blocks[j];
    if (/^(nav|header|footer|aside|script|style)$/i.test(el.tagName)) continue;
    var body = text(el);
    if (body.length < 200) continue;
    var tags = el.getElementsByTagName('*').length || 1;
    var links = el.getElementsByTagName('a').length || 0;
    var score = body.length / Math.max(tags, 1) - links * 2;   // 惩罚链接密集区
    if (score > bestScore) { bestScore = score; best = el; }
  }

  // 3) 下一页 / 下一章
  var nextUrl = '';
  var nextEl = document.querySelector('a[rel=next]');
  if (!nextEl) {
    var all = document.querySelectorAll('a[href]');
    for (var k = 0; k < all.length; k++) {
      if (NEXT_RE.test(text(all[k]))) { nextEl = all[k]; break; }
    }
  }
  if (nextEl) nextUrl = absUrl(nextEl.getAttribute('href'));

  return JSON.stringify({
    title: document.title || '',
    url: location.href,
    site: location.origin,
    meta: {
      ogTitle: metaContent('meta[property="og:title"]'),
      description: metaContent('meta[name="description"]'),
      author: metaContent('meta[name="author"]'),
      h1: text(document.querySelector('h1')).slice(0, 120)
    },
    chapters: chapters,
    contentSelector: cssPath(best),
    contentText: best ? text(best).slice(0, 3000) : '',
    nextUrl: nextUrl,
    pageType: chapters.length >= 5 ? 'toc' : (best && text(best).length > 800 ? 'content' : 'unknown')
  });
})();
