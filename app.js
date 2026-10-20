/* Central de Solicitações (Protect EPI) como app independente.
   Este arquivo liga a página ao Firebase (login e banco Firestore, onde ficam também as fotos)
   e expõe a mesma interface window.claude.use(...) que a página já usava no claude.ai,
   para que o código da Central rode quase sem mudanças. */
(function(){
  const cfg=window.FIREBASE_CONFIG;
  const $=s=>document.querySelector(s);
  const DOMINIO="@protectepi.com.br";
  const FORA_DO_DOMINIO=["planejamentoprotect@gmail.com"]; // e-mails de fora da Protect que podem criar conta (dono do app)
  const DONO="planejamentoprotect@gmail.com";
  const DONOS=[DONO,"planejamento@protectepi.com.br"]; // contas que podem criar/atualizar a lista padrão de papéis
  const PAPEIS_VERSAO=2; // aumente ao mudar a lista abaixo
  const PAPEIS_INICIAIS={
    gestores:["administrativo@protectepi.com.br","controladoria@protectepi.com.br","rh@protectepi.com.br","supplychain@protectepi.com.br"],
    master:["gustavo@protectepi.com.br","planejamento@protectepi.com.br",DONO],extras:[DONO]};

  if(!cfg||!cfg.apiKey||String(cfg.apiKey).startsWith("COLE")){
    document.addEventListener("DOMContentLoaded",()=>mostraLogin("Configuração do Firebase ausente. Preencha o arquivo config.js.",true));
    return;
  }
  firebase.initializeApp(cfg);
  const auth=firebase.auth(),fs=firebase.firestore();
  try{fs.settings({ignoreUndefinedProperties:true,merge:true})}catch(e){}
  try{fs.enablePersistence({synchronizeTabs:true}).catch(()=>{})}catch(e){}

  /* Trava curta (lease) usada para evitar duas reservas iguais ao mesmo tempo. */
  firebase.firestore.DocumentReference.prototype.acquire=async function({holder,ttlMs}){
    const ref=this;
    return fs.runTransaction(async tx=>{
      const s=await tx.get(ref);const agora=Date.now();const d=s.exists?s.data():null;
      if(d&&d.holder!==holder&&d.ate>agora)return{acquired:false};
      tx.set(ref,{holder,ate:agora+ttlMs});return{acquired:true};
    });
  };

  /* Fotos: ficam no próprio Firestore (coleção fotos/{id}), como JPEG reduzido, para não precisar do Storage (pago).
     A página continua guardando só o id; as imagens com data-foto são preenchidas assim que a foto chega. */
  const LIMITE=900000; // cada documento do Firestore aceita até ~1 MB
  const VAZIA="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const cacheFoto=new Map(); // id -> blob: URL (ou Promise enquanto carrega)
  window.blobUrl=id=>{const u=cacheFoto.get(id);return typeof u==="string"?u:VAZIA};
  const novoId=()=>{const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")};
  const paraDataUrl=b=>new Promise((ok,erro)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=erro;r.readAsDataURL(b)});
  async function reduz(blob){
    let bmp;try{bmp=await createImageBitmap(blob)}catch(e){const d=await paraDataUrl(blob);if(d.length<=LIMITE)return d;throw new Error("Imagem grande demais.")}
    for(const [lado,q] of [[1600,.8],[1280,.75],[1024,.7],[800,.65],[640,.6],[480,.55]]){
      const k=Math.min(1,lado/Math.max(bmp.width,bmp.height)),c=document.createElement("canvas");
      c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
      const d=c.toDataURL("image/jpeg",q);if(d.length<=LIMITE)return d;
    }
    throw new Error("Imagem grande demais.");
  }
  window.salvaFoto=async(id,blob)=>{const data=await reduz(blob);await fs.doc("fotos/"+id).set({data,criadoEm:Date.now(),por:auth.currentUser?.uid||null});return id};
  const assets={async upload(blob){const id=novoId();await window.salvaFoto(id,blob);return{id,url:VAZIA}}};
  function carregaFoto(id){
    let u=cacheFoto.get(id);if(u)return Promise.resolve(u);
    u=fs.doc("fotos/"+id).get().then(async s=>{if(!s.exists)throw new Error("sem foto");const b=await (await fetch(s.data().data)).blob();const url=URL.createObjectURL(b);cacheFoto.set(id,url);return url}).catch(e=>{cacheFoto.delete(id);throw e});
    cacheFoto.set(id,u);return u;
  }
  function preencheFotos(raiz){
    (raiz.querySelectorAll?raiz:document).querySelectorAll("[data-foto]").forEach(el=>{
      const id=el.getAttribute("data-foto");if(el.dataset.fotoOk===id)return;el.dataset.fotoOk=id;
      carregaFoto(id).then(url=>{if(el.tagName==="IMG")el.src=url;else el.href=url}).catch(()=>{if(el.tagName==="IMG")el.alt="Foto indisponível"});
    });
  }
  new MutationObserver(()=>preencheFotos(document)).observe(document.documentElement,{childList:true,subtree:true});

  const downloads={async save({filename,data,mimeType}){
    const b=new Blob([data],{type:mimeType||"application/octet-stream"});const u=URL.createObjectURL(b);
    const a=document.createElement("a");a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);
  }};

  let papel=null; // null | "gestor" | "master"
  /* Aceita a lista de papéis mesmo se foi editada à mão no Firebase (nome em maiúsculas, item solto, mapa 0/1/2...). */
  function normalizaPapeis(d){
    const lista=v=>Array.isArray(v)?v:typeof v==="string"?[v]:v&&typeof v==="object"?Object.values(v):[];
    const out={versaoPadrao:d.versaoPadrao||0,master:[],gestores:[],extras:[]};
    for(const [k,v] of Object.entries(d||{})){const c=k.toLowerCase().trim();
      const alvo=c.startsWith("master")?"master":c.startsWith("gestor")?"gestores":c.startsWith("extra")?"extras":null;
      if(alvo)out[alvo].push(...lista(v).filter(x=>typeof x==="string").map(x=>x.trim().toLowerCase()))}
    for(const k of ["master","gestores","extras"])out[k]=[...new Set(out[k])];
    return out;
  }
  /* Solicitante (sem login) só lê os próprios pedidos e chamados; a gestão lê tudo. */
  const PRIVADAS=new Set(["solicitacoes","chamados"]);
  const db=new Proxy(fs,{get(t,k){
    if(k==="doc")return caminho=>{const r=t.doc(caminho);return /^(decisoes|chamados_gestao)\/[^/]+$/.test(caminho)&&papel?comAviso(r,caminho):r};
    if(k==="collection")return n=>{const c=t.collection(n);if(!PRIVADAS.has(n)||papel)return c;
      const meus=()=>c.where("autor","==",auth.currentUser?.uid||"-");
      return{doc:(...a)=>c.doc(...a),where:(...a)=>meus().where(...a),get:(...a)=>meus().get(...a),onSnapshot:(...a)=>meus().onSnapshot(...a)}};
    const v=t[k];return typeof v==="function"?v.bind(t):v}});
  const user={id:async()=>auth.currentUser?.uid||null,canEdit:async()=>!!papel,can:async()=>true,email:()=>auth.currentUser?.email||""};

  let pronto;const prontoP=new Promise(r=>pronto=r);
  window.claude={use:async n=>{await prontoP;return n==="db"?db:n==="user"?user:n==="assets"?assets:n==="downloads"?downloads:null}};

  /* Solicitantes entram sem login (conta anônima do Firebase, guardada no navegador).
     Só a gestão usa e-mail e senha, pelo formulário dentro da aba Painel de Gestão. */
  let iniciado=false;
  auth.onAuthStateChanged(async u=>{
    if(iniciado){location.reload();return} // trocou de conta (entrou ou saiu da gestão)
    if(u&&await confirmaLinkEmail(u))return;
    if(!u){try{await auth.signInAnonymously()}catch(e){mostraLogin("Não foi possível abrir a Central ("+(e.code||e.message)+"). Ative o login Anônimo no Firebase.",true)}return}
    if(!u.isAnonymous&&!u.emailVerified){mostraVerificacao(u);return}
    papel=null;let e=null;
    if(!u.isAnonymous){
      e=u.email.toLowerCase();
      let erro="";
      try{
        const ref=fs.doc("config/papeis"),p=await ref.get();let m=normalizaPapeis(p.exists?p.data():{});
        /* Quando um dono entra e a lista padrão mudou (PAPEIS_VERSAO), acrescenta os papéis padrão sem tirar os que já existem
           e regrava a lista no formato certo (campos master/gestores/extras em minúsculas, como listas). */
        if(DONOS.includes(e)&&(m.versaoPadrao||0)<PAPEIS_VERSAO){
          const n={...m,versaoPadrao:PAPEIS_VERSAO};
          for(const [k,l] of Object.entries(PAPEIS_INICIAIS))n[k]=[...new Set([...(n[k]||[]),...l])];
          m=n;try{await ref.set(n)}catch(x){erro="não consegui gravar a lista: "+(x.code||x.message)}
        }
        papel=m.master.includes(e)?"master":m.gestores.includes(e)?"gestor":null;
        /* Dono sempre entra como master (mesmo que a gravação da lista falhe). */
        if(!papel&&DONOS.includes(e))papel="master";
      }catch(x){papel=DONOS.includes(e)?"master":null;erro=x.code||x.message}
      if(erro)console.warn("Papéis:",erro);
      let viaGestao=false;try{viaGestao=sessionStorage.getItem("viaGestao")==="1";sessionStorage.removeItem("viaGestao")}catch(x){}
      if(!papel&&viaGestao){try{sessionStorage.setItem("gestaoMsg","A conta "+e+" não tem acesso ao Painel de Gestão."+(erro?" ("+erro+")":""))}catch(x){}await auth.signOut();return}
    }
    try{if(papel){sessionStorage.setItem("gestor",papel);sessionStorage.setItem("gestorConta",e)}else{sessionStorage.removeItem("gestor");sessionStorage.removeItem("gestorConta")}}catch(x){}
    window.__APP={email:e,papel,anonimo:u.isAnonymous};
    escondeLogin();
    document.documentElement.classList.toggle("app-gestor",!!papel);
    iniciado=true;pronto();
    preparaLoginGestao();
    if(!papel)barraEmail(u);
  });

  window.appSair=async()=>{try{sessionStorage.clear();localStorage.setItem("aba","manutencao")}catch(e){}await auth.signOut()};

  /* ---------- E-mail do solicitante (confirmado uma vez por link, sem senha) ---------- */
  const voltaLink=()=>location.origin+location.pathname;
  async function confirmaLinkEmail(u){
    if(!auth.isSignInWithEmailLink(location.href))return false;
    let email="";try{email=localStorage.getItem("emailParaLink")||""}catch(x){}
    if(!email)email=(prompt("Confirme o seu e-mail para concluir:")||"").trim().toLowerCase();
    const limpa=()=>history.replaceState(null,"",voltaLink());
    if(!email){limpa();return false}
    try{
      const cred=firebase.auth.EmailAuthProvider.credentialWithLink(email,location.href);
      /* Conta anônima vira a conta do e-mail: os pedidos já feitos neste navegador continuam dela. */
      if(u.isAnonymous){try{await u.linkWithCredential(cred)}catch(x){if(x.code==="auth/credential-already-in-use"||x.code==="auth/email-already-in-use")await auth.signInWithCredential(cred);else throw x}}
      else await auth.signInWithEmailLink(email,location.href);
      try{localStorage.removeItem("emailParaLink");sessionStorage.setItem("emailOk",email)}catch(x){}
    }catch(x){try{sessionStorage.setItem("emailErro",traduz(x))}catch(y){}}
    limpa();location.reload();return true;
  }
  function barraEmail(u){
    if($("#email-bar"))return;
    const b=document.createElement("div");b.id="email-bar";b.className="panel";
    const ref=$("#banner");if(!ref)return;ref.after(b);
    let ok="",erro="";try{ok=sessionStorage.getItem("emailOk")||"";erro=sessionStorage.getItem("emailErro")||"";sessionStorage.removeItem("emailOk");sessionStorage.removeItem("emailErro")}catch(x){}
    const esc=t=>String(t).replace(/[<>&"]/g,"");
    if(!u.isAnonymous&&u.email){
      const e=u.email.toLowerCase();
      fs.doc("contatos/"+u.uid).set({email:e,em:Date.now()}).catch(()=>{});
      b.innerHTML=`<p class="eb-txt">${ok?"E-mail confirmado. ":""}As atualizações dos seus pedidos vão para <b>${esc(e)}</b>.</p><button type="button" class="eb-link" id="eb-trocar">Usar outro e-mail</button>`;
      $("#eb-trocar").onclick=()=>{if(confirm("Sair deste e-mail? Os pedidos dele deixam de aparecer aqui até você confirmar de novo."))window.appSair()};
      return;
    }
    let fechado=false;try{fechado=localStorage.getItem("emailBarFechada")==="1"}catch(x){}
    if(fechado&&!erro){b.remove();return}
    b.innerHTML=`<form class="eb-form" novalidate><p class="eb-txt"><b>Receba as atualizações por e-mail.</b> Confirme seu e-mail da Protect uma vez e veja seus pedidos em qualquer aparelho.</p>
      <div class="eb-row"><input type="email" id="eb-email" placeholder="nome@protectepi.com.br" autocomplete="email"><button class="btn primary" id="eb-btn" type="submit">Enviar link</button><button type="button" class="eb-link" id="eb-fechar">Agora não</button></div>
      <p class="eb-msg" id="eb-msg" role="status">${esc(erro)}</p></form>`;
    const m=$("#eb-msg");
    $("#eb-fechar").onclick=()=>{try{localStorage.setItem("emailBarFechada","1")}catch(x){}b.remove()};
    b.querySelector("form").onsubmit=async ev=>{ev.preventDefault();let e=$("#eb-email").value.trim().toLowerCase();if(e&&!e.includes("@"))e+=DOMINIO;
      if(!e||(!e.endsWith(DOMINIO)&&!FORA_DO_DOMINIO.includes(e))){m.textContent="Use o seu e-mail "+DOMINIO+".";return}
      const bt=$("#eb-btn");bt.disabled=true;bt.textContent="Enviando…";
      try{await auth.sendSignInLinkToEmail(e,{url:voltaLink(),handleCodeInApp:true});try{localStorage.setItem("emailParaLink",e)}catch(x){}
        m.textContent="Enviamos um link para "+e+". Abra o e-mail neste aparelho e clique no link para confirmar.";bt.textContent="Reenviar link"}
      catch(err){m.textContent=traduz(err);bt.textContent="Enviar link"}finally{bt.disabled=false}};
  }

  /* ---------- Aviso por e-mail quando a gestão atualiza um pedido ---------- */
  const ROTULO={aberta:"Aberta",em_andamento:"Em andamento",concluida:"Concluída",pendente:"Aguardando aprovação",aprovada:"Aprovada",recusada:"Recusada",aberto:"Aberto",respondido:"Respondido",encerrado:"Encerrado",recusado:"Recusado"};
  function comAviso(ref,caminho){
    return new Proxy(ref,{get(t,k){
      if(k==="set")return async(dados,...resto)=>{let antes={};try{const a=await t.get();antes=a.exists?a.data():{}}catch(x){}
        const r=await t.set(dados,...resto);avisaPorEmail(caminho,antes,dados).catch(e=>console.warn("Aviso por e-mail:",e));return r};
      const v=t[k];return typeof v==="function"?v.bind(t):v}});
  }
  async function avisaPorEmail(caminho,antes,depois){
    const url=window.EMAIL_URL;if(!url)return;
    const [col,id]=caminho.split("/");
    const linhas=[];
    if(depois.status&&depois.status!==antes.status)linhas.push("Situação: "+(ROTULO[depois.status]||depois.status));
    if(depois.aprovada&&!antes.aprovada)linhas.push("A compra foi aprovada.");
    const motivo=depois.motivoRecusa&&depois.motivoRecusa!==antes.motivoRecusa?depois.motivoRecusa:"";
    if(motivo)linhas.push("Motivo da recusa: "+motivo);
    const novas=(depois.respostas||[]).slice((antes.respostas||[]).length);
    for(const r of novas)if(r&&r.texto)linhas.push("Resposta da gestão: "+r.texto);
    if(!linhas.length)return;
    const origens=col==="chamados_gestao"?["chamados"]:["solicitacoes","reservas"];
    let pedido=null;for(const o of origens){const d=await fs.doc(o+"/"+id).get();if(d.exists){pedido=d.data();break}}
    if(!pedido)return;
    let para=pedido.autorEmail||"";
    if(!para&&pedido.autor){try{const c=await fs.doc("contatos/"+pedido.autor).get();if(c.exists)para=c.data().email||""}catch(x){}}
    if(!para)return;
    const prot=pedido.protocolo||id;
    const texto=`Olá${pedido.nome?", "+pedido.nome:""}.\n\nSeu pedido ${prot} na Central de Solicitações da Protect foi atualizado.\n\n${linhas.join("\n")}\n\nVeja os detalhes em Minhas solicitações:\n${voltaLink()}`;
    await fetch(url,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain"},body:JSON.stringify({chave:window.EMAIL_CHAVE||"",para,assunto:"Atualização do pedido "+prot,texto})});
  }

  /* ---------- Login da gestão (dentro da aba Painel de Gestão) ---------- */
  function preparaLoginGestao(){
    const f=$("#form-login");if(!f)return;
    const msg=$("#lg-msg"),btn=$("#lg-btn"),ent=$("#lg-email"),sen=$("#lg-senha");
    $("#g-login .lede").textContent="Entre com seu e-mail da Protect e sua senha.";
    ent.placeholder="nome@protectepi.com.br";
    try{const m=sessionStorage.getItem("gestaoMsg");if(m){msg.innerHTML=`<p class="al-msg">${m.replace(/[<>&"]/g,"")}</p>`;sessionStorage.removeItem("gestaoMsg");document.querySelector("#t-gestao")?.click()}}catch(e){}
    let modo="entrar";
    const links=document.createElement("div");links.className="al-links";links.innerHTML=`<button type="button" id="lg-criar">Primeiro acesso? Criar conta</button><button type="button" id="lg-esqueci">Esqueci a senha</button>`;
    f.appendChild(links);
    const diz=(t,ok)=>{msg.innerHTML=`<p class="al-msg${ok?" ok":""}">${t.replace(/[<>&"]/g,"")}</p>`};
    const email=()=>{let e=ent.value.trim().toLowerCase();if(e&&!e.includes("@"))e+=DOMINIO;return e};
    $("#lg-criar").onclick=()=>{modo=modo==="criar"?"entrar":"criar";btn.textContent=modo==="criar"?"Criar conta":"Entrar";$("#lg-criar").textContent=modo==="criar"?"Já tenho conta. Entrar":"Primeiro acesso? Criar conta";msg.innerHTML=""};
    $("#lg-esqueci").onclick=async()=>{const e=email();if(!e){diz("Digite seu e-mail acima para receber o link.");return}
      try{await auth.sendPasswordResetEmail(e);diz("Enviamos um link para "+e+" redefinir a senha.",true)}catch(err){diz(traduz(err))}};
    f.addEventListener("submit",async ev=>{ev.preventDefault();ev.stopImmediatePropagation();msg.innerHTML="";
      const e=email(),s=sen.value;if(!e||!s){diz("Preencha e-mail e senha.");return}
      if(modo==="criar"&&!e.endsWith(DOMINIO)&&!FORA_DO_DOMINIO.includes(e)){diz("Use um e-mail "+DOMINIO+".");return}
      btn.disabled=true;btn.textContent="Aguarde…";
      try{try{localStorage.setItem("aba","gestao");sessionStorage.setItem("viaGestao","1")}catch(x){}
        if(modo==="criar"){const c=await auth.createUserWithEmailAndPassword(e,s);try{await c.user.sendEmailVerification()}catch(x){}}
        else await auth.signInWithEmailAndPassword(e,s)}
      catch(err){diz(traduz(err));btn.disabled=false;btn.textContent=modo==="criar"?"Criar conta":"Entrar"}
    },true);
  }

  /* ---------- Tela de login ---------- */
  function mostraLogin(msg,erroFixo){
    let ov=$("#app-login");
    if(!ov){ov=document.createElement("div");ov.id="app-login";ov.innerHTML=`
      <form class="al-card" novalidate>
        <div class="al-mark"><svg viewBox="0 0 320 140" aria-hidden="true"><path d="M24 60 C24 30 40 18 72 18 L248 18 C280 18 296 30 296 60"/><path d="M296 80 C296 110 280 122 248 122 L72 122 C40 122 24 110 24 80"/></svg><b>Protect</b></div>
        <h1>Central de Solicitações</h1>
        <p class="al-sub" id="al-sub">Entre com seu e-mail da Protect.</p>
        <label for="al-email">E-mail</label><input id="al-email" type="email" autocomplete="username" placeholder="nome@protectepi.com.br" required>
        <label for="al-senha">Senha</label><input id="al-senha" type="password" autocomplete="current-password" minlength="6" required>
        <p class="al-msg" id="al-msg" role="alert"></p>
        <button class="al-btn" id="al-entrar" type="submit">Entrar</button>
        <div class="al-links"><button type="button" id="al-criar">Primeiro acesso? Criar conta</button><button type="button" id="al-esqueci">Esqueci a senha</button></div>
      </form>`;document.body.appendChild(ov);
      let modo="entrar";const f=ov.querySelector("form"),m=ov.querySelector("#al-msg");
      const email=()=>{let e=ov.querySelector("#al-email").value.trim().toLowerCase();if(e&&!e.includes("@"))e+=DOMINIO;return e};
      const setModo=x=>{modo=x;ov.querySelector("#al-entrar").textContent=x==="criar"?"Criar conta":"Entrar";ov.querySelector("#al-criar").textContent=x==="criar"?"Já tenho conta. Entrar":"Primeiro acesso? Criar conta";ov.querySelector("#al-sub").textContent=x==="criar"?"Use seu e-mail da Protect e escolha uma senha (mínimo 6 caracteres).":"Entre com seu e-mail da Protect.";m.textContent=""};
      ov.querySelector("#al-criar").onclick=()=>setModo(modo==="criar"?"entrar":"criar");
      ov.querySelector("#al-esqueci").onclick=async()=>{const e=email();if(!e){m.textContent="Digite seu e-mail acima para receber o link.";return}
        try{await auth.sendPasswordResetEmail(e);m.className="al-msg ok";m.textContent="Enviamos um link para "+e+" redefinir a senha."}catch(err){m.className="al-msg";m.textContent=traduz(err)}};
      f.onsubmit=async ev=>{ev.preventDefault();m.className="al-msg";m.textContent="";const e=email(),s=ov.querySelector("#al-senha").value;
        if(!e||!s){m.textContent="Preencha e-mail e senha.";return}
        if(modo==="criar"&&!e.endsWith(DOMINIO)&&!FORA_DO_DOMINIO.includes(e)){m.textContent="Use um e-mail "+DOMINIO+".";return}
        const b=ov.querySelector("#al-entrar");b.disabled=true;b.textContent="Aguarde…";
        try{if(modo==="criar"){const c=await auth.createUserWithEmailAndPassword(e,s);try{await c.user.sendEmailVerification()}catch(x){}}else await auth.signInWithEmailAndPassword(e,s)}
        catch(err){m.textContent=traduz(err)}finally{b.disabled=false;b.textContent=modo==="criar"?"Criar conta":"Entrar"}};
    }
    ov.hidden=false;ov.querySelector("form").hidden=false;const vv=ov.querySelector(".al-verif");if(vv)vv.hidden=true;
    if(msg){const m=ov.querySelector("#al-msg");m.textContent=msg;if(erroFixo)ov.querySelectorAll("input,button").forEach(x=>x.disabled=true)}
  }
  /* Conta nova: precisa confirmar o e-mail antes de usar (garante que é mesmo da Protect). */
  function mostraVerificacao(u){
    mostraLogin();const ov=$("#app-login"),f=ov.querySelector("form");
    let v=ov.querySelector(".al-verif");if(!v){v=document.createElement("div");v.className="al-verif";f.parentNode.appendChild(v)}
    f.hidden=true;v.hidden=false;
    v.innerHTML=`<div class="al-card"><h1>Confirme seu e-mail</h1><p class="al-sub">Enviamos um link de confirmação para <b>${u.email.replace(/[<>&"]/g,"")}</b>. Abra o e-mail, clique no link e volte aqui.</p>
      <p class="al-msg" id="av-msg" role="alert"></p><button class="al-btn" id="av-ok" type="button">Já confirmei</button>
      <div class="al-links"><button type="button" id="av-reenv">Reenviar e-mail</button><button type="button" id="av-sair">Usar outra conta</button></div></div>`;
    const m=v.querySelector("#av-msg");
    v.querySelector("#av-ok").onclick=async()=>{await u.reload();if(auth.currentUser.emailVerified){await auth.currentUser.getIdToken(true);location.reload()}else m.textContent="Ainda não aparece como confirmado. Verifique a caixa de spam."};
    v.querySelector("#av-reenv").onclick=async()=>{try{await u.sendEmailVerification();m.className="al-msg ok";m.textContent="E-mail reenviado."}catch(err){m.className="al-msg";m.textContent=traduz(err)}};
    v.querySelector("#av-sair").onclick=()=>window.appSair();
  }
  function escondeLogin(){const ov=$("#app-login");if(ov)ov.hidden=true}
  function traduz(err){const c=err?.code||"";return({
    "auth/invalid-credential":"E-mail ou senha incorretos.","auth/wrong-password":"E-mail ou senha incorretos.","auth/user-not-found":"Não encontramos uma conta com esse e-mail.",
    "auth/email-already-in-use":"Já existe uma conta com esse e-mail. Use Entrar.","auth/weak-password":"A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-email":"E-mail inválido.","auth/too-many-requests":"Muitas tentativas. Aguarde alguns minutos.","auth/network-request-failed":"Sem conexão com a internet."
  })[c]||("Não foi possível entrar ("+(c||err?.message||"erro")+").")}

  /* ---------- PWA ---------- */
  if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
