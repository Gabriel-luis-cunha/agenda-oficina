/*
  lembretes.js: datas, agenda do celular e aviso do dia
  =====================================================

  - Datas: transforma "2026-11-11" em "Quarta-feira, 11/11/2026" e afins.
  - Lembretes: cria o evento para a agenda do celular.
      * Arquivo .ics (iPhone e computador): já leva os alarmes
        (às 8h do dia e 30 minutos antes, se tiver hora).
      * Link do Google Agenda (Android): abre o evento pronto; os avisos
        seguem o padrão configurado na Google Agenda.
  - Aviso: notificação com os clientes do dia, mostrada ao abrir o app.
*/
(function () {
  'use strict';

  const dois = n => String(n).padStart(2, '0');
  const fmtSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
  const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long' });
  const fmtLonga = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ------------------------------------------------------------------
     Datas (sempre no fuso do aparelho)
     ------------------------------------------------------------------ */

  const Datas = {
    paraISO(d) { return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`; },
    deISO(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); },
    hoje() { return Datas.paraISO(new Date()); },
    somarDias(iso, n) { const d = Datas.deISO(iso); d.setDate(d.getDate() + n); return Datas.paraISO(d); },
    valida(iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
      return Datas.paraISO(Datas.deISO(iso)) === iso;
    },
    horaValida(h) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(h || ''); },
    br(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; },
    curta(iso) { const [, m, d] = iso.split('-'); return `${d}/${m}`; },
    semana(iso) { return fmtSemana.format(Datas.deISO(iso)); },
    mes(iso) { return fmtMes.format(Datas.deISO(iso)); },
    diaDoMes(iso) { return String(Number(iso.split('-')[2])); },
    maiuscula(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
    rotulo(iso, hoje = Datas.hoje()) {
      if (iso === hoje) return 'Hoje';
      if (iso === Datas.somarDias(hoje, 1)) return 'Amanhã';
      if (iso === Datas.somarDias(hoje, -1)) return 'Ontem';
      return Datas.maiuscula(Datas.semana(iso));
    },
    extenso(iso) { return `${Datas.maiuscula(Datas.semana(iso))}, ${Datas.br(iso)}`; },
    // "Terça-feira, 10 de novembro"
    longa(iso) { return Datas.maiuscula(fmtLonga.format(Datas.deISO(iso))); },
    // Quantos dias se passaram desde um momento (0 = hoje, 1 = ontem...)
    diasDesde(milissegundos) {
      const inicio = Datas.deISO(Datas.paraISO(new Date(milissegundos)));
      const hoje = Datas.deISO(Datas.hoje());
      return Math.max(0, Math.round((hoje - inicio) / 86400000));
    }
  };

  /* ------------------------------------------------------------------
     Agenda do celular
     ------------------------------------------------------------------ */

  const ehIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ehAndroid = /Android/i.test(navigator.userAgent);

  const DESCRICAO = 'Agendamento feito no app Agenda Oficina.';

  function tituloEvento(ag) {
    return `Oficina: ${ag.nome}${ag.servico ? ` (${ag.servico})` : ''}`;
  }

  const compacta = iso => iso.replace(/-/g, '');
  const minutos = h => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };

  // Fim do evento: 1 hora depois do início.
  function fimDoEvento(ag) {
    const [a, m, d] = ag.data.split('-').map(Number);
    const [hh, mm] = ag.hora.split(':').map(Number);
    const fim = new Date(a, m - 1, d, hh + 1, mm);
    return { data: Datas.paraISO(fim), hora: `${dois(fim.getHours())}:${dois(fim.getMinutes())}` };
  }

  // 90 minutos -> "PT1H30M" (formato de duração do calendário)
  function duracao(min) {
    if (min === 0) return 'PT0S';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '');
  }

  // Quando o celular deve avisar, contando a partir do início do evento.
  function alarmes(ag) {
    if (!ag.hora) return ['PT8H'];                 // dia inteiro: às 8h do próprio dia
    const inicio = minutos(ag.hora);
    const lista = [];
    if (inicio >= 480) {                           // às 8h do dia (se o horário for depois das 8h)
      const antes = inicio - 480;
      lista.push(antes === 0 ? 'PT0S' : '-' + duracao(antes));
    }
    if (inicio - 480 !== 30) lista.push('-PT30M'); // 30 minutos antes (sem repetir o das 8h)
    return lista;
  }

  function escapar(texto) {
    return String(texto)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Linhas do .ics não podem passar de 75 bytes; as maiores continuam na linha de baixo.
  const codificador = new TextEncoder();
  function dobrar(linha) {
    if (codificador.encode(linha).length <= 75) return linha;
    const partes = [];
    let atual = '';
    let bytes = 0;
    let limite = 75;
    for (const letra of linha) {
      const tamanho = codificador.encode(letra).length;
      if (bytes + tamanho > limite) { partes.push(atual); atual = ''; bytes = 0; limite = 74; }
      atual += letra;
      bytes += tamanho;
    }
    partes.push(atual);
    return partes.join('\r\n ');
  }

  function carimboUTC(d = new Date()) {
    return `${d.getUTCFullYear()}${dois(d.getUTCMonth() + 1)}${dois(d.getUTCDate())}T` +
      `${dois(d.getUTCHours())}${dois(d.getUTCMinutes())}${dois(d.getUTCSeconds())}Z`;
  }

  function ics(ag) {
    const linhas = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Agenda Oficina//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${ag.id}@agenda-oficina`,
      `DTSTAMP:${carimboUTC()}`
    ];
    if (ag.hora) {
      const fim = fimDoEvento(ag);
      // Sem fuso escrito: o celular usa o horário local dele.
      linhas.push(`DTSTART:${compacta(ag.data)}T${ag.hora.replace(':', '')}00`);
      linhas.push(`DTEND:${compacta(fim.data)}T${fim.hora.replace(':', '')}00`);
    } else {
      linhas.push(`DTSTART;VALUE=DATE:${compacta(ag.data)}`);
      linhas.push(`DTEND;VALUE=DATE:${compacta(Datas.somarDias(ag.data, 1))}`);
    }
    linhas.push(`SUMMARY:${escapar(tituloEvento(ag))}`);
    linhas.push(`DESCRIPTION:${escapar(DESCRICAO)}`);
    alarmes(ag).forEach(gatilho => {
      linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(tituloEvento(ag))}`, `TRIGGER:${gatilho}`, 'END:VALARM');
    });
    linhas.push('END:VEVENT', 'END:VCALENDAR');
    return linhas.map(dobrar).join('\r\n') + '\r\n';
  }

  function nomeArquivo(ag) {
    const base = String(ag.nome || 'cliente')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cliente';
    return `agendamento-${base}-${ag.data}.ics`;
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function adicionarAoCalendario(ag) {
    const texto = ics(ag);
    if (ehIOS) {
      // No iPhone, abrir o evento faz o próprio Calendário perguntar "Adicionar".
      const link = document.createElement('a');
      link.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(texto);
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    baixar(new Blob([texto], { type: 'text/calendar;charset=utf-8' }), nomeArquivo(ag));
  }

  function linkGoogle(ag) {
    let datas;
    let fuso = '';
    if (ag.hora) {
      const fim = fimDoEvento(ag);
      datas = `${compacta(ag.data)}T${ag.hora.replace(':', '')}00/${compacta(fim.data)}T${fim.hora.replace(':', '')}00`;
      try { fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { fuso = ''; }
    } else {
      datas = `${compacta(ag.data)}/${compacta(Datas.somarDias(ag.data, 1))}`;
    }
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(tituloEvento(ag)) +
      '&dates=' + datas +
      '&details=' + encodeURIComponent(DESCRICAO) +
      (fuso ? '&ctz=' + encodeURIComponent(fuso) : '');
  }

  function abrirGoogle(ag) {
    window.open(linkGoogle(ag), '_blank', 'noopener');
  }

  /* ------------------------------------------------------------------
     Aviso do dia (notificação ao abrir o app, uma vez por dia)
     ------------------------------------------------------------------ */

  const CHAVE_RESUMO = 'agenda-oficina:ultimo-aviso-do-dia';
  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

  function lerChave() { try { return localStorage.getItem(CHAVE_RESUMO); } catch (e) { return null; } }
  function gravarChave(v) { try { localStorage.setItem(CHAVE_RESUMO, v); } catch (e) { /* ignorar */ } }

  function porHora(a, b) {
    if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
    if (a.hora) return -1;
    if (b.hora) return 1;
    return 0;
  }

  const Aviso = {
    suportado() { return 'Notification' in window; },
    permissao() { return Aviso.suportado() ? Notification.permission : 'indisponivel'; },

    async pedir() {
      if (!Aviso.suportado()) return 'indisponivel';
      try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
    },

    async resumoDoDia(lista) {
      if (Aviso.permissao() !== 'granted') return false;
      const hoje = Datas.hoje();
      if (lerChave() === hoje) return false;
      const doDia = lista.filter(ag => ag.data === hoje && !ag.concluido && !ag.faltou).sort(porHora);
      if (!doDia.length) return false;
      gravarChave(hoje);

      const titulo = doDia.length === 1 ? 'Hoje: 1 cliente agendado' : `Hoje: ${doDia.length} clientes agendados`;
      const linhas = doDia.slice(0, 6).map(ag =>
        `${ag.hora || 'Sem hora'}  ${ag.nome}${ag.servico ? ` (${ag.servico})` : ''}`);
      if (doDia.length > 6) linhas.push(`e mais ${doDia.length - 6}`);
      const opcoes = {
        body: linhas.join('\n'),
        icon: 'icon-192.png',
        badge: 'badge-96.png',
        tag: 'aviso-' + hoje,
        lang: 'pt-BR'
      };

      try {
        const registro = 'serviceWorker' in navigator
          ? await Promise.race([navigator.serviceWorker.ready, esperar(3000).then(() => null)])
          : null;
        if (registro && registro.showNotification) {
          await registro.showNotification(titulo, opcoes);
        } else {
          new Notification(titulo, opcoes);
        }
        return true;
      } catch (erro) {
        console.warn('Não foi possível mostrar o aviso do dia', erro);
        return false;
      }
    }
  };

  window.Datas = Datas;
  window.Aviso = Aviso;
  window.Lembretes = { ics, alarmes, linkGoogle, adicionarAoCalendario, abrirGoogle, baixar, ehIOS, ehAndroid };
})();
