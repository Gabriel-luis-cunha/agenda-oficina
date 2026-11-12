# Agenda Oficina

App de agendamento de clientes da oficina. Funciona no celular e no computador, pode ser instalado como app e continua funcionando sem internet.

- **Agenda compartilhada:** os 3 celulares e os 4 computadores veem a mesma agenda (pelo Firebase, plano gratuito).
- **Lista de espera:** para clientes que ainda não têm data. Quando abrir um horário, um toque em "Agendar" leva o cliente para a agenda.
- **Sem internet:** dá para continuar usando. O que for feito offline é enviado sozinho quando a conexão voltar.
- **Login na abertura:** o app só mostra a agenda depois de entrar com o e-mail e a senha de acesso da oficina.
- **Chegou ou Faltou:** cada cliente de hoje tem dois botões. "Faltou" guarda o cliente no histórico **Faltas** (menu ☰).
- **Só nome e data são obrigatórios** no agendamento. Na lista de espera, só o nome.
- **Lembretes:** o agendamento vai para a agenda do celular (que avisa mesmo com o app fechado) e, ao abrir o app, aparece um aviso com os clientes do dia.

---

## O que cada arquivo faz

| Arquivo | Para que serve |
|---|---|
| `index.html` | O esqueleto: as telas, os botões e os campos. |
| `style.css` | A aparência: cores, tamanhos, animações e modo escuro. |
| `app.js` | O cérebro: agenda, lista de espera, busca e backup. |
| `dados.js` | Onde a agenda e a lista de espera ficam guardadas (Firebase ou só no aparelho) e o login. |
| `lembretes.js` | Datas em português, evento para a agenda do celular e aviso do dia. |
| `firebase-config.js` | **O único arquivo que você precisa editar**: a configuração do seu Firebase. |
| `sw.js` | Guarda uma cópia do app no aparelho para ele abrir sem internet. |
| `manifest.json` | Nome, ícone e cores usados quando o app é instalado. |
| `icon.svg`, `icon-*.png`, `apple-touch-icon.png`, `badge-96.png` | Ícones do app e da notificação. |

Enquanto o `firebase-config.js` estiver vazio, o app funciona, mas guarda tudo **só no aparelho** (aparece "Neste aparelho" no topo). Depois de configurado, aparece "Sincronizado".

**Sobre o login:** antes do Firebase, o app confere o e-mail e a senha de acesso combinados. A senha não fica escrita em nenhum arquivo: o código guarda só um "resumo" embaralhado dela. Depois do Firebase configurado, quem confere é o Firebase, com o usuário que você criar na Parte 1, passo 3.

---

## Antes de começar

- Faça a configuração em **um dos computadores da oficina**. Copiar códigos e subir arquivos é bem mais fácil no computador.
- Você vai precisar de uma **conta Google** (para o Firebase) e de uma **conta no GitHub** (gratuita).
- Tempo: uns 30 minutos.
- Descompacte o `agenda-oficina.zip` numa pasta.

---

## Parte 1: criar o banco de dados (Firebase)

### Passo 1: criar o projeto

1. Entre em https://console.firebase.google.com com a conta Google da oficina.
2. Clique em **Criar um projeto** (pode aparecer como "Adicionar projeto" ou "Começar").
3. Nome do projeto: `agenda-oficina`. Avance.
4. Se perguntar sobre Google Analytics ou Gemini, pode desligar: o app não usa. Clique em **Criar projeto** e espere terminar.

### Passo 2: ligar o login por e-mail e senha

1. No menu da esquerda, procure **Authentication** (às vezes fica dentro de "Criação" ou "Segurança").
2. Clique em **Vamos começar**.
3. Na aba **Método de login**, escolha **E-mail/senha**, ative a primeira chave e clique em **Salvar**.

### Passo 3: criar o usuário da equipe

1. Ainda em Authentication, abra a aba **Usuários** e clique em **Adicionar usuário**.
2. Coloque **o mesmo e-mail e a mesma senha de acesso que vocês já usam no login do app**. Assim nada muda para a equipe quando o Firebase for ligado.
3. Esse mesmo login vai ser usado nos 7 aparelhos.

> Quer um login para cada pessoa? Crie mais usuários aqui e coloque todos os e-mails na regra do passo 5.

### Passo 4: criar o banco de dados

1. No menu da esquerda, procure **Firestore Database** e clique em **Criar banco de dados**.
2. Se perguntar a edição, escolha **Standard**.
3. Local: **southamerica-east1 (São Paulo)**. Atenção: isso não pode ser mudado depois.
4. Escolha **Iniciar no modo de produção** e clique em **Criar**.

### Passo 5: colar as regras de segurança

