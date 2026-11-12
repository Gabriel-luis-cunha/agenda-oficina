/*
  dados.js: onde as informações ficam guardadas
  =============================================

  São duas listas ("coleções"):
  - agendamentos: os clientes com data marcada
  - espera: a lista de espera (clientes ainda sem data)

  E dois jeitos de guardar. O resto do app não precisa saber qual está em uso:
  ele só chama Dados.salvar, Dados.excluir, Dados.observar e Dados.lote.

  - "nuvem": no Firebase (banco Firestore). Todos os aparelhos veem as mesmas
    listas. Funciona sem internet: o que for feito offline fica guardado no
    aparelho e é enviado sozinho quando a conexão voltar.

  - "local": só neste aparelho (IndexedDB, o "armário" do navegador).
    É usado enquanto o arquivo firebase-config.js estiver vazio.
*/
(function () {
  'use strict';

  const FIREBASE_VERSAO = '13.2.0';
  const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSAO}/`;

  const texto = (valor, maximo) => String(valor == null ? '' : valor).trim().slice(0, maximo);

  // Cada coleção sabe quais campos tem e em que formato.
  const COLECOES = {
    agendamentos: ag => ({
      id: String(ag.id),
      nome: texto(ag.nome, 80),
      data: String(ag.data || ''),
      hora: ag.hora ? String(ag.hora).slice(0, 5) : '',
      servico: texto(ag.servico, 60),
      concluido: Boolean(ag.concluido),          // chegou
      faltou: Boolean(ag.faltou) && !ag.concluido, // faltou (vai para o histórico de faltas)
      criadoEm: Number(ag.criadoEm) || Date.now(),
      atualizadoEm: Number(ag.atualizadoEm) || Date.now()
    }),
    espera: es => ({
      id: String(es.id),
      nome: texto(es.nome, 80),
      telefone: texto(es.telefone, 30),
      servico: texto(es.servico, 60),
      observacao: texto(es.observacao, 120),
      criadoEm: Number(es.criadoEm) || Date.now(),
      atualizadoEm: Number(es.atualizadoEm) || Date.now()
    })
  };
  const NOMES = Object.keys(COLECOES);
  const limpar = (colecao, item) => COLECOES[colecao](item);

  // Descobre o modo pela configuração do firebase-config.js.
  function lerConfiguracao() {
    const c = window.FIREBASE_CONFIG;
    if (c === undefined || c === null || typeof c !== 'object') return { modo: 'erro-config' };
    if (c.apiKey && c.projectId) return { modo: 'nuvem', config: c };
    return { modo: 'local' };
  }

  /* ------------------------------------------------------------------
     MODO LOCAL (IndexedDB)
     ------------------------------------------------------------------ */

  function abrirBanco() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB indisponível')); return; }
      const pedido = indexedDB.open('agenda-oficina', 2);
      pedido.onupgradeneeded = () => {
        const banco = pedido.result;
        NOMES.forEach(nome => {
          if (!banco.objectStoreNames.contains(nome)) banco.createObjectStore(nome, { keyPath: 'id' });
        });
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => reject(pedido.error);
      pedido.onblocked = () => reject(new Error('Banco bloqueado por outra aba'));
    });
  }

  function lerTodos(banco, nome) {
    return new Promise((resolve, reject) => {
      const tx = banco.transaction(nome, 'readonly');
      const pedido = tx.objectStore(nome).getAll();
      tx.oncomplete = () => resolve(pedido.result || []);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Grava várias mudanças de uma vez (ou todas, ou nenhuma).
  function gravarLote(banco, operacoes) {
    const lojas = Array.from(new Set(operacoes.map(op => op.colecao)));
    return new Promise((resolve, reject) => {
      const tx = banco.transaction(lojas, 'readwrite');
      operacoes.forEach(op => {
        const loja = tx.objectStore(op.colecao);
        if (op.acao === 'salvar') loja.put(op.item);
        else loja.delete(op.id);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /* Login do modo local.
     A senha NÃO fica escrita aqui: guardamos só um "resumo" embaralhado
     (PBKDF2) do e-mail + senha. O app faz a mesma conta com o que foi
     digitado e compara os resultados. No modo nuvem, quem confere a senha
     é o Firebase (o usuário é criado lá, no README, parte 1, passo 3). */
  const ACESSO = {
    sal: 'b0311f63b68b818dabacfe2e29f0a34f',
    iteracoes: 300000,
    resumo: 'ab8894d4e4dcb87fa5830b3022a07f9b3f71a0bf2925559901e1abf94e011a76'
  };

  async function resumoDoAcesso(email, senha) {
    if (!window.crypto || !crypto.subtle) {
      const erro = new Error('Criptografia indisponível');
      erro.code = 'local/sem-cripto';
      throw erro;
    }
    const codificador = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      'raw', codificador.encode(String(email).trim().toLowerCase() + ':' + senha), 'PBKDF2', false, ['deriveBits']);
    const sal = Uint8Array.from(ACESSO.sal.match(/../g).map(par => parseInt(par, 16)));
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ACESSO.iteracoes }, chave, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const CHAVE_SESSAO = 'agenda-oficina:sessao';
  let sessaoNaMemoria = null;
  function lerSessao() { try { return localStorage.getItem(CHAVE_SESSAO); } catch (e) { return sessaoNaMemoria; } }
  function gravarSessao(email) { sessaoNaMemoria = email; try { localStorage.setItem(CHAVE_SESSAO, email); } catch (e) { /* fica só na memória */ } }
  function apagarSessao() { sessaoNaMemoria = null; try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* ignorar */ } }

  // Reserva para navegadores sem IndexedDB.
  const chaveReserva = nome => 'agenda-oficina:' + nome;
  function lerReserva(nome) { try { return JSON.parse(localStorage.getItem(chaveReserva(nome)) || '[]'); } catch (e) { return []; } }
  function gravarReserva(nome, lista) { try { localStorage.setItem(chaveReserva(nome), JSON.stringify(lista)); } catch (e) { /* sem espaço ou bloqueado */ } }

  const Local = {
    banco: null,
    listas: { agendamentos: [], espera: [] },
    ouvintes: { agendamentos: new Set(), espera: new Set() },
    canal: null,
    usuarioAtual: null,
    aoMudarUsuario: null,

    async iniciar(aoMudarUsuario) {
      await this.carregar();
      this.aoMudarUsuario = aoMudarUsuario || null;
      const email = lerSessao();
      this.usuarioAtual = email ? { email } : null;
      if (this.aoMudarUsuario) this.aoMudarUsuario(this.usuarioAtual);
    },

    async entrar(email, senha) {
      const resumo = await resumoDoAcesso(email, senha);
      if (resumo !== ACESSO.resumo) {
        const erro = new Error('E-mail ou senha incorretos');
        erro.code = 'auth/invalid-credential';
        throw erro;
      }
      this.usuarioAtual = { email: String(email).trim().toLowerCase() };
      gravarSessao(this.usuarioAtual.email);
      if (this.aoMudarUsuario) this.aoMudarUsuario(this.usuarioAtual);
    },

    async sair() {
      apagarSessao();
      this.usuarioAtual = null;
      if (this.aoMudarUsuario) this.aoMudarUsuario(null);
    },

    usuario() { return this.usuarioAtual ? this.usuarioAtual.email : null; },

    async carregar() {
      try {
        this.banco = await abrirBanco();
        for (const nome of NOMES) this.listas[nome] = await lerTodos(this.banco, nome);
      } catch (erro) {
        console.warn('Usando o armazenamento reserva (localStorage):', erro);
        this.banco = null;
        NOMES.forEach(nome => { this.listas[nome] = lerReserva(nome); });
      }
      // Se o app estiver aberto em duas abas, uma avisa a outra.
      if ('BroadcastChannel' in window) {
        this.canal = new BroadcastChannel('agenda-oficina');
        this.canal.onmessage = () => this.recarregar();
      }
    },

    async recarregar() {
      for (const nome of NOMES) {
        this.listas[nome] = this.banco ? await lerTodos(this.banco, nome) : lerReserva(nome);
        this.avisar(nome);
      }
    },

    avisar(nome) {
      const copia = this.listas[nome].map(item => ({ ...item }));
      this.ouvintes[nome].forEach(cb => cb(copia, { pendente: false, doCache: false }));
    },

    observar(nome, cb) {
      this.ouvintes[nome].add(cb);
      cb(this.listas[nome].map(item => ({ ...item })), { pendente: false, doCache: false });
      return () => this.ouvintes[nome].delete(cb);
    },

    async lote(operacoes) {
      if (this.banco) await gravarLote(this.banco, operacoes);
      const mudaram = new Set();
      operacoes.forEach(op => {
        mudaram.add(op.colecao);
        const lista = this.listas[op.colecao];
        if (op.acao === 'salvar') {
          const i = lista.findIndex(x => x.id === op.item.id);
          if (i >= 0) lista[i] = op.item; else lista.push(op.item);
        } else {
          this.listas[op.colecao] = lista.filter(x => x.id !== op.id);
        }
      });
      mudaram.forEach(nome => {
        if (!this.banco) gravarReserva(nome, this.listas[nome]);
        this.avisar(nome);
      });
      if (this.canal) this.canal.postMessage('mudou');
    }
  };

  /* ------------------------------------------------------------------
     MODO NUVEM (Firebase: login + Firestore com cache offline)
     ------------------------------------------------------------------ */

  const Nuvem = {
    m: null,          // partes do Firebase carregadas
    auth: null,
    db: null,
    usuarioAtual: null,
    aoErro: null,

    async iniciar(config, aoMudarUsuario) {
      // Baixa as partes do Firebase (depois da primeira vez, ficam guardadas no aparelho).
      const [mApp, mAuth, mFs] = await Promise.all([
        import(CDN + 'firebase-app.js'),
        import(CDN + 'firebase-auth.js'),
        import(CDN + 'firebase-firestore.js')
      ]);
      this.m = { app: mApp, auth: mAuth, fs: mFs };

      const app = mApp.initializeApp(config);

      // O login fica salvo no aparelho: a equipe entra uma vez só.
      this.auth = mAuth.initializeAuth(app, {
        persistence: [mAuth.indexedDBLocalPersistence, mAuth.browserLocalPersistence]
      });

      // Cache offline: as listas abrem e funcionam mesmo sem internet.
      try {
        this.db = mFs.initializeFirestore(app, {
          localCache: mFs.persistentLocalCache({ tabManager: mFs.persistentMultipleTabManager() })
        });
      } catch (erro) {
        console.warn('Cache offline indisponível; usando o padrão.', erro);
        this.db = mFs.getFirestore(app);
      }

      // Espera saber se já tem alguém conectado neste aparelho.
      await new Promise(resolve => {
        let primeiraVez = true;
        mAuth.onAuthStateChanged(this.auth, usuario => {
          this.usuarioAtual = usuario;
          if (aoMudarUsuario) aoMudarUsuario(usuario);
          if (primeiraVez) { primeiraVez = false; resolve(); }
        });
      });
    },

    entrar(email, senha) { return this.m.auth.signInWithEmailAndPassword(this.auth, email, senha); },
    sair() { return this.m.auth.signOut(this.auth); },
    usuario() { return this.usuarioAtual ? this.usuarioAtual.email : null; },

    observar(nome, cb, aoErro) {
      const fs = this.m.fs;
      return fs.onSnapshot(
        fs.collection(this.db, nome),
        { includeMetadataChanges: true },
        foto => {
          const lista = foto.docs.map(d => limpar(nome, { ...d.data(), id: d.id }));
          cb(lista, { pendente: foto.metadata.hasPendingWrites, doCache: foto.metadata.fromCache });
        },
        erro => { if (aoErro) aoErro(erro); }
      );
    },

    // Não esperamos o servidor responder: o Firestore guarda a mudança no
    // aparelho na hora (a tela atualiza) e envia quando houver internet.
    lote(operacoes) {
      const fs = this.m.fs;
      for (let i = 0; i < operacoes.length; i += 400) {
        const lote = fs.writeBatch(this.db);
        operacoes.slice(i, i + 400).forEach(op => {
          const ref = fs.doc(this.db, op.colecao, op.acao === 'salvar' ? op.item.id : op.id);
          if (op.acao === 'salvar') lote.set(ref, op.item);
          else lote.delete(ref);
        });
        lote.commit().catch(erro => this.falhou(erro));
      }
      return Promise.resolve();
    },

    falhou(erro) {
      console.error(erro);
      if (this.aoErro) this.aoErro(erro);
    }
  };

  /* ------------------------------------------------------------------
     O que o resto do app usa
     ------------------------------------------------------------------ */

  const cfg = lerConfiguracao();
  let atual = null;

  function prepararOperacao(op) {
    return op.acao === 'salvar'
      ? { acao: 'salvar', colecao: op.colecao, item: limpar(op.colecao, op.item) }
      : { acao: 'excluir', colecao: op.colecao, id: String(op.id) };
  }

  window.Dados = {
    modo: cfg.modo,

    async iniciar({ aoMudarUsuario, aoErro } = {}) {
      if (cfg.modo === 'nuvem') {
        atual = Nuvem;
        Nuvem.aoErro = aoErro || null;
        await Nuvem.iniciar(cfg.config, aoMudarUsuario);
      } else {
        atual = Local;
        await Local.iniciar(aoMudarUsuario);
      }
    },

    entrar: (email, senha) => atual.entrar(email, senha),
    sair: () => (atual && atual.sair ? atual.sair() : Promise.resolve()),
    usuario: () => (atual && atual.usuario ? atual.usuario() : null),

    // colecao: 'agendamentos' ou 'espera'
    observar: (colecao, cb, aoErro) => atual.observar(colecao, cb, aoErro),
    salvar: (colecao, item) => atual.lote([prepararOperacao({ acao: 'salvar', colecao, item })]),
    excluir: (colecao, id) => atual.lote([prepararOperacao({ acao: 'excluir', colecao, id })]),

    // Várias mudanças juntas. Ex.: agendar um cliente da espera
    // (salva o agendamento e tira da lista de espera ao mesmo tempo).
    lote: operacoes => (operacoes.length ? atual.lote(operacoes.map(prepararOperacao)) : Promise.resolve())
  };
})();
