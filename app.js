/*
  app.js: o "cérebro" do app
  ==========================

  Mostra as telas, monta as listas (agenda e lista de espera) e responde
  aos toques. Quem guarda os dados é o dados.js; quem cuida de datas e
  lembretes é o lembretes.js. Este arquivo só junta tudo.
*/
(function () {
  'use strict';

  /* ---------- Atalhos e configurações ---------- */

  const $ = (seletor, base = document) => base.querySelector(seletor);
  const $$ = (seletor, base = document) => Array.from(base.querySelectorAll(seletor));

  // Serviços sugeridos (para mudar a lista, edite aqui)
  const SERVICOS = ['Troca de óleo', 'Revisão', 'Freios', 'Alinhamento e balanceamento', 'Suspensão', 'Elétrica', 'Diagnóstico'];
  const OUTRO = '__outro';
  const DURACAO_GAVETA = 340;
  const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');
  const telaPequena = window.matchMedia('(max-width: 719px)');
  const ehInstalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const estado = {
    aba: 'agenda',                 // 'agenda' ou 'espera'
    lista: [],                     // agendamentos
    espera: [],                    // lista de espera
    assinaturas: { agendamentos: null, espera: null },
    carregado: { agendamentos: false, espera: false },
    pendentes: { agendamentos: false, espera: false },
    busca: '',
    hoje: Datas.hoje(),
    editandoId: null,
    deEsperaId: null,              // cliente da espera sendo agendado
    esperaEditandoId: null,
    detalheId: null,
    esperaDetalheId: null,
    salvoAtual: null,
    destacarId: null,
    recemId: null,
    primeiraVez: true,
    erroNuvem: false,
    online: navigator.onLine,
    paradas: [],
    eventoInstalar: null,
    contador: 0
  };

  /* ---------- Pequenas ajudas ---------- */

  function esc(texto) {
    return String(texto == null ? '' : texto).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const plural = (n, um, varios) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);
  const buscarAg = id => estado.lista.find(ag => ag.id === id) || null;
  const buscarEspera = id => estado.espera.find(es => es.id === id) || null;
  const nomeTransicao = (prefixo, id) => prefixo + '-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const tempo = ms => (movimentoReduzido.matches ? 0 : ms);

  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function lerFlag(nome) { try { return localStorage.getItem('agenda-oficina:' + nome) === '1'; } catch (e) { return false; } }
  function gravarFlag(nome) { try { localStorage.setItem('agenda-oficina:' + nome, '1'); } catch (e) { /* ignorar */ } }

  // Ordem dentro de um dia: pendentes primeiro, por hora; "sem hora" no fim.
  function ordenarDia(a, b) {
    if (a.concluido !== b.concluido) return a.concluido ? 1 : -1;
    if (a.hora && b.hora) return a.hora.localeCompare(b.hora) || a.nome.localeCompare(b.nome, 'pt-BR');
    if (a.hora) return -1;
    if (b.hora) return 1;
    return (a.criadoEm || 0) - (b.criadoEm || 0);
  }
  const porDataEHora = (a, b) => a.data.localeCompare(b.data) || ordenarDia(a, b);

  // Lista de espera: quem chegou primeiro fica na frente.
  const filaDeEspera = () => estado.espera.slice().sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));

  function agruparPorData(itens) {
    const grupos = new Map();
    itens.forEach(ag => {
      if (!grupos.has(ag.data)) grupos.set(ag.data, []);
      grupos.get(ag.data).push(ag);
    });
    return Array.from(grupos.entries());
  }

  // "Quarta-feira, 11/11/2026 às 10:00. Revisão."
  function quando(ag) {
    const dia = Datas.extenso(ag.data) + (ag.hora ? ` às ${ag.hora}` : ', sem hora marcada');
    return `${dia}.${ag.servico ? ` ${ag.servico}.` : ''}`;
  }
  const resumo = ag => `${ag.nome}. ${quando(ag)}`;

  // Telefone: "(11) 98765-4321" para mostrar; só números para ligar e mandar mensagem.
  const soDigitos = t => String(t || '').replace(/\D/g, '');
  function telefoneComPais(t) {
    const d = soDigitos(t);
    if (d.length === 10 || d.length === 11) return '55' + d;
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
    return '';
  }
  function formatarTelefone(t) {
    const d = soDigitos(t);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return String(t || '').trim();
  }
  function linkLigar(t) {
    const comPais = telefoneComPais(t);
    if (comPais) return 'tel:+' + comPais;
    const d = soDigitos(t);
    return d.length >= 8 ? 'tel:' + d : '';
  }
  function linkWhatsApp(es) {
    const comPais = telefoneComPais(es.telefone);
    if (!comPais) return '';
    const primeiroNome = es.nome.split(' ')[0];
    const texto = `Olá, ${primeiroNome}! Aqui é da oficina. Abriu um horário para o seu atendimento. Podemos agendar?`;
    return `https://wa.me/${comPais}?text=${encodeURIComponent(texto)}`;
  }

  function tempoNaEspera(es) {
    const dias = Datas.diasDesde(es.criadoEm);
    if (dias === 0) return 'Entrou hoje';
    if (dias === 1) return 'Na espera desde ontem';
    return `Na espera há ${dias} dias`;
  }

  /* ---------- Telas inteiras ---------- */

  const telas = {
    carregando: $('#telaCarregando'),
    login: $('#telaLogin'),
    erro: $('#telaErro'),
    app: $('#app')
  };

  function mostrarTela(nome) {
    Object.entries(telas).forEach(([chave, el]) => {
      if (chave === nome) return;
      el.classList.remove('visivel');
      el.hidden = true;
    });
    const el = telas[nome];
    if (!el.hidden && el.classList.contains('visivel')) return;
    el.hidden = false;
    void el.offsetWidth; // força o navegador a desenhar antes de animar
    el.classList.add('visivel');
  }

  function mostrarErroTela(titulo, texto) {
    $('#erroTitulo').textContent = titulo;
    $('#erroTexto').textContent = texto;
    mostrarTela('erro');
  }

  /* ---------- Gavetas (sobem de baixo) ---------- */

  const fundo = $('#fundo');
  let gavetaAberta = null;
  let focoAnterior = null;

  function animarSaida(gaveta) {
    gaveta.classList.remove('aberta');
    setTimeout(() => {
      if (!gaveta.classList.contains('aberta')) {
        gaveta.hidden = true;
        gaveta.style.transform = '';
      }
    }, tempo(DURACAO_GAVETA));
  }

  function abrirGaveta(gaveta) {
    if (gavetaAberta === gaveta) return;
    esconderToast();
    if (gavetaAberta) animarSaida(gavetaAberta);
    else focoAnterior = document.activeElement;
    gavetaAberta = gaveta;
    fundo.hidden = false;
    gaveta.hidden = false;
    gaveta.scrollTop = 0;
    void gaveta.offsetWidth;
    fundo.classList.add('aberto');
    gaveta.classList.add('aberta');
    document.documentElement.classList.add('travado');
  }

  function fecharGaveta() {
    const gaveta = gavetaAberta;
    if (!gaveta) return;
    gavetaAberta = null;
    animarSaida(gaveta);
    fundo.classList.remove('aberto');
    setTimeout(() => {
      if (!gavetaAberta) {
        fundo.hidden = true;
        document.documentElement.classList.remove('travado');
      }
    }, tempo(DURACAO_GAVETA));
    if (focoAnterior && document.contains(focoAnterior) && focoAnterior.focus) {
      focoAnterior.focus({ preventScroll: true });
    }
    focoAnterior = null;
    aoFecharGaveta();
  }

  // Fecha a gaveta e só depois faz a ação (a lista anima sem a gaveta na frente).
  function depoisDeFechar(acao) {
    const havia = Boolean(gavetaAberta);
    fecharGaveta();
    if (havia) setTimeout(acao, tempo(DURACAO_GAVETA - 60));
    else acao();
  }

  function aoFecharGaveta() {
    if (!estado.destacarId) return;
    const id = estado.destacarId;
    estado.destacarId = null;
    setTimeout(() => destacarItem(id), tempo(DURACAO_GAVETA - 80));
  }

  function destacarItem(id) {
    const item = $$('#lista .item').find(li => li.dataset.id === id);
    if (!item) return;
    const caixa = item.getBoundingClientRect();
    if (caixa.top < 0 || caixa.bottom > window.innerHeight - 90) {
      item.scrollIntoView({ behavior: movimentoReduzido.matches ? 'auto' : 'smooth', block: 'center' });
    }
    item.classList.remove('destaque');
    void item.offsetWidth;
    item.classList.add('destaque');
  }

  // Arrastar a gaveta para baixo fecha (só no celular).
  function ativarArraste(gaveta) {
    let inicioY = null;
    let deslocamento = 0;
    const comecar = e => {
      if (e.pointerType === 'mouse' || !telaPequena.matches) return;
      if (e.target.closest('button, input, a')) return;
      inicioY = e.clientY;
      deslocamento = 0;
      gaveta.classList.add('arrastando');
      if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    };
    const mover = e => {
      if (inicioY === null) return;
      deslocamento = Math.max(0, e.clientY - inicioY);
      gaveta.style.transform = `translateY(${deslocamento}px)`;
    };
    const soltar = () => {
      if (inicioY === null) return;
      inicioY = null;
      gaveta.classList.remove('arrastando');
      if (deslocamento > 90) {
        gaveta.style.transform = 'translateY(105%)';
        fecharGaveta();
      } else {
        gaveta.style.transform = '';
      }
    };
    $$('.gaveta-alca, .gaveta-topo', gaveta).forEach(alvo => {
      alvo.addEventListener('pointerdown', comecar);
      alvo.addEventListener('pointermove', mover);
      alvo.addEventListener('pointerup', soltar);
      alvo.addEventListener('pointercancel', soltar);
    });
  }

  // Mantém o Tab dentro da gaveta aberta (para quem usa teclado).
  function prenderFoco(e) {
    if (e.key !== 'Tab' || !gavetaAberta || !$('#dialogo').hidden) return;
    const focaveis = $$('button, input, [href], [tabindex]:not([tabindex="-1"])', gavetaAberta)
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    else if (!gavetaAberta.contains(document.activeElement)) { e.preventDefault(); primeiro.focus(); }
  }

  /* ---------- Caixa de confirmação ---------- */

  function confirmar({ titulo, texto = '', ok = 'Confirmar', perigo = false }) {
    return new Promise(resolve => {
      const caixa = $('#dialogo');
      const btnOk = $('#dialogoOk');
      const btnCancelar = $('#dialogoCancelar');
      const anterior = document.activeElement;
      $('#dialogoTitulo').textContent = titulo;
      $('#dialogoTexto').textContent = texto;
      btnOk.textContent = ok;
      btnOk.className = 'btn ' + (perigo ? 'btn-perigo' : 'btn-acao');
      caixa.hidden = false;
      void caixa.offsetWidth;
      caixa.classList.add('aberto');
      btnCancelar.focus();

      const teclas = e => {
        if (e.key === 'Escape') { e.stopPropagation(); fechar(false); }
        if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === btnOk ? btnCancelar : btnOk).focus(); }
      };
      function fechar(valor) {
        caixa.classList.remove('aberto');
        setTimeout(() => { caixa.hidden = true; }, tempo(200));
        btnOk.onclick = null;
        btnCancelar.onclick = null;
        caixa.onclick = null;
        document.removeEventListener('keydown', teclas, true);
        if (anterior && document.contains(anterior) && anterior.focus) anterior.focus({ preventScroll: true });
        resolve(valor);
      }
      btnOk.onclick = () => fechar(true);
      btnCancelar.onclick = () => fechar(false);
      caixa.onclick = e => { if (e.target === caixa) fechar(false); };
      document.addEventListener('keydown', teclas, true);
    });
  }

  /* ---------- Mensagem rápida (toast) ---------- */

  let relogioToast = null;
  function avisar(mensagem, { acao, aoClicar, duracao = 3200 } = {}) {
    const toast = $('#toast');
    toast.innerHTML = `<span>${esc(mensagem)}</span>` + (acao ? `<button type="button">${esc(acao)}</button>` : '');
    if (acao) {
      toast.querySelector('button').onclick = () => { esconderToast(); if (aoClicar) aoClicar(); };
    }
    toast.classList.remove('visivel');
    void toast.offsetWidth;
    toast.classList.add('visivel');
    clearTimeout(relogioToast);
    relogioToast = setTimeout(esconderToast, acao ? Math.max(duracao, 5000) : duracao);
  }
  function esconderToast() { $('#toast').classList.remove('visivel'); }

  /* ---------- Cabeçalho (resumo de hoje e abas) ---------- */

  function atualizarCabecalho() {
    const hoje = estado.hoje;
    $('#resumoData').textContent = Datas.longa(hoje);

    const doDia = estado.lista.filter(ag => ag.data === hoje);
    const chegaram = doDia.filter(ag => ag.concluido).length;
    const faltaram = doDia.filter(ag => ag.faltou).length;
    const resolvidos = chegaram + faltaram;
    const barra = $('#progresso');

    if (!estado.carregado.agendamentos) {
      $('#resumoTexto').textContent = 'Carregando…';
      barra.hidden = true;
      $('#resumoDetalhe').textContent = '';
    } else {
      $('#resumoTexto').textContent = doDia.length
        ? plural(doDia.length, 'agendamento hoje', 'agendamentos hoje')
        : 'Nenhum agendamento hoje';
      barra.hidden = !doDia.length;
      barra.setAttribute('aria-valuemax', String(doDia.length));
      barra.setAttribute('aria-valuenow', String(resolvidos));
      barra.style.setProperty('--p', doDia.length ? `${(resolvidos / doDia.length) * 100}%` : '0%');
      const partes = [];
      if (doDia.length) partes.push(chegaram === 1 ? '1 chegou' : `${chegaram} chegaram`);
      if (faltaram) partes.push(faltaram === 1 ? '1 faltou' : `${faltaram} faltaram`);
      $('#resumoDetalhe').textContent = partes.join(', ');
    }

    const faltas = estado.lista.filter(ag => ag.faltou).length;
    $('#contadorFaltas').textContent = String(faltas);
    $('#contadorFaltas').hidden = !faltas;

    const naEspera = estado.espera.length;
    const contador = $('#contadorEspera');
    contador.textContent = String(naEspera);
    contador.hidden = !naEspera;
    $('#abaEspera').setAttribute('aria-label', `Lista de espera${naEspera ? `, ${plural(naEspera, 'cliente', 'clientes')}` : ''}`);
  }

  function trocarAba(aba) {
    if (estado.aba === aba) return;
    estado.aba = aba;
    $$('.aba').forEach(botao => {
      const ativa = botao.dataset.aba === aba;
      botao.setAttribute('aria-selected', String(ativa));
      botao.tabIndex = ativa ? 0 : -1;
    });
    $('#lista').setAttribute('aria-labelledby', aba === 'espera' ? 'abaEspera' : 'abaAgenda');
    const busca = $('#busca');
    busca.placeholder = aba === 'espera' ? 'Buscar na lista de espera' : 'Buscar cliente pelo nome';
    busca.setAttribute('aria-label', busca.placeholder);
    atualizarFab();
    renderizar({ trocaDeAba: true });
  }

  function atualizarFab() {
    const espera = estado.aba === 'espera';
    $('#btnNovo span').textContent = espera ? 'Adicionar à espera' : 'Novo agendamento';
  }

  /* ---------- Situação da sincronização ---------- */

  function atualizarStatus() {
    let tipo;
    let rotulo;
    const pendente = estado.pendentes.agendamentos || estado.pendentes.espera;
    if (Dados.modo !== 'nuvem') { tipo = 'local'; rotulo = 'Neste aparelho'; }
    else if (estado.erroNuvem) { tipo = 'erro'; rotulo = 'Sem acesso'; }
    else if (!estado.online) { tipo = 'offline'; rotulo = 'Sem internet'; }
    else if (pendente) { tipo = 'enviando'; rotulo = 'Enviando'; }
    else { tipo = 'ok'; rotulo = 'Sincronizado'; }
    $('#status').dataset.tipo = tipo;
    $('#statusTexto').textContent = rotulo;
    $('#status').setAttribute('aria-label', `Situação: ${rotulo}. Toque para saber mais.`);
  }

  function explicarStatus() {
    const textos = {
      local: 'As informações estão salvas só neste aparelho. Para todos verem a mesma agenda, configure o Firebase (README, parte 1).',
      erro: 'Sem permissão para acessar a agenda. Confira as regras do Firestore e o e-mail da equipe (README, parte 1, passo 5).',
      offline: 'Sem internet. Pode continuar usando: tudo é enviado quando a conexão voltar.',
      enviando: 'Enviando as últimas mudanças para os outros aparelhos.',
      ok: 'Tudo certo: os outros aparelhos já veem as mesmas informações.'
    };
    avisar(textos[$('#status').dataset.tipo] || textos.ok, { duracao: 6000 });
  }

  /* ---------- Agenda: montar a lista ---------- */

  // Selo que mostra a situação: "Chegou" (verde) ou "Faltou" (vermelho).
  function seloSituacao(ag) {
    if (ag.concluido) return '<span class="selo-situacao chegou"><svg aria-hidden="true"><use href="#i-check"/></svg>Chegou</span>';
    if (ag.faltou) return '<span class="selo-situacao faltou"><svg aria-hidden="true"><use href="#i-x"/></svg>Faltou</span>';
    return '';
  }

  // acoes: mostra os botões "Chegou" e "Faltou" (para hoje e dias que já passaram).
  function itemHTML(ag, { comData = false, acoes = false, semTransicao = false } = {}) {
    let canhoto;
    if (comData) {
      canhoto = `<span class="item-hora com-data"><b>${Datas.curta(ag.data)}</b><small>${ag.hora ? esc(ag.hora) : 'sem hora'}</small></span>`;
    } else if (ag.hora) {
      canhoto = `<span class="item-hora">${esc(ag.hora)}</span>`;
    } else {
      canhoto = '<span class="item-hora"><small>sem<br>hora</small></span>';
    }
    const classes = ['item'];
    if (ag.concluido) classes.push('feito');
    if (ag.faltou) classes.push('faltou');
    if (ag.id === estado.recemId) classes.push('recem');
    const estilo = [`--i:${Math.min(estado.contador++, 14)}`];
    if (!semTransicao) estilo.push(`view-transition-name:${nomeTransicao('ag', ag.id)}`);

    const pendente = !ag.concluido && !ag.faltou;
    const botoes = acoes && pendente ? `
      <div class="item-acoes">
        <button type="button" class="acao acao-chegou" data-chegou="${esc(ag.id)}" aria-label="${esc(ag.nome)} chegou">
          <svg aria-hidden="true"><use href="#i-check"/></svg>Chegou
        </button>
        <button type="button" class="acao acao-faltou" data-faltou="${esc(ag.id)}" aria-label="${esc(ag.nome)} faltou">
          <svg aria-hidden="true"><use href="#i-x"/></svg>Faltou
        </button>
      </div>` : '';

    return `<li class="${classes.join(' ')}" data-id="${esc(ag.id)}" style="${estilo.join(';')}">
      <button type="button" class="item-corpo" data-abrir="${esc(ag.id)}">
        ${canhoto}
        <span class="item-info">
          <span class="item-nome">${esc(ag.nome)}</span>
          ${ag.servico ? `<span class="item-servico">${esc(ag.servico)}</span>` : ''}
          ${seloSituacao(ag)}
        </span>
      </button>${botoes}
    </li>`;
  }

  function secaoHTML(itens, { titulo, data = '', nivel = 2, classe = '', vazio = '', ...opcoes }) {
    const cabeca = `<header class="dia-cabeca"><h${nivel}>${esc(titulo)}</h${nivel}>` +
      (data ? `<span class="dia-data">${Datas.br(data)}</span>` : '') + '</header>';
    const corpo = itens.length
      ? `<ul class="dia-lista">${itens.map(ag => itemHTML(ag, opcoes)).join('')}</ul>`
      : vazio;
    return `<section class="dia ${classe}">${cabeca}${corpo}</section>`;
  }

  function quadroHTML() {
    const hoje = estado.hoje;
    // Quem faltou sai da agenda e fica só no histórico de Faltas.
    const ativos = estado.lista.filter(ag => !ag.faltou);
    const doDia = ativos.filter(ag => ag.data === hoje).sort(ordenarDia);
    const pendentes = ativos.filter(ag => ag.data < hoje && !ag.concluido).sort(porDataEHora);
    const proximos = ativos.filter(ag => ag.data > hoje).sort(porDataEHora);

    let principal = secaoHTML(doDia, {
      titulo: 'Hoje',
      data: hoje,
      classe: 'dia-hoje',
      acoes: true,
      vazio: `<div class="vazio"><p>Nenhum agendamento para hoje.</p>
        <button type="button" class="btn-texto" data-novo>Novo agendamento</button></div>`
    });
    if (pendentes.length) {
      principal += secaoHTML(pendentes, { titulo: 'Pendentes de dias anteriores', classe: 'dia-pendentes', comData: true, acoes: true });
    }

    let lado = '<h2 class="coluna-titulo">Próximos dias</h2>';
    const grupos = agruparPorData(proximos);
    lado += grupos.length
      ? grupos.map(([data, itens]) => secaoHTML(itens, { titulo: Datas.rotulo(data, hoje), data, nivel: 3 })).join('')
      : '<p class="vazio-curto">Nada marcado para os próximos dias.</p>';

    return `<div class="coluna">${principal}</div><div class="coluna">${lado}</div>`;
  }

  function buscaHTML() {
    const termo = semAcento(estado.busca.trim());
    const achados = estado.lista.filter(ag => semAcento(ag.nome).includes(termo));
    if (!achados.length) {
      return `<div class="coluna coluna-unica"><div class="vazio vazio-busca">
        <p>Nenhum agendamento encontrado com “${esc(estado.busca.trim())}”.</p></div></div>`;
    }
    const hoje = estado.hoje;
    const daquiPraFrente = achados.filter(ag => ag.data >= hoje).sort(porDataEHora);
    const anteriores = achados.filter(ag => ag.data < hoje).sort((a, b) => b.data.localeCompare(a.data) || ordenarDia(a, b));
    let html = `<p class="resultado-conta">${plural(achados.length, 'agendamento encontrado', 'agendamentos encontrados')}</p>`;
    if (daquiPraFrente.length) html += secaoHTML(daquiPraFrente, { titulo: 'De hoje em diante', comData: true });
    if (anteriores.length) html += secaoHTML(anteriores, { titulo: 'Anteriores', comData: true });
    return `<div class="coluna coluna-unica">${html}</div>`;
  }

  /* ---------- Lista de espera: montar a lista ---------- */

  function esperaItemHTML(es, posicao) {
    return `<li class="item item-espera" data-id="${esc(es.id)}"
        style="--i:${Math.min(estado.contador++, 14)};view-transition-name:${nomeTransicao('es', es.id)}">
      <button type="button" class="item-corpo" data-abrir-espera="${esc(es.id)}">
        <span class="item-hora item-posicao" aria-label="Posição ${posicao}">${posicao}º</span>
        <span class="item-info">
          <span class="item-nome">${esc(es.nome)}</span>
          ${es.servico ? `<span class="item-servico">${esc(es.servico)}</span>` : ''}
          <span class="item-meta">${esc(tempoNaEspera(es))}</span>
          ${es.observacao ? `<span class="item-obs">${esc(es.observacao)}</span>` : ''}
        </span>
      </button>
      <button type="button" class="item-agendar" data-agendar-espera="${esc(es.id)}" aria-label="Agendar ${esc(es.nome)}">
        <svg aria-hidden="true"><use href="#i-agendar"/></svg><span>Agendar</span>
      </button>
    </li>`;
  }

  function esperaHTML() {
    const fila = filaDeEspera();
    if (!fila.length) {
      return `<div class="coluna coluna-unica"><section class="dia">
        <header class="dia-cabeca"><h2>Lista de espera</h2></header>
        <div class="vazio"><p>Ninguém na lista de espera.</p>
          <p class="vazio-dica">Use para clientes que ainda não têm data. Quando abrir um horário, é só tocar em Agendar.</p>
          <button type="button" class="btn-texto" data-nova-espera>Adicionar à lista de espera</button></div>
      </section></div>`;
    }
    const termo = semAcento(estado.busca.trim());
    const comPosicao = fila.map((es, i) => ({ es, posicao: i + 1 }));
    const visiveis = termo ? comPosicao.filter(({ es }) => semAcento(es.nome).includes(termo)) : comPosicao;

    const cabeca = `<header class="dia-cabeca"><h2>Lista de espera</h2>
      <span class="dia-data">${plural(fila.length, 'cliente aguardando', 'clientes aguardando')}</span></header>`;
    const corpo = visiveis.length
      ? `<ul class="dia-lista">${visiveis.map(({ es, posicao }) => esperaItemHTML(es, posicao)).join('')}</ul>`
      : `<div class="vazio vazio-busca"><p>Ninguém na lista de espera com “${esc(estado.busca.trim())}”.</p></div>`;
    return `<div class="coluna coluna-unica coluna-espera"><section class="dia">${cabeca}
      <p class="dica">Ordem de chegada. Quando abrir um horário, toque em Agendar: o cliente sai da lista e vai para a agenda.</p>
      ${corpo}</section></div>`;
  }

  /* ---------- Desenhar a tela ---------- */

  function renderizar({ animar = true, trocaDeAba = false } = {}) {
    estado.hoje = Datas.hoje();
    estado.contador = 0;
    atualizarCabecalho();
    const alvo = $('#lista');
    const colecao = estado.aba === 'espera' ? 'espera' : 'agendamentos';

    if (!estado.carregado[colecao]) {
      alvo.innerHTML = '<div class="coluna coluna-unica carregando-lista" aria-label="Carregando"><span></span><span></span><span></span></div>';
      return;
    }

    let html;
    if (estado.aba === 'espera') html = esperaHTML();
    else html = estado.busca.trim() ? buscaHTML() : quadroHTML();

    const aplicar = () => { alvo.innerHTML = html; };
    const podeAnimar = !movimentoReduzido.matches && !document.hidden;

    if (trocaDeAba) {
      aplicar();
      if (podeAnimar) {
        alvo.classList.remove('trocando');
        void alvo.offsetWidth;
        alvo.classList.add('trocando');
      }
    } else if (animar && podeAnimar && !estado.primeiraVez && !gavetaAberta && typeof document.startViewTransition === 'function') {
      try { document.startViewTransition(aplicar); } catch (e) { aplicar(); }
    } else {
      aplicar();
    }

    if (estado.primeiraVez) {
      estado.primeiraVez = false;
      if (podeAnimar) {
        alvo.classList.add('entrada');
        setTimeout(() => alvo.classList.remove('entrada'), 1400);
      }
    }
    if (estado.recemId) {
      const id = estado.recemId;
      setTimeout(() => { if (estado.recemId === id) estado.recemId = null; }, 600);
    }
  }

  function aoClicarLista(e) {
    const alvo = e.target;
    const chegou = alvo.closest('[data-chegou]');
    if (chegou) { marcarSituacao(chegou.dataset.chegou, 'chegou'); return; }
    const faltou = alvo.closest('[data-faltou]');
    if (faltou) { marcarSituacao(faltou.dataset.faltou, 'faltou'); return; }
    const agendarEspera = alvo.closest('[data-agendar-espera]');
    if (agendarEspera) { agendarDaEspera(agendarEspera.dataset.agendarEspera); return; }
    const abrirEspera = alvo.closest('[data-abrir-espera]');
    if (abrirEspera) { abrirEsperaDetalhe(abrirEspera.dataset.abrirEspera); return; }
    const abrir = alvo.closest('[data-abrir]');
    if (abrir) { abrirDetalhe(abrir.dataset.abrir); return; }
    if (alvo.closest('[data-novo]')) { abrirFormulario(); return; }
    if (alvo.closest('[data-nova-espera]')) abrirFormEspera();
  }

  /* ---------- Dados chegando (do aparelho ou da nuvem) ---------- */

  function assinaturaDe(lista) {
    return JSON.stringify(lista.map(item => Object.keys(item).sort().map(chave => item[chave])).sort());
  }

  function aoReceber(colecao, lista, info = {}) {
    estado.pendentes[colecao] = Boolean(info.pendente);
    estado.erroNuvem = false;
    atualizarStatus();

    const assinatura = assinaturaDe(lista);
    const primeiraCarga = !estado.carregado[colecao];
    if (assinatura !== estado.assinaturas[colecao] || primeiraCarga) {
      estado.assinaturas[colecao] = assinatura;
      estado.carregado[colecao] = true;
      if (colecao === 'agendamentos') estado.lista = lista;
      else estado.espera = lista;
      const visivel = (colecao === 'espera') === (estado.aba === 'espera');
      if (visivel) renderizar(); else atualizarCabecalho();
      if (gavetaAberta === $('#gavetaDetalhe')) preencherDetalhe();
      if (gavetaAberta === $('#gavetaEsperaDetalhe')) preencherEsperaDetalhe();
    }

    // Aviso do dia: só depois de ter os dados do servidor (ou se estiver sem internet).
    if (colecao === 'agendamentos' && (!info.doCache || !estado.online)) Aviso.resumoDoDia(estado.lista);
  }

  function comecarAObservar() {
    pararDeObservar();
    estado.paradas = [
      Dados.observar('agendamentos', (lista, info) => aoReceber('agendamentos', lista, info), erroDaNuvem),
      Dados.observar('espera', (lista, info) => aoReceber('espera', lista, info), erroDaNuvem)
    ];
  }

  function pararDeObservar() {
    estado.paradas.forEach(parar => { try { if (parar) parar(); } catch (e) { /* ignorar */ } });
    estado.paradas = [];
  }


  function erroDaNuvem(erro) {
    const codigo = (erro && erro.code) || '';
    if (codigo.includes('permission-denied')) {
      estado.erroNuvem = true;
      atualizarStatus();
      avisar('Sem permissão para acessar a agenda. Confira as regras do Firestore e o e-mail da equipe (README, parte 1, passo 5).', { duracao: 9000 });
    } else if (codigo.includes('unauthenticated')) {
      avisar('A sessão expirou. Entre de novo com o e-mail e a senha da equipe.', { duracao: 7000 });
    } else {
      avisar(estado.online
        ? 'Não foi possível falar com o banco de dados agora. Tente de novo em instantes.'
        : 'Sem internet: as mudanças ficam guardadas e são enviadas depois.', { duracao: 6000 });
    }
  }

  function erroAoSalvar(erro) {
    console.error(erro);
    avisar('Não foi possível salvar neste aparelho. Feche e abra o app de novo.', { duracao: 6000 });
  }

  /* ---------- Escolha de serviço (usada nos dois formulários) ---------- */

  function criarSeletorServico(caixa, caixaOutro, campoOutro) {
    let valor = '';
    caixa.innerHTML = SERVICOS
      .map(s => `<button type="button" class="chip" data-servico="${esc(s)}" aria-pressed="false">${esc(s)}</button>`)
      .join('') + `<button type="button" class="chip" data-servico="${OUTRO}" aria-pressed="false">Outro</button>`;

    function definir(novo) {
      valor = novo;
      $$('.chip', caixa).forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.servico === novo)));
      if (novo === OUTRO) {
        if (caixaOutro.hidden) { caixaOutro.hidden = false; void caixaOutro.offsetWidth; }
        caixaOutro.classList.add('aberto');
      } else {
        caixaOutro.classList.remove('aberto');
        caixaOutro.hidden = true;
      }
    }

    caixa.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      definir(valor === chip.dataset.servico ? '' : chip.dataset.servico);
      if (valor === OUTRO) setTimeout(() => campoOutro.focus({ preventScroll: true }), tempo(120));
    });
    campoOutro.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); campoOutro.blur(); } });

    return {
      // Recebe o serviço salvo ("Freios", "Troca de embreagem"...) e marca a opção certa.
      definirTexto(texto) {
        if (!texto) { definir(''); campoOutro.value = ''; return; }
        if (SERVICOS.includes(texto)) { definir(texto); campoOutro.value = ''; return; }
        definir(OUTRO);
        campoOutro.value = texto;
      },
      texto() { return valor === OUTRO ? campoOutro.value.trim() : valor; }
    };
  }

  const servicoAgenda = criarSeletorServico($('#chipsServico'), $('#campoOutro'), $('#fOutro'));
  const servicoEspera = criarSeletorServico($('#chipsEsperaServico'), $('#campoEsperaOutro'), $('#eOutro'));

  function mostrarErro(campo, mensagem) {
    const caixa = $('#campo' + campo);
    caixa.classList.add('com-erro');
    $('#erro' + campo + ' span').textContent = mensagem;
  }

  function limparErro(campo) {
    $('#campo' + campo).classList.remove('com-erro');
    $('#erro' + campo + ' span').textContent = '';
  }

  /* ---------- Formulário de agendamento ---------- */

  function atualizarData() {
    const valor = $('#fData').value;
    const hoje = Datas.hoje();
    const valida = Datas.valida(valor);
    $$('.atalhos .chip').forEach(chip =>
      chip.setAttribute('aria-pressed', String(valida && Datas.somarDias(hoje, Number(chip.dataset.dia)) === valor)));
    $('#dataExtenso').textContent = valida ? Datas.extenso(valor) : '';
    $('#fData').classList.toggle('preenchido', valida);
    if (valida) limparErro('Data');
  }

  // ag: agendamento para editar. deEspera: cliente da lista de espera para agendar.
  // remarcar: cliente que faltou, para marcar uma nova data (a falta continua no histórico).
  function abrirFormulario(ag = null, { deEspera = null, remarcar = null } = {}) {
    const form = $('#formAgendamento');
    form.reset();
    estado.editandoId = ag ? ag.id : null;
    estado.deEsperaId = deEspera ? deEspera.id : null;

    $('#formTitulo').textContent = ag ? 'Editar agendamento'
      : deEspera ? 'Agendar cliente da espera'
        : remarcar ? 'Remarcar cliente' : 'Novo agendamento';
    $('#btnSalvar').textContent = ag ? 'Salvar alterações' : 'Salvar agendamento';
    const nota = $('#notaEspera');
    nota.hidden = !deEspera && !remarcar;
    nota.textContent = remarcar
      ? `Faltou em ${Datas.br(remarcar.data)}. Escolha a nova data; a falta continua no histórico.`
      : 'Cliente da lista de espera. Ao salvar, ele sai da lista e entra na agenda.';
    $('#btnParaEspera').hidden = Boolean(ag || deEspera || remarcar);
    limparErro('Nome');
    limparErro('Data');

    const origem = ag || deEspera || remarcar;
    $('#fNome').value = origem ? origem.nome : '';
    $('#fData').value = ag ? ag.data : '';
    $('#fHora').value = ag ? ag.hora : '';
    servicoAgenda.definirTexto(origem ? origem.servico : '');
    atualizarData();

    $('#telaSalvo').hidden = true;
    form.hidden = false;
    const jaAberta = gavetaAberta === $('#gavetaForm');
    abrirGaveta($('#gavetaForm'));
    if (jaAberta) $('#gavetaForm').scrollTop = 0;
    if (!origem) {
      setTimeout(() => {
        if (gavetaAberta === $('#gavetaForm') && !form.hidden) $('#fNome').focus({ preventScroll: true });
      }, tempo(DURACAO_GAVETA));
    }
  }

  async function aoEnviarFormulario(e) {
    e.preventDefault();
    const nome = $('#fNome').value.trim().replace(/\s+/g, ' ');
    const data = $('#fData').value;
    const hora = $('#fHora').value;

    let primeiroErro = null;
    if (!nome) { mostrarErro('Nome', 'Digite o nome do cliente.'); primeiroErro = 'nome'; }
    if (!Datas.valida(data)) { mostrarErro('Data', 'Escolha a data do agendamento.'); primeiroErro = primeiroErro || 'data'; }
    if (primeiroErro === 'nome') { $('#fNome').focus(); return; }
    if (primeiroErro === 'data') { $('#campoData').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

    const anterior = estado.editandoId ? buscarAg(estado.editandoId) : null;
    const deEsperaId = estado.deEsperaId;
    const agora = Date.now();
    const ag = {
      id: anterior ? anterior.id : novoId(),
      nome,
      data,
      hora: Datas.horaValida(hora) ? hora : '',
      servico: servicoAgenda.texto(),
      concluido: anterior ? anterior.concluido : false,
      faltou: anterior ? anterior.faltou : false,
      criadoEm: anterior ? anterior.criadoEm : agora,
      atualizadoEm: agora
    };

    const botao = $('#btnSalvar');
    botao.disabled = true;
    try {
      if (deEsperaId) {
        // Agenda e tira da lista de espera de uma vez só.
        await Dados.lote([
          { acao: 'salvar', colecao: 'agendamentos', item: ag },
          { acao: 'excluir', colecao: 'espera', id: deEsperaId }
        ]);
      } else {
        await Dados.salvar('agendamentos', ag);
      }
      estado.deEsperaId = null;
      estado.destacarId = estado.aba === 'agenda' ? ag.id : null;
      mostrarSalvo(ag, { editado: Boolean(anterior), saiuDaEspera: Boolean(deEsperaId) });
    } catch (erro) {
      erroAoSalvar(erro);
    } finally {
      botao.disabled = false;
    }
  }

  function prepararBotoesAgenda(caixa, { destacar = true } = {}) {
    const ics = $('[data-agenda="ics"]', caixa);
    const google = $('[data-agenda="google"]', caixa);
    const icsPrimeiro = Lembretes.ehIOS;
    caixa.prepend(icsPrimeiro ? ics : google);
    const principal = destacar ? 'btn btn-acao' : 'btn btn-secundario';
    ics.className = icsPrimeiro ? principal : 'btn btn-secundario';
    google.className = icsPrimeiro ? 'btn btn-secundario' : principal;
  }

  function mostrarSalvo(ag, { editado = false, saiuDaEspera = false } = {}) {
    estado.salvoAtual = ag;
    $('#formAgendamento').hidden = true;
    $('#formTitulo').textContent = editado ? 'Alterações salvas' : 'Agendamento salvo';
    $('#salvoTitulo').textContent = ag.nome;
    $('#salvoResumo').textContent = quando(ag) + (saiuDaEspera ? ' Saiu da lista de espera.' : '');
    prepararBotoesAgenda($('#salvoBotoes'));
    $('#salvoDica').textContent = Lembretes.ehIOS
      ? 'No iPhone, use “Calendário do celular”: o evento já vem com os alarmes.'
      : Lembretes.ehAndroid
        ? 'No Android, use “Google Agenda”. Os avisos seguem o padrão da sua Google Agenda.'
        : 'No computador, “Google Agenda” abre o evento pronto no navegador.';
    const tela = $('#telaSalvo');
    tela.hidden = false;
    tela.classList.remove('animar');
    void tela.offsetWidth;
    tela.classList.add('animar');
    $('#gavetaForm').scrollTop = 0;
  }

  /* ---------- Detalhes, concluir e excluir (agenda) ---------- */

  function abrirDetalhe(id) {
    estado.detalheId = id;
    if (!preencherDetalhe()) return;
    abrirGaveta($('#gavetaDetalhe'));
  }

  function preencherDetalhe() {
    const ag = buscarAg(estado.detalheId);
    if (!ag) {
      if (gavetaAberta === $('#gavetaDetalhe')) fecharGaveta();
      return false;
    }
    $('#detNome').textContent = ag.nome;
    $('#detData').textContent = Datas.extenso(ag.data);
    $('#detHora').textContent = ag.hora || 'Sem hora';
    $('#detServico').textContent = ag.servico || 'Não informado';
    $('#detSituacao').textContent = ag.concluido ? 'Chegou'
      : ag.faltou ? 'Faltou'
        : ag.data < Datas.hoje() ? 'Pendente (o dia já passou)' : 'Agendado';
    $('#detSituacao').className = ag.concluido ? 'texto-chegou' : ag.faltou ? 'texto-faltou' : '';

    let acoes;
    if (ag.concluido) {
      acoes = '<button type="button" class="btn btn-secundario" data-acao="desfazer"><svg aria-hidden="true"><use href="#i-desfazer"/></svg>Desfazer chegada</button>';
    } else if (ag.faltou) {
      acoes = '<button type="button" class="btn btn-acao" data-acao="remarcar"><svg aria-hidden="true"><use href="#i-remarcar"/></svg>Remarcar</button>' +
        '<button type="button" class="btn btn-secundario" data-acao="desfazer"><svg aria-hidden="true"><use href="#i-desfazer"/></svg>Desfazer falta</button>';
    } else {
      acoes = '<button type="button" class="btn acao-chegou" data-acao="chegou"><svg aria-hidden="true"><use href="#i-check"/></svg>Chegou</button>' +
        '<button type="button" class="btn acao-faltou" data-acao="faltou"><svg aria-hidden="true"><use href="#i-x"/></svg>Faltou</button>';
    }
    const caixa = $('#detAcoes');
    caixa.innerHTML = acoes;
    caixa.classList.toggle('uma-coluna', ag.concluido);
    prepararBotoesAgenda($('#detBotoes'), { destacar: false });
    // Quem faltou não precisa ir para a agenda do celular.
    $('#detRotuloAgenda').hidden = ag.faltou;
    $('#detBotoes').hidden = ag.faltou;
    return true;
  }

  // situacao: 'chegou', 'faltou' ou 'agendado' (desfaz as duas).
  async function marcarSituacao(id, situacao) {
    const ag = buscarAg(id);
    if (!ag) return;
    const novo = { ...ag, concluido: situacao === 'chegou', faltou: situacao === 'faltou', atualizadoEm: Date.now() };
    estado.recemId = situacao === 'chegou' ? id : null;
    const mensagens = {
      chegou: `${ag.nome} chegou`,
      faltou: `${ag.nome} faltou. Guardado em Faltas.`,
      agendado: `${ag.nome} voltou para a agenda`
    };
    try {
      await Dados.salvar('agendamentos', novo);
      avisar(mensagens[situacao], {
        acao: 'Desfazer',
        aoClicar: () => {
          estado.recemId = null;
          Dados.salvar('agendamentos', { ...ag, atualizadoEm: Date.now() }).catch(erroAoSalvar);
        }
      });
    } catch (erro) {
      erroAoSalvar(erro);
      renderizar({ animar: false });
    }
  }

  function aoClicarAcaoDetalhe(e) {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const id = estado.detalheId;
    const acao = botao.dataset.acao;
    if (acao === 'remarcar') {
      const ag = buscarAg(id);
      if (ag) abrirFormulario(null, { remarcar: ag });
      return;
    }
    const situacao = acao === 'desfazer' ? 'agendado' : acao;
    // Se a gaveta veio do histórico, volta a mostrar a lista atualizada.
    depoisDeFechar(() => marcarSituacao(id, situacao));
  }

  async function excluirAgendamento(id) {
    const ag = buscarAg(id);
    if (!ag) return;
    const ok = await confirmar({
      titulo: 'Excluir agendamento?',
      texto: `${resumo(ag)} Isso não pode ser desfeito.`,
      ok: 'Excluir',
      perigo: true
    });
    if (!ok) return;
    depoisDeFechar(async () => {
      try {
        await Dados.excluir('agendamentos', id);
        avisar('Agendamento excluído');
      } catch (erro) {
        erroAoSalvar(erro);
      }
    });
  }

  /* ---------- Lista de espera: formulário, detalhes e agendar ---------- */

  function abrirFormEspera(es = null, { nome = '', servico = '' } = {}) {
    $('#formEspera').reset();
    estado.esperaEditandoId = es ? es.id : null;
    $('#esperaTitulo').textContent = es ? 'Editar cliente da espera' : 'Adicionar à lista de espera';
    $('#btnSalvarEspera').textContent = es ? 'Salvar alterações' : 'Adicionar à lista';
    limparErro('EsperaNome');
    $('#eNome').value = es ? es.nome : nome;
    $('#eTelefone').value = es ? es.telefone : '';
    $('#eObs').value = es ? es.observacao : '';
    servicoEspera.definirTexto(es ? es.servico : servico);
    abrirGaveta($('#gavetaEspera'));
    if (!es) {
      const campo = nome ? $('#eTelefone') : $('#eNome');
      setTimeout(() => { if (gavetaAberta === $('#gavetaEspera')) campo.focus({ preventScroll: true }); }, tempo(DURACAO_GAVETA));
    }
  }

  async function aoEnviarEspera(e) {
    e.preventDefault();
    const nome = $('#eNome').value.trim().replace(/\s+/g, ' ');
    if (!nome) { mostrarErro('EsperaNome', 'Digite o nome do cliente.'); $('#eNome').focus(); return; }

    const anterior = estado.esperaEditandoId ? buscarEspera(estado.esperaEditandoId) : null;
    const agora = Date.now();
    const item = {
      id: anterior ? anterior.id : novoId(),
      nome,
      telefone: $('#eTelefone').value.trim(),
      servico: servicoEspera.texto(),
      observacao: $('#eObs').value.trim(),
      criadoEm: anterior ? anterior.criadoEm : agora,
      atualizadoEm: agora
    };

    const botao = $('#btnSalvarEspera');
    botao.disabled = true;
    try {
      await Dados.salvar('espera', item);
      estado.destacarId = item.id;
      fecharGaveta();
      if (estado.aba !== 'espera') trocarAba('espera');
      avisar(anterior ? 'Alterações salvas' : `${nome} entrou na lista de espera`);
    } catch (erro) {
      erroAoSalvar(erro);
    } finally {
      botao.disabled = false;
    }
  }

  function abrirEsperaDetalhe(id) {
    estado.esperaDetalheId = id;
    if (!preencherEsperaDetalhe()) return;
    abrirGaveta($('#gavetaEsperaDetalhe'));
  }

  function preencherEsperaDetalhe() {
    const es = buscarEspera(estado.esperaDetalheId);
    if (!es) {
      if (gavetaAberta === $('#gavetaEsperaDetalhe')) fecharGaveta();
      return false;
    }
    const posicao = filaDeEspera().findIndex(x => x.id === es.id) + 1;
    const dias = Datas.diasDesde(es.criadoEm);
    const quando = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
    $('#edNome').textContent = es.nome;
    $('#edPosicao').textContent = `${posicao}º da fila`;
    $('#edDesde').textContent = `${Datas.br(Datas.paraISO(new Date(es.criadoEm)))} (${quando})`;
    $('#edTelefone').textContent = es.telefone ? formatarTelefone(es.telefone) : 'Não informado';
    $('#edServico').textContent = es.servico || 'Não informado';
    $('#edObs').textContent = es.observacao || 'Nenhuma';

    const ligar = linkLigar(es.telefone);
    const whats = linkWhatsApp(es);
    $('#edLigar').hidden = !ligar;
    $('#edWhats').hidden = !whats;
    if (ligar) $('#edLigar').href = ligar;
    if (whats) $('#edWhats').href = whats;
    $('#edContato').hidden = !ligar && !whats;
    $('#edContato').classList.toggle('uma-coluna', !(ligar && whats));
    return true;
  }

  function agendarDaEspera(id) {
    const es = buscarEspera(id);
    if (es) abrirFormulario(null, { deEspera: es });
  }

  async function removerDaEspera(id) {
    const es = buscarEspera(id);
    if (!es) return;
    const ok = await confirmar({
      titulo: 'Remover da lista de espera?',
      texto: `${es.nome} vai sair da lista.`,
      ok: 'Remover',
      perigo: true
    });
    if (!ok) return;
    depoisDeFechar(async () => {
      try {
        await Dados.excluir('espera', id);
        avisar(`${es.nome} saiu da lista de espera`, {
          acao: 'Desfazer',
          aoClicar: () => Dados.salvar('espera', es).catch(erroAoSalvar)
        });
      } catch (erro) {
        erroAoSalvar(erro);
      }
    });
  }

  /* ---------- Menu ---------- */

  function abrirMenu() {
    const conta = $('#menuConta');
    const usuario = esc(Dados.usuario() || '');
    if (Dados.modo === 'nuvem') {
      conta.innerHTML = `<b>Agenda compartilhada</b><span>Conectado como ${usuario}</span>`;
    } else {
      conta.innerHTML = `<b>Salvando só neste aparelho</b><span>Conectado como ${usuario}. Para todos verem a mesma agenda, configure o Firebase (README, parte 1).</span>`;
    }
    $('#mInstalar').hidden = !estado.eventoInstalar;
    $('#mNotificacoes').hidden = Aviso.permissao() === 'granted';
    abrirGaveta($('#gavetaMenu'));
  }

  // tipo: 'chegaram' ou 'faltas'
  function abrirHistorico(tipo = 'chegaram') {
    const faltas = tipo === 'faltas';
    const itens = estado.lista.filter(ag => (faltas ? ag.faltou : ag.concluido))
      .sort((a, b) => b.data.localeCompare(a.data) || ordenarDia(a, b))
      .slice(0, 300);
    estado.contador = 0;
    $('#historicoTitulo').textContent = faltas ? 'Faltas' : 'Quem chegou';
    const resumoTopo = faltas && itens.length
      ? `<p class="dica dica-historico">${plural(itens.length, 'falta registrada', 'faltas registradas')}. Toque em um cliente para remarcar.</p>`
      : '';
    $('#historicoLista').innerHTML = itens.length
      ? resumoTopo + agruparPorData(itens).map(([data, grupo]) =>
        secaoHTML(grupo, { titulo: Datas.rotulo(data, estado.hoje), data, nivel: 3, semTransicao: true })).join('')
      : `<p class="vazio-curto">${faltas ? 'Nenhuma falta registrada.' : 'Ninguém marcado como "Chegou" ainda.'}</p>`;
    abrirGaveta($('#gavetaHistorico'));
  }

  async function ativarAvisos() {
    if (!Aviso.suportado()) {
      avisar(Lembretes.ehIOS
        ? 'No iPhone, instale o app na Tela de Início para receber avisos.'
        : 'Este navegador não mostra notificações.', { duracao: 6000 });
      return;
    }
    if (Aviso.permissao() === 'denied') {
      avisar('As notificações estão bloqueadas. Libere nas configurações do navegador para este site.', { duracao: 7000 });
      return;
    }
    const resposta = await Aviso.pedir();
    gravarFlag('dica-aviso');
    renderizarAvisos();
    if (resposta === 'granted') {
      if (gavetaAberta === $('#gavetaMenu')) fecharGaveta();
      avisar('Aviso do dia ativado');
      Aviso.resumoDoDia(estado.lista);
    } else if (resposta === 'denied') {
      avisar('Você bloqueou as notificações. Dá para liberar depois nas configurações do navegador.', { duracao: 7000 });
    }
  }

  async function instalarApp() {
    const evento = estado.eventoInstalar;
    if (!evento) return;
    fecharGaveta();
    evento.prompt();
    try { await evento.userChoice; } catch (e) { /* ignorar */ }
    estado.eventoInstalar = null;
  }

  async function sairDaConta() {
    const ok = await confirmar({
      titulo: 'Sair da conta?',
      texto: 'Para usar a agenda de novo neste aparelho, será preciso entrar com o e-mail e a senha da equipe.',
      ok: 'Sair'
    });
    if (!ok) return;
    fecharGaveta();
    try { await Dados.sair(); } catch (e) { avisar('Não foi possível sair agora. Tente de novo.'); }
  }

  /* ---------- Backup ---------- */

  async function exportarBackup() {
    const pacote = {
      app: 'agenda-oficina',
      versao: 2,
      exportadoEm: new Date().toISOString(),
      agendamentos: estado.lista,
      espera: estado.espera
    };
    const nome = `backup-agenda-oficina-${Datas.hoje()}.json`;
    const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: 'application/json' });
    const total = `${plural(estado.lista.length, 'agendamento', 'agendamentos')} e ${estado.espera.length} na espera`;

    // No iPhone, compartilhar é o jeito mais fácil de salvar em Arquivos ou mandar por mensagem.
    if (Lembretes.ehIOS && navigator.canShare) {
      try {
        const arquivo = new File([blob], nome, { type: 'application/json' });
        if (navigator.canShare({ files: [arquivo] })) {
          await navigator.share({ files: [arquivo], title: 'Backup da Agenda Oficina' });
          avisar(`Backup exportado: ${total}`);
          return;
        }
      } catch (erro) {
        if (erro && erro.name === 'AbortError') return;
      }
    }
    Lembretes.baixar(blob, nome);
    avisar(`Backup exportado: ${total}`);
  }

  function normalizarAgendamento(item) {
    if (!item || typeof item !== 'object') return null;
    const nome = String(item.nome || '').trim();
    const data = String(item.data || '');
    if (!nome || !Datas.valida(data)) return null;
    return {
      id: item.id ? String(item.id) : novoId(),
      nome,
      data,
      hora: Datas.horaValida(item.hora) ? item.hora : '',
      servico: String(item.servico || '').trim(),
      concluido: Boolean(item.concluido),
      faltou: Boolean(item.faltou),
      criadoEm: Number(item.criadoEm) || Date.now(),
      atualizadoEm: Date.now()
    };
  }

  function normalizarEspera(item) {
    if (!item || typeof item !== 'object') return null;
    const nome = String(item.nome || '').trim();
    if (!nome) return null;
    return {
      id: item.id ? String(item.id) : novoId(),
      nome,
      telefone: String(item.telefone || '').trim(),
      servico: String(item.servico || '').trim(),
      observacao: String(item.observacao || '').trim(),
      criadoEm: Number(item.criadoEm) || Date.now(),
      atualizadoEm: Date.now()
    };
  }

  async function importarBackup(e) {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    let agendamentos;
    let espera;
    try {
      const conteudo = JSON.parse(await arquivo.text());
      const listaAg = Array.isArray(conteudo) ? conteudo : conteudo.agendamentos;
      const listaEs = Array.isArray(conteudo) ? [] : (conteudo.espera || []);
      if (!Array.isArray(listaAg) || !Array.isArray(listaEs)) throw new Error('formato');
      agendamentos = listaAg.map(normalizarAgendamento).filter(Boolean);
      espera = listaEs.map(normalizarEspera).filter(Boolean);
    } catch (erro) {
      avisar('Não foi possível ler esse arquivo. Escolha um backup .json exportado pelo app.', { duracao: 6000 });
      return;
    }
    if (!agendamentos.length && !espera.length) { avisar('Esse arquivo não tem agendamentos válidos.'); return; }
    const partes = [];
    if (agendamentos.length) partes.push(plural(agendamentos.length, 'agendamento', 'agendamentos'));
    if (espera.length) partes.push(`${espera.length} da lista de espera`);
    const ok = await confirmar({
      titulo: `Importar ${partes.join(' e ')}?`,
      texto: 'O que já existir no app será atualizado com os dados do arquivo.',
      ok: 'Importar'
    });
    if (!ok) return;
    fecharGaveta();
    try {
      await Dados.lote([
        ...agendamentos.map(item => ({ acao: 'salvar', colecao: 'agendamentos', item })),
        ...espera.map(item => ({ acao: 'salvar', colecao: 'espera', item }))
      ]);
      avisar(`Importado: ${partes.join(' e ')}`);
    } catch (erro) {
      erroAoSalvar(erro);
    }
  }

  /* ---------- Avisos na tela (instalar no iPhone, ativar notificação) ---------- */

  function renderizarAvisos() {
    let html = '';
    if (Lembretes.ehIOS && !ehInstalado && !lerFlag('dica-ios')) {
      html = `<div class="aviso">
        <svg aria-hidden="true"><use href="#i-celular"/></svg>
        <b>Instale no iPhone</b>
        <p>Toque em Compartilhar e depois em “Adicionar à Tela de Início”. Pelo ícone, o app guarda os dados e pode mandar avisos.</p>
        <div class="aviso-botoes"><button type="button" class="btn btn-secundario" data-aviso="fechar" data-chave="dica-ios">Entendi</button></div>
      </div>`;
    } else if (Aviso.suportado() && Aviso.permissao() === 'default' && !lerFlag('dica-aviso')) {
      html = `<div class="aviso">
        <svg aria-hidden="true"><use href="#i-sino"/></svg>
        <b>Aviso dos clientes do dia</b>
        <p>Ao abrir o app, aparece uma notificação com quem está marcado para hoje.</p>
        <div class="aviso-botoes">
          <button type="button" class="btn btn-acao" data-aviso="ativar">Ativar aviso</button>
          <button type="button" class="btn-texto" data-aviso="fechar" data-chave="dica-aviso">Agora não</button>
        </div>
      </div>`;
    }
    $('#avisos').innerHTML = html;
  }

  function aoClicarAviso(e) {
    const botao = e.target.closest('[data-aviso]');
    if (!botao) return;
    if (botao.dataset.aviso === 'ativar') { ativarAvisos(); return; }
    gravarFlag(botao.dataset.chave);
    renderizarAvisos();
  }

  /* ---------- Login (modo compartilhado) ---------- */

  const ERROS_LOGIN = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'local/sem-cripto': 'Abra o app pelo endereço com https (o do GitHub Pages) para poder entrar.',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Esse e-mail não parece certo. Confira e tente de novo.',
    'auth/missing-password': 'Digite a senha.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem internet. Na primeira vez, é preciso estar conectado para entrar.',
    'auth/user-disabled': 'Esse usuário foi desativado no Firebase.',
    'auth/operation-not-allowed': 'O login por e-mail e senha não está ligado no Firebase (README, parte 1, passo 2).',
    'auth/configuration-not-found': 'O login por e-mail e senha não está ligado no Firebase (README, parte 1, passo 2).',
    'auth/unauthorized-domain': 'Este endereço não está liberado no Firebase (README, parte 4).'
  };

  function mensagemErroLogin(erro) {
    const codigo = (erro && erro.code) || '';
    if (ERROS_LOGIN[codigo]) return ERROS_LOGIN[codigo];
    if (codigo.includes('api-key')) return 'A configuração do Firebase está errada. Confira o arquivo firebase-config.js (README, parte 2).';
    return 'Não foi possível entrar. Confira o e-mail, a senha e a internet.';
  }

  async function aoEntrar(e) {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const senha = $('#loginSenha').value;
    const erro = $('#loginErro');
    erro.textContent = '';
    if (!email || !senha) { erro.textContent = 'Digite o e-mail e a senha.'; return; }
    const botao = $('#btnEntrar');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      await Dados.entrar(email, senha);
      $('#loginSenha').value = '';
      try { localStorage.setItem('agenda-oficina:ultimo-email', email); } catch (e2) { /* ignorar */ }
    } catch (falha) {
      erro.textContent = mensagemErroLogin(falha);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  }

  function aoMudarUsuario(usuario) {
    pararDeObservar();
    if (usuario) {
      estado.carregado = { agendamentos: false, espera: false };
      estado.assinaturas = { agendamentos: null, espera: null };
      estado.primeiraVez = true;
      mostrarTela('app');
      renderizar();
      renderizarAvisos();
      comecarAObservar();
    } else {
      estado.lista = [];
      estado.espera = [];
      estado.carregado = { agendamentos: false, espera: false };
      fecharGaveta();
      // Deixa o e-mail já preenchido (o último que entrou neste aparelho).
      let ultimoEmail = '';
      try { ultimoEmail = localStorage.getItem('agenda-oficina:ultimo-email') || ''; } catch (e) { /* ignorar */ }
      if (ultimoEmail && !$('#loginEmail').value) $('#loginEmail').value = ultimoEmail;
      $('#loginErro').textContent = '';
      mostrarTela('login');
    }
  }

  /* ---------- Virada do dia e volta ao app ---------- */

  function verificarNovoDia() {
    const hoje = Datas.hoje();
    if (hoje !== estado.hoje) {
      estado.hoje = hoje;
      renderizar({ animar: false });
    }
    if (estado.carregado.agendamentos) Aviso.resumoDoDia(estado.lista);
  }

  /* ---------- Ligando os botões ---------- */

  function ligarEventos() {
    $('#btnNovo').addEventListener('click', () => (estado.aba === 'espera' ? abrirFormEspera() : abrirFormulario()));
    $('#btnMenu').addEventListener('click', abrirMenu);
    $('#status').addEventListener('click', explicarStatus);
    $('#lista').addEventListener('click', aoClicarLista);
    $('#historicoLista').addEventListener('click', aoClicarLista);
    $('#avisos').addEventListener('click', aoClicarAviso);

    // Abas
    $$('.aba').forEach(botao => botao.addEventListener('click', () => trocarAba(botao.dataset.aba)));
    $('.abas').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const proxima = estado.aba === 'agenda' ? 'espera' : 'agenda';
      trocarAba(proxima);
      $(`.aba[data-aba="${proxima}"]`).focus();
    });

    fundo.addEventListener('click', () => fecharGaveta());
    $$('[data-fechar]').forEach(botao => botao.addEventListener('click', () => fecharGaveta()));
    $$('.gaveta').forEach(ativarArraste);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && gavetaAberta && $('#dialogo').hidden) fecharGaveta();
      prenderFoco(e);
    });

    // Formulário de agendamento
    $('#formAgendamento').addEventListener('submit', aoEnviarFormulario);
    $('#fNome').addEventListener('input', () => limparErro('Nome'));
    $('#fNome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('#fData').addEventListener('input', atualizarData);
    $('#fData').addEventListener('change', atualizarData);
    $$('.atalhos .chip').forEach(chip => chip.addEventListener('click', () => {
      $('#fData').value = Datas.somarDias(Datas.hoje(), Number(chip.dataset.dia));
      atualizarData();
    }));
    $('#limparHora').addEventListener('click', () => { $('#fHora').value = ''; });
    $('#btnParaEspera').addEventListener('click', () => {
      abrirFormEspera(null, { nome: $('#fNome').value.trim(), servico: servicoAgenda.texto() });
    });

    // Depois de salvar
    $('#salvoIcs').addEventListener('click', () => { if (estado.salvoAtual) Lembretes.adicionarAoCalendario(estado.salvoAtual); });
    $('#salvoGoogle').addEventListener('click', () => { if (estado.salvoAtual) Lembretes.abrirGoogle(estado.salvoAtual); });
    $('#salvoOutro').addEventListener('click', () => abrirFormulario());

    // Detalhes do agendamento
    $('#detAcoes').addEventListener('click', aoClicarAcaoDetalhe);
    $('#detEditar').addEventListener('click', () => { const ag = buscarAg(estado.detalheId); if (ag) abrirFormulario(ag); });
    $('#detExcluir').addEventListener('click', () => excluirAgendamento(estado.detalheId));
    $('#detIcs').addEventListener('click', () => { const ag = buscarAg(estado.detalheId); if (ag) Lembretes.adicionarAoCalendario(ag); });
    $('#detGoogle').addEventListener('click', () => { const ag = buscarAg(estado.detalheId); if (ag) Lembretes.abrirGoogle(ag); });

    // Lista de espera
    $('#formEspera').addEventListener('submit', aoEnviarEspera);
    $('#eNome').addEventListener('input', () => limparErro('EsperaNome'));
    $('#eNome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#eTelefone').focus(); } });
    $('#eTelefone').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('#eObs').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('#edAgendar').addEventListener('click', () => agendarDaEspera(estado.esperaDetalheId));
    $('#edEditar').addEventListener('click', () => { const es = buscarEspera(estado.esperaDetalheId); if (es) abrirFormEspera(es); });
    $('#edRemover').addEventListener('click', () => removerDaEspera(estado.esperaDetalheId));

    // Menu
    $('#mHistorico').addEventListener('click', () => abrirHistorico('chegaram'));
    $('#mFaltas').addEventListener('click', () => abrirHistorico('faltas'));
    $('#mNotificacoes').addEventListener('click', ativarAvisos);
    $('#mInstalar').addEventListener('click', instalarApp);
    $('#mExportar').addEventListener('click', () => { exportarBackup(); fecharGaveta(); });
    $('#mImportar').addEventListener('click', () => $('#arquivoImportar').click());
    $('#arquivoImportar').addEventListener('change', importarBackup);
    $('#mSair').addEventListener('click', sairDaConta);

    // Busca (vale para a aba aberta)
    const busca = $('#busca');
    busca.addEventListener('input', () => {
      estado.busca = busca.value;
      $('#buscaLimpar').hidden = !busca.value;
      renderizar({ animar: false });
    });
    busca.addEventListener('keydown', e => { if (e.key === 'Enter') busca.blur(); });
    $('#buscaLimpar').addEventListener('click', () => {
      busca.value = '';
      estado.busca = '';
      $('#buscaLimpar').hidden = true;
      renderizar({ animar: false });
      busca.focus();
    });

    // Login e erro
    $('#formLogin').addEventListener('submit', aoEntrar);
    $('#mostrarSenha').addEventListener('click', () => {
      const campo = $('#loginSenha');
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      $('#mostrarSenha').setAttribute('aria-pressed', String(mostrar));
      $('#mostrarSenha').setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
    });
    $('#btnTentarDeNovo').addEventListener('click', () => window.location.reload());

    // O botão de novo encolhe ao rolar para baixo
    let ultimoY = window.scrollY;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (Math.abs(y - ultimoY) < 6) return;
      $('#btnNovo').classList.toggle('compacto', y > 140 && y > ultimoY);
      ultimoY = y;
    }, { passive: true });

    // Virada do dia, internet e instalação
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verificarNovoDia(); });
    setInterval(verificarNovoDia, 60000);
    window.addEventListener('online', () => { estado.online = true; atualizarStatus(); });
    window.addEventListener('offline', () => { estado.online = false; atualizarStatus(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); estado.eventoInstalar = e; });
    window.addEventListener('appinstalled', () => { estado.eventoInstalar = null; avisar('App instalado'); });
  }

  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const registrar = () => {
      try {
        navigator.serviceWorker.register('sw.js').catch(erro => console.warn('Modo offline não ativado:', erro));
      } catch (erro) {
        console.warn('Modo offline não ativado:', erro);
      }
    };
    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar);
  }

  /* ---------- Começo de tudo ---------- */

  async function iniciar() {
    ligarEventos();
    registrarServiceWorker();
    atualizarStatus();
    atualizarFab();

    if (Dados.modo === 'erro-config') {
      mostrarErroTela('O arquivo firebase-config.js está com erro',
        'Abra o arquivo e confira se você colou só o bloco “const firebaseConfig = { … };” e apagou o bloco de exemplo. Veja o README, parte 2.');
      return;
    }

    try {
      await Dados.iniciar({ aoMudarUsuario, aoErro: erroDaNuvem });
    } catch (erro) {
      console.error(erro);
      if (Dados.modo === 'nuvem') {
        mostrarErroTela('Não foi possível abrir a agenda', navigator.onLine
          ? 'O Firebase não respondeu. Confira o arquivo firebase-config.js (README, parte 2) e tente de novo.'
          : 'Na primeira vez, o app precisa de internet para baixar a parte do banco de dados. Conecte-se e tente de novo.');
      } else {
        mostrarErroTela('Não foi possível abrir a agenda', 'O navegador não deixou guardar dados. Saia da janela anônima, se estiver em uma, e tente de novo.');
      }
      return;
    }

    // Nos dois modos, quem decide se mostra o login ou a agenda é o aoMudarUsuario.
  }

  iniciar();
})();
