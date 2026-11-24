/*
  CONFIGURAÇÃO DO FIREBASE (o banco de dados online)
  ==================================================

  Enquanto os campos abaixo estiverem vazios, o app funciona,
  mas guarda os agendamentos SÓ no aparelho em que foi usado.

  Para todos os celulares e computadores verem a mesma agenda:
    1. Siga o README.md, Parte 1 (criar o Firebase).
    2. No Firebase, copie o bloco que começa com
         const firebaseConfig = {
  apiKey: "AIzaSyAlst7YaH4y0W6ZjGN707xIOaWsLKD2eI4",
  authDomain: "agenda-oficina-55d5e.firebaseapp.com",
  projectId: "agenda-oficina-55d5e",
  storageBucket: "agenda-oficina-55d5e.firebasestorage.app",
  messagingSenderId: "387433992599",
  appId: "1:387433992599:web:71ba4dc8599dfddcbf34d2"
};
    3. Apague o bloco de exemplo abaixo (de "const" até "};")
       e cole o seu no lugar.
    4. Salve o arquivo.

  Pode ficar tranquilo: esses códigos não são senhas.
  Quem protege a agenda é o login da equipe e as regras do Firestore.
*/

const firebaseConfig = {
  apiKey: "AIzaSyAlst7YaH4y0W6ZjGN707xIOaWsLKD2eI4",
  authDomain: "agenda-oficina-55d5e.firebaseapp.com",
  projectId: "agenda-oficina-55d5e",
  storageBucket: "agenda-oficina-55d5e.firebasestorage.app",
  messagingSenderId: "387433992599",
  appId: "1:387433992599:web:71ba4dc8599dfddcbf34d2"
};

/* Não mexa na linha abaixo. */
window.FIREBASE_CONFIG = firebaseConfig;
