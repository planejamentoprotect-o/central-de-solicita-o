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
  const PAPEIS_INICIAIS={
    gestores:["administrativo@protectepi.com.br","controladoria@protectepi.com.br","rh@protectepi.com.br","supplychain@protectepi.com.br"],
    master:["gustavo@protectepi.com.br",DONO],extras:[DONO]};

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
    let u=cacheFoto.get(id);if(u)return u;
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
  const user={id:async()=>auth.currentUser?.uid||null,canEdit:async()=>!!papel,can:async()=>true,email:()=>auth.currentUser?.email||""};

  let pronto;const prontoP=new Promise(r=>pronto=r);
  window.claude={use:async n=>{await prontoP;return n==="db"?fs:n==="user"?user:n==="assets"?assets:n==="downloads"?downloads:null}};

  auth.onAuthStateChanged(async u=>{
    if(!u){mostraLogin();return}
    if(!u.emailVerified){mostraVerificacao(u);return}
    try{
      const ref=fs.doc("config/papeis"),p=await ref.get(),e=u.email.toLowerCase();let m=p.exists?p.data():{};
      /* Primeiro acesso do dono: cria a lista de papéis com os gestores da Central antiga. */
      if(!p.exists&&e===DONO){m=PAPEIS_INICIAIS;try{await ref.set(m)}catch(x){}}
      papel=(m.master||[]).includes(e)?"master":(m.gestores||[]).includes(e)?"gestor":null;
    }catch(e){papel=null}
    try{if(papel){sessionStorage.setItem("gestor",papel);sessionStorage.setItem("gestorConta",u.email.toLowerCase())}else{sessionStorage.removeItem("gestor");sessionStorage.removeItem("gestorConta")}}catch(e){}
    window.__APP={email:u.email.toLowerCase(),papel};
    escondeLogin();
    document.documentElement.classList.toggle("app-gestor",!!papel);
    pronto();
  });

  window.appSair=async()=>{try{sessionStorage.clear()}catch(e){}await auth.signOut();location.reload()};

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
