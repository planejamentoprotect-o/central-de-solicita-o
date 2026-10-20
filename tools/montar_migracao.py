"""Junta a exportação do banco da Central (uma pasta por coleção, um JSON por documento)
num único arquivo migracao-central.json, já com as fotos dentro (data URL).
O arquivo tem dados pessoais: entregue direto ao dono, nunca coloque no repositório.
Uso: python3 tools/montar_migracao.py <pasta_exportada> <email_dono> <pasta_fotos> <arquivo_saida>"""
import base64,json,mimetypes,os,sys
src,dono,fotos_dir,saida=sys.argv[1],sys.argv[2].lower(),sys.argv[3],sys.argv[4]
COLS=["solicitacoes","reservas","decisoes","chamados","chamados_gestao","bloqueios"]
out={"colecoes":{},"fotos":[],"papeis":{
  "gestores":["administrativo@protectepi.com.br","controladoria@protectepi.com.br","rh@protectepi.com.br","supplychain@protectepi.com.br"],
  "master":["gustavo@protectepi.com.br","planejamento@protectepi.com.br",dono],"extras":[dono]}}
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
arquivos={os.path.splitext(f)[0]:f for f in os.listdir(fotos_dir)}
out["fotosData"]={};faltam=[]
for i in out["fotos"]:
    if i not in arquivos:faltam.append(i);continue
    f=os.path.join(fotos_dir,arquivos[i]);tipo=mimetypes.guess_type(f)[0] or "image/jpeg"
    out["fotosData"][i]="data:%s;base64,%s"%(tipo,base64.b64encode(open(f,"rb").read()).decode())
json.dump(out,open(saida,"w",encoding="utf-8"),ensure_ascii=False)
print({c:len(v) for c,v in out["colecoes"].items()},"fotos:",len(out["fotosData"]),"faltando:",faltam)
