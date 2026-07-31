import { PrismaClient } from '@prisma/client';

import { COMMUNITY } from '../game/rules';

/**
 * Editorial curation — the cold-start lever.
 *
 * A brand-new app has no organic voting volume, so the community layer has nothing to
 * work with: photos get no views, so no votes, so no standing, so no reason to keep
 * shooting. A light curation pass breaks that loop by putting genuinely good submissions
 * in front of people until there is enough traffic to be self-sustaining.
 *
 * This is deliberately a script and not an endpoint. Featuring is a human judgement made
 * a handful of times a week, and an HTTP surface for it would be one more thing to
 * authorise, rate-limit and audit for no benefit.
 *
 * A featured photo keeps its feed placement for COMMUNITY.featuredBoostDays and then
 * falls back into the normal ordering. It is exposure, not a score — the boost cannot
 * change anyone's community score directly, only their chance of being seen.
 *
 *   npx tsx src/db/../scripts/feature-photo.ts list
 *   npx tsx src/scripts/feature-photo.ts feature <photoId>
 *   npx tsx src/scripts/feature-photo.ts unfeature <photoId>
 */

const prisma = new PrismaClient();

async function listCandidates(): Promise<void> {
  // Shared photos nobody has seen much of yet — the ones curation actually helps.
  const candidates = await prisma.photo.findMany({
    where: { sharedToFeed: true, featured: false },
    orderBy: [{ viewCount: 'asc' }, { total: 'desc' }],
    take: 20,
    select: {
      id: true,
      total: true,
      tier: true,
      badges: true,
      viewCount: true,
      voteCount: true,
      caption: true,
      owner: { select: { username: true } },
      cat: { select: { defaultNickname: true } },
    },
  });

  if (candidates.length === 0) {
    console.log('No shared photos to feature yet.');
    return;
  }

  console.log(`${candidates.length} candidates (least-seen first):\n`);
  for (const photo of candidates) {
    console.log(
      `  ${photo.id}\n` +
        `    ${photo.cat.defaultNickname} by ${photo.owner.username} — ` +
        `${photo.tier} ${photo.total}, ${photo.viewCount} views, ${photo.voteCount} votes\n` +
        `    ${photo.badges.join(', ') || 'no badges'}` +
        (photo.caption ? `\n    "${photo.caption}"` : '')
    );
  }
}

async function setFeatured(photoId: string, featured: boolean): Promise<void> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { id: true, sharedToFeed: true, owner: { select: { username: true } } },
  });

  if (!photo) {
    console.error(`No photo with id ${photoId}.`);
    process.exitCode = 1;
    return;
  }

  // Featuring an unshared photo would publish something its owner chose to keep
  // private. That is not a curation call anyone gets to make on their behalf.
  if (featured && !photo.sharedToFeed) {
    console.error(
      'That photo is not shared to the feed. Featuring it would publish a private photo.'
    );
    process.exitCode = 1;
    return;
  }

  await prisma.photo.update({
    where: { id: photoId },
    data: { featured, featuredAt: featured ? new Date() : null },
  });

  console.log(
    featured
      ? `Featured ${photoId} by ${photo.owner.username} for ${COMMUNITY.featuredBoostDays} days.`
      : `Removed the feature flag from ${photoId}.`
  );
}

async function main(): Promise<void> {
  const [command, photoId] = process.argv.slice(2);

  switch (command) {
    case 'list':
      await listCandidates();
      break;
    case 'feature':
    case 'unfeature':
      if (!photoId) {
        console.error(`Usage: ${command} <photoId>`);
        process.exitCode = 1;
        return;
      }
      await setFeatured(photoId, command === 'feature');
      break;
    default:
      console.log(
        'Usage:\n' +
          '  list                 show shared photos worth featuring, least-seen first\n' +
          '  feature <photoId>    put a photo at the top of the feed for a few days\n' +
          '  unfeature <photoId>  remove the boost'
      );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
