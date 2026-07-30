/* Finanças da Família — componentes de formulário no estilo Metronic (Select2 e datepicker).

   Por que não jQuery + Select2: o app é offline-first e sem build. Puxar jQuery (~90KB)
   e Select2 (~70KB) por CDN quebraria o uso sem rede, e embutir os arquivos triplicaria
   o peso do app por causa de dois campos. Estes componentes têm a mesma aparência e o
   mesmo comportamento (busca, teclado, grupos), em ~6KB.

   Estratégia: melhoria progressiva. O <select> e o <input type="date"> originais
   continuam no DOM como fonte da verdade — todo código que lê `.value` segue funcionando.
   A interface bonita só reflete e escreve neles, disparando 'change' normalmente. */
'use strict';

const UI = {
  aberto: null,   // painel atualmente aberto

  /* Devolve o invólucro a usar: o que já existe, ou um novo.

     Reembrulhar sem isto ANINHAVA. `enhance` é chamado de novo quando as opções
     mudam — o seletor de categoria recarrega a lista ao trocar o tipo do
     lançamento —, e para isso o chamador tira o `data-ui`. Na segunda passada
     `el.parentNode` já era o invólucro antigo, então o novo entrava DENTRO dele e
     sobrava um botão a mais visível. Medido: 1, 2, 3, 4 invólucros em quatro
     passadas. Era o "select da categoria duplica" ao clicar em "Outra".

     Reaproveitando, o que foi gerado antes é descartado e refeito no mesmo lugar,
     quantas vezes for. */
  embrulho(el, classe) {
    const pai = el.parentNode;
    if (pai && pai.classList && pai.classList.contains(classe)) {
      // Descarta o que foi gerado antes, preservando o campo nativo
      [...pai.children].forEach(f => { if (f !== el) pai.removeChild(f); });
      return { box: pai, reusado: true };
    }
    const box = document.createElement('div');
    box.className = classe;
    return { box, reusado: false };
  },

  /* ---------------- Select estilo Select2 ---------------- */
  enhanceSelect(sel) {
    if (sel.dataset.ui === '1') return;
    sel.dataset.ui = '1';
    sel.classList.add('ui-native');

    const { box, reusado } = this.embrulho(sel, 'ui-select');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ui-select-btn';
    botao.innerHTML = '<span class="ui-select-txt"></span><span class="ui-select-arrow"></span>';
    box.insertBefore(botao, box.firstChild);
    if (!reusado) {
      sel.parentNode.insertBefore(box, sel);
      box.appendChild(sel);
    }

    /* Com escolha múltipla o botão não cabe a lista inteira, então ele conta.
       Um item ainda aparece pelo nome — é o caso comum, e trocar "Alimentação"
       por "1 selecionado" esconderia justamente a informação útil. O texto de
       lista vazia vem de data-vazio ("Todas"/"Todos"), porque num filtro nada
       escolhido não é falta de resposta: é "não restrinja por isto". */
    const rotulo = () => {
      const el = botao.querySelector('.ui-select-txt');
      const vazioTxt = sel.dataset.vazio || 'Selecione';
      if (sel.multiple) {
        const marcadas = [...sel.options].filter(o => o.selected && o.value);
        el.textContent = !marcadas.length ? vazioTxt
          : marcadas.length === 1 ? marcadas[0].textContent.trim()
          : `${marcadas.length} selecionados`;
        botao.classList.toggle('is-placeholder', !marcadas.length);
        return;
      }
      const o = sel.options[sel.selectedIndex];
      const txt = o ? o.textContent.trim() : '';
      const vazio = !o || !o.value;
      el.textContent = txt || vazioTxt;
      botao.classList.toggle('is-placeholder', vazio);
    };
    rotulo();
    sel.addEventListener('change', rotulo);
    sel._uiRefresh = rotulo;

    botao.onclick = e => { e.preventDefault(); e.stopPropagation(); this.abrirSelect(sel, box, botao, rotulo); };
    botao.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); botao.click(); }
    };
  },

  abrirSelect(sel, box, botao, rotulo) {
    this.fechar();
    const multi = sel.multiple;
    const opcoes = [];
    for (const o of sel.options) {
      const grupo = o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      opcoes.push({ value: o.value, label: o.textContent.trim(), grupo, disabled: o.disabled, marcada: o.selected });
    }
    const comBusca = opcoes.length > 7;
    const estaMarcada = o => (multi ? o.marcada : o.value === sel.value);

    /* Lista longa e agrupada abre em DOIS NÍVEIS. As categorias somavam 75 itens
       — 11 telas de rolagem dentro do painel. Mostrando só os grupos, a primeira
       tela cai para 13, e cada grupo tem 5 ou 6 opções.

       Só quando compensa: com poucos itens, ou sem grupos, a lista plana é mais
       rápida, e um passo a mais seria atrito de graça. A busca continua varrendo
       tudo de uma vez, então quem sabe o nome não navega — digita e escolhe. */
    const grupos = [...new Set(opcoes.filter(o => o.grupo).map(o => o.grupo))];
    const emNiveis = grupos.length >= 3 && opcoes.length > 20;
    let grupoAberto = null;
    // Abre no grupo do que já está escolhido: rever a categoria de um lançamento
    // não deve começar do zero
    if (emNiveis && sel.value) {
      const atual = opcoes.find(o => o.value === sel.value);
      if (atual && atual.grupo) grupoAberto = atual.grupo;
    }

    const painel = document.createElement('div');
    painel.className = 'ui-panel';
    painel.innerHTML =
      (comBusca ? '<div class="ui-search"><input type="text" placeholder="Buscar…" autocomplete="off"></div>' : '') +
      '<div class="ui-list" role="listbox"></div>';
    box.appendChild(painel);
    this.aberto = { painel, box };

    const lista = painel.querySelector('.ui-list');
    const busca = painel.querySelector('.ui-search input');
    let marcado = Math.max(0, opcoes.findIndex(o => o.value === sel.value));

    const linhaOpcao = (o, i) => {
      const sel_ = estaMarcada(o);
      return `<div class="ui-opt${sel_ ? ' is-sel' : ''}${i === marcado ? ' is-mark' : ''}${o.disabled ? ' is-off' : ''}"
        data-i="${i}" role="option" aria-selected="${sel_}">${this.esc(o.label)}${sel_ ? '<span class="ui-check">✓</span>' : ''}</div>`;
    };

    const desenhar = (filtro = '') => {
      const f = this.norm(filtro);
      let html = '', visiveis = 0;

      // Buscando, o nível some: o resultado vem achatado, com o grupo como contexto
      if (emNiveis && !f) {
        if (grupoAberto === null) {
          for (const g of grupos) {
            const dentro = opcoes.filter(o => o.grupo === g);
            const escolhidas = dentro.filter(estaMarcada).length;
            // Com escolha múltipla o grupo diz quantas ficaram marcadas dentro
            // dele: senão, fechado, ele esconderia a própria seleção
            html += `<div class="ui-opt ui-grupo-linha${escolhidas ? ' is-sel' : ''}" data-grupo="${this.esc(g)}" role="option">
              <span>${this.esc(g)}</span><span class="ui-grupo-info">${
                multi && escolhidas ? `${escolhidas} de ${dentro.length}` : dentro.length
              }<span class="ui-grupo-seta">›</span></span></div>`;
            visiveis++;
          }
          // Opções sem grupo (ex.: "— escolha a categoria —") ficam no primeiro nível
          opcoes.forEach((o, i) => { if (!o.grupo) { html = linhaOpcao(o, i) + html; visiveis++; } });
        } else {
          html += `<div class="ui-voltar" data-voltar="1">‹ Todos os grupos</div>
            <div class="ui-group">${this.esc(grupoAberto)}</div>`;
          opcoes.forEach((o, i) => { if (o.grupo === grupoAberto) { html += linhaOpcao(o, i); visiveis++; } });
        }
      } else {
        let grupoAtual = '';
        opcoes.forEach((o, i) => {
          // Busca também pelo nome do grupo: com as categorias agrupadas, a opção
          // se chama só "Mercado", e procurar por "alimentação" tem de encontrá-la.
          if (f && !this.norm(o.label).includes(f) && !this.norm(o.grupo).includes(f)) return;
          if (o.grupo && o.grupo !== grupoAtual) { grupoAtual = o.grupo; html += `<div class="ui-group">${this.esc(o.grupo)}</div>`; }
          html += linhaOpcao(o, i);
          visiveis++;
        });
      }

      lista.innerHTML = visiveis ? html : '<div class="ui-empty">Nada encontrado</div>';
      lista.querySelectorAll('.ui-opt[data-i]').forEach(el => {
        el.onclick = () => { if (!el.classList.contains('is-off')) escolher(Number(el.dataset.i)); };
      });
      /* stopPropagation aqui não é zelo: desenhar() troca o innerHTML da lista, e
         o elemento clicado sai do DOM ANTES de o clique chegar ao document. Lá o
         fechamento por "clique fora" testa box.contains(e.target) — que dá falso
         para um nó já removido, e o painel fechava ao entrar num grupo. */
      lista.querySelectorAll('[data-grupo]').forEach(el => {
        el.onclick = e => { if (e && e.stopPropagation) e.stopPropagation(); grupoAberto = el.dataset.grupo; desenhar(); };
      });
      const voltar = lista.querySelector('[data-voltar]');
      if (voltar) voltar.onclick = e => { if (e && e.stopPropagation) e.stopPropagation(); grupoAberto = null; desenhar(); };
      const m = lista.querySelector('.is-mark');
      if (m) m.scrollIntoView({ block: 'nearest' });
    };

    /* Com escolha múltipla o painel NÃO fecha ao marcar: fechar a cada item
       obrigaria a reabrir uma vez por valor, que é o atrito que faz desistir de
       filtrar por três categorias. Fecha no clique fora, no Escape ou no botão. */
    const escolher = i => {
      if (multi) {
        const alvoOpt = [...sel.options].find(o => o.value === opcoes[i].value);
        if (alvoOpt) alvoOpt.selected = !alvoOpt.selected;
        opcoes[i].marcada = !!(alvoOpt && alvoOpt.selected);
        marcado = i;
        rotulo();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        desenhar(busca ? busca.value : '');
        return;
      }
      sel.value = opcoes[i].value;
      rotulo();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      this.fechar();
      botao.focus();
    };

    desenhar();
    this.posicionar(painel, box);
    if (busca) {
      setTimeout(() => busca.focus(), 30);
      busca.oninput = () => { marcado = -1; desenhar(busca.value); };
    }

    const alvo = busca || painel;
    alvo.onkeydown = e => {
      const vis = [...lista.querySelectorAll('.ui-opt:not(.is-off)')];
      // Escape volta um nível antes de fechar: fechar direto perderia o caminho
      if (e.key === 'Escape') {
        e.preventDefault();
        if (grupoAberto !== null && !(busca && busca.value)) { grupoAberto = null; desenhar(); return; }
        this.fechar(); botao.focus(); return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const alvoEl = lista.querySelector('.is-mark') || vis[0];
        if (!alvoEl) return;
        // Enter numa linha de grupo entra nele, em vez de tentar escolher um valor
        if (alvoEl.dataset.grupo) { grupoAberto = alvoEl.dataset.grupo; desenhar(); return; }
        escolher(Number(alvoEl.dataset.i));
        return;
      }
      // Seta para a direita entra no grupo, esquerda volta — como em árvore de arquivos
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const alvoEl = lista.querySelector('.is-mark') || vis[0];
        if (e.key === 'ArrowRight' && alvoEl && alvoEl.dataset.grupo) {
          e.preventDefault(); grupoAberto = alvoEl.dataset.grupo; desenhar(); return;
        }
        if (e.key === 'ArrowLeft' && grupoAberto !== null) {
          e.preventDefault(); grupoAberto = null; desenhar(); return;
        }
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const atual = vis.findIndex(el => el.classList.contains('is-mark'));
      const prox = e.key === 'ArrowDown'
        ? Math.min(vis.length - 1, atual + 1)
        : Math.max(0, atual <= 0 ? 0 : atual - 1);
      // Linha de grupo não tem índice: marca só o que é opção de verdade
      if (vis[prox] && vis[prox].dataset.i !== undefined) {
        marcado = Number(vis[prox].dataset.i);
        desenhar(busca ? busca.value : '');
      }
    };
    if (!busca) painel.tabIndex = -1, setTimeout(() => painel.focus(), 20);
  },

  /* ---------------- Popover ancorado ----------------
     Painel preso ao elemento que o abriu, com o mesmo visual do dropdown. Serve
     às pílulas de filtro do extrato: cobrir a lista para escolher o que a lista
     mostra tira a referência do que se está filtrando — por isso não é folha nem
     modal. Reaproveita posicionar() e o fechamento por clique fora já existentes. */
  /* Vai para o <body> com position:fixed, não para dentro da âncora.

     Motivo concreto: a fileira de pílulas rola na horizontal, e overflow-x:auto
     CORTA qualquer filho que passe da caixa — o painel sairia decapitado. Preso
     ao body ele escapa de qualquer recorte de ancestral, ao custo de posicionar
     na mão a partir do retângulo da âncora. */
  popover(ancora, html, aoFechar) {
    this.fechar();
    if (!ancora) return null;
    ancora.classList.add('tem-pop');
    const painel = document.createElement('div');
    painel.className = 'ui-panel ui-pop';
    painel.innerHTML = html;
    document.body.appendChild(painel);
    this.aberto = {
      painel, box: ancora,
      aoFechar: () => { ancora.classList.remove('tem-pop'); if (aoFechar) aoFechar(); },
    };
    this.posicionarFixo(painel, ancora);
    const busca = painel.querySelector('.ui-search input');
    if (busca) setTimeout(() => busca.focus(), 30);
    return painel;
  },

  // Coloca um painel fixo logo abaixo da âncora, dentro da área visível
  posicionarFixo(painel, ancora) {
    if (typeof ancora.getBoundingClientRect !== 'function') return;
    const margem = 8;
    const r = ancora.getBoundingClientRect();
    const vv = typeof window !== 'undefined' && window.visualViewport;
    const larguraTela = (vv && vv.width) || window.innerWidth || 0;
    const alturaTela = (vv && vv.height) || window.innerHeight || 0;
    const topoTela = (vv && vv.offsetTop) || 0;
    if (!larguraTela || !alturaTela) return;

    const cx = painel.getBoundingClientRect();
    const largura = cx.width || 240;
    let left = r.left;
    if (left + largura > larguraTela - margem) left = larguraTela - margem - largura;
    if (left < margem) left = margem;
    painel.style.left = Math.round(left) + 'px';

    const abaixo = (topoTela + alturaTela) - r.bottom - margem;
    const acima = r.top - topoTela - margem;
    const paraCima = abaixo < 190 && acima > abaixo;
    painel.classList.toggle('acima', paraCima);
    if (paraCima) painel.style.top = Math.round(r.top - margem - Math.min(cx.height || 0, acima)) + 'px';
    else painel.style.top = Math.round(r.bottom + 6) + 'px';

    const lista = painel.querySelector && painel.querySelector('.ui-list');
    if (lista) lista.style.maxHeight = Math.round(Math.min(260, Math.max(120, (paraCima ? acima : abaixo) - 60))) + 'px';
  },

  /* ---------------- Datepicker ---------------- */
  enhanceDate(inp) {
    if (inp.dataset.ui === '1') return;
    inp.dataset.ui = '1';
    inp.classList.add('ui-native');

    // Mesmo cuidado do select: reembrulhar sem reaproveitar aninharia os invólucros
    const { box, reusado } = this.embrulho(inp, 'ui-date');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ui-date-btn';
    botao.innerHTML = '<span class="ui-date-txt"></span><span class="ui-date-ico">📅</span>';
    box.insertBefore(botao, box.firstChild);
    if (!reusado) {
      inp.parentNode.insertBefore(box, inp);
      box.appendChild(inp);
    }

    const rotulo = () => {
      const v = inp.value;
      const el = botao.querySelector('.ui-date-txt');
      if (!v) { el.textContent = 'Escolher data'; botao.classList.add('is-placeholder'); return; }
      botao.classList.remove('is-placeholder');
      const d = new Date(v + 'T12:00:00');
      const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
      const dif = Math.round((hoje - d) / 86400000);
      const rel = dif === 0 ? 'Hoje' : dif === 1 ? 'Ontem' : dif === -1 ? 'Amanhã' : '';
      el.textContent = (rel ? rel + ' · ' : '') + d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    rotulo();
    inp.addEventListener('change', rotulo);
    inp._uiRefresh = rotulo;

    botao.onclick = e => { e.preventDefault(); e.stopPropagation(); this.abrirData(inp, box, rotulo); };
  },

  abrirData(inp, box, rotulo) {
    this.fechar();
    const base = inp.value ? new Date(inp.value + 'T12:00:00') : new Date();
    let ano = base.getFullYear(), mes = base.getMonth();

    /* VAI PARA O <body> com position:fixed, não para dentro do campo.

       A folha (`.sheet`) tem `overflow-y: auto`, e overflow RECORTA qualquer filho
       que passe da caixa. Preso ao campo, o calendário aparecia cortado sempre que
       a data ficava na metade de baixo do formulário — no "Nova meta" ela é o
       último campo, então sobrava meio calendário.

       É a mesma solução que o popover dos filtros já usava, pelo mesmo motivo (lá
       o recorte vinha do `overflow-x` da fileira de pílulas). Agora as duas usam a
       mesma infraestrutura: `ui-pop` para escapar do recorte e `posicionarFixo`
       para ancorar na âncora dentro da área visível. */
    const painel = document.createElement('div');
    painel.className = 'ui-panel ui-pop ui-cal';
    document.body.appendChild(painel);
    box.classList.add('tem-pop');
    this.aberto = {
      painel, box,
      aoFechar: () => box.classList.remove('tem-pop'),
    };

    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hojeISO = iso(new Date());

    const desenhar = () => {                       // eslint-disable-line no-shadow
      const primeiro = new Date(ano, mes, 1);
      const inicio = primeiro.getDay();                       // domingo = 0
      const dias = new Date(ano, mes + 1, 0).getDate();
      const nomeMes = primeiro.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

      let celulas = '';
      for (let i = 0; i < inicio; i++) celulas += '<span class="ui-cal-d is-out"></span>';
      for (let d = 1; d <= dias; d++) {
        const data = iso(new Date(ano, mes, d));
        const classes = ['ui-cal-d'];
        if (data === inp.value) classes.push('is-sel');
        if (data === hojeISO) classes.push('is-today');
        celulas += `<button type="button" class="${classes.join(' ')}" data-d="${data}">${d}</button>`;
      }

      painel.innerHTML = `
        <div class="ui-cal-head">
          <button type="button" class="ui-cal-nav" data-nav="-1" aria-label="Mês anterior">‹</button>
          <b>${this.esc(nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1))}</b>
          <button type="button" class="ui-cal-nav" data-nav="1" aria-label="Próximo mês">›</button>
        </div>
        <div class="ui-cal-wd">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="ui-cal-grid">${celulas}</div>
        <div class="ui-cal-quick">
          <button type="button" data-q="0">Hoje</button>
          <button type="button" data-q="1">Ontem</button>
          <button type="button" data-q="7">7 dias atrás</button>
        </div>`;

      painel.querySelectorAll('[data-nav]').forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        mes += Number(b.dataset.nav);
        if (mes < 0) { mes = 11; ano--; } else if (mes > 11) { mes = 0; ano++; }
        desenhar();
      });
      painel.querySelectorAll('[data-d]').forEach(b => b.onclick = () => aplicar(b.dataset.d));
      painel.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
        const d = new Date(); d.setDate(d.getDate() - Number(b.dataset.q));
        aplicar(iso(d));
      });
      // Reposiciona a cada desenho: trocar de mês muda a altura da grade (4, 5 ou
      // 6 linhas), e um painel ancorado por cima precisa subir junto
      this.posicionarFixo(painel, box);
    };

    const aplicar = valor => {
      inp.value = valor;
      rotulo();
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      this.fechar();
    };

    desenhar();
  },

  /* ---------------- Utilitários ---------------- */
  // Impede que um painel mais largo que o campo (o calendário, em coluna estreita)
  // fique espremido ou saia da tela: mede e desloca para dentro da janela.
  posicionar(painel, box) {
    if (typeof painel.getBoundingClientRect !== 'function') return;
    if (!box || typeof box.getBoundingClientRect !== 'function') return;
    const margem = 10;

    // --- horizontal: não passar das bordas da tela ---
    painel.style.left = '0'; painel.style.right = 'auto';
    const r = painel.getBoundingClientRect();
    const largura = window.innerWidth || 0;
    if (largura && r.width) {
      if (r.right > largura - margem) {
        painel.style.left = `-${Math.round(r.right - (largura - margem))}px`;
      }
      const novo = painel.getBoundingClientRect();
      if (novo.left < margem) {
        painel.style.left = `${Math.round(margem - (novo.left - parseFloat(painel.style.left || 0)))}px`;
      }
    }

    /* --- vertical: caber no que o teclado deixou visível ---
       Sem isto, campo perto do rodapé abria a lista atrás do teclado: a lista
       existia, ninguém via. Mede pelo visualViewport, que é a área realmente
       visível, e não pelo innerHeight, que ignora o teclado. */
    const vv = window.visualViewport;
    const alturaVisivel = (vv && vv.height) || window.innerHeight || 0;
    const topoVisivel = (vv && vv.offsetTop) || 0;
    if (!alturaVisivel) return;

    const campo = box.getBoundingClientRect();
    const lista = painel.querySelector && painel.querySelector('.ui-list');
    const busca = painel.querySelector && painel.querySelector('.ui-search');
    const cromo = (busca ? 52 : 0) + 12;          // caixa de busca + respiro do painel
    const abaixo = (topoVisivel + alturaVisivel) - campo.bottom - margem;
    const acima = campo.top - topoVisivel - margem;

    // Abre para cima só quando lá caiba mais: virar por virar desorienta
    const paraCima = abaixo < 200 && acima > abaixo;
    painel.classList.toggle('acima', paraCima);
    const disponivel = Math.max(120, (paraCima ? acima : abaixo) - cromo);
    if (lista) lista.style.maxHeight = `${Math.round(Math.min(260, disponivel))}px`;
    // Calendário não tem lista rolável: se não couber embaixo, sobe inteiro
    const cal = painel.querySelector && painel.querySelector('.ui-cal');
    if (cal && !lista) painel.classList.toggle('acima', painel.getBoundingClientRect().height > abaixo && acima > abaixo);
  },

  // Abre o painel de um campo por código (ex: ao escolher "Outra" nas categorias)
  open(nativo) {
    const box = nativo && nativo.closest && nativo.closest('.ui-select, .ui-date');
    const botao = box && box.querySelector('.ui-select-btn, .ui-date-btn');
    if (botao) botao.click();
  },

  fechar() {
    if (!this.aberto) return;
    const { painel, aoFechar } = this.aberto;
    painel.remove();
    this.aberto = null;
    if (aoFechar) aoFechar();
  },

  norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
  esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

  // Aplica nos campos de um trecho da tela (chamado a cada folha/modal aberto)
  enhance(root) {
    const r = root || document;
    r.querySelectorAll('select:not([data-ui])').forEach(s => this.enhanceSelect(s));
    r.querySelectorAll('input[type="date"]:not([data-ui])').forEach(i => this.enhanceDate(i));
  },

  // Sincroniza os rótulos quando o valor muda por código
  refresh(root) {
    (root || document).querySelectorAll('[data-ui="1"]').forEach(el => el._uiRefresh && el._uiRefresh());
  },

  /* ---------------- Teclado do celular ----------------
     A barra de digitação cobre a parte de baixo da tela, mas elemento com
     position:fixed continua ancorado no viewport de layout — que não encolheu.
     Resultado: o botão de salvar da folha ficava embaixo do teclado exatamente
     quando havia um campo em foco, que é quando ele é necessário.

     visualViewport informa a altura que sobrou. A variável --teclado leva isso ao
     CSS, e daí a folha se apoia acima do teclado e o modal ganha espaço no rodapé. */
  vigiarTeclado() {
    const vv = typeof window !== 'undefined' && window.visualViewport;
    if (!vv || typeof document === 'undefined' || !document.documentElement) return;
    const aplicar = () => {
      const total = window.innerHeight || 0;
      const oculto = Math.max(0, Math.round(total - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--teclado', oculto + 'px');
      // 120px separa teclado aberto de barrinhas do navegador aparecendo/sumindo
      document.body.classList.toggle('teclado-aberto', oculto > 120);
      // Painel aberto precisa ser recolocado: o espaço disponível mudou
      if (this.aberto) this.posicionar(this.aberto.painel, this.aberto.box);
    };
    vv.addEventListener('resize', aplicar);
    vv.addEventListener('scroll', aplicar);
    aplicar();
  },

  /* Campo que recebe foco dentro de folha ou modal precisa continuar à vista.
     O navegador faz isso sozinho no documento, mas não de forma confiável dentro
     de contêiner com position:fixed e rolagem própria. */
  vigiarFoco() {
    document.addEventListener('focusin', e => {
      const alvo = e.target;
      if (!alvo || !alvo.closest) return;
      if (!alvo.closest('.sheet, .modal')) return;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      // Espera o viewport assentar depois de o teclado subir
      setTimeout(() => {
        if (alvo.scrollIntoView) alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 260);
    });
  },

  init() {
    document.addEventListener('click', e => {
      if (!this.aberto) return;
      const alvo = e.target;
      // Nó já retirado do DOM não é "clique fora": é um redesenho do próprio
      // painel, e fechar aí tiraria a lista debaixo de quem acabou de tocar nela.
      if (alvo && alvo.isConnected === false) return;
      // O popover vive no <body>, fora da âncora: sem testar o painel também, o
      // primeiro toque dentro dele contaria como "clique fora" e fecharia tudo
      if (!this.aberto.box.contains(alvo) && !this.aberto.painel.contains(alvo)) this.fechar();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.fechar(); });
    this.vigiarTeclado();
    this.vigiarFoco();
  },
};
