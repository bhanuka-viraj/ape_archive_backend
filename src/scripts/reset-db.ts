
import { PrismaClient } from "@prisma/client";
import { log } from "../utils/logger";

const prisma = new PrismaClient();

async function reset() {
  try {
    log.warn("⚠️  Starting Database Reset (Resources & Tags)...");

    // 1. Delete Resources
    // This removes all files indexed from Drive
    const deletedResources = await prisma.resource.deleteMany({});
    log.info(`✅ Deleted ${deletedResources.count} resources`);

    // 2. Delete Tags
    // This removes the hierarchy structure (Stream, Subject, Grade, etc.)
    // Note: This will also remove tags from any existing Forum Questions or User Profiles
    const deletedTags = await prisma.tag.deleteMany({});
    log.info(`✅ Deleted ${deletedTags.count} tags`);

    log.info("✨ Database Reset Complete. You can now run 'bun sync:drive' to rebuild.");
  } catch (error) {
    log.error("Reset failed", error as Error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  reset();
}