1. No Firestore, abra a aba **Regras**.
2. Apague tudo o que estiver lá e cole isto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{colecao}/{id} {
      allow read, write: if colecao in ['agendamentos', 'espera']
        && request.auth != null
        && request.auth.token.email in ['agenda@suaoficina.com.br'];
    }
  }
}
```

3. Troque `agenda@suaoficina.com.br` pelo e-mail de acesso do passo 3. Escreva **tudo em minúsculas** e mantenha as aspas simples.
4. Clique em **Publicar**.

Mais de um login fica assim: `['agenda@suaoficina.com.br', 'joao@suaoficina.com.br']`

**O que essa regra faz:** só quem entrou no app com um desses e-mails consegue ver ou mudar a agenda e a lista de espera. Mais ninguém.

### Passo 6: registrar o app e copiar a configuração

1. Clique na engrenagem ⚙ ao lado de "Visão geral do projeto" e depois em **Configurações do projeto**.
2. Em **Seus apps**, clique no ícone da Web: **</>**.
3. Apelido: `Agenda Oficina`. **Não** marque "Firebase Hosting". Clique em **Registrar app**.
4. Vai aparecer um código. Você só precisa deste pedaço (os valores serão os seus):

```
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "agenda-oficina-xxxxx.firebaseapp.com",
  projectId: "agenda-oficina-xxxxx",
  storageBucket: "agenda-oficina-xxxxx.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

---

## Parte 2: colar a configuração no app

1. Abra o arquivo `firebase-config.js` num editor de texto (no Windows: botão direito → Abrir com → Bloco de Notas).
2. Apague o bloco de exemplo, de `const firebaseConfig = {` até `};`.
3. Cole o seu bloco no mesmo lugar e salve.
4. A última linha (`window.FIREBASE_CONFIG = firebaseConfig;`) precisa continuar lá.

**Isso é seguro?** Sim. Esses códigos só dizem qual é o seu projeto, não são senhas. Quem protege a agenda é o login da equipe e as regras do passo 5.

Se o app mostrar "O arquivo firebase-config.js está com erro": confira se não sobrou o bloco antigo e se você não colou linhas a mais (como `import ...` ou `initializeApp`).

---

## Parte 3: publicar no GitHub Pages

1. Entre em https://github.com (crie a conta, se ainda não tiver).
2. Clique no **+** no canto de cima e em **New repository**.
3. Repository name: `agenda-oficina`. Marque **Public** e clique em **Create repository**.
   No plano gratuito, o GitHub Pages só publica repositórios públicos. Tudo bem: os dados dos clientes não ficam no GitHub. Eles ficam no Firebase, protegidos pelo login.
4. Na página do repositório vazio, clique no link **uploading an existing file**.
5. Arraste **todos os arquivos** da pasta (os arquivos, não a pasta) para a página e clique em **Commit changes**.
6. Vá em **Settings** e, no menu da esquerda, em **Pages**.
7. Em "Build and deployment": Source **Deploy from a branch**; Branch **main** e **/(root)**. Clique em **Save**.
8. Espere de 1 a 3 minutos e atualize a página. O endereço do app aparece no topo, assim:
   `https://SEU-USUARIO.github.io/agenda-oficina/`

---

## Parte 4: liberar o endereço no Firebase

1. No Firebase, vá em **Authentication** → aba **Configurações** → **Domínios autorizados** → **Adicionar domínio**.
2. Digite `SEU-USUARIO.github.io` (sem `https://` e sem `/agenda-oficina`) e confirme.

---

## Parte 5: instalar nos celulares e computadores

Abra o endereço do app em cada aparelho e entre com o e-mail e a senha da equipe. Só precisa entrar uma vez.

- **Android (Chrome):** menu **⋮** → **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** botão **Compartilhar** (quadrado com seta para cima) → **Adicionar à Tela de Início** → **Adicionar**. Depois, use sempre pelo ícone.
- **Computadores (Chrome ou Edge):** ícone de instalar no canto da barra de endereço, ou menu → **Instalar Agenda Oficina**. Também dá para usar direto no navegador.

No Android e no computador, o próprio app também mostra **Instalar o app** no menu ☰.

**App instalado e navegador:** como tudo fica no Firebase, a agenda é a mesma no app instalado, no navegador e em todos os aparelhos. Isso vale até para o iPhone, onde o Safari e o ícone da Tela de Início guardam os dados do aparelho separados.

---

## Parte 6: ligar os lembretes

### Agenda do celular (avisa mesmo com o app fechado)

Depois de salvar um agendamento, toque em:

- **iPhone: "Calendário do celular".** O evento já vem com dois alarmes: às 8h do dia e 30 minutos antes (se tiver hora).
- **Android: "Google Agenda".** O evento abre pronto; toque em **Salvar**. Os avisos seguem o padrão da sua Google Agenda. Para ficar igual ao iPhone, nas configurações da Google Agenda escolha sua conta e ajuste as notificações padrão: eventos, 30 minutos antes; eventos de dia inteiro, no dia às 8:00.
- **Computador:** "Google Agenda" abre o evento no navegador. "Calendário do celular" baixa um arquivo `.ics`, que abre no Outlook ou no Calendário.

Dá para fazer isso depois também: toque no agendamento → **Adicionar à agenda do celular**.
Se mudar a data de um agendamento, adicione de novo. No iPhone, o mesmo evento é atualizado. Na Google Agenda, apague o antigo.

