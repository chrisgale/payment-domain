/**
 * Payment Domain API — Sandbox
 * Pure Node.js, no dependencies. Runs on http://localhost:3011
 *
 * Stateful in-memory store. Resets on restart.
 * All mutating endpoints require Idempotency-Key header.
 */

const http = require('http');
const crypto = require('crypto');

// ── In-memory store ──────────────────────────────────────────────────────────
const store = {
  cardCaptureSessions: {},
  paymentMethods: {
    'cust_HX_7823641': [
      {
        paymentMethodToken: 'pm_4X7K2M9N',
        type: 'card', scheme: 'visa', lastFour: '4242',
        expiryMonth: 9, expiryYear: 2027, isDefault: true,
        hasActiveAgreement: false, storedAt: '2025-11-03T14:22:00Z'
      },
      {
        paymentMethodToken: 'pm_8B3J5L1P',
        type: 'card', scheme: 'mastercard', lastFour: '1234',
        expiryMonth: 3, expiryYear: 2026, isDefault: false,
        hasActiveAgreement: true, storedAt: '2024-06-18T09:10:00Z'
      }
    ]
  },
  authorisations: {},
  scaSessions: {},
  paymentAgreements: {},
  transactions: {
    'HX-2026-005678': {
      bookingReference: 'HX-2026-005678',
      totalAmount: 29500, capturedAmount: 10000,
      outstandingAmount: 19500, currency: 'GBP',
      transactions: [
        {
          transactionId: 'txn_1A2B3C4D', type: 'CAPTURE', amount: 10000,
          currency: 'GBP', status: 'SETTLED', paymentMethodToken: 'pm_4X7K2M9N',
          capturedAt: '2026-06-01T10:00:00Z', authorisationId: 'auth_5E6F7G8H'
        }
      ]
    }
  },
  idempotencyCache: {}
};

