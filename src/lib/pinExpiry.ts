import * as Notifications from 'expo-notifications';

import { MAP_CONFIG, PAW_CONFIG } from '../constants/game';
import type { Photo } from '../models';

/**
 * When a photograph's map pin comes down, and warning its owner before it does.
 *
 * ## Why a local notification and not a push
 *
 * Nothing on the server knows when a pin is about to expire, and nothing should have to. The
 * expiry is not an event — it is `captured_at + SIGHTING_TTL_HOURS`, or a `map_pin_until` the
 * owner paid for, both of which are *arithmetic on a row the client already has*. Sending it as
 * a push would mean a scheduled job walking every photograph in the product to recompute a
 * number each device can work out for itself, plus a push token, plus a delivery guarantee, for
 * a message whose whole purpose is to be ignorable.
 *
 * The same argument the paw grant makes for settling lazily instead of on a cron, in
 * `server/src/game/paws.ts`: if the answer can be derived when somebody asks, do not build a
 * machine to keep it fresh.
 *
 * ## What it costs to do it this way
 *
 * A local notification is scheduled on *this* device, so it does not follow the player to
 * another phone, and it does not fire if they uninstall or if the OS drops it. All acceptable:
 * missing the warning costs a pin that expires the way pins expired before any of this existed.
 *
 * It is also **not** rescheduled by anything but an app launch or an explicit call here. A pin
 * extended on another device will still warn on this one at the old time — which is why the
 * copy asks rather than asserts, and why reopening the photograph re-syncs it.
 */

/** Notification identifiers are namespaced so nothing else's can be cancelled by accident. */
function idFor(photoId: string): string {
  return `pin-expiry:${photoId}`;
}

/**
 * When this photograph's pin stops being published.
 *
 * `mapPinUntil` wins when it is set, because that is what the owner bought. Otherwise it is the
 * ordinary TTL measured from capture — the same rule `services/map.ts` applies, and the reason
 * `MAP_CONFIG.sightingTtlHours` mirrors `SIGHTING_TTL_HOURS`.
 *
 * Null when the photograph is not on the map at all. There is no expiry to speak of: the pin is
 * already not there, and the switch is what put it back.
 */
export function pinExpiresAt(photo: Pick<Photo, 'capturedAt' | 'mapPinUntil' | 'sharedToMap'>) {
  if (!photo.sharedToMap) return null;

  if (photo.mapPinUntil) return new Date(photo.mapPinUntil);

  const captured = new Date(photo.capturedAt);
  if (Number.isNaN(captured.getTime())) return null;

  return new Date(captured.getTime() + MAP_CONFIG.sightingTtlHours * 3_600_000);
}

/** Whether the pin has already come down. Owners still see their own pins; readers do not. */
export function pinHasExpired(
  photo: Pick<Photo, 'capturedAt' | 'mapPinUntil' | 'sharedToMap'>,
  now: Date = new Date()
): boolean {
  const at = pinExpiresAt(photo);
  return at !== null && at <= now;
}

/**
 * Schedules — or reschedules, or cancels — the warning for one photograph.
 *
 * Cancel-then-schedule every time, because this is called whenever the photograph's state
 * changes and the alternative is a device accumulating one stale notification per extension.
 * Cancelling something that was never scheduled is not an error on either platform.
 *
 * Nothing is scheduled when:
 *
 *   - the pin is down, or already expired — there is nothing to warn about;
 *   - the warning time is in the past, which is every pin inside its last
 *     `pinExpiryWarningHours`. A notification that should have fired yesterday must not fire
 *     *now*: the player is holding the phone, looking at this photograph, and the screen already
 *     says when the pin goes. Firing would be the app telling them what they are reading.
 *   - permission has not been granted. Checked rather than requested, deliberately — a prompt
 *     raised by opening a photograph is a prompt with no context, and the Settings screen is
 *     where that conversation belongs.
 */
export async function syncPinExpiryWarning(
  photo: Pick<Photo, 'id' | 'capturedAt' | 'mapPinUntil' | 'sharedToMap' | 'catNickname'>
): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(idFor(photo.id)).catch(() => undefined);

    const expires = pinExpiresAt(photo);
    if (!expires) return;

    const fireAt = new Date(expires.getTime() - PAW_CONFIG.pinExpiryWarningHours * 3_600_000);
    if (fireAt.getTime() <= Date.now()) return;

    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;

    const who = photo.catNickname ? `${photo.catNickname}'s` : 'Your';

    await Notifications.scheduleNotificationAsync({
      identifier: idFor(photo.id),
      content: {
        title: `${who} pin comes off the map tomorrow`,
        /*
         * Says what will happen and what can be done, and names the price.
         *
         * Not "act now" and not a count of hours remaining. The pin coming down is the ordinary
         * course of events rather than a problem — see the TTL's rationale in
         * `server/src/game/map.ts` — so the warning is an offer, and an offer that hides its
         * price until the player has opened the app is a worse offer.
         */
        body: `Cats move on, so pins expire. Keep this one up for another week for ${PAW_CONFIG.pinExtensionCost} paws.`,
        data: { kind: 'pin-expiry', photoId: photo.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch {
    /*
     * Silent. This is a courtesy about a cosmetic consequence, and every caller is doing
     * something else the player actually asked for — opening a photograph, or buying an
     * extension. Neither should fail because a notification could not be scheduled.
     */
  }
}

/** Drops the warning for a photograph that is gone. Called when one is deleted. */
export async function cancelPinExpiryWarning(photoId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idFor(photoId)).catch(() => undefined);
}
