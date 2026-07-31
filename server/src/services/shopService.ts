import type { CosmeticKind } from '@prisma/client';

import { prisma } from '../db/client';
import { errors } from '../errors';
import { logger } from '../logger';
import { verifyReceipt } from '../integrations/receipts';

/**
 * Shop and Pro subscription (README section 5.7).
 *
 * The catalogue is server-owned so pricing and availability can change without an app
 * release. Nothing here is pay-to-win, and structurally cannot be: there is no currency
 * and no power to buy. Cosmetics change how photos are captured and displayed; Pro lifts
 * the album cap and export resolution. Neither touches a score.
 *
 * Some cosmetics are gated on Photographer Rank rather than sold — that is the
 * progression reward the README describes, and it is the only thing rank does.
 */

interface CatalogEntry {
  id: string;
  kind: CosmeticKind;
  name: string;
  description: string;
  productId: string;
  priceLabel: string;
  /** Rank at which this unlocks for free. Zero means it is purchase-only. */
  requiredRank: number;
  /** Pro renews; cosmetics are permanent. */
  subscription: boolean;
}

const CATALOG: CatalogEntry[] = [
  /* --- camera filters --- */
  {
    id: 'filter-warm-street',
    kind: 'filter',
    name: 'Warm street',
    description: 'Lifts shadows and warms midtones. Good for overcast afternoons.',
    productId: 'app.catsnap.filter.warmstreet',
    priceLabel: '$1.99',
    requiredRank: 0,
    subscription: false,
  },
  {
    id: 'filter-night-window',
    kind: 'filter',
    name: 'Night window',
    description: 'Cleans up noise in low light without flattening the fur.',
    productId: 'app.catsnap.filter.nightwindow',
    priceLabel: '$1.99',
    requiredRank: 0,
    subscription: false,
  },
  {
    id: 'filter-hedgerow',
    kind: 'filter',
    name: 'Hedgerow',
    description: 'Deepens greens. Unlocked at Fence Sitter.',
    productId: 'app.catsnap.filter.hedgerow',
    priceLabel: 'Rank 4',
    requiredRank: 4,
    subscription: false,
  },

  /* --- frame styles --- */
  {
    id: 'frame-brass',
    kind: 'frame',
    name: 'Brass frame',
    description: 'A machined brass edge for any photo in your album.',
    productId: 'app.catsnap.frame.brass',
    priceLabel: '$2.99',
    requiredRank: 0,
    subscription: false,
  },
  {
    id: 'frame-slate',
    kind: 'frame',
    name: 'Slate frame',
    description: 'A quiet grey edge with a hairline inner rule.',
    productId: 'app.catsnap.frame.slate',
    priceLabel: '$2.99',
    requiredRank: 0,
    subscription: false,
  },
  {
    id: 'frame-contact-sheet',
    kind: 'frame',
    name: 'Contact sheet',
    description: 'Sprocket holes and a grease-pencil mark. Unlocked at Window Watcher.',
    productId: 'app.catsnap.frame.contactsheet',
    priceLabel: 'Rank 5',
    requiredRank: 5,
    subscription: false,
  },

  /* --- gallery themes --- */
  {
    id: 'theme-darkroom',
    kind: 'theme',
    name: 'Darkroom',
    description: 'A dark album grid that puts the photos first.',
    productId: 'app.catsnap.theme.darkroom',
    priceLabel: '$2.99',
    requiredRank: 0,
    subscription: false,
  },
  {
    id: 'theme-archive',
    kind: 'theme',
    name: 'Archive',
    description: 'Wide margins and small captions, like a print portfolio.',
    productId: 'app.catsnap.theme.archive',
    priceLabel: '$2.99',
    requiredRank: 0,
    subscription: false,
  },

  /* --- pro --- */
  {
    id: 'pro-monthly',
    kind: 'pro',
    name: 'CatSnap Pro',
    description:
      'Unlimited album storage, full-resolution exports, and early access to challenges. No scoring advantages.',
    productId: 'app.catsnap.pro.monthly',
    priceLabel: '$4.99 / month',
    requiredRank: 0,
    subscription: true,
  },
];

export async function catalog(userId: string) {
  const [owned, user] = await Promise.all([
    prisma.ownedCosmetic.findMany({ where: { userId }, select: { itemId: true } }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { proSubscriptionActive: true, photographerRank: true },
    }),
  ]);

  const ownedIds = new Set(owned.map((o) => o.itemId));

  return {
    proActive: user.proSubscriptionActive,
    photographerRank: user.photographerRank,
    items: CATALOG.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
      productId: item.productId,
      priceLabel: item.priceLabel,
      requiredRank: item.requiredRank,
      owned:
        item.kind === 'pro'
          ? user.proSubscriptionActive
          : ownedIds.has(item.id) ||
            // A rank-gated item is owned the moment the rank is reached — there is
            // nothing to claim and no purchase to make.
            (item.requiredRank > 0 && user.photographerRank >= item.requiredRank),
    })),
  };
}

/**
 * Grant an item after verifying the receipt with the platform.
 *
 * The transaction id carries a unique constraint, so a replayed receipt hits a conflict
 * rather than granting twice. That is why validation happens before any grant, inside
 * one transaction.
 */
export async function purchase(params: {
  userId: string;
  platform: 'ios' | 'android';
  productId: string;
  receipt: string;
}) {
  const item = CATALOG.find((i) => i.productId === params.productId);
  if (!item) throw errors.notFound('That item is not in the shop.');

  if (item.requiredRank > 0) {
    throw errors.badRequest('That item is unlocked by rank, not purchased.');
  }

  const verdict = await verifyReceipt({
    platform: params.platform,
    receipt: params.receipt,
    productId: params.productId,
  });

  if (!verdict.valid) {
    throw errors.badRequest('That purchase could not be verified with the store.');
  }

  const existing = await prisma.purchase.findUnique({
    where: { transactionId: verdict.transactionId },
    select: { id: true },
  });

  if (existing) {
    // Idempotent: a client retrying after a dropped response gets a success, not a
    // duplicate grant.
    logger.info({ transactionId: verdict.transactionId }, 'purchase already applied');
    return { granted: false, alreadyApplied: true, item: item.id };
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchase.create({
      data: {
        userId: params.userId,
        productId: params.productId,
        platform: params.platform,
        transactionId: verdict.transactionId,
        validated: true,
      },
    });

    if (item.kind === 'pro') {
      await tx.user.update({
        where: { id: params.userId },
        data: { proSubscriptionActive: true, proExpiresAt: verdict.expiresAt },
      });
      return;
    }

    await tx.ownedCosmetic.upsert({
      where: { userId_itemId: { userId: params.userId, itemId: item.id } },
      create: { userId: params.userId, itemId: item.id, kind: item.kind },
      update: {},
    });
  });

  return { granted: true, alreadyApplied: false, item: item.id };
}

/**
 * Expire lapsed Pro subscriptions. Run by the scheduled job, because Apple and Google do
 * not reliably tell us the moment a subscription lapses.
 *
 * Note this can put a player over the free album cap. That is deliberate: their photos
 * are never deleted, they simply cannot add more until they free space or resubscribe.
 */
export async function expireLapsedPro(): Promise<number> {
  const result = await prisma.user.updateMany({
    where: {
      proSubscriptionActive: true,
      proExpiresAt: { not: null, lt: new Date() },
    },
    data: { proSubscriptionActive: false },
  });

  return result.count;
}
