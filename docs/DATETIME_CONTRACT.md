# Datetime Contract

All API responses involving a time-bounded resource or action deadline include explicit ISO 8601 datetime fields.

**Callers must never compute deadlines or expiry times themselves. The API always tells you.**

---

## Field definitions

| Field | Type | Meaning |
|---|---|---|
| `expiresAt` | ISO 8601 datetime | This resource becomes invalid at this time. Do not attempt to use it after this point. |
| `captureBy` | ISO 8601 datetime | An authorisation must be captured before this time or it voids automatically. |
| `settlementDeadline` | ISO 8601 datetime | Payment must reach settled status by this time. After this time the booking may be at risk. |
| `respondBy` | ISO 8601 datetime | The caller (or customer) must act before this time — e.g. complete an SCA challenge, redirect to card capture. |
| `cardExpiresAt` | ISO 8601 datetime | The stored card becomes unusable after this time. |
| `createdAt` | ISO 8601 datetime | When this resource was created. |
| `authorisedAt` | ISO 8601 datetime | When the authorisation was granted. |
| `capturedAt` | ISO 8601 datetime | When the authorisation was captured. |
| `settledAt` | ISO 8601 datetime | When the transaction reached settled status at the PSP. |
| `completedAt` | ISO 8601 datetime | When this resource reached a terminal completed state. |
| `revokedAt` | ISO 8601 datetime | When this agreement was revoked. |
| `cancelledAt` | ISO 8601 datetime | When this authorisation was cancelled/voided. |

---

## Which resources carry time fields

### Card capture session
```json
{
  "cardCaptureSessionId": "ccs_3F9A2B1C",
  "redirectUrl": "https://...",
  "createdAt": "2026-07-01T06:00:00Z",
  "expiresAt": "2026-07-01T06:30:00Z",
  "respondBy": "2026-07-01T06:30:00Z"
}
```
The customer must complete card entry before `respondBy`. Create a new session after expiry.

---

### Authorisation
```json
{
  "authorisationId": "auth_7H3K9M2P",
  "status": "AUTHORISED",
  "amount": 19500,
  "currency": "GBP",
  "authorisedAt": "2026-07-01T06:00:00Z",
  "captureBy": "2026-07-02T06:00:00Z",
  "expiresAt": "2026-07-02T06:00:00Z"
}
```
Capture before `captureBy` or the authorisation voids. `expiresAt` and `captureBy` are the same value — both are present so callers can check either field by convention.

---

### SCA session
```json
{
  "scaSessionId": "scas_4B7D2F9H",
  "status": "PENDING",
  "challengeUrl": "https://...",
  "createdAt": "2026-07-01T06:00:00Z",
  "expiresAt": "2026-07-01T06:30:00Z",
  "respondBy": "2026-07-01T06:30:00Z",
  "paymentConsentId": null,
  "completedAt": null
}
```
Redirect the customer to `challengeUrl` before `respondBy`. On completion `paymentConsentId` is populated and `completedAt` is set.

---

### Order payment status (experience layer)
```json
{
  "bookingReference": "HX-2026-005678",
  "outstandingAmount": 19500,
  "currency": "GBP",
  "settlementDeadline": "2026-07-04T14:00:00Z",
  "settlementDeadlineNote": "Payment must settle 24 hours before check-in. After this time the booking may be cancelled.",
  "isOverdue": false
}
```
`settlementDeadline` is the computed datetime — booking check-in time minus the product-type offset. The experience layer computes this from the domain's `offsetHours` and the booking's check-in datetime.

---

### Stored payment method
```json
{
  "paymentMethodToken": "pm_4X7K2M9N",
  "scheme": "visa",
  "lastFour": "4242",
  "cardExpiresAt": "2027-09-30T23:59:59Z"
}
```
`cardExpiresAt` lets the UI warn the customer if their card will expire before their trip.

---

## Status + time field matrix

| Resource | PENDING | ACTIVE | COMPLETED/CAPTURED | EXPIRED/CANCELLED |
|---|---|---|---|---|
| Card capture session | `expiresAt`, `respondBy` set | — | `completedAt` set | `expiresAt` in past, `status: EXPIRED` |
| SCA session | `expiresAt`, `respondBy` set | — | `completedAt`, `paymentConsentId` set | `expiresAt` in past, `status: EXPIRED` |
| Authorisation | `captureBy`, `expiresAt` set | — | `capturedAt` set | `captureBy` in past, `status: EXPIRED` |
| Payment agreement | — | `registeredAt` set, `revokedAt: null` | — | `revokedAt` set, `status: REVOKED` |

---

## Rules for callers

1. **Never compute deadlines** — always read from the response field
2. **Check `expiresAt` before retrying** — if a resource has expired, create a new one rather than retrying the original
3. **Show `respondBy` in UI** — for SCA and card capture, surface the countdown to the customer
4. **Warn on `cardExpiresAt`** — if the card expires before the trip date, prompt the customer to update
5. **Treat `settlementDeadline` as hard** — if outstanding payment is not settled by this time, escalate