const settlementRules = {
  hotel:     { productType: 'hotel',     settlementRule: 'BEFORE_CHECKIN',    offsetHours: 24, description: 'Payment must be settled at least 24 hours before check-in' },
  parking:   { productType: 'parking',   settlementRule: 'BEFORE_DEPARTURE',  offsetHours: 48, description: 'Payment must be settled at least 48 hours before departure' },
  lounge:    { productType: 'lounge',    settlementRule: 'BEFORE_ENTRY',      offsetHours: 0,  description: 'Payment must be settled before lounge entry' },
  insurance: { productType: 'insurance', settlementRule: 'AT_PURCHASE',       offsetHours: 0,  description: 'Payment settled at point of purchase' },
  transfer:  { productType: 'transfer',  settlementRule: 'BEFORE_DEPARTURE',  offsetHours: 72, description: 'Payment must be settled at least 72 hours before transfer time' }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function now() { return new Date().toISOString(); }

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

// ── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3011');
  const path = url.pathname;
  const method = req.method;
  const idempotencyKey = req.headers['idempotency-key'];

  // Check idempotency cache for mutating requests
  if (['POST', 'PUT', 'DELETE'].includes(method) && idempotencyKey) {
    if (store.idempotencyCache[idempotencyKey]) {
      const cached = store.idempotencyCache[idempotencyKey];
      res.setHeader('Idempotent-Replayed', 'true');
      return send(res, cached.status, cached.body);
    }
  }

  function reply(status, body) {
    if (['POST', 'PUT', 'DELETE'].includes(method) && idempotencyKey) {
      store.idempotencyCache[idempotencyKey] = { status, body };
    }
    send(res, status, body);
  }

  const body = await parseBody(req);

  // POST /v1/payment-methods/sessions
  if (method === 'POST' && path === '/v1/payment-methods/sessions') {
    if (!body.customerId || !body.returnUrl) return reply(400, { error: 'BAD_REQUEST', message: 'customerId and returnUrl required' });
    const id = uid('ccs');
    const session = { cardCaptureSessionId: id, redirectUrl: `https://secure.worldpay.com/hpp/paymentPage?token=${id}`, expiresAt: new Date(Date.now() + 30*60000).toISOString() };
    store.cardCaptureSessions[id] = session;
    return reply(201, session);
  }

  // GET /v1/payment-methods/:customerId
  const pmMatch = path.match(/^\/v1\/payment-methods\/([^/]+)$/);
  if (method === 'GET' && pmMatch) {
    const cid = pmMatch[1];
    const methods = store.paymentMethods[cid];
    if (!methods) return reply(404, { error: 'NOT_FOUND', message: 'Customer not found' });
    return reply(200, { customerId: cid, paymentMethods: methods });
  }

  // DELETE /v1/payment-methods/:customerId/:token
  const pmDelMatch = path.match(/^\/v1\/payment-methods\/([^/]+)\/([^/]+)$/);
  if (method === 'DELETE' && pmDelMatch) {
    const [, cid, token] = pmDelMatch;
    const methods = store.paymentMethods[cid] || [];
    const idx = methods.findIndex(m => m.paymentMethodToken === token);
    if (idx === -1) return reply(404, { error: 'NOT_FOUND', message: 'Payment method not found' });
    if (methods[idx].hasActiveAgreement) return reply(409, { error: 'ACTIVE_AGREEMENT', message: 'Revoke the payment agreement before removing this payment method' });
    methods.splice(idx, 1);
    return reply(204, {});
  }

  // POST /v1/authorisations
  if (method === 'POST' && path === '/v1/authorisations') {
    if (!body.paymentMethodToken || !body.amount || !body.bookingReference) {
      return reply(400, { error: 'BAD_REQUEST', message: 'paymentMethodToken, amount, bookingReference required' });
    }
    const authId = uid('auth');
    const auth = {
      authorisationId: authId, status: 'AUTHORISED',
      amount: body.amount, currency: body.currency || 'GBP',
      bookingReference: body.bookingReference,
      scaToken: 'sca_' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      authorisedAt: now(),
      captureBy: new Date(Date.now() + 24*60*60000).toISOString()
    };
    store.authorisations[authId] = auth;
    return reply(201, auth);
  }

  // POST /v1/authorisations/:id/capture
  const captureMatch = path.match(/^\/v1\/authorisations\/([^/]+)\/capture$/);
  if (method === 'POST' && captureMatch) {
    const auth = store.authorisations[captureMatch[1]];
    if (!auth) return reply(404, { error: 'NOT_FOUND', message: 'Authorisation not found' });
    if (auth.status !== 'AUTHORISED') return reply(409, { error: 'INVALID_STATE', currentStatus: auth.status });
    auth.status = 'CAPTURED'; auth.capturedAt = now();
    return reply(200, auth);
  }

  // POST /v1/authorisations/:id/cancel
  const cancelMatch = path.match(/^\/v1\/authorisations\/([^/]+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    const auth = store.authorisations[cancelMatch[1]];
    if (!auth) return reply(404, { error: 'NOT_FOUND', message: 'Authorisation not found' });
    auth.status = 'CANCELLED'; auth.cancelledAt = now();
    return reply(200, auth);
  }

  // POST /v1/sca/sessions
  if (method === 'POST' && path === '/v1/sca/sessions') {
    const sessionId = uid('scas');
    const session = {
      scaSessionId: sessionId, status: 'PENDING',
      challengeUrl: `https://3ds.worldpay.com/challenge?session=${sessionId}`,
      expiresAt: new Date(Date.now() + 30*60000).toISOString()
    };
    store.scaSessions[sessionId] = session;
    return reply(201, session);
  }

  // GET /v1/sca/sessions/:id
  const scaGetMatch = path.match(/^\/v1\/sca\/sessions\/([^/]+)$/);
  if (method === 'GET' && scaGetMatch) {
    const session = store.scaSessions[scaGetMatch[1]];
    if (!session) return reply(404, { error: 'NOT_FOUND', message: 'SCA session not found' });
    return reply(200, session);
  }

  // PUT /v1/sca/sessions/:id (PSP callback — auto-complete for sandbox)
  if (method === 'PUT' && scaGetMatch) {
    const session = store.scaSessions[scaGetMatch[1]];
    if (!session) return reply(404, { error: 'NOT_FOUND', message: 'SCA session not found' });
    session.status = 'COMPLETED';
    session.paymentConsentId = uid('pci');
    session.completedAt = now();
    return reply(200, session);
  }

  // POST /v1/payment-agreements
  if (method === 'POST' && path === '/v1/payment-agreements') {
    if (!body.customerId || !body.paymentMethodToken || !body.paymentConsentId) {
      return reply(400, { error: 'BAD_REQUEST', message: 'customerId, paymentMethodToken, paymentConsentId required' });
    }
    const agreementId = uid('pa');
    const agreement = {
      paymentAgreementId: agreementId,
      customerId: body.customerId,
      paymentMethodToken: body.paymentMethodToken,
      status: 'ACTIVE', agreementType: body.agreementType || 'BALANCE_COLLECTION',
      registeredAt: now(), lastUsedAt: null
    };
    store.paymentAgreements[agreementId] = agreement;
    // Mark payment method
    const methods = store.paymentMethods[body.customerId] || [];
    const pm = methods.find(m => m.paymentMethodToken === body.paymentMethodToken);
    if (pm) pm.hasActiveAgreement = true;
    return reply(201, agreement);
  }

  // GET /v1/payment-agreements/:id
  const paMatch = path.match(/^\/v1\/payment-agreements\/([^/]+)$/);
  if (method === 'GET' && paMatch) {
    const agreement = store.paymentAgreements[paMatch[1]];
    if (!agreement) return reply(404, { error: 'NOT_FOUND', message: 'Agreement not found' });
    return reply(200, agreement);
  }

  // DELETE /v1/payment-agreements/:id
  if (method === 'DELETE' && paMatch) {
    const agreement = store.paymentAgreements[paMatch[1]];
    if (!agreement) return reply(404, { error: 'NOT_FOUND', message: 'Agreement not found' });
    agreement.status = 'REVOKED'; agreement.revokedAt = now();
    const methods = store.paymentMethods[agreement.customerId] || [];
    const pm = methods.find(m => m.paymentMethodToken === agreement.paymentMethodToken);
    if (pm) pm.hasActiveAgreement = false;
    return reply(200, agreement);
  }

  // GET /v1/settlement-rules/:productType
  const srMatch = path.match(/^\/v1\/settlement-rules\/([^/]+)$/);
  if (method === 'GET' && srMatch) {
    const rule = settlementRules[srMatch[1]];
    if (!rule) return reply(404, { error: 'NOT_FOUND', message: `No settlement rules for product type: ${srMatch[1]}` });
    return reply(200, rule);
  }

  // GET /v1/transactions/:bookingReference
  const txMatch = path.match(/^\/v1\/transactions\/([^/]+)$/);
  if (method === 'GET' && txMatch) {
    const record = store.transactions[txMatch[1]];
    if (!record) return reply(404, { error: 'NOT_FOUND', message: 'No transactions found for reference' });
    return reply(200, record);
  }

  // Health
  if (path === '/health') return send(res, 200, { status: 'ok', service: 'payment-domain-sandbox' });

  send(res, 404, { error: 'NOT_FOUND', message: `No route: ${method} ${path}` });
});

server.listen(3011, () => {
  console.log('Payment Domain sandbox running on http://localhost:3011');
  console.log('');
  console.log('Endpoints:');
  console.log('  POST   /v1/payment-methods/sessions');
  console.log('  GET    /v1/payment-methods/:customerId');
  console.log('  DELETE /v1/payment-methods/:customerId/:token');
  console.log('  POST   /v1/authorisations');
  console.log('  POST   /v1/authorisations/:id/capture');
  console.log('  POST   /v1/authorisations/:id/cancel');
  console.log('  POST   /v1/sca/sessions');
  console.log('  GET    /v1/sca/sessions/:id');
  console.log('  PUT    /v1/sca/sessions/:id  (PSP callback / sandbox complete)');
  console.log('  POST   /v1/payment-agreements');
  console.log('  GET    /v1/payment-agreements/:id');
  console.log('  DELETE /v1/payment-agreements/:id');
  console.log('  GET    /v1/settlement-rules/:productType');
  console.log('  GET    /v1/transactions/:bookingReference');
  console.log('');
  console.log('Test data: customer cust_HX_7823641, booking HX-2026-005678');
});
