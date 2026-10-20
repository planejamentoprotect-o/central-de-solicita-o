/* Central de Solicitações · envio dos e-mails de atualização
   Onde colar: script.google.com, logado como planejamentoprotect@gmail.com > Novo projeto.
   Troque a CHAVE abaixo por uma palavra sua e coloque a mesma em config.js (EMAIL_CHAVE).
   Depois: Implantar > Nova implantação > tipo "App da Web" > Executar como: eu > Quem pode acessar: Qualquer pessoa.
   Copie o endereço que termina em /exec para config.js (EMAIL_URL). */
const CHAVE = 'TROQUE-ESTA-CHAVE';
const DOMINIO = /@protectepi\.com\.br$/;  // só envia para e-mails da Protect

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return saida('erro'); }
  if (d.chave !== CHAVE) return saida('chave');
  const para = String(d.para || '').trim().toLowerCase();
  if (!DOMINIO.test(para)) return saida('dominio');
  // no máximo 30 e-mails por hora, para não estourar a cota diária do Gmail
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('hora') || 0);
  if (n >= 30) return saida('limite');
  cache.put('hora', String(n + 1), 3600);
  MailApp.sendEmail({
    to: para,
    subject: String(d.assunto || 'Atualização do seu pedido').slice(0, 150),
    body: String(d.texto || '').slice(0, 5000),
    name: 'Central de Solicitações Protect'
  });
  return saida('ok');
}

function saida(t) { return ContentService.createTextOutput(t); }

// Teste: escolha "teste" na lista de funções e clique em Executar. Manda um e-mail direto, sem passar pelo app.
function teste() {
  MailApp.sendEmail('planejamento@protectepi.com.br', 'Teste da Central de Solicitações', 'Se este e-mail chegou, o envio está funcionando.');
}
