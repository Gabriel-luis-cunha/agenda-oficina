/*
  CONFIGURAÇÃO DO FIREBASE (o banco de dados online)
  ==================================================

  Enquanto os campos abaixo estiverem vazios, o app funciona,
  mas guarda os agendamentos SÓ no aparelho em que foi usado.

  Para todos os celulares e computadores verem a mesma agenda:
    1. Siga o README.md, Parte 1 (criar o Firebase).
    2. No Firebase, copie o bloco que começa com
         const firebaseConfig = {
       e termina com
         };
    3. Apague o bloco de exemplo abaixo (de "const" até "};")
       e cole o seu no lugar.
    4. Salve o arquivo.

  Pode ficar tranquilo: esses códigos não são senhas.
  Quem protege a agenda é o login da equipe e as regras do Firestore.
*/

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

/* Não mexa na linha abaixo. */
window.FIREBASE_CONFIG = firebaseConfig;