### Aviso do dia (notificação ao abrir o app)

1. Toque em **Ativar aviso** na faixa que aparece no app (ou menu ☰ → **Ativar aviso do dia**).
2. Permita as notificações.
3. Uma vez por dia, ao abrir o app, aparece a lista dos clientes de hoje.

No iPhone, o aviso só funciona com o app instalado na Tela de Início (iOS 16.4 ou mais novo).

---

## Parte 7: teste final

- [ ] Criar um agendamento só com nome e data.
- [ ] Abrir em outro aparelho: o agendamento aparece lá em alguns segundos.
- [ ] Ligar o modo avião, criar outro agendamento e desligar o modo avião: ele aparece nos outros aparelhos.
- [ ] No iPhone, "Calendário do celular" pergunta se quer adicionar o evento.
- [ ] No Android, "Google Agenda" abre o evento pronto.
- [ ] Fechar o app e abrir de novo sem internet: a agenda abre.
- [ ] Colocar alguém na lista de espera e tocar em "Agendar": o cliente sai da lista e aparece na agenda, em todos os aparelhos.

---

## Chegou, Faltou e o histórico de Faltas

- Cada cliente de **hoje** (e os pendentes de dias anteriores) tem dois botões: **Chegou** e **Faltou**.
- **Chegou:** o cliente fica marcado com o selo verde "Chegou".
- **Faltou:** o cliente sai da agenda e vai para o histórico **Faltas** (menu ☰ → Faltas). O número ao lado mostra quantas faltas existem.
- Tocou sem querer? Logo depois aparece **Desfazer**. Também dá para desfazer pelos detalhes do cliente.
- No histórico de Faltas, toque no cliente e use **Remarcar** para marcar uma nova data. A falta continua registrada no histórico.
- Quem chegou fica em menu ☰ → **Quem chegou**.

---

## Como usar a lista de espera

- **Adicionar:** abra a aba **Lista de espera** e toque em **Adicionar à espera**. Só o nome é obrigatório; telefone, serviço e observação (ex.: "prefere sábado") são opcionais.
- **Atalho:** no formulário de novo agendamento, se o cliente ainda não tem data, toque em **Sem data? Colocar na lista de espera**. O nome e o serviço já vão preenchidos.
- **Ordem:** a lista segue a ordem de chegada (1º, 2º, 3º...) e mostra há quantos dias cada cliente espera.
- **Abriu um horário:** toque em **Agendar** ao lado do cliente, escolha a data e salve. Ele sai da lista e entra na agenda de uma vez só.
- **Avisar o cliente:** toque no nome para ver os detalhes e use **Ligar** ou **WhatsApp** (aparecem quando tem telefone). O WhatsApp já abre com uma mensagem pronta, que dá para mudar antes de enviar.
- **Remover:** nos detalhes, **Remover da lista de espera**. Se tocar sem querer, dá para desfazer logo em seguida.

---

## Como mudar algo depois

- No GitHub, abra o arquivo, clique no lápis ✏️, faça a mudança e clique em **Commit changes**. Em até uns 10 minutos os aparelhos pegam a versão nova (às vezes é preciso fechar e abrir o app duas vezes).
- Para mudar a lista de serviços: no `app.js`, edite a linha que começa com `const SERVICOS = [`.

## Backup

- Menu ☰ → **Exportar backup** baixa um arquivo `.json` com todos os agendamentos e a lista de espera. Faça de vez em quando (por exemplo, uma vez por mês).
- **Importar backup** coloca tudo de volta. Não duplica: o que já existe é atualizado.

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "E-mail ou senha incorretos" | Confira o e-mail e a senha de acesso. Com o Firebase ligado, o usuário da Parte 1, passo 3 precisa ter exatamente esse e-mail e essa senha. |
| "Sem acesso" no topo ou "Sem permissão" | O e-mail da regra (Parte 1, passo 5) precisa ser igual ao do login, em minúsculas. Confira também se a regra tem `['agendamentos', 'espera']`. Publique a regra de novo. |
| "O login por e-mail e senha não está ligado" | Parte 1, passo 2. |
| "O arquivo firebase-config.js está com erro" | Parte 2. |
| "Neste aparelho" no topo, em vez de "Sincronizado" | O `firebase-config.js` publicado no GitHub ainda está vazio. |
| Página 404 no GitHub | Espere alguns minutos. Confira Settings → Pages e se o `index.html` está na raiz do repositório, e não dentro de uma pasta. |
| Notificação não aparece | Confira se as notificações estão permitidas nas configurações do celular. No iPhone, use o app pelo ícone instalado. |

## Custos

- **Firebase:** plano gratuito (Spark), sem cadastrar cartão. O limite diário (dezenas de milhares de leituras) fica muito acima do que uma oficina usa.
- **GitHub Pages:** gratuito.

## Créditos

- Ícone de chave inglesa: Lucide (licença ISC, lucide.dev).
