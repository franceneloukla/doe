/*!
 * checkout.js — fluxo de doação do clone Vakinha
 * doar.html  ->  pix.html | cartao.html  ->  obrigado.html
 *
 * ===========================================================================
 * SIMULAÇÃO DE FRONT-END — NÃO EXISTE BACKEND NESTE PROJETO.
 *
 * Tudo o que acontece aqui roda dentro do navegador e para no navegador:
 *   - nenhum fetch(), XMLHttpRequest, WebSocket, sendBeacon ou <form action>;
 *   - nenhuma requisição de rede (o site abre offline, sem CDN);
 *   - nenhum dado de doador, cartão ou PIX sai da página;
 *   - o QR Code do PIX é montado e desenhado localmente (EMV + encoder próprio);
 *   - o estado da doação vive em sessionStorage sob a chave "doacao".
 * Nenhum pagamento é processado de verdade. É demonstração visual/funcional.
 * ===========================================================================
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Configuração da campanha e do recebedor PIX (dados moldados do alvo) *
   * ------------------------------------------------------------------ */
  var CAMPANHA = {
    titulo: 'Juntos pela família de Joans',
    arrecadado: 188005.52,
    meta: 250000,
    apoiadores: 2241,
    progresso: 75
  };

  var VALOR_MINIMO = 5;          // R$ 5,00
  var VALOR_MAXIMO = 100000;     // R$ 100.000,00
  var PRECO_CORACOES = 4.99;     // "5 corações"
  var EXPIRACAO_PIX = 15 * 60;   // 900 segundos = 15:00
  var CHAVE_ESTADO = 'doacao';
  var CHAVE_SEQ = 'doacao_seq';

  var PIX_CONF = {
    chave: '8e9b1f2a-4c3d-4a5b-9e8f-0a1b2c3d4e5f', // chave EVP de exemplo
    nome: 'JUNTOS PELA FAMILIA',                    // ID 59 (máx. 25)
    cidade: 'SAO PAULO',                            // ID 60 (máx. 15)
    mcc: '0000'                                     // ID 52
  };

  /* ------------------------------------------------------------------ *
   * Utilidades                                                          *
   * ------------------------------------------------------------------ */
  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) {
    return Array.prototype.slice.call((raiz || document).querySelectorAll(sel));
  }
  function soDigitos(txt) { return String(txt || '').replace(/\D+/g, ''); }

  /** Formata centavos -> "R$ 1.234,56" (determinístico, sem depender de locale do SO). */
  function brl(valor) {
    var centavos = Math.round(Number(valor) * 100);
    var negativo = centavos < 0;
    centavos = Math.abs(centavos);
    var s = String(centavos);
    while (s.length < 3) { s = '0' + s; }
    var inteiro = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (negativo ? '-' : '') + 'R$ ' + inteiro + ',' + s.slice(-2);
  }

  function numeroDeTexto(txt) {
    var limpo = String(txt || '').trim().replace(/^R\$\s*/i, '');
    limpo = limpo.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  }

  function texto(txt) { return String(txt == null ? '' : txt).trim(); }

  /* ------------------------------------------------------------------ *
   * Estado entre páginas (sessionStorage)                               *
   * ------------------------------------------------------------------ */
  function lerEstado() {
    try {
      var bruto = sessionStorage.getItem(CHAVE_ESTADO);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }

  function salvarEstado(dados) {
    var atual = lerEstado() || {};
    var novo = Object.assign({}, atual, dados, { atualizadoEm: Date.now() });
    try { sessionStorage.setItem(CHAVE_ESTADO, JSON.stringify(novo)); } catch (e) {}
    return novo;
  }

  function gerarIdTransacao() {
    var seq = 0;
    try { seq = parseInt(sessionStorage.getItem(CHAVE_SEQ) || '0', 10) || 0; } catch (e) {}
    seq += 1;
    try { sessionStorage.setItem(CHAVE_SEQ, String(seq)); } catch (e) {}
    var ano = new Date().getFullYear();
    var numero = ('0000' + seq).slice(-4);
    return 'VK-' + ano + '-' + numero;
  }

  function estadoComFallback() {
    var e = lerEstado() || {};
    var valor = Number(e.valor);
    var total = Number(e.total);
    if (!isFinite(valor) || valor <= 0)  { valor = 100; }
    if (!isFinite(total) || total <= 0)  { total = valor; }
    return {
      nome: e.nome || '',
      email: e.email || '',
      documento: e.documento || '',
      telefone: e.telefone || '',
      valor: valor,
      total: total,
      coracoes: !!e.coracoes,
      numerosSorte: !!e.numerosSorte,
      atualizacoes: !!e.atualizacoes,
      forma: e.forma === 'cartao' ? 'cartao' : (e.forma === 'pix' ? 'pix' : 'pix'),
      txid: e.txid || gerarIdTransacao(),
      parcelas: Number(e.parcelas) || 1,
      cartaoFinal: e.cartaoFinal || '',
      bandeira: e.bandeira || ''
    };
  }

  /* ------------------------------------------------------------------ *
   * Validação                                                           *
   * ------------------------------------------------------------------ */
  function cpfValido(digitos) {
    var d = soDigitos(digitos);
    if (d.length !== 11) { return false; }
    if (/^(\d)\1{10}$/.test(d)) { return false; } // 111.111.111-11, 000..., etc.
    var soma = 0, i;
    for (i = 0; i < 9; i++) { soma += parseInt(d.charAt(i), 10) * (10 - i); }
    var dv1 = (soma * 10) % 11;
    if (dv1 === 10) { dv1 = 0; }
    if (dv1 !== parseInt(d.charAt(9), 10)) { return false; }
    soma = 0;
    for (i = 0; i < 10; i++) { soma += parseInt(d.charAt(i), 10) * (11 - i); }
    var dv2 = (soma * 10) % 11;
    if (dv2 === 10) { dv2 = 0; }
    return dv2 === parseInt(d.charAt(10), 10);
  }

  function telefoneValido(digitos) {
    var d = soDigitos(digitos);
    if (d.length !== 10 && d.length !== 11) { return false; }
    var ddd = parseInt(d.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) { return false; }
    if (d.length === 11 && d.charAt(2) !== '9') { return false; } // celular
    if (d.length === 10 && '0123456789'.indexOf(d.charAt(2)) < 0) { return false; }
    return true;
  }

  var REGEX_EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

  /**
   * Valida um campo. Devolve { ok, msg }.
   * As mensagens são exatamente as que aparecem abaixo do campo.
   */
  function validarCampo(campo, valor) {
    var v = texto(valor);
    switch (campo) {
      case 'nome':
        if (!v) { return { ok: false, msg: 'Informe seu nome completo.' }; }
        var partes = v.split(/\s+/).filter(function (p) { return p.length >= 2; });
        if (/\d/.test(v) || partes.length < 2) {
          return { ok: false, msg: 'Digite nome e sobrenome, como no documento.' };
        }
        return { ok: true, msg: '' };
      case 'cpf':
        var d = soDigitos(v);
        if (!d) { return { ok: false, msg: 'Informe seu CPF.' }; }
        if (d.length !== 11) { return { ok: false, msg: 'O CPF precisa ter 11 dígitos.' }; }
        if (!cpfValido(d)) { return { ok: false, msg: 'CPF inválido. Confira os números.' }; }
        return { ok: true, msg: '' };
      case 'telefone':
        var t = soDigitos(v);
        if (!t) { return { ok: false, msg: 'Informe um telefone com WhatsApp.' }; }
        if (!telefoneValido(t)) {
          return { ok: false, msg: 'Telefone inválido. Use DDD + número, ex.: (73) 99888-7766.' };
        }
        return { ok: true, msg: '' };
      case 'email':
        if (!v) { return { ok: false, msg: 'Informe seu melhor e-mail.' }; }
        if (!REGEX_EMAIL.test(v)) { return { ok: false, msg: 'E-mail inválido. Ex.: maria@example.com' }; }
        return { ok: true, msg: '' };
      case 'valor':
        var n = typeof valor === 'number' ? valor : numeroDeTexto(v);
        if (!v && !n) { return { ok: false, msg: 'Informe o valor da contribuição.' }; }
        if (n < VALOR_MINIMO) { return { ok: false, msg: 'O valor mínimo da doação é ' + brl(VALOR_MINIMO) + '.' }; }
        if (n > VALOR_MAXIMO) { return { ok: false, msg: 'O valor máximo por doação é ' + brl(VALOR_MAXIMO) + '.' }; }
        return { ok: true, msg: '' };
      case 'numeroCartao':
        var c = soDigitos(v);
        if (!c) { return { ok: false, msg: 'Informe o número do cartão.' }; }
        if (c.length < 13 || c.length > 19) { return { ok: false, msg: 'Número de cartão incompleto.' }; }
        if (!luhnValido(c)) { return { ok: false, msg: 'Número de cartão inválido.' }; }
        return { ok: true, msg: '' };
      case 'nomeCartao':
        if (!v) { return { ok: false, msg: 'Informe o nome impresso no cartão.' }; }
        if (v.length < 3 || /\d/.test(v)) { return { ok: false, msg: 'Nome impresso inválido.' }; }
        return { ok: true, msg: '' };
      case 'validade':
        var val = validadeCartao(v);
        if (!v) { return { ok: false, msg: 'Informe a validade (MM/AA).' }; }
        if (!val.ok) { return { ok: false, msg: val.msg }; }
        return { ok: true, msg: '' };
      case 'cvv':
        var s = soDigitos(v);
        if (!s) { return { ok: false, msg: 'Informe o CVV.' }; }
        if (s.length < 3 || s.length > 4) { return { ok: false, msg: 'O CVV tem 3 ou 4 dígitos.' }; }
        return { ok: true, msg: '' };
      default:
        return { ok: true, msg: '' };
    }
  }

  /* ------------------------------------------------------------------ *
   * Cartão: Luhn, validade, bandeira                                    *
   * ------------------------------------------------------------------ */
  function luhnValido(digitos) {
    var soma = 0, alternar = false;
    for (var i = digitos.length - 1; i >= 0; i--) {
      var n = parseInt(digitos.charAt(i), 10);
      if (alternar) {
        n *= 2;
        if (n > 9) { n -= 9; }
      }
      soma += n;
      alternar = !alternar;
    }
    return soma % 10 === 0;
  }

  /** Validade MM/AA: mês 01-12, ano de 2 dígitos, mês não vencido. */
  function validadeCartao(valor) {
    var m = String(valor || '').replace(/\D/g, '');
    if (m.length !== 4) { return { ok: false, msg: 'Use o formato MM/AA.' }; }
    var mes = parseInt(m.slice(0, 2), 10);
    var ano = 2000 + parseInt(m.slice(2, 4), 10);
    if (mes < 1 || mes > 12) { return { ok: false, msg: 'Mês inválido.' }; }
    var hoje = new Date();
    var anoAtual = hoje.getFullYear();
    var mesAtual = hoje.getMonth() + 1;
    if (ano < anoAtual || (ano === anoAtual && mes < mesAtual)) {
      return { ok: false, msg: 'Cartão vencido.' };
    }
    if (ano > anoAtual + 20) { return { ok: false, msg: 'Ano inválido.' }; }
    return { ok: true, msg: '', mes: mes, ano: ano };
  }

  function bandeiraCartao(digitos) {
    if (/^4/.test(digitos)) { return 'Visa'; }
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digitos)) { return 'Mastercard'; }
    if (/^3[47]/.test(digitos)) { return 'Amex'; }
    if (/^(606282|3841)/.test(digitos)) { return 'Hipercard'; }
    if (/^(4011|4312|4389|5067|6277|6362|6363|650|651|655)/.test(digitos)) { return 'Elo'; }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * Máscaras                                                            *
   * ------------------------------------------------------------------ */
  function mascaraCPF(valor) {
    var d = soDigitos(valor).slice(0, 11);
    var saida = d;
    if (d.length > 3) { saida = d.slice(0, 3) + '.' + d.slice(3); }
    if (d.length > 6) { saida = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6); }
    if (d.length > 9) { saida = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9); }
    return saida;
  }

  function mascaraTelefone(valor) {
    var d = soDigitos(valor).slice(0, 11);
    if (!d) { return ''; }
    if (d.length <= 2) { return '(' + d; }
    if (d.length <= 6) { return '(' + d.slice(0, 2) + ') ' + d.slice(2); }
    if (d.length <= 10) { return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6); }
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  /**
   * Valor em reais com separador de milhar pt-BR.
   * Não força os centavos enquanto o usuário digita (evita o "100 -> 1,00");
   * ao sair do campo, complete() fecha em ",00" ou ",X0".
   */
  /**
   * Aceita "47.50", "1.234,56", "R$ 100" e devolve texto só com dígitos e vírgula.
   * Ponto seguido de 1-2 dígitos no fim é lido como separador decimal (é o que
   * aparece quando o valor vem de script/paste em formato en-US).
   */
  function normalizarValorBruto(valor) {
    var t = String(valor == null ? '' : valor).replace(/R\$?\s*/gi, '').replace(/\s+/g, '');
    if (t.indexOf(',') === -1) {
      var m = /^(\d{1,3}(?:\.\d{3})*)\.(\d{1,2})$/.exec(t);
      if (m) { return m[1].replace(/\./g, '') + ',' + m[2]; }
      var simples = /^(\d+)\.(\d{1,2})$/.exec(t);
      if (simples) { return simples[1] + ',' + simples[2]; }
    }
    return t;
  }

  function mascaraValor(valor) {
    var bruto = normalizarValorBruto(valor).replace(/[^\d,]/g, '');
    var partes = bruto.split(',');
    var inteiro = partes[0].slice(0, 7);
    var decimal = partes.length > 1 ? partes.slice(1).join('').slice(0, 2) : null;
    if (inteiro) { inteiro = inteiro.replace(/^0+(?=\d)/, ''); }
    var formatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (decimal !== null) { return formatado + ',' + decimal; }
    return formatado;
  }

  function completaValor(valor) {
    var bruto = texto(valor);
    if (!bruto) { return ''; }
    if (bruto.indexOf(',') === -1) { return bruto + ',00'; }
    var partes = bruto.split(',');
    var dec = (partes[1] || '').padEnd(2, '0');
    return partes[0] + ',' + dec;
  }

  function mascaraCartao(valor) {
    var d = soDigitos(valor).slice(0, 19);
    return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function mascaraValidade(valor) {
    var d = soDigitos(valor).slice(0, 4);
    if (d.length > 2) { return d.slice(0, 2) + '/' + d.slice(2); }
    return d;
  }

  /* ------------------------------------------------------------------ *
   * PIX — BR Code (EMV MPM) + CRC16-CCITT-FALSE                         *
   * ------------------------------------------------------------------ */
  /** Campo EMV: <ID><tamanho em 2 dígitos><valor>. */
  function tlv(id, valor) {
    var v = String(valor == null ? '' : valor);
    var tam = v.length;
    return String(id) + (tam < 10 ? '0' + tam : String(tam)) + v;
  }

  /** CRC16-CCITT-FALSE: polinômio 0x1021, inicial 0xFFFF, sem reflexão, xorout 0. */
  function crc16(payload) {
    var crc = 0xFFFF;
    for (var i = 0; i < payload.length; i++) {
      var c = payload.charCodeAt(i);
      if (c > 0xFF) { c = c & 0xFF; } // payload é ASCII; protege contra lixo
      crc ^= (c << 8);
      for (var b = 0; b < 8; b++) {
        if (crc & 0x8000) { crc = ((crc << 1) ^ 0x1021) & 0xFFFF; }
        else { crc = (crc << 1) & 0xFFFF; }
      }
    }
    var hex = crc.toString(16).toUpperCase();
    while (hex.length < 4) { hex = '0' + hex; }
    return hex;
  }

  /**
   * Monta o BR Code completo.
   * @param {string} valor  ex.: "104.99"
   * @param {string} txid   identificador alfanumérico (máx. 25)
   */
  function montarPayloadPix(valor, txid) {
    var v = Number(String(valor).replace(',', '.'));
    var valorStr = isFinite(v) && v > 0 ? v.toFixed(2) : '';
    var id = String(txid || 'VK20260001').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25);

    var conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', PIX_CONF.chave);
    var adicional = tlv('05', id);

    var payload = ''
      + tlv('00', '01')
      + tlv('26', conta)
      + tlv('52', PIX_CONF.mcc)
      + tlv('53', '986')
      + (valorStr ? tlv('54', valorStr) : '')
      + tlv('58', 'BR')
      + tlv('59', PIX_CONF.nome.slice(0, 25))
      + tlv('60', PIX_CONF.cidade.slice(0, 15))
      + tlv('62', adicional);

    payload += '6304';
    return payload + crc16(payload);
  }

  /** Payload de exemplo mostrado na imagem estática assets/qr/pix-qr.png. */
  var PAYLOAD_EXEMPLO = montarPayloadPix('104.99', 'VK20260001');

  /* ------------------------------------------------------------------ *
   * QR Code — encoder próprio                                           *
   *   modo byte · correção de erro M · versões 1 a 10                   *
   * Nenhuma biblioteca externa: a matriz é calculada aqui no navegador   *
   * (Reed-Solomon sobre GF(256), intercalação de blocos, mascaramento    *
   *  e escolha por penalidade — ISO/IEC 18004).                          *
   * ------------------------------------------------------------------ */

  // [ecPorBloco, blocosG1, dadosPorBlocoG1, blocosG2, dadosPorBlocoG2] — nível M
  var QR_TABELA_M = {
    1:  [10, 1, 16, 0, 0],
    2:  [16, 1, 28, 0, 0],
    3:  [26, 1, 44, 0, 0],
    4:  [18, 2, 32, 0, 0],
    5:  [24, 2, 43, 0, 0],
    6:  [16, 4, 27, 0, 0],
    7:  [18, 4, 31, 0, 0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };

  // posições dos padrões de alinhamento por versão
  var QR_ALINHAMENTO = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  // Tabelas de corpo finito GF(256) com polinômio primitivo 0x11D
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) { x ^= 0x11D; }
    }
    for (var j = 255; j < 512; j++) { GF_EXP[j] = GF_EXP[j - 255]; }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) { return 0; }
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /** Polinômio gerador de Reed-Solomon de grau n (coeficientes em ordem decrescente). */
  function rsGerador(grau) {
    var p = [1];
    for (var i = 0; i < grau; i++) {
      var np = new Array(p.length + 1);
      for (var k = 0; k < np.length; k++) { np[k] = 0; }
      for (var j = 0; j < p.length; j++) {
        np[j] ^= p[j];
        np[j + 1] ^= gfMul(p[j], GF_EXP[i]);
      }
      p = np;
    }
    return p;
  }

  /** Códigos de correção de erro para um bloco de dados. */
  function rsEcc(dados, grau) {
    var gen = rsGerador(grau);
    var res = dados.slice();
    for (var i = 0; i < grau; i++) { res.push(0); }
    for (var d = 0; d < dados.length; d++) {
      var f = res[d];
      if (f === 0) { continue; }
      for (var j = 0; j < gen.length; j++) {
        res[d + j] ^= gfMul(gen[j], f);
      }
    }
    return res.slice(dados.length);
  }

  function utf8Bytes(str) {
    var s = String(str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = s.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function qrBitsContador(versao) { return versao <= 9 ? 8 : 16; }

  function qrCapacidadeBytes(versao) {
    var t = QR_TABELA_M[versao];
    var codewordsDados = t[1] * t[2] + t[3] * t[4];
    return Math.floor((codewordsDados * 8 - 4 - qrBitsContador(versao)) / 8);
  }

  function qrEscolherVersao(nBytes) {
    for (var v = 1; v <= 10; v++) {
      if (nBytes <= qrCapacidadeBytes(v)) { return v; }
    }
    throw new Error('Payload muito longo para o QR (limite: versão 10, nível M).');
  }

  function qrCodewords(dadosBytes, versao) {
    var t = QR_TABELA_M[versao];
    var totalDados = t[1] * t[2] + t[3] * t[4];
    var bits = [];
    function empurra(valor, n) {
      for (var i = n - 1; i >= 0; i--) { bits.push((valor >> i) & 1); }
    }
    empurra(4, 4);                                   // modo byte
    empurra(dadosBytes.length, qrBitsContador(versao)); // contador de caracteres
    for (var i = 0; i < dadosBytes.length; i++) { empurra(dadosBytes[i], 8); }

    var limite = totalDados * 8;
    var terminador = Math.min(4, limite - bits.length);
    for (var k = 0; k < terminador; k++) { bits.push(0); }
    while (bits.length % 8 !== 0) { bits.push(0); }

    var cw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) { byte = (byte << 1) | bits[b + j]; }
      cw.push(byte);
    }
    var enchimento = [0xEC, 0x11];
    var idx = 0;
    while (cw.length < totalDados) { cw.push(enchimento[idx++ % 2]); }
    return cw;
  }

  /** Divide em blocos, calcula ECC e intercala (ordem exigida pela norma). */
  function qrIntercalar(dados, versao) {
    var t = QR_TABELA_M[versao];
    var ecPorBloco = t[0];
    var blocos = [], eccs = [], pos = 0, i;

    for (i = 0; i < t[1]; i++) { blocos.push(dados.slice(pos, pos + t[2])); pos += t[2]; }
    for (i = 0; i < t[3]; i++) { blocos.push(dados.slice(pos, pos + t[4])); pos += t[4]; }
    for (i = 0; i < blocos.length; i++) { eccs.push(rsEcc(blocos[i], ecPorBloco)); }

    var maior = Math.max.apply(null, blocos.map(function (b) { return b.length; }));
    var final = [], b2, i2;
    for (i2 = 0; i2 < maior; i2++) {
      for (b2 = 0; b2 < blocos.length; b2++) {
        if (i2 < blocos[b2].length) { final.push(blocos[b2][i2]); }
      }
    }
    for (i2 = 0; i2 < ecPorBloco; i2++) {
      for (b2 = 0; b2 < eccs.length; b2++) { final.push(eccs[b2][i2]); }
    }
    return final;
  }

  function qrBase(versao) {
    var n = versao * 4 + 17;
    var m = [], i, j;

    for (i = 0; i < n; i++) {
      var linha = [];
      for (j = 0; j < n; j++) { linha.push(null); }
      m.push(linha);
    }

    function poe(r, c, valor) {
      if (r >= 0 && c >= 0 && r < n && c < n) { m[r][c] = valor; }
    }

    // localizadores (finder) + separadores
    var cantos = [[0, 0], [0, n - 7], [n - 7, 0]];
    for (var k = 0; k < 3; k++) {
      var r0 = cantos[k][0], c0 = cantos[k][1];
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var dentro = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          var escuro = dentro && (
            dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
          );
          poe(r0 + dr, c0 + dc, escuro);
        }
      }
    }

    // padrões de sincronismo (timing)
    for (i = 8; i < n - 8; i++) {
      var v = (i % 2 === 0);
      if (m[6][i] === null) { poe(6, i, v); }
      if (m[i][6] === null) { poe(i, 6, v); }
    }

    // padrões de alinhamento
    var posicoes = QR_ALINHAMENTO[versao];
    for (var a = 0; a < posicoes.length; a++) {
      for (var b = 0; b < posicoes.length; b++) {
        var ra = posicoes[a], ca = posicoes[b];
        if ((ra === 6 && ca === 6) || (ra === 6 && ca === n - 7) || (ra === n - 7 && ca === 6)) { continue; }
        for (var da = -2; da <= 2; da++) {
          for (var db = -2; db <= 2; db++) {
            var borda = Math.abs(da) === 2 || Math.abs(db) === 2;
            poe(ra + da, ca + db, borda || (da === 0 && db === 0));
          }
        }
      }
    }

    // área reservada das informações de formato (preenchida depois)
    for (i = 0; i < 9; i++) {
      if (i !== 6) {
        poe(8, i, false);
        poe(i, 8, false);
      }
    }
    for (j = 0; j < 8; j++) {
      poe(8, n - 1 - j, false);
      poe(n - 1 - j, 8, false);
    }

    // informações de versão (v >= 7)
    if (versao >= 7) {
      for (i = 0; i < 6; i++) {
        for (j = 0; j < 3; j++) {
          poe(i, n - 11 + j, false);
          poe(n - 11 + j, i, false);
        }
      }
    }

    return m;
  }

  function qrMascara(indice, r, c) {
    switch (indice) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function qrPosicionarDados(m, codewords, mascara) {
    var n = m.length;
    var inc = -1, linha = n - 1, bitIdx = 7, byteIdx = 0;

    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) { col--; }
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (m[linha][col - c] === null) {
            var escuro = false;
            if (byteIdx < codewords.length) {
              escuro = ((codewords[byteIdx] >>> bitIdx) & 1) === 1;
            }
            if (qrMascara(mascara, linha, col - c)) { escuro = !escuro; }
            m[linha][col - c] = escuro;
            bitIdx--;
            if (bitIdx === -1) { byteIdx++; bitIdx = 7; }
          }
        }
        linha += inc;
        if (linha < 0 || linha >= n) { linha -= inc; inc = -inc; break; }
      }
    }
  }

  function bchDigitos(n) {
    var d = 0;
    while (n !== 0) { d++; n >>>= 1; }
    return d;
  }

  function bchInfoFormato(dados) {
    var d = dados << 10;
    while (bchDigitos(d) - bchDigitos(0x537) >= 0) {
      d ^= (0x537 << (bchDigitos(d) - bchDigitos(0x537)));
    }
    return ((dados << 10) | d) ^ 0x5412;
  }

  function bchInfoVersao(versao) {
    var d = versao << 12;
    while (bchDigitos(d) - bchDigitos(0x1F25) >= 0) {
      d ^= (0x1F25 << (bchDigitos(d) - bchDigitos(0x1F25)));
    }
    return (versao << 12) | d;
  }

  function qrInfoFormato(m, mascara) {
    var n = m.length;
    var nivelM = 0; // bits do nível M
    var bits = bchInfoFormato((nivelM << 3) | mascara);
    var i;

    for (i = 0; i < 15; i++) {
      var bit = ((bits >> i) & 1) === 1;
      if (i < 6) { m[i][8] = bit; }
      else if (i < 8) { m[i + 1][8] = bit; }
      else { m[n - 15 + i][8] = bit; }
    }
    for (i = 0; i < 15; i++) {
      var bit2 = ((bits >> i) & 1) === 1;
      if (i < 8) { m[8][n - i - 1] = bit2; }
      else if (i < 9) { m[8][15 - i] = bit2; }
      else { m[8][15 - i - 1] = bit2; }
    }
    m[n - 8][8] = true; // módulo escuro fixo
  }

  function qrInfoVersao(m, versao) {
    if (versao < 7) { return; }
    var n = m.length;
    var bits = bchInfoVersao(versao);
    for (var i = 0; i < 18; i++) {
      var bit = ((bits >> i) & 1) === 1;
      m[Math.floor(i / 3)][n - 8 - 3 + (i % 3)] = bit;
      m[n - 8 - 3 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }

  function qrPenalidade(m) {
    var n = m.length, p = 0, i, j, run;

    for (i = 0; i < n; i++) {
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[i][j] === m[i][j - 1]) { run++; }
        else { if (run >= 5) { p += 3 + (run - 5); } run = 1; }
      }
      if (run >= 5) { p += 3 + (run - 5); }
    }
    for (j = 0; j < n; j++) {
      run = 1;
      for (i = 1; i < n; i++) {
        if (m[i][j] === m[i - 1][j]) { run++; }
        else { if (run >= 5) { p += 3 + (run - 5); } run = 1; }
      }
      if (run >= 5) { p += 3 + (run - 5); }
    }

    for (i = 0; i < n - 1; i++) {
      for (j = 0; j < n - 1; j++) {
        var v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) { p += 3; }
      }
    }

    var padraoA = [true, false, true, true, true, false, true, false, false, false, false];
    var padraoB = [false, false, false, false, true, false, true, true, true, false, true];
    function bate(linha, inicio, padrao) {
      for (var k = 0; k < padrao.length; k++) {
        if (linha[inicio + k] !== padrao[k]) { return false; }
      }
      return true;
    }
    for (i = 0; i < n; i++) {
      var lin = m[i];
      var col = [];
      for (j = 0; j < n; j++) { col.push(m[j][i]); }
      for (j = 0; j <= n - 11; j++) {
        if (bate(lin, j, padraoA) || bate(lin, j, padraoB)) { p += 40; }
        if (bate(col, j, padraoA) || bate(col, j, padraoB)) { p += 40; }
      }
    }

    var escuros = 0;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) { if (m[i][j]) { escuros++; } }
    }
    var pct = (escuros * 100) / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  /**
   * Matriz final do QR.
   * @param {string} conteudo
   * @param {number} [mascaraForcada] 0-7 (teste); sem valor, escolhe a melhor.
   * @returns {{tamanho:number, versao:number, mascara:number, modulos:boolean[][]}}
   */
  function matrizQR(conteudo, mascaraForcada) {
    var dados = utf8Bytes(conteudo);
    var versao = qrEscolherVersao(dados.length);
    var codewords = qrIntercalar(qrCodewords(dados, versao), versao);
    var base = qrBase(versao);

    var mascaras = (typeof mascaraForcada === 'number') ? [mascaraForcada] : [0, 1, 2, 3, 4, 5, 6, 7];
    var melhor = null;

    for (var k = 0; k < mascaras.length; k++) {
      var mask = mascaras[k];
      var m = base.map(function (linha) { return linha.slice(); });
      qrPosicionarDados(m, codewords, mask);
      qrInfoFormato(m, mask);
      qrInfoVersao(m, versao);
      var p = qrPenalidade(m);
      if (!melhor || p < melhor.penalidade) {
        melhor = { penalidade: p, modulos: m, mascara: mask };
      }
    }

    return { tamanho: base.length, versao: versao, mascara: melhor.mascara, modulos: melhor.modulos };
  }

  /** Desenha a matriz num <canvas> (módulos alinhados em pixels inteiros). */
  function desenharQR(canvas, qr) {
    var ctx = canvas.getContext('2d');
    var n = qr.tamanho;
    var quiet = 4;
    var total = n + quiet * 2;
    var lado = canvas.width;
    var mod = Math.floor(lado / total);
    var sobra = lado - mod * total;
    var off = Math.floor(sobra / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = '#111111';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.modulos[r][c]) {
          ctx.fillRect(off + (c + quiet) * mod, off + (r + quiet) * mod, mod, mod);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Utilitários de UI                                                   *
   * ------------------------------------------------------------------ */
  function mascaraPosicao(input, valorNovo) {
    var pos = input.selectionStart;
    var antes = pos == null ? input.value.length : input.value.slice(0, pos).replace(/\D/g, '').length;
    input.value = valorNovo;
    var idx = 0, cont = 0;
    while (idx < valorNovo.length && cont < antes) {
      if (/\d/.test(valorNovo.charAt(idx))) { cont++; }
      idx++;
    }
    try { input.setSelectionRange(idx, idx); } catch (e) {}
  }

  function mostrarErro(campoEl, input, msg) {
    var box = campoEl ? $('.campo__erro', campoEl) : null;
    if (box) { box.textContent = msg || ''; }
    if (input) {
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) { input.setAttribute('aria-describedby', box ? box.id : input.id); }
    }
    if (campoEl) { campoEl.classList.toggle('campo--erro', !!msg); }
  }

  function valorDeUrl(nome) {
    var m = new RegExp('[?&]' + nome + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  function mascararEmail(email) {
    var e = texto(email);
    var at = e.indexOf('@');
    if (at < 1) { return e || 'e-mail não informado'; }
    var usuario = e.slice(0, at);
    var dominio = e.slice(at);
    var visivel = usuario.slice(0, Math.min(2, usuario.length));
    return visivel + '***' + dominio;
  }

  /* ------------------------------------------------------------------ *
   * PÁGINA: doar.html                                                   *
   * ------------------------------------------------------------------ */
  function initDoar() {
    var form = $('#form-doacao');
    if (!form) { return; }

    var entrada = {
      nome: $('#name'),
      cpf: $('#payerDocument'),
      telefone: $('#payerPhone'),
      email: $('#email'),
      valor: $('#amount')
    };
    var tipoDe = {
      name: 'nome',
      payerDocument: 'cpf',
      payerPhone: 'telefone',
      email: 'email',
      amount: 'valor'
    };
    var tocados = {};
    var btn = $('#btn-contribuir');
    var totalContribuicao = $('#total-contribuicao');
    var totalGeral = $('#total-geral');
    var chkSorte = $('#numeros-sorte');
    var chkCoracoes = $('#coracoes');
    var chkTurbine = $('#turbine');
    var badge = $('#turbine-badge');
    var envioEmAndamento = false;

    function campoDe(input) {
      return input ? input.closest('.campo') : null;
    }

    function valorNumerico() {
      var bruto = texto(entrada.valor.value);
      if (!bruto) { return 0; }
      var n = numeroDeTexto(bruto);
      return isFinite(n) ? n : 0;
    }

    function totalAtual() {
      return valorNumerico() + (chkCoracoes && chkCoracoes.checked ? PRECO_CORACOES : 0);
    }

    function validarCampoUI(input, mostrar) {
      var tipo = tipoDe[input.id];
      if (!tipo) { return { ok: true, msg: '' }; }
      var r = tipo === 'valor' ? validarCampo(tipo, valorNumerico()) : validarCampo(tipo, input.value);
      if (tipo === 'valor' && texto(input.value) === '') {
        r = { ok: false, msg: '' }; // vazio: não incomoda com mensagem
      }
      if (mostrar || tocados[input.id]) {
        mostrarErro(campoDe(input), input, r.msg);
      }
      return r;
    }

    function validarTudo(mostrar) {
      var ok = true, primeiro = null, msgs = [];
      Object.keys(entrada).forEach(function (chave) {
        var input = entrada[chave];
        if (!input) { return; }
        var r = validarCampoUI(input, mostrar);
        if (!r.ok) {
          ok = false;
          if (!primeiro) { primeiro = input; }
          if (r.msg) { msgs.push({ input: input, msg: r.msg }); }
        }
      });
      return { ok: ok, primeiro: primeiro, msgs: msgs };
    }

    /**
     * Marca o CTA como "pronto"/"incompleto". Usa data-estado + classe em vez de
     * `disabled`: o botão continua focável/acionável para que o clique explique o
     * erro inline (leitor de tela e teclado não ficam presos num controle morto),
     * mas o formulário NUNCA é enviado enquanto houver campo inválido.
     */
    function atualizarBotao() {
      var r = validarTudo(false);
      if (!btn) { return; }
      btn.dataset.estado = r.ok ? 'pronto' : 'incompleto';
      btn.classList.toggle('btn--inativo', !r.ok);
    }

    function atualizarTotais() {
      var contribuicao = valorNumerico();
      var total = totalAtual();
      if (totalContribuicao) { totalContribuicao.textContent = brl(contribuicao); }
      if (totalGeral) { totalGeral.textContent = brl(total); }
      if (badge) { badge.textContent = '+' + brl(PRECO_CORACOES); }
      atualizarBotao();
    }

    /** Preenche o campo com um valor em reais já formatado. */
    function definirValor(reais) {
      if (!entrada.valor) { return; }
      entrada.valor.value = mascaraValor(String(Math.round(reais * 100) / 100).replace('.', ','));
      if (entrada.valor.value.indexOf(',') === -1) { entrada.valor.value += ',00'; }
      tocados.amount = true;
      atualizarTotais();
    }

    // ----- máscaras + validação ao vivo -----
    if (entrada.cpf) {
      entrada.cpf.addEventListener('input', function () {
        mascaraPosicao(entrada.cpf, mascaraCPF(entrada.cpf.value));
        tocados[entrada.cpf.id] = true;
        validarCampoUI(entrada.cpf, false);
        atualizarBotao();
      });
      entrada.cpf.addEventListener('blur', function () {
        tocados[entrada.cpf.id] = true;
        validarCampoUI(entrada.cpf, true);
        atualizarBotao();
      });
    }

    if (entrada.telefone) {
      entrada.telefone.addEventListener('input', function () {
        mascaraPosicao(entrada.telefone, mascaraTelefone(entrada.telefone.value));
        tocados[entrada.telefone.id] = true;
        validarCampoUI(entrada.telefone, false);
        atualizarBotao();
      });
      entrada.telefone.addEventListener('blur', function () {
        tocados[entrada.telefone.id] = true;
        validarCampoUI(entrada.telefone, true);
        atualizarBotao();
      });
    }

    ['nome', 'email'].forEach(function (chave) {
      var input = entrada[chave];
      if (!input) { return; }
      input.addEventListener('input', function () {
        tocados[input.id] = true;
        validarCampoUI(input, false);
        atualizarBotao();
      });
      input.addEventListener('blur', function () {
        tocados[input.id] = true;
        validarCampoUI(input, true);
        atualizarBotao();
      });
    });

    if (entrada.valor) {
      entrada.valor.addEventListener('input', function () {
        mascaraPosicao(entrada.valor, mascaraValor(entrada.valor.value));
        tocados.amount = true;
        atualizarTotais();
        marcarChips();
      });
      entrada.valor.addEventListener('blur', function () {
        entrada.valor.value = completaValor(entrada.valor.value);
        validarCampoUI(entrada.valor, true);
        atualizarTotais();
        marcarChips();
      });
      entrada.valor.addEventListener('focus', function () {
        entrada.valor.setAttribute('aria-invalid', 'false');
      });
    }

    // ----- chips de valor -----
    var chips = $$('[data-valor]');
    function marcarChips() {
      var atual = valorNumerico();
      chips.forEach(function (chip) {
        var v = chip.getAttribute('data-valor');
        var ativo = v !== 'outro' && Number(v) === atual && atual > 0;
        chip.classList.toggle('chip--ativo', ativo);
        chip.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      });
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var v = chip.getAttribute('data-valor');
        if (v === 'outro') {
          if (entrada.valor) { entrada.valor.focus(); entrada.valor.select(); }
          return;
        }
        definirValor(Number(v));
        marcarChips();
      });
    });

    // ----- turbine: master + sub-cards -----
    function sincronizarTurbine(origem) {
      if (!chkSorte || !chkCoracoes || !chkTurbine) { return; }
      if (origem === 'master') {
        chkSorte.checked = chkTurbine.checked;
        chkCoracoes.checked = chkTurbine.checked;
      } else {
        chkTurbine.checked = chkSorte.checked || chkCoracoes.checked;
      }
      chkTurbine.indeterminate = !chkTurbine.checked && (chkSorte.checked || chkCoracoes.checked);
      atualizarTotais();
    }
    if (chkTurbine) {
      chkTurbine.addEventListener('change', function () { sincronizarTurbine('master'); });
    }
    [chkSorte, chkCoracoes].forEach(function (chk) {
      if (chk) { chk.addEventListener('change', function () { sincronizarTurbine('sub'); }); }
    });

    // ----- forma de pagamento -----
    var pills = $$('.pill-pgto');
    function formaSelecionada() {
      var marcado = $('input[name="forma"]:checked', form);
      return marcado ? marcado.value : 'pix';
    }
    pills.forEach(function (pill) {
      var radio = $('input[type="radio"]', pill);
      if (!radio) { return; }
      radio.addEventListener('change', function () {
        pills.forEach(function (p) { p.classList.toggle('pill-pgto--ativo', $('input[type="radio"]', p).checked); });
        pills.forEach(function (p) {
          var r = $('input[type="radio"]', p);
          p.setAttribute('aria-checked', r.checked ? 'true' : 'false');
        });
      });
    });

    // ----- aviso "Leticia doou" -----
    var aviso = $('#destaque-doacao');
    var fechar = $('#fechar-destaque');
    if (fechar) {
      fechar.addEventListener('click', function () {
        if (aviso) { aviso.remove(); }
      });
    }

    // ----- envio -----
    if (btn) {
      btn.addEventListener('click', function (ev) {
        if (envioEmAndamento) { ev.preventDefault(); return; }
        var r = validarTudo(true);
        if (!r.ok) {
          ev.preventDefault();
          var alvo = r.primeiro;
          if (alvo) { alvo.focus(); alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          anunciar(r.msgs.length ? r.msgs[0].msg : 'Revise os dados para continuar.', true);
        }
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (envioEmAndamento) { return; }
      var r = validarTudo(true);
      if (!r.ok) {
        if (r.primeiro) { r.primeiro.focus(); }
        anunciar(r.msgs.length ? r.msgs[0].msg : 'Revise os dados para continuar.', true);
        return;
      }

      envioEmAndamento = true;
      if (btn) {
        btn.classList.add('is-carregando');
        btn.setAttribute('aria-busy', 'true');
        var rotulo = $('.btn-contribuir__txt', btn);
        if (rotulo) { rotulo.textContent = 'PROCESSANDO…'; }
      }
      anunciar('Criando a cobrança, aguarde.', false);

      var valor = valorNumerico();
      var total = totalAtual();
      var forma = formaSelecionada();
      var estado = salvarEstado({
        nome: texto(entrada.nome.value),
        documento: soDigitos(entrada.cpf.value),
        telefone: soDigitos(entrada.telefone.value),
        email: texto(entrada.email.value),
        valor: valor,
        total: total,
        coracoes: !!(chkCoracoes && chkCoracoes.checked),
        numerosSorte: !!(chkSorte && chkSorte.checked),
        atualizacoes: !!(($('#atualizacoes') || {}).checked),
        forma: forma,
        txid: gerarIdTransacao(),
        parcelas: 1,
        cartaoFinal: '',
        concluida: false
      });

      var query = '?valor=' + estado.valor.toFixed(2) + '&total=' + estado.total.toFixed(2);
      var destino = forma === 'pix' ? 'pix.html' + query : 'cartao.html' + query;

      setTimeout(function () { window.location.href = destino; }, 900);
    });

    // ----- primeira pintura -----
    atualizarTotais();
    marcarChips();
  }

  /** Região viva global (aria-live) para avisos do checkout. */
  function anunciar(mensagem, erro) {
    var regiao = $('#checkout-aviso');
    if (!regiao) { return; }
    regiao.textContent = '';
    regiao.classList.toggle('checkout-aviso--erro', !!erro);
    // pequeno atraso garante que leitores de tela reanunciem o texto
    setTimeout(function () { regiao.textContent = mensagem || ''; }, 30);
  }

  /* ------------------------------------------------------------------ *
   * PÁGINA: pix.html                                                    *
   * ------------------------------------------------------------------ */
  function initPix() {
    var painel = $('#pix-painel');
    if (!painel) { return; }

    var estado = estadoComFallback();
    var valorUrl = valorDeUrl('total') || valorDeUrl('valor');
    if (valorUrl) {
      var t = parseFloat(String(valorUrl).replace(',', '.'));
      if (isFinite(t) && t > 0) { estado.total = t; }
    }
    if (!estado.txid) { estado.txid = gerarIdTransacao(); }

    salvarEstado({ valor: estado.valor, total: estado.total, forma: 'pix', txid: estado.txid });

    var displayValor = $('#pix-valor');
    var displayTotal = $('#pix-total');
    var displayForma = $('#pix-forma');
    var canvas = $('#pix-qr-canvas');
    var img = $('#pix-qr-img');
    var codigo = $('#pix-codigo');
    var btnCopiar = $('#btn-copiar-pix');
    var feedback = $('#pix-copia-feedback');
    var timerEl = $('#pix-timer');
    var expiradoEl = $('#pix-expirado');
    var btnRenovar = $('#btn-renovar-pix');
    var btnPaguei = $('#btn-ja-paguei');

    if (displayValor) { displayValor.textContent = brl(estado.total); }
    if (displayTotal) { displayTotal.textContent = brl(estado.total); }
    if (displayForma) { displayForma.textContent = 'Pix'; }
    var displayContribuicao = $('#pix-contribuicao');
    if (displayContribuicao) { displayContribuicao.textContent = brl(estado.valor); }
    var linhaCoracoes = $('#pix-linha-coracoes');
    if (linhaCoracoes) {
      if (estado.coracoes) { linhaCoracoes.removeAttribute('hidden'); }
      else { linhaCoracoes.setAttribute('hidden', ''); }
    }
    var extraCoracoes = $('#pix-extra-coracoes');
    if (extraCoracoes) { extraCoracoes.textContent = '+ ' + brl(Math.max(0, estado.total - estado.valor)); }

    var payloadAtual = '';
    var txidAtual = estado.txid;
    var restante = EXPIRACAO_PIX;
    var intervalo = null;

    function pintarQR() {
      payloadAtual = montarPayloadPix(estado.total.toFixed(2), txidAtual);
      if (codigo) { codigo.value = payloadAtual; }

      var usarImagem = payloadAtual === PAYLOAD_EXEMPLO && img;
      if (usarImagem) {
        img.hidden = false;
        img.removeAttribute('hidden');
        if (canvas) { canvas.hidden = true; canvas.setAttribute('hidden', ''); }
        img.alt = 'QR Code do PIX para pagar ' + brl(estado.total) + ' — aponte a câmera do app do banco';
      } else {
        if (img) { img.hidden = true; img.setAttribute('hidden', ''); }
        if (canvas) {
          canvas.hidden = false;
          canvas.removeAttribute('hidden');
          desenharQR(canvas, matrizQR(payloadAtual));
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', 'QR Code do PIX para pagar ' + brl(estado.total));
        }
      }
      var crcEl = $('#pix-crc');
      if (crcEl) { crcEl.textContent = payloadAtual.slice(-4); }
    }

    function pintarTimer() {
      var min = Math.floor(restante / 60);
      var seg = restante % 60;
      var txt = (min < 10 ? '0' : '') + min + ':' + (seg < 10 ? '0' : '') + seg;
      if (timerEl) { timerEl.textContent = txt; }
      if (restante <= 0) {
        if (timerEl) { timerEl.classList.add('pix-timer--expirado'); }
        if (expiradoEl) { expiradoEl.hidden = false; expiradoEl.removeAttribute('hidden'); }
        if (btnCopiar) { btnCopiar.setAttribute('aria-disabled', 'true'); }
        if (btnPaguei) { btnPaguei.setAttribute('aria-disabled', 'true'); }
        anunciar('O código PIX expirou. Gere um novo código para continuar.', true);
      }
    }

    function reiniciarTimer() {
      restante = EXPIRACAO_PIX;
      if (expiradoEl) { expiradoEl.hidden = true; expiradoEl.setAttribute('hidden', ''); }
      if (timerEl) { timerEl.classList.remove('pix-timer--expirado'); }
      if (btnCopiar) { btnCopiar.setAttribute('aria-disabled', 'false'); }
      if (btnPaguei) { btnPaguei.setAttribute('aria-disabled', 'false'); }
      pintarTimer();
    }

    function iniciarContagem() {
      if (intervalo) { clearInterval(intervalo); }
      intervalo = setInterval(function () {
        restante -= 1;
        if (restante <= 0) {
          restante = 0;
          pintarTimer();
          clearInterval(intervalo);
          intervalo = null;
          return;
        }
        pintarTimer();
      }, 1000);
    }

    pintarQR();
    pintarTimer();
    iniciarContagem();

    // gancho de teste (sem rede, sem backend): força a expiração do código
    if (typeof window !== 'undefined' && window.VakinhaCheckout) {
      window.VakinhaCheckout.expirarPix = function () { restante = 1; };
    }

    if (btnCopiar) {
      btnCopiar.addEventListener('click', function () {
        if (restante <= 0) {
          anunciar('O código expirou. Gere um novo código PIX.', true);
          return;
        }
        var concluido = function () {
          if (feedback) {
            feedback.textContent = 'Código copiado!';
            feedback.classList.add('pix-feedback--visivel');
            setTimeout(function () { feedback.classList.remove('pix-feedback--visivel'); }, 2500);
          }
          anunciar('Código PIX copiado para a área de transferência.', false);
          if (btnCopiar) {
            btnCopiar.classList.add('is-copiado');
            var txt = $('.btn-copiar__txt', btnCopiar);
            if (txt) {
              txt.textContent = 'Código copiado!';
              setTimeout(function () { txt.textContent = 'Copiar código PIX'; btnCopiar.classList.remove('is-copiado'); }, 2500);
            }
          }
        };

        var copiarFallback = function () {
          if (codigo) {
            codigo.focus();
            codigo.select();
            try { document.execCommand('copy'); } catch (e) {}
            try { codigo.setSelectionRange(0, 0); } catch (e) {}
          }
          concluido();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payloadAtual).then(concluido, copiarFallback);
        } else {
          copiarFallback();
        }
      });
    }

    if (btnRenovar) {
      btnRenovar.addEventListener('click', function () {
        txidAtual = gerarIdTransacao();
        salvarEstado({ txid: txidAtual });
        pintarQR();
        reiniciarTimer();
        iniciarContagem();
        anunciar('Novo código PIX gerado. Você tem 15 minutos.', false);
      });
    }

    if (btnPaguei) {
      btnPaguei.addEventListener('click', function (ev) {
        if (restante <= 0) { ev.preventDefault(); return; }
        salvarEstado({
          forma: 'pix',
          total: estado.total,
          valor: estado.valor,
          txid: txidAtual,
          concluida: true,
          pagoEm: Date.now()
        });
        // navegação real para obrigado.html
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * PÁGINA: cartao.html                                                 *
   * ------------------------------------------------------------------ */
  function initCartao() {
    var form = $('#form-cartao');
    if (!form) { return; }

    var estado = estadoComFallback();
    var valorUrl = valorDeUrl('total') || valorDeUrl('valor');
    if (valorUrl) {
      var t = parseFloat(String(valorUrl).replace(',', '.'));
      if (isFinite(t) && t > 0) { estado.total = t; }
    }
    if (!estado.txid) { estado.txid = gerarIdTransacao(); }

    var numero = $('#numeroCartao');
    var nome = $('#nomeCartao');
    var validade = $('#validadeCartao');
    var cvv = $('#cvvCartao');
    var parcelas = $('#parcelas');
    var btn = $('#btn-pagar');
    var totalEls = $$('[data-total-cartao]');
    var valorEls = $$('[data-valor-cartao]');
    var previewNumero = $('#preview-numero');
    var previewNome = $('#preview-nome');
    var previewValidade = $('#preview-validade');
    var previewBandeira = $('#preview-bandeira');
    var tocados = {};
    var envioEmAndamento = false;

    totalEls.forEach(function (el) { el.textContent = brl(estado.total); });
    valorEls.forEach(function (el) { el.textContent = brl(estado.valor); });

    // ----- parcelamento 1x..12x, recalculado do total -----
    function montarParcelas() {
      if (!parcelas) { return; }
      var maximo = Math.min(12, Math.max(1, Math.floor(estado.total / 5)));
      parcelas.innerHTML = '';
      for (var i = 1; i <= maximo; i++) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = i + 'x de ' + brl(estado.total / i) + ' sem juros';
        parcelas.appendChild(opt);
      }
      parcelas.value = String(estado.parcelas && estado.parcelas <= maximo ? estado.parcelas : 1);
    }
    montarParcelas();

    if (parcelas) {
      parcelas.addEventListener('change', function () {
        var n = Number(parcelas.value) || 1;
        $$('[data-parcelas]').forEach(function (el) {
          el.textContent = n + 'x de ' + brl(estado.total / n) + ' sem juros';
        });
      });
    }

    function campoDe(input) { return input ? input.closest('.campo') : null; }

    function validarCampoUI(input, mostrar, tipo) {
      var r = validarCampo(tipo, input.value);
      if (mostrar || tocados[input.id]) { mostrarErro(campoDe(input), input, r.msg); }
      return r;
    }

    function validarTudo(mostrar) {
      var mapa = [
        { el: numero, tipo: 'numeroCartao' },
        { el: nome, tipo: 'nomeCartao' },
        { el: validade, tipo: 'validade' },
        { el: cvv, tipo: 'cvv' }
      ];
      var ok = true, primeiro = null, primeiraMsg = '';
      mapa.forEach(function (item) {
        if (!item.el) { return; }
        var r = validarCampoUI(item.el, mostrar, item.tipo);
        if (!r.ok) {
          ok = false;
          if (!primeiro) { primeiro = item.el; primeiraMsg = r.msg; }
        }
      });
      return { ok: ok, primeiro: primeiro, msg: primeiraMsg };
    }

    // mesma lógica do doar.html: CTA acionável, envio só quando válido
    function atualizarBotao() {
      var r = validarTudo(false);
      if (!btn) { return; }
      btn.dataset.estado = r.ok ? 'pronto' : 'incompleto';
      btn.classList.toggle('btn--inativo', !r.ok);
    }

    function atualizarPreview() {
      var d = soDigitos(numero ? numero.value : '');
      if (previewNumero) {
        // mascara ANTES de agrupar: só os 4 últimos dígitos ficam visíveis
        var mostrado = d
          ? d.replace(/\d(?=\d{4})/g, '•').replace(/(.{4})(?=.)/g, '$1 ')
          : '•••• •••• •••• ••••';
        previewNumero.textContent = mostrado;
      }
      if (previewNome) { previewNome.textContent = texto(nome ? nome.value : '').toUpperCase() || 'NOME NO CARTÃO'; }
      if (previewValidade) { previewValidade.textContent = (validade && validade.value) || 'MM/AA'; }
      var bandeira = bandeiraCartao(d);
      if (previewBandeira) { previewBandeira.textContent = bandeira || 'cartão'; }
    }

    function ligar(input, tipo, mascara) {
      if (!input) { return; }
      input.addEventListener('input', function () {
        if (mascara) { mascaraPosicao(input, mascara(input.value)); }
        tocados[input.id] = true;
        validarCampoUI(input, false, tipo);
        atualizarPreview();
        atualizarBotao();
      });
      input.addEventListener('blur', function () {
        tocados[input.id] = true;
        validarCampoUI(input, true, tipo);
        atualizarBotao();
      });
    }

    ligar(numero, 'numeroCartao', mascaraCartao);
    ligar(nome, 'nomeCartao', null);
    ligar(validade, 'validade', mascaraValidade);
    ligar(cvv, 'cvv', function (v) { return soDigitos(v).slice(0, 4); });

    if (btn) {
      btn.addEventListener('click', function (ev) {
        if (envioEmAndamento) { ev.preventDefault(); return; }
        var r = validarTudo(true);
        if (!r.ok) {
          ev.preventDefault();
          if (r.primeiro) { r.primeiro.focus(); }
          anunciar(r.msg || 'Revise os dados do cartão.', true);
        }
      });
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (envioEmAndamento) { return; }
      var r = validarTudo(true);
      if (!r.ok) {
        if (r.primeiro) { r.primeiro.focus(); }
        anunciar(r.msg || 'Revise os dados do cartão.', true);
        return;
      }

      envioEmAndamento = true;
      if (btn) {
        btn.classList.add('is-carregando');
        btn.setAttribute('aria-busy', 'true');
        var rotulo = $('.btn-pagar__txt', btn);
        if (rotulo) { rotulo.textContent = 'AUTORIZANDO…'; }
      }
      anunciar('Autorizando o pagamento, aguarde.', false);

      var digitos = soDigitos(numero.value);
      salvarEstado({
        forma: 'cartao',
        cartaoFinal: digitos.slice(-4),
        bandeira: bandeiraCartao(digitos) || 'Cartão',
        parcelas: Number(parcelas ? parcelas.value : 1) || 1,
        total: estado.total,
        valor: estado.valor,
        txid: estado.txid,
        concluida: true,
        pagoEm: Date.now()
      });

      setTimeout(function () { window.location.href = 'obrigado.html'; }, 900);
    });

    atualizarPreview();
    atualizarBotao();
  }

  /* ------------------------------------------------------------------ *
   * PÁGINA: obrigado.html                                               *
   * ------------------------------------------------------------------ */
  function initObrigado() {
    var painel = $('#obrigado-painel');
    if (!painel) { return; }

    var estado = estadoComFallback();
    var formaTxt = estado.forma === 'cartao'
      ? ('Cartão de crédito'
          + (estado.cartaoFinal ? ' •••• ' + estado.cartaoFinal : '')
          + (estado.bandeira ? ' · ' + estado.bandeira : ''))
      : 'Pix';

    var mapa = {
      '#obrigado-valor': brl(estado.total),
      '#obrigado-forma': formaTxt,
      '#obrigado-email': mascararEmail(estado.email),
      '#obrigado-txid': estado.txid,
      '#obrigado-nome': estado.nome ? estado.nome.split(/\s+/)[0] : 'doador',
      '#obrigado-data': new Date().toLocaleString('pt-BR')
    };
    Object.keys(mapa).forEach(function (sel) {
      var el = $(sel);
      if (el) { el.textContent = mapa[sel]; }
    });

    if (estado.forma === 'cartao') {
      $$('[data-parcelas]').forEach(function (el) {
        var n = estado.parcelas || 1;
        el.textContent = n + 'x de ' + brl(estado.total / n) + ' sem juros';
      });
    } else {
      $$('[data-parcelas]').forEach(function (el) {
        var linha = el.closest('tr, .resumo__linha');
        if (linha) { linha.hidden = true; }
      });
    }

    // dispara a animação do check depois do primeiro frame
    requestAnimationFrame(function () {
      painel.classList.add('obrigado--animado');
    });

    var btn = $('#btn-voltar-vaquinha');
    if (btn) {
      btn.addEventListener('click', function () {
        // navegação normal para index.html
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Bootstrap: cada página chama o seu controlador.                     *
   * ------------------------------------------------------------------ */
  var controladores = {
    doar: initDoar,
    pix: initPix,
    cartao: initCartao,
    obrigado: initObrigado
  };

  function iniciar() {
    var pagina = document.body ? document.body.getAttribute('data-pagina') : '';
    var fn = controladores[pagina];
    if (typeof fn === 'function') { fn(); }
  }

  // API exposta só para depuração/teste automatizado (não faz requisição).
  var alvo = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
  alvo.VakinhaCheckout = {
    versao: '1.0.0',
    brl: brl,
    crc16: crc16,
    montarPayloadPix: montarPayloadPix,
    payloadExemplo: PAYLOAD_EXEMPLO,
    cpfValido: cpfValido,
    luhnValido: luhnValido,
    matrizQR: function (textoQR, mascara) { return matrizQR(textoQR, mascara); },
    lerEstado: lerEstado
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', iniciar);
    } else {
      iniciar();
    }
  }
})();
