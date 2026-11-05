/* Central de Solicitações · envio dos e-mails de atualização
   Onde colar: script.google.com, logado como planejamentoprotect@gmail.com > Novo projeto.
   Troque a CHAVE abaixo por uma palavra sua e coloque a mesma em config.js (EMAIL_CHAVE).
   Depois: Implantar > Nova implantação > tipo "App da Web" > Executar como: eu > Quem pode acessar: Qualquer pessoa.
   Copie o endereço que termina em /exec para config.js (EMAIL_URL).

   Envio pelo Microsoft 365 (remetente @protectepi.com.br):
   quando o TI criar o aplicativo no Entra ID, abra Configurações do projeto (engrenagem) > Propriedades do script
   e adicione TENANT_ID, CLIENT_ID e CLIENT_SECRET com os valores que o TI passar. A senha fica só aí, nunca no código.
   Enquanto essas propriedades não existirem, o envio continua pelo Gmail. */
const CHAVE = 'TROQUE-ESTA-CHAVE';
const DOMINIO = /@protectepi\.com\.br$/;  // só envia para e-mails da Protect
const REMETENTE = 'planejamento@protectepi.com.br';  // caixa do Microsoft 365 que aparece como remetente

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return saida('erro'); }
  if (d.chave !== CHAVE) return saida('chave');
  const para = String(d.para || '').trim().toLowerCase();
  if (!DOMINIO.test(para)) return saida('dominio');
  // no máximo 30 e-mails por hora, para não estourar a cota diária
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('hora') || 0);
  if (n >= 30) return saida('limite');
  cache.put('hora', String(n + 1), 3600);
  enviar(para, String(d.assunto || 'Atualização do seu pedido').slice(0, 150), String(d.texto || '').slice(0, 5000));
  return saida('ok');
}

function enviar(para, assunto, texto) {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (!p.TENANT_ID || !p.CLIENT_ID || !p.CLIENT_SECRET) {
    MailApp.sendEmail({ to: para, subject: assunto, body: texto, name: 'Central de Solicitações Protect' });
    return;
  }
  const r = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(REMETENTE) + '/sendMail', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + tokenMicrosoft(p) },
    payload: JSON.stringify({
      message: { subject: assunto, body: { contentType: 'Text', content: texto }, toRecipients: [{ emailAddress: { address: para } }] },
      saveToSentItems: true
    }),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 202) throw new Error('Microsoft 365 recusou o envio: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
}

function tokenMicrosoft(p) {
  const cache = CacheService.getScriptCache();
  const salvo = cache.get('tokenMs');
  if (salvo) return salvo;
  const r = UrlFetchApp.fetch('https://login.microsoftonline.com/' + p.TENANT_ID + '/oauth2/v2.0/token', {
    method: 'post',
    payload: { client_id: p.CLIENT_ID, client_secret: p.CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' },
    muteHttpExceptions: true
  });
  const j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error('Não foi possível entrar no Microsoft 365: ' + (j.error_description || r.getContentText()).slice(0, 300));
  cache.put('tokenMs', j.access_token, Math.min(3000, Number(j.expires_in || 3600) - 120));
  return j.access_token;
}

function saida(t) { return ContentService.createTextOutput(t); }

// Teste: escolha "teste" na lista de funções e clique em Executar. Manda um e-mail direto, sem passar pelo app.
function teste() {
  enviar('planejamento@protectepi.com.br', 'Teste da Central de Solicitações', 'Se este e-mail chegou, o envio está funcionando.');
}

/* ---------------------------------------------------------------------------------------------
   Entregas do Mercado Livre: marca a compra como concluída quando chega o e-mail de entrega.

   Como funciona: a cada hora o script procura, nesta caixa do Gmail, e-mails do Mercado Livre dos últimos dias
   que digam que o pacote foi entregue. Se o número de um pedido salvo na Gestão (campo "Nº do pedido no
   Mercado Livre" da compra aprovada) aparece no e-mail, a compra vira "Concluída" e o solicitante recebe um aviso.

   Ativar (uma vez):
   1. Configurações do projeto (engrenagem) > marque "Mostrar o arquivo de manifesto appsscript.json".
      Abra appsscript.json no editor e troque o conteúdo pelo de tools/appsscript.json do repositório.
   2. Cole este arquivo inteiro de novo no Código.gs (mantendo a sua CHAVE) e salve.
   3. Escolha "testarEntregasML" na lista de funções e clique em Executar. Autorize o acesso pedido.
      Ele só mostra no registro o que encontraria, sem gravar nada.
   4. Escolha "ativarEntregasML" e clique em Executar. Pronto: passa a rodar sozinho a cada hora.
   5. Implantar > Gerenciar implantações > lápis > Versão: Nova versão > Implantar (o endereço /exec não muda).
   Os e-mails do Mercado Livre precisam chegar nesta caixa do Gmail (direto ou por encaminhamento automático). */
const PROJETO = 'central-de-solicita';
const APP_URL = 'https://planejamentoprotect-o.github.io/central-de-solicita-o/';
// Sem filtro de remetente: e-mails encaminhados de outra caixa (ex.: regra do Outlook) chegam com o remetente de quem encaminhou.
const BUSCA_ML = '(mercadolivre OR "mercado livre" OR mercadolibre) newer_than:20d';
const ENTREGUE = /(entregamos|foi entregue|foram entregues|j[aá] (est[aá]|chegou)|(seu|sua|o seu|a sua) (pacote|compra|produto|pedido) chegou|chegou (o )?(seu|sua)|entrega (foi )?(realizada|conclu[ií]da|feita))/i;
const NAO_ENTREGUE = /(n[aã]o (foi|conseguimos|pudemos) entreg|tentativa de entrega|entrega (n[aã]o realizada|falhou|cancelada)|devolvid)/i;

function verificarEntregasML() { return entregasML(false); }
function testarEntregasML() { return entregasML(true); }

function entregasML(teste) {
  const pend = decisoesComPedidoML().filter(function (d) { return !d.f.entregueML; });
  console.log(pend.length + ' compra(s) aguardando entrega com nº de pedido do Mercado Livre.');
  if (!pend.length) return;
  const achou = {};
  GmailApp.search(BUSCA_ML, 0, 100).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      const texto = m.getSubject() + '\n' + m.getPlainBody();
      if (!ENTREGUE.test(texto) || NAO_ENTREGUE.test(texto)) return;
      const tudo = texto + '\n' + m.getBody();
      pend.forEach(function (d) {
        const n = d.f.pedidoML;
        if (achou[d.id] || !n) return;
        if (new RegExp('(^|\\D)' + n + '(\\D|$)').test(tudo)) achou[d.id] = { quando: m.getDate().getTime(), assunto: m.getSubject() };
      });
    });
  });
  pend.forEach(function (d) {
    const a = achou[d.id];
    if (!a) return;
    console.log((teste ? '[teste] ' : '') + 'Pedido ' + d.f.pedidoML + ' entregue (e-mail "' + a.assunto + '") -> decisoes/' + d.id);
    if (!teste) marcarEntregue(d, a.quando);
  });
  if (!Object.keys(achou).length) console.log('Nenhum e-mail de entrega com esses números nos últimos 20 dias.');
}

