#!/usr/bin/env python3
"""
gen_pix_qr.py — gera a imagem QR Code do PIX (BR Code / EMV MPM) usada em pix.html.

Monta o payload EMV de ponta a ponta (mesmo algoritmo do assets/js/checkout.js),
calcula o CRC16-CCITT-FALSE do campo 63 e desenha o QR com a lib `qrcode` (offline).

Uso:
    python3 tools/gen_pix_qr.py                         # payload de exemplo R$ 104,99
    python3 tools/gen_pix_qr.py --valor 100 --out ../assets/qr/pix-qr.png
    python3 tools/gen_pix_qr.py --print-only            # só imprime payload + CRC

Nenhuma requisição de rede: o QR é gerado localmente, o site é 100% estático.
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
except ImportError:  # pragma: no cover
    sys.exit("erro: instale 'qrcode[pil]' (pip install qrcode pillow)")

# ---------------------------------------------------------------------------
# Constantes da campanha / recebedor PIX (dados de demonstração do clone)
# ---------------------------------------------------------------------------
PIX_KEY = "8e9b1f2a-4c3d-4a5b-9e8f-0a1b2c3d4e5f"  # chave EVP (UUID) de exemplo
MERCHANT_NAME = "JUNTOS PELA FAMILIA"              # ID 59, máx. 25
MERCHANT_CITY = "SAO PAULO"                        # ID 60, máx. 15
TXID = "VK20260001"                                # ID 62-05, máx. 25 alfanumérico
MERCHANT_CATEGORY = "0000"                         # ID 52 (MCC não informado)


def tlv(tag: str, value: str) -> str:
    """Campo EMV: <ID><tamanho em 2 dígitos><valor>."""
    return f"{tag}{len(value):02d}{value}"


def crc16_ccitt_false(payload: str) -> str:
    """CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, sem reflexão, xorout 0."""
    crc = 0xFFFF
    for ch in payload.encode("utf-8"):
        crc ^= ch << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def build_pix_payload(
    valor: str = "104.99",
    nome: str = MERCHANT_NAME,
    cidade: str = MERCHANT_CITY,
    chave: str = PIX_KEY,
    txid: str = TXID,
) -> str:
    """Monta o BR Code completo, com o CRC do campo 63 já calculado."""
    conta = (
        tlv("00", "br.gov.bcb.pix")  # GUI obrigatório
        + tlv("01", chave)           # chave PIX
    )
    adicional = tlv("05", txid.upper()[:25])

    payload = "".join(
        [
            tlv("00", "01"),                       # versão do payload
            tlv("26", conta),                      # conta do recebedor
            tlv("52", MERCHANT_CATEGORY),          # MCC
            tlv("53", "986"),                      # moeda BRL
            tlv("54", valor),                      # valor da transação
            tlv("58", "BR"),                       # país
            tlv("59", nome.upper()[:25]),          # nome do recebedor
            tlv("60", cidade.upper()[:15]),        # cidade do recebedor
            tlv("62", adicional),                  # dados adicionais (txid)
        ]
    )
    payload += "6304"                              # header do CRC
    return payload + crc16_ccitt_false(payload)


def render_qr(payload: str, out_path: str, box_size: int = 12) -> str:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=4,
    )
    # optimize=0 força modo byte puro, igual ao encoder do assets/js/checkout.js
    # (mesma versão de QR, mesmo desenho na tela).
    qr.add_data(payload, optimize=0)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#111111", back_color="#ffffff")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    img.save(out_path)
    return f"versao={qr.version} modulos={qr.modules_count}"


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(os.path.dirname(here), "assets", "qr", "pix-qr.png")

    ap = argparse.ArgumentParser(description="Gera o QR Code do PIX (BR Code EMV) do clone.")
    ap.add_argument("--valor", default="104.99", help="valor como string, ex.: 104.99")
    ap.add_argument("--txid", default=TXID)
    ap.add_argument("--out", default=default_out)
    ap.add_argument("--box-size", type=int, default=12)
    ap.add_argument("--print-only", action="store_true")
    args = ap.parse_args()

    valor = args.valor.strip().replace(",", ".")
    if "." not in valor:
        valor = f"{valor}.00"

    payload = build_pix_payload(valor=valor, txid=args.txid)
    crc = payload[-4:]

    print(f"valor      : R$ {valor}")
    print(f"tamanho    : {len(payload)} caracteres")
    print(f"CRC16      : {crc}")
    print(f"payload    : {payload}")

    if args.print_only:
        return 0

    info = render_qr(payload, args.out, args.box_size)
    print(f"imagem     : {args.out} ({info})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
