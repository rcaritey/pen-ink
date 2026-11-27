# Builds the alternate version (/Reid2) from the main app, so fixes to the main app carry over.
# Run from the repo root:  python3 prep/ai/build.py
import re, pathlib
src = pathlib.Path('prep/new/index.html').read_text()
shim = """<script>
  // Version B keeps its own saved answers (prefixed "ai:"), started from a copy of version A's, so the two never mix.
  (function () { try {
    const P = 'ai:', S = Storage.prototype, g = S.getItem, s = S.setItem, r = S.removeItem;
    if (!g.call(localStorage, P + '__copied')) { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && !k.startsWith(P)) s.call(localStorage, P + k, g.call(localStorage, k)); } s.call(localStorage, P + '__copied', '1'); }
    S.getItem = function (k) { return g.call(this, P + k); }; S.setItem = function (k, v) { return s.call(this, P + k, v); }; S.removeItem = function (k) { return r.call(this, P + k); };
  } catch (e) { /* storage off: nothing to keep apart */ } })();
</script>"""
out = src.replace('<head>', '<head>\n' + shim, 1)
out = out.replace("indexedDB.open('wellheard-audio'", "indexedDB.open('wellheard-ai-audio'").replace("indexedDB.open('wellheard-papers'", "indexedDB.open('wellheard-ai-papers'")
out = re.sub(r'<title>(.*?)</title>', r'<title>\1 · Version B</title>', out, count=1)
v = str(abs(hash(pathlib.Path('prep/ai/alt.js').read_text())) % 10**8)
out = out.replace('</body>', f'<script src="/prep/ai/alt.js?v={v}"></script>\n</body>', 1)
pathlib.Path('prep/ai/index.html').write_text(out)
print('built prep/ai/index.html')
