# Payment Domain API

Internal domain API for payment operations at Holiday Extras.

This is **not** a public-facing or experience-shaped API. It is the domain layer — owned by the Payment Domain team — that the [payment-experience](https://github.com/chrisgale/payment-experience) layer (and other experiences) call through to.

## What this owns

| Capability | Description |
|---|---|
| Payment method storage | Store and retrieve tokenised card details (PCI-compliant, PSP-held) |
| Authorisation & capture | Authorise a payment on token, capture or cancel |
| SCA sessions | Initiate and complete Strong Customer Authentication challenges |
| Payment agreements | Register and revoke MIT (Merchant Initiated Transaction) mandates |
| Settlement rules | Business rules for when a payment must be settled per product type |
| Transaction ledger | Source of truth for payment history against a booking/policy/order |

## What this does NOT own

- Basket, booking, or policy data — those are Booking Domain concerns
- Which PSP is active — that is the PSP Adapter's concern (internal to this domain)
- Journey-specific response shapes — that is the Experience API's job

## How the layers fit together

```
Wizard / Mini-app / Partner
        │
        ▼
┌─────────────────────────┐
│   Payment Experience API │  journey-shaped, composes domain calls
│   payment-experience     │  github.com/chrisgale/payment-experience
└────────────┬────────────┘
             │ calls
             ▼
┌─────────────────────────┐
│   Payment Domain API     │  this repo — owns domain operations
│   payment-domain         │  internal service
└────────────┬────────────┘
             │ adapts
             ▼
┌─────────────────────────┐
│   PSP Adapter            │  Worldpay today, swappable
│   (internal impl detail) │
└─────────────────────────┘
```

## Running the sandbox

```bash
node sandbox/server.js
# Listens on http://localhost:3011
```

## Docs

- [`docs/OPENAPI.md`](docs/OPENAPI.md) — endpoint reference with example payloads
- [`docs/CALL_THROUGH.md`](docs/CALL_THROUGH.md) — how the Experience API maps to Domain calls
- [`docs/SETTLEMENT_RULES.md`](docs/SETTLEMENT_RULES.md) — settlement deadline business rules per product type
