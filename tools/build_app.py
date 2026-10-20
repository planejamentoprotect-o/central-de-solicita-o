"""Gera o index.html do app a partir do HTML da Central publicada no claude.ai.
Uso: python3 tools/build_app.py caminho/da/central.html index.html"""
import sys
src,out=sys.argv[1],sys.argv[2]
s=open(src,encoding="utf-8").read()
def rep(o,n,c=1):
    global s
    assert s.count(o)==c,(o[:80],s.count(o));s=s.replace(o,n)
cut=s.index('<div id="splash"')
head,body=s[:cut],s[cut:]
FB="https://www.gstatic.com/firebasejs/10.12.2/"
head=f'''<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0D1512">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Central Protect">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
'''+(head if 'Montserrat' in head else head.replace('family=IBM+Plex+Mono:wght@400;500&','family=IBM+Plex+Mono:wght@400;500&family=Montserrat:wght@800&',1))
head+='''<style>
/* Tela de login do app */
#app-login{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:16px;background:radial-gradient(ellipse at 50% 35%,#12261c 0%,var(--bg) 70%)}
#app-login[hidden]{display:none}
.al-card{width:min(380px,100%);background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:26px 24px;display:grid;gap:8px;box-shadow:var(--shadow)}
.al-mark{position:relative;width:170px;aspect-ratio:320/140;margin:0 auto 6px}
.al-mark svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.al-mark path{fill:none;stroke:#13A35E;stroke-width:13;stroke-linecap:round}
.al-mark b{position:absolute;inset:0;display:grid;place-items:center;font-family:"Montserrat",var(--f-body);font-weight:800;font-size:30px;color:#F2F7F4}
.al-card h1{font-family:var(--f-display);font-size:24px;text-align:center;margin:0}
.al-sub{text-align:center;color:var(--muted);font-size:14px;margin:0 0 8px}
.al-card label{font-size:13px;font-weight:600;margin-top:6px}
.al-card input{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:11px 12px;min-height:44px;font:inherit}
.al-msg{min-height:1.2em;margin:4px 0 0;font-size:13px;color:var(--alta)}.al-msg.ok{color:var(--ok)}
.al-btn{margin-top:6px;min-height:46px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:700;cursor:pointer}
.al-btn:disabled{opacity:.6}
.al-links{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px}
.al-links button{background:none;border:0;color:var(--accent);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}
#who{cursor:pointer}
@media (display-mode: standalone){body{padding-top:env(safe-area-inset-top)}}
</style>
<script src="'''+FB+'''firebase-app-compat.js"></script>
<script src="'''+FB+'''firebase-auth-compat.js"></script>
<script src="'''+FB+'''firebase-firestore-compat.js"></script>
<script src="config.js"></script>
<script src="app.js"></script>
</head><body>
'''
s=body
# fotos: vêm do Firestore; o app.js preenche os elementos com data-foto
s=s.replace('href="/_blob/${esc(id)}"','href="${esc(blobUrl(id))}" data-foto="${esc(id)}"').replace('src="/_blob/${esc(id)}"','src="${esc(blobUrl(id))}" data-foto="${esc(id)}"')
assert "/_blob/" not in s
# aba Painel de Gestão sempre visível (o login fica dentro dela); só abre sozinha para quem já entrou como gestor
rep('if(store("aba")==="gestao")setView("gestao");','if(store("aba")==="gestao"&&window.__APP?.papel)setView("gestao");')
rep('$("#g-sair").onclick=()=>{','$("#g-sair").onclick=()=>{if(window.appSair){window.appSair();return}')
# pílula do topo: mostra o e-mail e permite sair
rep('$("#whoTxt").textContent=!db?"Não conectado":"Conectado";','$("#whoTxt").textContent=!db?"Não conectado":(window.__APP?.email||"Conectado");if(window.appSair&&window.__APP?.email){$("#who").onclick=()=>{if(confirm("Sair da conta de gestão?"))window.appSair()};$("#who").title="Clique para sair"}')
# protocolo dos chamados: contador no banco (o solicitante não lê os chamados dos outros)
rep('const snap=await S.db.collection("chamados").get();\n    const seq=snap.docs.reduce((m,x)=>{const k=/^CH-(\\d+)-(\\d+)$/.exec(x.id);return k&&+k[1]===ano?Math.max(m,+k[2]):m},0)+1;',
    'const seq=await S.db.runTransaction(async tx=>{const r=S.db.doc("contadores/chamados_"+ano),c=await tx.get(r),n=(c.exists?c.data().n:0)+1;tx.set(r,{n});return n});')
# e-mail do autor junto do id (ajuda a vincular contas e a migrar)
s=s.replace('autor:S.uid||null','autor:S.uid||null,autorEmail:window.__APP?.email||null')
s+='\n</body></html>\n'
open(out,"w",encoding="utf-8").write(head+s)
print("ok",len(head+s))
