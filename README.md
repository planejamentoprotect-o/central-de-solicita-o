# Central de Solicitações · Protect (app)

App web instalável (PWA) da Central de Solicitações da Protect EPI. Roda no navegador, pode ser instalado no computador e no celular, e usa o Firebase para login, banco de dados e fotos (Firestore). Não usa o Storage, que exige plano pago.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | A Central (gerado a partir da versão do claude.ai por `tools/build_app.py`) |
| `app.js` | Liga a Central ao Firebase: login, banco, fotos, download do Excel, instalação |
| `config.js` | Configuração do projeto Firebase (preencher) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Deixam o app instalável e rápido para abrir |
| `firestore.rules` | Quem pode ler e gravar o quê (as fotos ficam no Firestore, coleção `fotos`, sem precisar do Storage pago) |
| `importar.html` | Página usada uma vez para trazer os dados da Central antiga |
| `firebase.json` | Configuração de hospedagem no Firebase Hosting |

## Quem pode fazer o quê

- Qualquer pessoa com e-mail `@protectepi.com.br` cria a própria conta (primeiro acesso) e confirma o e-mail.
- Gestores e master ficam no documento `config/papeis` do Firestore:
  `{ "gestores": [...], "master": [...], "extras": [e-mails de fora do domínio que podem usar] }`.
- As abas que cada gestor vê continuam definidas em `ABAS_CONTA` dentro do `index.html`.

## Colocar no ar (uma vez)

1. No [Console do Firebase](https://console.firebase.google.com), crie o projeto e ative:
   Authentication > E-mail/senha e Anônimo, e Firestore Database. Solicitantes entram sem login (conta anônima); só a gestão usa e-mail e senha, dentro da aba Painel de Gestão.
2. Registre um App da Web e copie o `firebaseConfig` para `config.js`.
3. O dono do app (planejamentoprotect@gmail.com) já está em `firestore.rules`.
4. Publique: `npm i -g firebase-tools`, `firebase login`, `firebase use --add`, `firebase deploy`.
5. Entre no app com o e-mail do dono, abra `/importar.html`, salve os papéis e importe os dados.
6. Crie as contas dos gestores (cada um faz o primeiro acesso com o próprio e-mail).

## Atualizar o app depois

Edite `index.html` (ou gere de novo com `tools/build_app.py`) e rode `firebase deploy`. Troque `CACHE` em `sw.js` para forçar a atualização nos aparelhos.
