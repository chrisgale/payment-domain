# How the Experience API calls the Domain API

This document maps every Experience API endpoint to its Domain API calls.

The Experience API lives at [`payment-experience`](https://github.com/chrisgale/payment-experience).  
The Domain API lives here (`payment-domain`).

---

## The value the Experience API adds

The Experience API is **not** just a proxy. For each endpoint it:

1. **Composes** — calls multiple domain endpoints and merges results
2. **Enriches** — adds basket/booking context the domain doesn't hold
3. **Shapes** — returns only the fields the wizard or mini-app needs
4. **Hides** — the caller never knows which PSP is active

---

## Endpoint mapping

### `GET /customer/payment-methods`
> *Show what cards and vouchers are on account for a customer*

```
Experience API caller
  └─► GET /v1/payment-methods/{customerId}    [Domain API]
        Returns tokenised card list

  + enriches with voucher balances from Voucher Domain (separate call)
  + filters to methods eligible for current basket product type
  + shapes to experience response (hides PSP-specific fields)
```

**Experience response adds:** `displayLabel`, `isEligible` (per product type), voucher balance  
**Domain response has:** raw token data, PSP-level fields, agreement flags

---

### `GET /baskets/{basketId}/payment-options`
> *What payment options are available for this basket?*

```
Experience API caller
  └─► GET /v1/settlement-rules/{productType}  [Domain API]  (one call per product in basket)
  └─► GET /v1/payment-methods/{customerId}    [Domain API]
  └─► GET /basket/{basketId}                  [Basket Domain]

  Composes: eligible payment methods + settlement deadline + deposit/balance split
  Shapes to: what the checkout screen needs to render
```

**Experience response adds:** deposit amount, balance due, settlement deadline in human-readable form  
**Domain provides:** the business rule (offset hours), the payment methods

---

### `GET /orders/{reference}/payment-status`
> *How much is left to pay and when does it need to be settled?*

```
Experience API caller
  └─► GET /v1/transactions/{bookingReference}          [Domain API]
  └─► GET /v1/settlement-rules/{productType}           [Domain API]
  └─► GET booking details from Booking Domain          [Booking Domain]

  Computes: settlementDeadline = booking date/time - offsetHours
  Shapes to: outstanding amount, deadline, whether payment is overdue
```

**Domain provides:** transaction history, raw settlement rule  
**Experience computes:** the actual deadline datetime (business rule + booking date)

---

### `POST /payments/card-sessions`
> *Create a PCI card capture session (new card)*

```
Experience API caller
  └─► POST /v1/payment-methods/sessions        [Domain API]
        Returns redirectUrl

  + wraps in experience context (basketId, journey label)
  + returns sessionId + redirectUrl to caller (caller redirects customer)
```

**This is mostly pass-through** — the experience adds basket context and journey labelling only.  
The Domain owns the PCI session creation.

---

### `POST /payments/token`
> *Process a payment on a stored card token*

```
Experience API caller
  └─► (optional) GET /v1/sca/sessions/{id}     [Domain API]  — check SCA status if needed
  └─► POST /v1/authorisations                  [Domain API]  — authorise
        If AUTHORISED:
  └─► POST /v1/authorisations/{id}/capture     [Domain API]  — capture immediately
        If SCA_REQUIRED:
  └─► (redirect customer to SCA) ──────────────────────────────────────────────┐
        Customer completes SCA                                                   │
  └─► POST /v1/authorisations  (retry with paymentConsentId) ◄───────────────┘
  └─► POST /v1/authorisations/{id}/capture

  + logs outcome against basket/booking
  + emits experience-level event (payment_completed) for journey tracking
```

**Two domain calls minimum** (authorise + capture). Up to four if SCA is required mid-flow.

---

### `POST /sca/initiate`
> *Start an SCA challenge*

```
Experience API caller
  └─► POST /v1/sca/sessions                    [Domain API]
        Returns challengeUrl

  + wraps in basket/journey context
  + stores scaSessionId against basket for later completion check
```

**Near pass-through.** Experience adds journey context and stores session reference.

---

### `POST /sca/complete`
> *SCA challenge returned — what happened?*

```
Experience API caller
  └─► GET /v1/sca/sessions/{scaSessionId}      [Domain API]  — poll status
        If COMPLETED: proceed with payment flow
        If FAILED: surface error to customer
```

**Note:** in production the PSP calls back directly to the Domain API (`PUT /v1/sca/sessions/{id}`).  
The Experience API polls for status rather than receiving a direct callback.

---

### `POST /mandates`
> *Register a payment agreement (MIT)*

```
Experience API caller
  └─► POST /v1/payment-agreements              [Domain API]
        Returns paymentAgreementId

  + stores agreement reference against customer profile
  + triggers CRM update (suppress future SCA challenge prompts)
```

**Near pass-through.** Experience adds profile update and CRM notification.

---

### `DELETE /mandates/{mandateId}`
> *Revoke a payment agreement*

```
Experience API caller
  └─► DELETE /v1/payment-agreements/{id}       [Domain API]

  + triggers CRM update (re-enable SCA challenge prompts)
```

---

## Summary table

| Experience endpoint | Domain calls | Adds |
|---|---|---|
| `GET /customer/payment-methods` | `GET /v1/payment-methods/{cid}` | Vouchers, eligibility filter |
| `GET /baskets/{id}/payment-options` | settlement-rules + payment-methods + basket | Deposit/balance split, deadline |
| `GET /orders/{ref}/payment-status` | transactions + settlement-rules + booking | Computed deadline datetime |
| `POST /payments/card-sessions` | `POST /v1/payment-methods/sessions` | Basket context, journey label |
| `POST /payments/token` | authorise + capture (+ SCA if needed) | Booking log, experience event |
| `POST /sca/initiate` | `POST /v1/sca/sessions` | Journey context, session store |
| `POST /sca/complete` | `GET /v1/sca/sessions/{id}` | Status normalisation |
| `POST /mandates` | `POST /v1/payment-agreements` | Profile update, CRM trigger |
| `DELETE /mandates/{id}` | `DELETE /v1/payment-agreements/{id}` | CRM trigger |

---

## What never reaches the Experience API

These are internal to the Domain layer — experience callers never call them directly:

- `PUT /v1/sca/sessions/{id}` — PSP callback, domain-internal
- `DELETE /v1/payment-methods/{cid}/{token}` — account management, not a checkout concern
- `GET /v1/settlement-rules/{productType}` — raw rule, experience computes the deadline
- `GET /v1/transactions/{ref}` — raw ledger, experience shapes the status view
