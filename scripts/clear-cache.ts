import { prisma } from '../src/lib/prisma.js';
import { WorkspaceCache } from '../src/lib/redis/cache.client.js';
import { BILLING_CACHE } from '../src/redis/redis.client.js';

async function clearWorkspaceCache(workspaceId: string) {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, slug: true, ownerId: true }
    });

    if (!workspace) {
      console.log('❌ Workspace not found');
      return;
    }

    console.log(`🧹 Clearing cache for workspace: ${workspace.id} (${workspace.slug})`);
    
    // Clear workspace cache
    await WorkspaceCache.invalidateWorkspace(workspace.id, workspace.slug);
    console.log('✅ Workspace cache cleared');
    
    // Clear billing cache
    await BILLING_CACHE.invalidateWorkspace(workspace.id, workspace.ownerId);
    console.log('✅ Billing cache cleared');
    
    console.log('🎉 All cache cleared successfully for workspace:', workspace.slug);
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

// Get workspace ID from command line
const workspaceId = process.argv[2];
if (!workspaceId) {
  console.log('Usage: npx tsx scripts/clear-cache.ts <workspaceId>');
  console.log('Example: npx tsx scripts/clear-cache.ts cm1234567890abcdef');
  process.exit(1);
}

clearWorkspaceCache(workspaceId).catch(console.error);
