import { config } from '../config';
import { errors } from '../errors';
import { logger } from '../logger';

/**
 * In-app purchase receipt validation.
 *
 * Nothing is granted on the client's word. The app sends the store receipt, Node verifies
 * it with Apple or Google, and only a verified, not-previously-seen transaction unlocks
 * anything. The unique constraint on `Purchase.transactionId` is the replay defence.
 */

export interface ReceiptVerdict {
  valid: boolean;
  transactionId: string;
  productId: string;
  /** Present for subscriptions. */
  expiresAt: Date | null;
}

export async function verifyReceipt(params: {
  platform: 'ios' | 'android';
  receipt: string;
  productId: string;
}): Promise<ReceiptVerdict> {
  if (params.platform === 'ios') return verifyApple(params.receipt, params.productId);
  return verifyGoogle(params.receipt, params.productId);
}

/**
 * Apple verifyReceipt.
 *
 * Status 21007 means a sandbox receipt was sent to production. Apple's review team tests
 * against sandbox, so a build that does not retry there will fail review — this is the
 * single most common IAP mistake.
 */
async function verifyApple(receipt: string, productId: string): Promise<ReceiptVerdict> {
  if (!config.APPLE_SHARED_SECRET) {
    throw errors.unavailable('Purchases are not configured.');
  }

  const body = JSON.stringify({
    'receipt-data': receipt,
    password: config.APPLE_SHARED_SECRET,
    'exclude-old-transactions': true,
  });

  const call = async (url: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    return (await response.json()) as AppleResponse;
  };

  let json = await call('https://buy.itunes.apple.com/verifyReceipt');

  if (json.status === 21007) {
    json = await call('https://sandbox.itunes.apple.com/verifyReceipt');
  }

  if (json.status !== 0) {
    logger.warn({ status: json.status }, 'apple receipt rejected');
    return { valid: false, transactionId: '', productId, expiresAt: null };
  }

  const purchases = [
    ...(json.latest_receipt_info ?? []),
    ...(json.receipt?.in_app ?? []),
  ];

  const match = purchases.find((p) => p.product_id === productId);

  if (!match) {
    return { valid: false, transactionId: '', productId, expiresAt: null };
  }

  const expiresAt = match.expires_date_ms
    ? new Date(Number(match.expires_date_ms))
    : null;

  // An expired subscription receipt is structurally valid but must not grant Pro.
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return {
      valid: false,
      transactionId: match.transaction_id,
      productId,
      expiresAt,
    };
  }

  return {
    valid: true,
    transactionId: match.transaction_id,
    productId,
    expiresAt,
  };
}

interface AppleResponse {
  status: number;
  receipt?: { in_app?: AppleInApp[] };
  latest_receipt_info?: AppleInApp[];
}

interface AppleInApp {
  product_id: string;
  transaction_id: string;
  expires_date_ms?: string;
}

/**
 * Google Play validation via the Android Publisher API.
 *
 * Requires a service account with the Play Developer API enabled. Left as an explicit
 * failure when unconfigured rather than defaulting to "valid" — a permissive default here
 * is free items for anyone who can craft a request.
 */
async function verifyGoogle(receipt: string, productId: string): Promise<ReceiptVerdict> {
  if (!config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    throw errors.unavailable('Purchases are not configured.');
  }

  let parsed: { purchaseToken?: string; packageName?: string };
  try {
    parsed = JSON.parse(receipt);
  } catch {
    throw errors.badRequest('That purchase receipt could not be read.');
  }

  if (!parsed.purchaseToken || !parsed.packageName) {
    throw errors.badRequest('That purchase receipt is incomplete.');
  }

  const accessToken = await googleAccessToken();

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(parsed.packageName)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(parsed.purchaseToken)}`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'google receipt rejected');
    return { valid: false, transactionId: '', productId, expiresAt: null };
  }

  const json = (await response.json()) as {
    orderId?: string;
    purchaseState?: number;
    expiryTimeMillis?: string;
  };

  // purchaseState 0 is Purchased. 1 is Cancelled, 2 is Pending — neither grants anything.
  const valid = json.purchaseState === 0;

  return {
    valid,
    transactionId: json.orderId ?? parsed.purchaseToken,
    productId,
    expiresAt: json.expiryTimeMillis ? new Date(Number(json.expiryTimeMillis)) : null,
  };
}

/** Service-account JWT exchange for a Play API access token. */
async function googleAccessToken(): Promise<string> {
  const { JWT } = await import('google-auth-library');
  const credentials = JSON.parse(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) as {
    client_email: string;
    private_key: string;
  };

  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const token = await client.getAccessToken();
  if (!token.token) throw errors.unavailable('Purchase validation is unavailable.');
  return token.token;
}
