/*
  sw.js: o "service worker"
  =========================

  É um ajudante que o navegador roda por trás do app. Ele guarda uma cópia
  dos arquivos no aparelho para o app abrir mesmo sem internet.

  - Arquivos do app: tenta pegar a versão mais nova na internet; se não
    der (sem sinal ou muito lento), usa a cópia guardada.
  - Partes do Firebase: depois de baixadas uma vez, ficam guardadas.
  - Toque na notificação do dia: abre o app.
*/

const VERSAO = 'agenda-oficina-v5';

const ARQUIVOS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'dados.js',
  'lembretes.js',
  'firebase-config.js',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'badge-96.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    await cache.addAll(ARQUIVOS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(nome => nome !== VERSAO).map(nome => caches.delete(nome)));
    await self.clients.claim();
  })());
});

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

// Internet primeiro; se falhar ou demorar mais de 4 segundos, usa a cópia guardada.
async function internetPrimeiro(pedido) {
  const cache = await caches.open(VERSAO);
  const daInternet = (pedido.mode === 'navigate' ? fetch(pedido) : fetch(pedido.url, { cache: 'no-cache' }))
    .then(resposta => {
      if (resposta && resposta.ok) cache.put(pedido, resposta.clone());
      return resposta;
    });
  daInternet.catch(() => { /* tratado abaixo */ });

  try {
    return await Promise.race([daInternet, esperar(4000).then(() => { throw new Error('lento'); })]);
  } catch (erro) {
    const guardado = await cache.match(pedido, { ignoreSearch: true }) ||
      (pedido.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (guardado) return guardado;
    return daInternet;
  }
}

// Partes do Firebase: usa a cópia guardada; se não tiver, baixa e guarda.
async function guardadoPrimeiro(pedido) {
  const cache = await caches.open(VERSAO);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;
  const resposta = await fetch(pedido);
  if (resposta && resposta.ok) cache.put(pedido, resposta.clone());
  return resposta;
}

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);

  if (url.origin === self.location.origin) {
    evento.respondWith(internetPrimeiro(pedido));
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    evento.respondWith(guardadoPrimeiro(pedido));
  }
  // Todo o resto (o banco de dados do Firebase, por exemplo) passa direto.
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of janelas) {
      if ('focus' in janela) return janela.focus();
    }
    return self.clients.openWindow('./');
  })());
});
