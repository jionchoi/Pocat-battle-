import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'phosphor-react-native';

import { ALBUM_CONFIG } from '../constants/game';
import {
  contextColors,
  fern,
  icon,
  spacing,
  text,
  type ContextName,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

/**
 * Pro Upsell (README section 5.7).
 *
 * Triggered contextually — when album storage nears the free cap, or when a capture is
 * refused because the album is full. Never on a timer and never on launch: an upsell that
 * interrupts someone who is not blocked by anything is the pattern this app should not
 * have.
 *
 * The copy states what Pro does and nothing else. There is no scoring advantage to sell,
 * because there isn't one — README section 1 rules it out, and inventing urgency around a
 * storage limit is as far as this should ever go.
 */

const BENEFITS = [
  'Unlimited album storage',
  'Full-resolution exports',
  'Early access to weekly challenges',
] as const;

export const ProUpsell = React.memo(function ProUpsell({
  visible,
  onClose,
  onOpenShop,
  photoCount,
  photoLimit,
  /** True when the player is already blocked, rather than merely close to the cap. */
  blocked = false,
  context = 'bone',
}: {
  visible: boolean;
  onClose: () => void;
  onOpenShop: () => void;
  photoCount: number;
  photoLimit: number;
  blocked?: boolean;
  context?: ContextName;
}) {
  const c = contextColors(context);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={blocked ? 'Your album is full' : 'Your album is nearly full'}
      context={context}
    >
      <Text style={[text.body, { color: c.textMuted }]}>
        {blocked
          ? `You have reached the ${photoLimit}-photo limit on the free tier. Delete a few shots to keep going, or go Pro for unlimited storage.`
          : `You are at ${photoCount} of ${photoLimit} photos. Pro removes the limit — nothing you have already taken is ever deleted.`}
      </Text>

      <View style={styles.benefits}>
        {BENEFITS.map((benefit) => (
          <View key={benefit} style={styles.benefit}>
            <Check size={icon.size.sm} color={fern[600]} weight={icon.weightActive} />
            <Text style={[text.bodySm, { color: c.text }]}>{benefit}</Text>
          </View>
        ))}
      </View>

      <Text style={[text.caption, styles.footnote, { color: c.textFaint }]}>
        Pro changes storage and export quality only. It has no effect on how a photo is
        scored.
      </Text>

      <View style={styles.actions}>
        <Button label="See Pro" onPress={onOpenShop} context={context} trailingIcon />
        <Button
          label={blocked ? 'Manage my album' : 'Not now'}
          variant="ghost"
          onPress={onClose}
          context={context}
        />
      </View>
    </BottomSheet>
  );
});

/** Whether the quota is close enough to the cap to be worth mentioning. */
export function shouldPromptForPro(
  photoCount: number,
  photoLimit: number | null
): boolean {
  if (photoLimit === null) return false;
  return photoCount >= Math.floor(photoLimit * ALBUM_CONFIG.upsellThreshold);
}

const styles = StyleSheet.create({
  benefits: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  footnote: {
    marginTop: spacing.md,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
});
