# doe — campanha de vaquinha (front-end estático)

Clone estático de uma página de vaquinha no estilo **Vakinha** e do fluxo de doação que ela
abre (PIX, cartão e confirmação). HTML, CSS e JS puros: **sem framework, sem build, sem CDN**.
Todo o pacote é offline — nenhuma requisição sai do host que serve a página.

Serve como base de front-end para uma campanha real: troca-se o conteúdo do cliente, aponta-se
o botão de doar para um gateway de verdade e o layout já está pronto.

> **Isto não processa pagamento.** O fluxo é **simulação de front-end**: QR PIX de demonstração,
> cartão validado (Luhn) e descartado — só os 4 últimos dígitos chegam ao recibo. Nenhum dado
> sai da máquina. O ponto exato onde um gateway real entra é `assets/js/checkout.js`
> (lá estão a montagem do pedido, o `sessionStorage["doacao"]` e os redirects para
> `pix.html`/`cartao.html`; a confirmação é `obrigado.html`).

---

## Rodar local

Precisa ser servido por **HTTP** — por `file://` o `sessionStorage` do fluxo e as fontes locais
não se comportam igual.

```bash
python3 -m http.server
```

O servidor imprime a porta que escolheu (a raiz do site fica em `http://<host>:<porta>/`) —
abra a raiz `/` no navegador: é a campanha (`index.html`).

## Deploy (Vercel)

O repositório está montado para deploy **zero-config**: a raiz do repo **é** o site, então o
`index.html` já está em `/`.

1. **Add New… → Project** e importe este repositório.
2. **Framework Preset:** `Other`.
3. **Root Directory:** `./` (padrão).
4. **Build Command / Output Directory:** vazio — não há build.
5. Deploy.

Sem domínio apontado, as metatags sociais (`og:url`, `og:image` e `twitter:image`) estão
**relativas** ao pacote — o site funciona, mas o cartão de preview de WhatsApp/Facebook/Telegram
só é montado quando essas três viram URL **absoluta** (`https://<domínio>/…`). Ajuste em
`index.html` no mesmo commit em que o domínio entrar.

O que já está resolvido no repositório:

| Arquivo | Para que serve |
|---|---|
| `vercel.json` | `cleanUrls` (`/doar` em vez de `/doar.html`), sem barra final, `Cache-Control` de 1 ano `immutable` para `/assets/*` e `no-cache` para HTML, além dos headers de segurança básicos |
| `.gitignore` | mantém fora do Git o material de trabalho, os screenshots do QA e os segredos |
| `.vercelignore` | mantém fora do deploy o relatório de QA e os metadados (`qa/`, `tools/`, `inventory.json`) |

## Fluxo de páginas

```
index.html  →  doar.html  →  pix.html     →  obrigado.html
                        ↘  cartao.html   ↗
```

| Arquivo | Conteúdo |
|---|---|
| `index.html` | página da campanha — hero, barra de progresso, sidebar (arrecadado/meta/corações/apoiadores), abas (Sobre, Atualizações, Quem ajudou, Vakinha Premiada, Selos), comentários, FAQ, rodapé |
| `doar.html` | formulário de doação — dados do doador, valor, forma de pagamento (PIX/cartão), bloco "Turbine sua doação", total ao vivo, CTA |
| `pix.html` | QR Code PIX (BR Code EMV) + copia-e-cola com CRC16, contador de expiração, passo a passo |
| `cartao.html` | cartão de crédito — Luhn, validade, CVV, parcelamento 1x–12x com recálculo |
| `obrigado.html` | confirmação com resumo (valor, forma, e-mail mascarado, id da transação) |

Estado atravessa as páginas por `sessionStorage["doacao"]`, com `?valor=&total=` como fallback;
sem estado, cai no valor padrão. Toda a lógica está em `assets/js/app.js` (página da campanha)
e `assets/js/checkout.js` (fluxo de pagamento).

## Estrutura

```
.
├── index.html  doar.html  pix.html  cartao.html  obrigado.html
├── assets/
│   ├── css/   style.css (campanha)  checkout.css (pagamento)  fonts.css
│   ├── js/    app.js  checkout.js
│   ├── img/   hero, logo, selo e badges
│   ├── fonts/ Lato 400/700/900 e Montserrat 400/700 (woff2, latin + latin-ext)
│   └── qr/    pix-qr.png
├── inventory.json        sha256, origem e bytes de cada arquivo do pacote publicado
├── tools/gen_pix_qr.py   gerador do QR a partir de um payload EMV
├── qa/QA_REPORT.md       relatório da auditoria adversarial que liberou o pacote
├── vercel.json
└── README.md
```

Pacote publicado: **30 arquivos, ~694 KB** (5 páginas + `assets/`), todos referenciados por
alguma página — nenhum asset morto (o item 8 do QA falha se aparecer um).

## QA

A auditoria roda em Chromium real (Playwright), sobe um `http.server` isolado e mede as 5
páginas em 1440×900 e 390×844 contra as imagens do alvo: offline puro, 404/recursos, console,
layout (medidas em pixel), fluxo PIX/cartão ponta a ponta, validação negativa, texto e peso.
Placar final: **115/115** checagens e **51/51** passos do fluxo E2E.

Os **scripts** do harness não fazem parte deste repositório — eles vivem no projeto que gerou o
pacote (junto do material de captura do alvo). Aqui fica só o resultado auditado, em
`qa/QA_REPORT.md`, com as rodadas e as evidências de cada checagem.

## O que é real do alvo e o que é de exemplo

- **Real (capturado do original):** título da campanha, id, valores (R$ 188.005,52 de
  R$ 250.000,00), apoiadores e corações, categoria, criadora, texto integral do "Sobre",
  paleta (`#24ca68`, `#009d4e`, `#282828`, `#EEFFE6`), logo, selo, badges e foto.
- **De exemplo (preenchido para o layout fechar):** nomes/valores de "Quem ajudou",
  comentários, FAQ, atualizações.

Diferenças propositais em relação ao original: hero com outro recorte, chips de valor,
seções de comentários/FAQ e coleção de selos do rodapé são adições; badges de loja foram
recriados em CSS e o ícone do selo de segurança é SVG próprio.

## Origem e uso

O layout e o conteúdo desta campanha pertencem aos seus autores originais
(família/campanha publicada na plataforma citada). Este repositório é uma **reconstrução de
front-end para fins de estudo e de reuso como modelo de página de captação** — sem qualquer
vínculo com a plataforma, sem coleta de dados e sem movimentação de dinheiro. Antes de usar em
produção para um cliente, substitua textos e imagens pela campanha real, revise a marca e
conecte um PSP/gateway licenciado.
