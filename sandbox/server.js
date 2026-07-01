/**
 * Payment Domain API — Sandbox
 * Pure Node.js, no dependencies. Runs on http://localhost:3011
 *
 * All mutating endpoints require Idempotency-Key header.
 * All responses with expiry/deadlines include explicit ISO 8601 time fields.
 */

const http = require('http');
const crypto = require('crypto');

const store = {
  cardCaptureSessions: {},
  paymentMethods: {
    'cust_HX_7823641': [
      {
        paymentMethodToken: 'pm_4X7K2M9N',
        type: 'card', scheme: 'visa', lastFour: '4242',
        expiryMonth: 9, expiryYear: 2027,
        cardExpiresAt: '2027-09-30T23:59:59Z',
        isDefault: true, hasActiveAgreement: false,
        storedAt: '2025-11-03T14:22:00Z'
      },
      {
        paymentMethodToken: 'pm_8B3J5L1P',
        type: 'card', scheme: 'mastercard', lastFour: '1234',
        expiryMonth: 3, expiryYear: 2026,
        cardExpiresAt: '2026-03-31T23:59:59Z',
        isDefault: false, hasActiveAgreement: true,
        storedAt: '2024-06-18T09:10:00Z'
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
          authorisedAt: '2026-06-01T09:55:00Z',
          capturedAt: '2026-06-01T10:00:00Z',
          settledAt: '2026-06-01T10:00:05Z',
          captureBy: null, expiresAt: null,
          authorisationId: 'auth_5E6F7G8H'
        }
      ]
    }
  },
  idempotencyCache: {}
};

const settlementRules = {
  hotel:     { productType: 'hotel',     settlementRule: 'BEFORE_CHECKIN',   offsetHours: 24, description: 'Payment must be settled at least 24 hours before check-in' },
  parking:   { productType: 'parking',   settlementRule: 'BEFORE_DEPARTURE', offsetHours: 48, description: 'Payment must be settled at least 48 hours before departure' },
  lounge:    { productType: 'lounge',    settlementRule: 'BEFORE_ENTRY',     offsetHours: 0,  description: 'Payment must be settled before lounge entry' },
  insurance: { productType: 'insurance', settlementRule: 'AT_PURCHASE',      offsetHours: 0,  description: 'Payment settled at point of purchase' },
  transfer:  { productType: 'transfer',  settlementRule: 'BEFORE_DEPARTURE', offsetHours: 72, description: 'Payment must be settled at least 72 hours before transfer time' }
};

