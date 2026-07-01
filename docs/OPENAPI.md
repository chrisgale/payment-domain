# Payment Domain API — Endpoint Reference

Quick reference. See [`openapi.yaml`](../openapi.yaml) for full schemas.

All mutating endpoints require `Idempotency-Key: <uuid>` header.

---

## Payment Methods

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/payment-methods/sessions` | Create PCI card capture session |
| `GET` | `/v1/payment-methods/{customerId}` | List stored payment methods |
| `DELETE` | `/v1/payment-methods/{customerId}/{token}` | Remove a payment method |

---

## Authorisations

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/authorisations` | Authorise a payment on token |
| `POST` | `/v1/authorisations/{id}/capture` | Capture an authorisation |
| `POST` | `/v1/authorisations/{id}/cancel` | Cancel / void an authorisation |

---

## SCA Sessions

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/sca/sessions` | Initiate SCA challenge |
| `GET` | `/v1/sca/sessions/{id}` | Get session status |
| `PUT` | `/v1/sca/sessions/{id}` | Complete session (PSP callback) |

---

## Payment Agreements (MIT)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/payment-agreements` | Register a mandate |
| `GET` | `/v1/payment-agreements/{id}` | Get agreement |
| `DELETE` | `/v1/payment-agreements/{id}` | Revoke agreement |

---

## Settlement Rules

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/settlement-rules/{productType}` | Get settlement rule for product type |

Product types: `hotel` `parking` `lounge` `insurance` `transfer`

---

## Transactions

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/transactions/{bookingReference}` | Payment history for a booking |

---

## Sandbox test data

| Data | Value |
|---|---|
| Customer ID | `cust_HX_7823641` |
| Booking reference | `HX-2026-005678` |
| Payment method (Visa) | `pm_4X7K2M9N` |
| Payment method (MC) | `pm_8B3J5L1P` |
| Sandbox port | `3011` |

```bash
node sandbox/server.js

# Try it:
curl http://localhost:3011/v1/payment-methods/cust_HX_7823641
curl http://localhost:3011/v1/transactions/HX-2026-005678
curl http://localhost:3011/v1/settlement-rules/hotel
```
