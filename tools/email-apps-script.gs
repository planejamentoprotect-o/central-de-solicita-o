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
