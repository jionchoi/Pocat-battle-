import { PrismaClient } from '@prisma/client';

import { CHALLENGE_CONFIG } from '../game/rules';
import { CHALLENGE_PROMPTS } from '../services/challengeService';

/**
 * Seed data.
 *
 * Far less is required than the battle-based build needed: there are no abilities to
 * roll against and no towers to stand next to, so a fresh database can score a photo
 * immediately. What the seed does provide is an open challenge, because the Challenges
 * tab is empty and unexplainable without one — the rotation job would create one within
 * ten minutes, but a developer opening the app for the first time should not have to
 * wait for a cron tick to see the screen work.
 *
 * Run with: npm run db:seed
 */

const prisma = new PrismaClient();

async function seedChallenges(): Promise<{ created: number; existing: number }> {
  const now = new Date();

  const active = await prisma.challenge.count({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
  });

  if (active > 0) return { created: 0, existing: active };

  const prompt = CHALLENGE_PROMPTS[0];
  const endsAt = new Date(
    now.getTime() + CHALLENGE_CONFIG.durationDays * 24 * 3600 * 1000
  );

  await prisma.challenge.create({
    data: {
      slug: `${prompt.slug}-${now.toISOString().slice(0, 10)}`,
      title: prompt.title,
      prompt: prompt.prompt,
      judging: prompt.judging,
      startsAt: now,
      endsAt,
    },
  });

  return { created: 1, existing: 0 };
}

/**
 * A handful of sightings around a chosen centre, so the map is not an empty grid on a
 * fresh install. Defaults to central London; override with SEED_LAT / SEED_LNG to match
 * whatever your simulator is set to.
 */
const CENTER_LAT = Number(process.env.SEED_LAT ?? 51.5074);
const CENTER_LNG = Number(process.env.SEED_LNG ?? -0.1278);

const SIGHTING_OFFSETS: { lat: number; lng: number }[] = [
  { lat: 0.0012, lng: 0.0008 },
  { lat: -0.0009, lng: 0.0015 },
  { lat: 0.0021, lng: -0.0011 },
  { lat: -0.0018, lng: -0.0007 },
  { lat: 0.0004, lng: 0.0026 },
];

async function seedSightings(): Promise<number> {
  // Sightings belong to a reporter, so this only runs once at least one account exists.
  // On a truly fresh database there is nobody to attribute them to, and inventing a
  // fake user would put a row in the leaderboard that no one can explain.
  const reporter = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!reporter) return 0;

  const existing = await prisma.catSighting.count({
    where: { reportedByUserId: reporter.id },
  });
  if (existing > 0) return 0;

  const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

  await prisma.catSighting.createMany({
    data: SIGHTING_OFFSETS.map((offset) => ({
      reportedByUserId: reporter.id,
      lat: CENTER_LAT + offset.lat,
      lng: CENTER_LNG + offset.lng,
      photoUrl: '',
      verified: false,
      expiresAt,
    })),
  });

  return SIGHTING_OFFSETS.length;
}

async function main() {
  const challenges = await seedChallenges();
  const sightings = await seedSightings();

  console.log(
    `Seed complete. ${challenges.created} challenge created ` +
      `(${challenges.existing} already active), ${sightings} sightings created.`
  );

  if (sightings > 0) {
    console.log(
      `Sightings are around ${CENTER_LAT}, ${CENTER_LNG} — set your simulator to that ` +
        `location, or re-run with SEED_LAT and SEED_LNG set.`
    );
  } else {
    console.log(
      'No sightings seeded — sign up an account first, then re-run to populate the map.'
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
