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

  /* ---------------- Select estilo Select2 ---------------- */
  enhanceSelect(sel) {
    if (sel.dataset.ui === '1' || sel.multiple) return;
    sel.dataset.ui = '1';
    sel.classList.add('ui-native');

    const box = document.createElement('div');
    box.className = 'ui-select';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ui-select-btn';
    botao.innerHTML = '<span class="ui-select-txt"></span><span class="ui-select-arrow"></span>';
    box.appendChild(botao);
    sel.parentNode.insertBefore(box, sel);
    box.appendChild(sel);

    const rotulo = () => {
      const o = sel.options[sel.selectedIndex];
      const txt = o ? o.textContent.trim() : '';
      const vazio = !o || !o.value;
      botao.querySelector('.ui-select-txt').textContent = txt || 'Selecione';
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
    const opcoes = [];
    for (const o of sel.options) {
      const grupo = o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      opcoes.push({ value: o.value, label: o.textContent.trim(), grupo, disabled: o.disabled });
    }
    const comBusca = opcoes.length > 7;

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

    const desenhar = (filtro = '') => {
      const f = this.norm(filtro);
      let html = '', grupoAtual = '', visiveis = 0;
      opcoes.forEach((o, i) => {
        if (f && !this.norm(o.label).includes(f)) return;
        if (o.grupo && o.grupo !== grupoAtual) { grupoAtual = o.grupo; html += `<div class="ui-group">${this.esc(o.grupo)}</div>`; }
        const sel_ = o.value === sel.value;
        html += `<div class="ui-opt${sel_ ? ' is-sel' : ''}${i === marcado ? ' is-mark' : ''}${o.disabled ? ' is-off' : ''}"
          data-i="${i}" role="option" aria-selected="${sel_}">${this.esc(o.label)}${sel_ ? '<span class="ui-check">✓</span>' : ''}</div>`;
        visiveis++;
      });
      lista.innerHTML = visiveis ? html : '<div class="ui-empty">Nada encontrado</div>';
      lista.querySelectorAll('.ui-opt').forEach(el => {
        el.onclick = () => { if (!el.classList.contains('is-off')) escolher(Number(el.dataset.i)); };
      });
      const m = lista.querySelector('.is-mark');
      if (m) m.scrollIntoView({ block: 'nearest' });
    };

    const escolher = i => {
      sel.value = opcoes[i].value;
      rotulo();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      this.fechar();
      botao.focus();
    };

    desenhar();
    if (busca) {
      setTimeout(() => busca.focus(), 30);
      busca.oninput = () => { marcado = -1; desenhar(busca.value); };
    }

    const alvo = busca || painel;
    alvo.onkeydown = e => {
      const vis = [...lista.querySelectorAll('.ui-opt:not(.is-off)')];
      if (e.key === 'Escape') { e.preventDefault(); this.fechar(); botao.focus(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const alvoEl = lista.querySelector('.is-mark') || vis[0];
        if (alvoEl) escolher(Number(alvoEl.dataset.i));
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const atual = vis.findIndex(el => el.classList.contains('is-mark'));
      const prox = e.key === 'ArrowDown'
        ? Math.min(vis.length - 1, atual + 1)
        : Math.max(0, atual <= 0 ? 0 : atual - 1);
      if (vis[prox]) { marcado = Number(vis[prox].dataset.i); desenhar(busca ? busca.value : ''); }
    };
    if (!busca) painel.tabIndex = -1, setTimeout(() => painel.focus(), 20);
  },

  /* ---------------- Datepicker ---------------- */
  enhanceDate(inp) {
    if (inp.dataset.ui === '1') return;
    inp.dataset.ui = '1';
    inp.classList.add('ui-native');

    const box = document.createElement('div');
    box.className = 'ui-date';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ui-date-btn';
    botao.innerHTML = '<span class="ui-date-txt"></span><span class="ui-date-ico">📅</span>';
    box.appendChild(botao);
    inp.parentNode.insertBefore(box, inp);
    box.appendChild(inp);

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

    const painel = document.createElement('div');
    painel.className = 'ui-panel ui-cal';
    box.appendChild(painel);
    this.aberto = { painel, box };

    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hojeISO = iso(new Date());

    const desenhar = () => {
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
  fechar() {
    if (!this.aberto) return;
    this.aberto.painel.remove();
    this.aberto = null;
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

  init() {
    document.addEventListener('click', e => {
      if (this.aberto && !this.aberto.box.contains(e.target)) this.fechar();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.fechar(); });
  },
};
