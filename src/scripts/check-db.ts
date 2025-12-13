
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("🔍 Checking Recent Migrations...");
    const resources = await prisma.resource.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
            tags: {
                include: { parent: true }
            }
        }
    });

    for (const r of resources) {
        console.log(`\n📄 Resource: ${r.title} (ID: ${r.originalDriveId})`);
        console.log(`   Source: ${r.source}, Status: ${r.status}`);
        console.log(`   Tags:`);
        r.tags.forEach(t => {
            console.log(`     - [${t.group}] ${t.name} (Parent: ${t.parent?.name || 'ROOT'})`);
        });
    }

    // Also check for orphaned subjects
    console.log("\n🔍 Checking for Potential Orphaned Subjects (Unit vs Subject)...");
    const oddTags = await prisma.tag.findMany({
        where: { name: { contains: "Unit" }, group: "SUBJECT" },
        take: 5,
        include: { parent: true }
    });
    oddTags.forEach(t => {
        console.log(`   ⚠️  Found SUBJECT Tag: "${t.name}" -> Parent: "${t.parent?.name}" (Expected: proper subject, Found: Grade?)`);
    });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
