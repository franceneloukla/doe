/* =============================================================================
   VAKINHA — página de campanha · app.js
   Vanilla JS (ES2017+), sem framework e sem nenhuma requisição externa.
   Responsável por: barra de progresso animada, abas, compartilhar, copiar chave
   Pix, menu do header, coração da campanha e feedback via toast.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------------- utilidades */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  var toastEl = $('#toast');
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) { return; }
    toastEl.textContent = msg;
    toastEl.classList.add('is-visivel');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-visivel');
    }, 2600);
  }

  var reduzido = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------- 1. barra de progresso ---- */
  function animarProgresso(fill) {
    var pct = parseFloat(fill.getAttribute('data-pct') || '0');
    if (!isFinite(pct)) { pct = 0; }
    pct = Math.max(0, Math.min(100, pct));

    if (reduzido) {
      fill.style.width = pct + '%';
      return;
    }
    // duplo rAF garante que o browser aplique o width:0 antes de animar
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        fill.style.width = pct + '%';
      });
    });
  }

  function iniciarProgressos() {
    var barras = $$('.progresso-fill[data-pct]');
    if (!barras.length) { return; }

    if (!('IntersectionObserver' in window)) {
      barras.forEach(animarProgresso);
      return;
    }
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) {
          animarProgresso(e.target);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.2 });
    barras.forEach(function (b) { obs.observe(b); });
  }

  /* --------------------------------------------------------------- 2. abas ---- */
  var abas = $$('.aba');
  var paineis = abas.map(function (aba) {
    return doc.getElementById('grupo-' + aba.getAttribute('data-painel'));
  });

  function selecionarAba(indice, moverFoco) {
    if (indice < 0 || indice >= abas.length) { return; }
    abas.forEach(function (aba, i) {
      var ativo = i === indice;
      aba.classList.toggle('is-ativa', ativo);
      aba.setAttribute('aria-selected', ativo ? 'true' : 'false');
      aba.setAttribute('tabindex', ativo ? '0' : '-1');
      if (paineis[i]) { paineis[i].hidden = !ativo; }
    });
    if (moverFoco) { abas[indice].focus(); }
  }

  abas.forEach(function (aba, i) {
    aba.addEventListener('click', function () { selecionarAba(i, false); });
    aba.addEventListener('keydown', function (ev) {
      var alvo = null;
      if (ev.key === 'ArrowRight') { alvo = (i + 1) % abas.length; }
      else if (ev.key === 'ArrowLeft') { alvo = (i - 1 + abas.length) % abas.length; }
      else if (ev.key === 'Home') { alvo = 0; }
      else if (ev.key === 'End') { alvo = abas.length - 1; }
      if (alvo !== null) {
        ev.preventDefault();
        selecionarAba(alvo, true);
      }
    });
  });

  /* atalhos "ver tudo" e "Ver selos" -> troca a aba e rola até a barra */
  $$('[data-aba-alvo]').forEach(function (link) {
    link.addEventListener('click', function (ev) {
      var alvo = link.getAttribute('data-aba-alvo');
      var idx = abas.findIndex(function (a) { return a.getAttribute('data-painel') === alvo; });
      if (idx < 0) { return; }
      ev.preventDefault();
      selecionarAba(idx, false);
      var topo = abas[idx].getBoundingClientRect().top + window.pageYOffset - 100;
      window.scrollTo({ top: topo, behavior: reduzido ? 'auto' : 'smooth' });
    });
  });

  /* --------------------------------------------------- 3. copiar / compartilhar */
  function copiarTexto(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = doc.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        doc.body.appendChild(ta);
        ta.select();
        var ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy'));
      } catch (err) {
        reject(err);
      }
    });
  }

  $$('[data-copiar]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copiarTexto(btn.getAttribute('data-copiar')).then(function () {
        toast('Chave Pix copiada!');
      }, function () {
        toast('Não foi possível copiar automaticamente.');
      });
    });
  });

  var btnCompartilhar = $('#btn-compartilhar');
  if (btnCompartilhar) {
    btnCompartilhar.addEventListener('click', function () {
      var url = window.location.href;
      var dados = {
        title: 'Juntos pela família de Joans',
        text: 'Ajude a família de Joans: vaquinha organizada por Tamires Nascimento.',
        url: url
      };
      // Web Share API quando disponível; senão copia o link
      if (navigator.share) {
        navigator.share(dados).catch(function () { /* usuário cancelou */ });
        return;
      }
      copiarTexto(url).then(function () {
        toast('Link da vaquinha copiado!');
      }, function () {
        toast('Copie o endereço: ' + url);
      });
    });
  }

  /* ------------------------------------------------------------- 4. header ---- */
  var header = $('.site-header');
  var menuToggle = $('#menu-toggle');

  if (menuToggle && header) {
    menuToggle.addEventListener('click', function () {
      var aberto = header.classList.toggle('is-aberto');
      menuToggle.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      menuToggle.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    });
  }

  var botoesMenu = $$('.nav-link[aria-controls]');
  botoesMenu.forEach(function (btn) {
    var sub = doc.getElementById(btn.getAttribute('aria-controls'));
    if (!sub) { return; }
    btn.addEventListener('click', function () {
      var aberto = btn.getAttribute('aria-expanded') === 'true';
      // fecha os outros
      botoesMenu.forEach(function (outro) {
        if (outro === btn) { return; }
        outro.setAttribute('aria-expanded', 'false');
        var s = doc.getElementById(outro.getAttribute('aria-controls'));
        if (s) { s.hidden = true; }
      });
      btn.setAttribute('aria-expanded', aberto ? 'false' : 'true');
      sub.hidden = aberto;
    });
  });

  // fecha submenus e o menu mobile ao clicar fora / ESC
  doc.addEventListener('click', function (ev) {
    botoesMenu.forEach(function (btn) {
      var sub = doc.getElementById(btn.getAttribute('aria-controls'));
      if (!sub || sub.hidden) { return; }
      if (btn.contains(ev.target) || sub.contains(ev.target)) { return; }
      btn.setAttribute('aria-expanded', 'false');
      sub.hidden = true;
    });

    if (header && header.classList.contains('is-aberto') && menuToggle) {
      if (!header.contains(ev.target)) {
        header.classList.remove('is-aberto');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });

  doc.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') { return; }
    botoesMenu.forEach(function (btn) {
      var sub = doc.getElementById(btn.getAttribute('aria-controls'));
      if (sub) { sub.hidden = true; }
      btn.setAttribute('aria-expanded', 'false');
    });
    if (header && menuToggle && header.classList.contains('is-aberto')) {
      header.classList.remove('is-aberto');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.focus();
    }
  });

  /* ----------------------------------------------------------- 5. coração ----- */
  var btnCoracao = $('#btn-coracao');
  if (btnCoracao) {
    btnCoracao.addEventListener('click', function () {
      var marcado = btnCoracao.getAttribute('aria-pressed') === 'true';
      btnCoracao.setAttribute('aria-pressed', marcado ? 'false' : 'true');
      toast(marcado ? 'Coração removido.' : 'Coração enviado! Obrigado 💚');
    });
  }

  /* -------------------------------------------------- 6. comentários / apoio -- */
  var btnComentario = $('#btn-enviar-comentario');
  if (btnComentario) {
    btnComentario.addEventListener('click', function () {
      var campo = $('#novo-comentario');
      var texto = campo ? campo.value.trim() : '';
      if (texto.length < 3) {
        toast('Escreva uma mensagem antes de enviar.');
        if (campo) { campo.focus(); }
        return;
      }
      if (campo) { campo.value = ''; }
      toast('Mensagem registrada. Obrigado pelo apoio!');
    });
  }

  $$('.btn-acao[data-acao="coracao"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var atual = parseInt((btn.textContent || '').replace(/\D+/g, ''), 10) || 0;
      btn.textContent = '♥ ' + (atual + 1);
      btn.disabled = true;
      toast('Coração enviado para o comentário.');
    });
  });

  /* ------------------------------------------------------------- 7. start ----- */
  function iniciar() {
    iniciarProgressos();
    // garante o estado inicial das abas (Sobre ativa, demais escondidas)
    if (abas.length) {
      var idxAtiva = abas.findIndex(function (a) { return a.classList.contains('is-ativa'); });
      selecionarAba(idxAtiva < 0 ? 0 : idxAtiva, false);
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