function uid(prefix) { return prefix + '_' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function now() { return new Date().toISOString(); }
function inMinutes(m) { return new Date(Date.now() + m * 60000).toISOString(); }
function inHours(h) { return new Date(Date.now() + h * 3600000).toISOString(); }

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3011');
  const path = url.pathname;
  const method = req.method;
  const idempotencyKey = req.headers['idempotency-key'];

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
    const createdAt = now();
    const expiresAt = inMinutes(30);
    const session = {
      cardCaptureSessionId: id,
      redirectUrl: `https://secure.worldpay.com/hpp/paymentPage?token=${id}`,
      createdAt, expiresAt, respondBy: expiresAt
    };
    store.cardCaptureSessions[id] = session;
    return reply(201, session);
  }

  // GET /v1/payment-methods/:customerId
  const pmMatch = path.match(/^\/v1\/payment-methods\/([^/]+)$/);
  if (method === 'GET' && pmMatch) {
    const methods = store.paymentMethods[pmMatch[1]];
    if (!methods) return reply(404, { error: 'NOT_FOUND', message: 'Customer not found' });
    return reply(200, { customerId: pmMatch[1], paymentMethods: methods });
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
    const authorisedAt = now();
    const captureBy = inHours(24);
    const auth = {
      authorisationId: authId, status: 'AUTHORISED',
      amount: body.amount, currency: body.currency || 'GBP',
      bookingReference: body.bookingReference,
      scaToken: 'sca_' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      authorisedAt, captureBy, expiresAt: captureBy
    };
    store.authorisations[authId] = auth;
    // Add pending transaction to ledger
    const ref = body.bookingReference;
    if (!store.transactions[ref]) {
      store.transactions[ref] = { bookingReference: ref, totalAmount: body.amount, capturedAmount: 0, outstandingAmount: body.amount, currency: body.currency || 'GBP', transactions: [] };
    }
    store.transactions[ref].transactions.push({
      transactionId: uid('txn'), type: 'AUTHORISATION', amount: body.amount,
      currency: body.currency || 'GBP', status: 'AUTHORISED',
      paymentMethodToken: body.paymentMethodToken,
      authorisedAt, capturedAt: null, settledAt: null,
      captureBy, expiresAt: captureBy,
      authorisationId: authId
    });
    return reply(201, auth);
  }

  // POST /v1/authorisations/:id/capture
  const captureMatch = path.match(/^\/v1\/authorisations\/([^/]+)\/capture$/);
  if (method === 'POST' && captureMatch) {
    const auth = store.authorisations[captureMatch[1]];
    if (!auth) return reply(404, { error: 'NOT_FOUND', message: 'Authorisation not found' });
    if (auth.status !== 'AUTHORISED') {
      return reply(409, { error: 'INVALID_STATE', currentStatus: auth.status, captureBy: auth.captureBy, message: auth.status === 'EXPIRED' ? 'Authorisation expired — a new authorisation is required' : `Cannot capture from status: ${auth.status}` });
    }
    const capturedAt = now();
    auth.status = 'CAPTURED'; auth.capturedAt = capturedAt;
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
    const createdAt = now();
    const expiresAt = inMinutes(30);
    const session = {
      scaSessionId: sessionId, status: 'PENDING',
      challengeUrl: `https://3ds.worldpay.com/challenge?session=${sessionId}`,
      createdAt, expiresAt, respondBy: expiresAt,
      paymentConsentId: null, completedAt: null
    };
    store.scaSessions[sessionId] = session;
    return reply(201, session);
  }

  // GET /v1/sca/sessions/:id
  const scaMatch = path.match(/^\/v1\/sca\/sessions\/([^/]+)$/);
  if (method === 'GET' && scaMatch) {
    const session = store.scaSessions[scaMatch[1]];
    if (!session) return reply(404, { error: 'NOT_FOUND', message: 'SCA session not found' });
    // Auto-expire in sandbox if past expiresAt
    if (session.status === 'PENDING' && new Date(session.expiresAt) < new Date()) {
      session.status = 'EXPIRED';
    }
    return reply(200, session);
  }

  // PUT /v1/sca/sessions/:id (PSP callback / sandbox complete)
  if (method === 'PUT' && scaMatch) {
    const session = store.scaSessions[scaMatch[1]];
    if (!session) return reply(404, { error: 'NOT_FOUND', message: 'SCA session not found' });
    if (session.status === 'EXPIRED') return reply(409, { error: 'SESSION_EXPIRED', expiresAt: session.expiresAt, message: 'SCA session expired — a new session is required' });
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
      paymentAgreementId: agreementId, customerId: body.customerId,
      paymentMethodToken: body.paymentMethodToken, status: 'ACTIVE',
      agreementType: body.agreementType || 'BALANCE_COLLECTION',
      registeredAt: now(), lastUsedAt: null, revokedAt: null
    };
    store.paymentAgreements[agreementId] = agreement;
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

  if (path === '/health') return send(res, 200, { status: 'ok', service: 'payment-domain-sandbox', time: now() });

  send(res, 404, { error: 'NOT_FOUND', message: `No route: ${method} ${path}` });
});

server.listen(3011, () => {
  console.log('Payment Domain sandbox — http://localhost:3011');
  console.log('All time-bounded responses include expiresAt, captureBy, respondBy, settlementDeadline');
  console.log('Test data: cust_HX_7823641 / HX-2026-005678');
});
