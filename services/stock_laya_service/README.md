# Stock-Laya inference service

This folder is the deployable inference service for a **trained and promoted** Stock-Laya checkpoint.

Expected runtime contract:

- `GET /health`
- `POST /predict` with `{"state": {...}, "questions": {...}}`
- returns the native Laya prediction object, including `answers.trade_action` and `answers.tradeable`

Environment variables:

- `STOCK_LAYA_MODEL_ID` — defaults to `Smit1105/stock-laya-qstate`
- `HF_TOKEN` — needed when the model repo is private
- `STOCK_LAYA_DEVICE` — optional; leave unset for Laya auto-selection

The public Stock Truth browser should never call this service with a secret. Deno Deploy is the gateway: configure its `LAYA_SERVICE_URL` to the full `/predict` URL and optionally `LAYA_SERVICE_TOKEN` if the service itself is protected.

Do not deploy the generic base checkpoint as if it were a stock model. Production remains disabled until `config/laya.json` promotion gates pass.
