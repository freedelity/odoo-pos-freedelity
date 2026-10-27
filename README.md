# Freedelity Loyalty for Point of Sale (Odoo 19.0)

Odoo addon `pos_freedelity`: the Odoo point of sale drives a Freedelity **CustomerScreen** terminal over the
ECR protocol (v3, HTTP framing) to identify loyalty customers, redeem their vouchers and register their sales.

One branch per Odoo version: `18.0`, `19.0`. This branch: **19.0**.

## How it works

- The POS **browser** talks to the terminal directly: `POST http://<terminal-ip>:9005/ecr_command` (the Odoo
  server is not involved, so Odoo.sh works). Requests are sent with `targetAddressSpace: "local"` for Chrome's
  Local Network Access: the browser asks once to allow local network access.
- One terminal session per order, keyed by the order `uuid`: `start_session` → `select_session` →
  `get_customer_details` (polled) → `get_vouchers` (polled). Customer search uses `search_customer` /
  `select_customer`.
- Vouchers become discount lines on the voucher product, one per tax group, proportional to the goods of that group
  (amount vouchers and percentage vouchers alike), so the VAT base is reduced correctly.
- When the order is paid, an `end_session` with `sale_id` (order reference), `total` (goods, before
  vouchers), `total_paid`, `vouchers_usage` and `products_data` is written to a persistent outbox
  (`localStorage`) and delivered in the background: retried on `busy` (forced after 10 s), on network errors
  (every 30 s and when the connection comes back). The result is stored on the order
  (`freedelity_sync_state`). Refunds and anonymous orders only close the terminal session.
- Everything that differs between Odoo versions lives in `static/src/app/compat.js` and the validation hook
  (`payment_screen.js` on 18, `order_payment_validation.js` on 19).

## Configuration

Point of Sale ▸ Configuration ▸ Settings ▸ **Freedelity Loyalty**: enable, terminal IP address, port (9005),
voucher product (created by the module), optional automatic identification start.
The terminal must allow the IP address of the cash register.

## Development

```bash
dev/run-tests.sh 19.0                   # install + all tests (backend + POS tours) in podman
dev/run-demo.sh 19.0                    # demo data + fake terminal: http://localhost:28069 (admin/admin)
python3 pos_freedelity/tests/ecr_mock.py --port 9005   # fake CustomerScreen terminal on its own
```

`dev/Dockerfile` builds `pos-freedelity-dev:19.0` (official `odoo:19.0` + Chrome + websocket-client, needed by the tours).

## Support

Freedelity SA — Rue Altiero Spinelli 7, 1401 Nivelles, Belgium — support@freedelity.be

License: LGPL-3 (see `pos_freedelity/LICENSE` and `pos_freedelity/COPYING`).
