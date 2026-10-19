"""Junta a exportação do banco da Central (uma pasta por coleção, um JSON por documento)
em migracao/dados.json, e lista as fotos que precisam ir para migracao/fotos/<id>.
Uso: python3 tools/montar_migracao.py <pasta_exportada> <email_dono>"""
import json,os,sys
src,dono=sys.argv[1],sys.argv[2].lower()
COLS=["solicitacoes","reservas","decisoes","chamados","chamados_gestao","bloqueios"]
out={"colecoes":{},"fotos":[],"papeis":{
  "gestores":["administrativo@protectepi.com.br","controladoria@protectepi.com.br","rh@protectepi.com.br","supplychain@protectepi.com.br"],
  "master":["gustavo@protectepi.com.br",dono],"extras":[dono]}}
for c in COLS:
    d=os.path.join(src,c);out["colecoes"][c]={}
    if not os.path.isdir(d):continue
    for f in sorted(os.listdir(d)):
        if f.endswith(".json"):
            doc=json.load(open(os.path.join(d,f),encoding="utf-8"));doc=doc.get("data",doc) if isinstance(doc,dict) and "data" in doc and isinstance(doc["data"],dict) else doc
            out["colecoes"][c][f[:-5]]=doc
            for k in ("fotos","imagens"):
                out["fotos"]+=[x for x in (doc.get(k) or []) if isinstance(x,str)]
out["fotos"]=sorted(set(out["fotos"]))
os.makedirs("migracao/fotos",exist_ok=True)
json.dump(out,open("migracao/dados.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print({c:len(v) for c,v in out["colecoes"].items()},"fotos:",len(out["fotos"]))
