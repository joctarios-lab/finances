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

  /* Palavras-chave → [trecho do nome da subcategoria, trecho do nome do envelope].
     Com dois níveis dá para acertar o detalhe: "IPIRANGA" não é só Transporte, é
     Combustível. Se a subcategoria não existir na família, cai no envelope. */
  KEYWORDS: [
    // Alimentação
    [['mercado', 'supermerc', 'atacad', 'carrefour', 'pao de acucar', 'assai', 'hortifruti', 'big bompreco'], 'mercado', 'aliment'],
    [['padaria'], 'padaria', 'aliment'],
    [['acougue', 'feira livre', 'sacolao'], 'feira', 'aliment'],
    [['ifood', 'rappi', 'delivery', 'zedelivery'], 'delivery', 'aliment'],
    [['restaurante', 'pizzar', 'burger', 'mcdonald', 'subway', 'outback', 'habibs'], 'restaurante', 'aliment'],
    [['starbucks', 'cafeteria', 'lanche'], 'cafe', 'aliment'],
    // Transporte
    [['posto', 'ipiranga', 'shell', 'combustivel', 'gasolina', 'etanol'], 'combustivel', 'transp'],
    [['uber', '99app', '99 pop', 'cabify', 'taxi'], 'aplicativo', 'transp'],
    [['estacionament', 'pedagio', 'sem parar', 'conectcar', 'veloe'], 'estacionamento', 'transp'],
    [['onibus', 'metro ', 'bilhete unico', 'cptm'], 'transporte publico', 'transp'],
    [['oficina', 'pneu', 'mecanic', 'autocenter'], 'manutencao', 'transp'],
    [['ipva', 'licenciament', 'detran'], 'ipva', 'transp'],
    // Saúde
    [['farmacia', 'drogaria', 'drogasil', 'pacheco', 'raia', 'panvel'], 'farmacia', 'saud'],
    [['unimed', 'amil', 'sulamerica', 'plano de saude', 'hapvida'], 'plano de saude', 'saud'],
    [['hospital', 'clinica', 'consulta', 'psicolog'], 'consulta', 'saud'],
    [['laborator', 'exame', 'fleury', 'dasa'], 'exames', 'saud'],
    [['odonto', 'dentista'], 'dentista', 'saud'],
    [['academia', 'smartfit', 'smart fit', 'bodytech'], 'academia', 'saud'],
    // Assinaturas
    [['netflix', 'disney', 'hbo', 'max.com', 'globoplay', 'prime video', 'amazon prime', 'paramount'], 'streaming', 'assinat'],
    [['spotify', 'deezer', 'apple music', 'tidal'], 'musica', 'assinat'],
    [['icloud', 'google one', 'dropbox', 'onedrive'], 'nuvem', 'assinat'],
    [['microsoft', 'adobe', 'chatgpt', 'openai', 'assinatura', 'youtube premium'], 'aplicativo', 'assinat'],
    // Lazer
    [['cinema', 'teatro', 'show ', 'ingresso', 'cinemark'], 'cinema', 'lazer'],
    [['balada', 'pub ', 'cervej', 'choperia'], 'bar', 'lazer'],
    [['hotel', 'airbnb', 'decolar', 'latam', 'azul viagens', 'booking', 'viagem'], 'viagem', 'lazer'],
    [['steam', 'playstation', 'xbox', 'nintendo'], 'jogos', 'lazer'],
    // Moradia
    [['aluguel', 'imobiliaria'], 'aluguel', 'morad'],
    [['condominio'], 'condominio', 'morad'],
    [['energia', 'enel', 'cemig', 'light serv', 'copel', 'celesc', 'equatorial', 'neoenergia'], 'luz', 'morad'],
    [['sabesp', 'sanepar', 'copasa', 'cedae', 'agua'], 'agua', 'morad'],
    [['comgas', 'gas natural', 'ultragaz'], 'gas', 'morad'],
    [['internet', 'vivo fibra', 'claro', 'oi fibra', 'net serv'], 'internet', 'morad'],
    [['seguro resid'], 'seguro', 'servic'],
    // Educação
    [['escola', 'colegio', 'faculdade', 'universidade', 'mensalidade'], 'escola', 'educ'],
    [['curso', 'udemy', 'alura', 'coursera'], 'curso', 'educ'],
    [['livraria', 'amazon livr'], 'livro', 'educ'],
    [['papelaria'], 'material', 'educ'],
    // Outros envelopes
    [['petz', 'cobasi', 'veterinar', 'racao'], 'racao', 'pet'],
    [['renner', 'riachuelo', 'zara ', 'marisa', 'centauro', 'netshoes'], 'roupa', 'vestuario'],
    [['tarifa', 'anuidade', 'cesta de servico'], 'tarifa', 'servic'],
    [['iptu'], 'imposto', 'servic'],
  ],

  /* Devolve a categoria mais específica que a família realmente tem.
     Recebe TODAS as categorias (não só as folhas): sem os pais na lista não há
     como saber se a subcategoria encontrada pertence ao envelope esperado —
     "Manutenção" existe em Moradia e em Transporte. */
  guessCategoryId(memo, categories) {
    const m = this.norm(memo);
    const nome = c => this.norm(c.name);
    const paiDe = c => categories.find(p => p.id === c.parent_id);
    for (const [words, sub, raiz] of this.KEYWORDS) {
      if (!words.some(w => m.includes(w))) continue;
      // 1) subcategoria dentro do envelope esperado — a resposta mais precisa
      let hit = categories.find(c => c.parent_id && nome(c).includes(sub) &&
        (p => p && nome(p).includes(raiz))(paiDe(c)));
      // 2) qualquer subcategoria com esse nome
      if (!hit) hit = categories.find(c => c.parent_id && nome(c).includes(sub));
      // 3) o envelope, quando a família não detalhou essa parte
      if (!hit) hit = categories.find(c => !c.parent_id && nome(c).includes(raiz));
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
