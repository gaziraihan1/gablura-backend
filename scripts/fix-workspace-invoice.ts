// scripts/fix-invoice-workspace.ts
import { prisma } from '../src/index';

async function fixInvoices() {
  const invoices = await prisma.invoice.findMany({
    where: { workspaceId: null },
    select: { id: true, stripeInvoiceId: true },
  });

  for (const inv of invoices) {
    // Find subscription via stripeInvoiceId lookup in Stripe, or via any subscription
    const sub = await prisma.subscription.findFirst({
      select: { workspaceId: true, stripeCustomerId: true },
    });
    if (!sub) continue;

    await prisma.invoice.update({
      where: { id: inv.id },
      data:  { workspaceId: sub.workspaceId },
    });
    console.log(`Fixed invoice ${inv.id} → workspace ${sub.workspaceId}`);
  }
}

fixInvoices().then(() => process.exit(0));