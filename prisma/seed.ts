import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding plans...');

  await prisma.plan.createMany({
    data: [
      {
        name:                'FREE',
        displayName:         'Free',
        maxWorkspacesOwned:  1,
        maxMembersPerWs:     5,
        maxStorageMb:        1024,
        maxFileSizeMb:       5,
        maxMeetingsPerMo:    10,
        maxProjects:         3,
        analyticsAccess:     false,
        businessOnlyAccess:  false,
        prioritySupport:     false,
        apiAccess:           false,
        monthlyPriceCents:   0,
        yearlyPriceCents:    0,
        sortOrder:           0,
      },
      {
        name:                 'PRO',
        displayName:          'Pro',
        maxWorkspacesOwned:   3,
        maxMembersPerWs:      25,
        maxStorageMb:         10240,
        maxFileSizeMb:        25,
        maxMeetingsPerMo:     -1,
        maxProjects:          -1,
        analyticsAccess:      true,
        businessOnlyAccess:   false,
        prioritySupport:      false,
        apiAccess:            false,
        stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
        stripePriceIdYearly:  process.env.STRIPE_PRICE_PRO_YEARLY,
        monthlyPriceCents:    1200,
        yearlyPriceCents:     12000,
        sortOrder:            1,
      },
      {
        name:                 'BUSINESS',
        displayName:          'Business',
        maxWorkspacesOwned:   -1,
        maxMembersPerWs:      -1,
        maxStorageMb:         102400,
        maxFileSizeMb:        100,
        maxMeetingsPerMo:     -1,
        maxProjects:          -1,
        analyticsAccess:      true,
        businessOnlyAccess:   true,
        prioritySupport:      true,
        apiAccess:            true,
        stripePriceIdMonthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
        stripePriceIdYearly:  process.env.STRIPE_PRICE_BUSINESS_YEARLY,
        monthlyPriceCents:    4900,
        yearlyPriceCents:     48000,
        sortOrder:            2,
      },
    ],
    skipDuplicates: true,
  });

  // Self-heal: correct the PRO per-file limit on already-seeded databases
  // (was seeded as 50 MB; the enforced quota and marketing are 25 MB).
  await prisma.plan.updateMany({
    where: { name: 'PRO', maxFileSizeMb: 50 },
    data: { maxFileSizeMb: 25 },
  });

  console.log('✅ Plans seeded');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });