/* Finanças da Família — leitor de extratos OFX (Open Financial Exchange)
   Suporta OFX 1.x (SGML, tags sem fechamento) e OFX 2.x (XML), extrato de conta e de cartão.
   Bancos brasileiros costumam usar ISO-8859-1/Windows-1252 — a leitura detecta e corrige. */
'use strict';

const OFX = {
  norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  },

  async readText(file) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    // Caractere de substituição = arquivo não era UTF-8; relê como Windows-1252 (padrão dos bancos BR)
    if (text.includes('�') || /CHARSET:\s*1252|ENCODING:\s*USASCII/i.test(text.slice(0, 400))) {
      text = new TextDecoder('windows-1252').decode(buf);
    }
    return text;
  },

  // Lê <TAG>valor tanto em SGML (sem fechamento) quanto em XML (</TAG>)
  tag(block, name) {
    const m = block.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
    return m ? m[1].trim() : '';
  },

  parse(text) {
    const isCard = /<CCSTMTRS|<CCACCTFROM/i.test(text);
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    const txs = [];
    for (const raw of blocks) {
      const b = raw.split(/<\/STMTTRN>/i)[0];
      const dt = this.tag(b, 'DTPOSTED').replace(/\D/g, '');
      const amt = parseFloat(this.tag(b, 'TRNAMT').replace(/\./g, '.').replace(',', '.'));
      if (dt.length < 8 || isNaN(amt) || amt === 0) continue;
      txs.push({
        date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
        amount: amt,                                   // negativo = saída, positivo = entrada
        memo: (this.tag(b, 'MEMO') || this.tag(b, 'NAME') || 'Lançamento').replace(/\s+/g, ' ').trim(),
        fitid: this.tag(b, 'FITID'),
        trntype: this.tag(b, 'TRNTYPE').toUpperCase(),
      });
    }
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const bal = parseFloat(this.tag(text, 'BALAMT'));
    return {
      txs, isCard,
      balance: isNaN(bal) ? null : bal,
      acctId: this.tag(text, 'ACCTID'),
      bankId: this.tag(text, 'BANKID') || this.tag(text, 'ORG'),
    };
  },

  // Palavras-chave → trecho do nome da categoria (comparação sem acento/caixa)
  KEYWORDS: [
    [['mercado', 'supermerc', 'atacad', 'carrefour', 'pao de acucar', 'assai', 'hortifruti', 'padaria', 'acougue', 'ifood', 'rappi', 'restaurante', 'lanche', 'pizzar', 'burger', 'mcdonald', 'subway', 'delivery'], 'aliment'],
    [['posto', 'ipiranga', 'shell', 'combustivel', 'gasolina', 'etanol', 'uber', '99app', 'cabify', 'taxi', 'estacionament', 'pedagio', 'sem parar', 'conectcar', 'onibus', 'metro', 'oficina', 'pneu'], 'transp'],
    [['farmacia', 'drogaria', 'drogasil', 'pacheco', 'raia', 'hospital', 'clinica', 'laborator', 'odonto', 'dentista', 'unimed', 'amil', 'psicolog', 'exame'], 'saud'],
    [['netflix', 'spotify', 'prime video', 'amazon prime', 'disney', 'hbo', 'globoplay', 'deezer', 'youtube', 'icloud', 'google one', 'microsoft', 'adobe', 'assinatura', 'chatgpt', 'openai'], 'assinat'],
    [['cinema', 'teatro', 'show ', 'ingresso', 'balada', 'hotel', 'airbnb', 'decolar', 'latam', 'steam', 'playstation', 'xbox', 'nintendo', 'viagem'], 'lazer'],
    [['aluguel', 'condominio', 'energia', 'enel', 'cemig', 'light serv', 'copel', 'celesc', 'sabesp', 'sanepar', 'copasa', 'comgas', 'internet', 'vivo', 'claro', 'oi fibra', 'iptu', 'seguro resid', 'agua'], 'morad'],
    [['escola', 'colegio', 'faculdade', 'universidade', 'curso', 'udemy', 'alura', 'livraria', 'papelaria', 'mensalidade'], 'educ'],
  ],

  guessCategoryId(memo, categories) {
    const m = this.norm(memo);
    for (const [words, catToken] of this.KEYWORDS) {
      if (!words.some(w => m.includes(w))) continue;
      const hit = categories.find(c => this.norm(c.name).includes(catToken));
      if (hit) return hit.id;
    }
    return '';
  },

  // Método provável a partir do texto do extrato
  guessMethod(memo, isCard) {
    if (isCard) return 'Cartão de Crédito';
    const m = this.norm(memo);
    if (m.includes('pix')) return 'PIX';
    if (m.includes('boleto') || m.includes('pagamento de conta')) return 'Boleto';
    if (m.includes('saque') || m.includes('dinheiro')) return 'Dinheiro';
    return 'Débito';
  },
};