function marcarEntregue(d, quando) {
  const agora = Date.now();
  const texto = 'Entrega confirmada pelo Mercado Livre em ' + Utilities.formatDate(new Date(quando), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm') + ' (pedido ' + d.f.pedidoML + ').';
  const respostas = (d.raw.respostas && d.raw.respostas.arrayValue && d.raw.respostas.arrayValue.values) || [];
  respostas.push({ mapValue: { fields: { texto: { stringValue: texto }, data: { integerValue: String(agora) }, por: { stringValue: 'Mercado Livre (automático)' } } } });
  const campos = {
    status: { stringValue: 'concluida' },
    em: { integerValue: String(agora) },
    entregueML: { booleanValue: true },
    entregueMLEm: { integerValue: String(quando) },
    respostas: { arrayValue: { values: respostas } }
  };
  const mask = Object.keys(campos).map(function (k) { return 'updateMask.fieldPaths=' + k; }).join('&');
  firestore('patch', 'decisoes/' + d.id + '?currentDocument.exists=true&' + mask, { fields: campos });
  try { avisarSolicitante(d.id, texto); } catch (e) { console.warn('Aviso ao solicitante: ' + e); }
}

function avisarSolicitante(id, linha) {
  const p = firestore('get', 'solicitacoes/' + id);
  if (!p) return;
  const f = valores(p.fields || {});
  let para = f.autorEmail || '';
  if (!para && f.autor) { const c = firestore('get', 'contatos/' + f.autor); if (c) para = valores(c.fields || {}).email || ''; }
  para = String(para).trim().toLowerCase();
  if (!DOMINIO.test(para)) return;
  const prot = f.protocolo || id;
  enviar(para, 'Atualização do pedido ' + prot, 'Olá' + (f.nome ? ', ' + f.nome : '') + '.\n\nSeu pedido ' + prot + ' na Central de Solicitações da Protect foi atualizado.\n\nSituação: Concluída\n' + linha + '\n\nVeja os detalhes em Minhas solicitações:\n' + APP_URL);
}

function decisoesComPedidoML() {
  const out = [];
  let token = '';
  do {
    const r = firestore('get', 'decisoes?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    (r && r.documents || []).forEach(function (doc) {
      const f = valores(doc.fields || {});
      if (f.pedidoML) out.push({ id: doc.name.split('/').pop(), f: f, raw: doc.fields });
    });
    token = r && r.nextPageToken;
  } while (token);
  return out;
}

/* Firestore pela API REST com a própria conta do Google (precisa ser dona/editora do projeto Firebase). */
function firestore(metodo, caminho, corpo) {
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJETO + '/databases/(default)/documents/' + caminho, {
    method: metodo,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': PROJETO },
    payload: corpo ? JSON.stringify(corpo) : undefined,
    muteHttpExceptions: true
  });
  const c = r.getResponseCode();
  if (c === 404 && metodo === 'get') return null;
  if (c >= 300) throw new Error('Firestore ' + c + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}

function valores(campos) {
  const o = {};
  Object.keys(campos).forEach(function (k) {
    const v = campos[k];
    o[k] = 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : null;
  });
  return o;
}

function ativarEntregasML() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'verificarEntregasML') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificarEntregasML').timeBased().everyHours(1).create();
  console.log('Verificação de entregas do Mercado Livre ativada (a cada hora).');
}
