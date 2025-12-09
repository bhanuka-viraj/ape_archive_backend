
import { PrismaClient } from "@prisma/client";
import { log } from "../utils/logger";

const prisma = new PrismaClient();

async function checkTags() {
  const tags = await prisma.tag.findMany({
    orderBy: { group: 'asc' }
  });

  const grouped: Record<string, string[]> = {};

  for (const tag of tags) {
    const group = tag.group || "NO_GROUP";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(tag.name);
  }

  console.log("\n📊 --- TAG AUDIT REPORT --- 📊\n");

  for (const [group, names] of Object.entries(grouped)) {
    console.log(`\n📂 GROUP: ${group} (${names.length} tags)`);
    console.log("----------------------------------------");
    // Show first 20 as sample
    console.log(names.slice(0, 20).join(", "));
    if (names.length > 20) console.log(`... and ${names.length - 20} more`);
  }
  
  console.log("\n----------------------------------------");
  console.log(`\n✅ Total Tags: ${tags.length}`);
}

if (import.meta.main) {
  checkTags()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
}
