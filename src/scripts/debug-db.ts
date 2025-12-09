
import { libraryService } from "../services/library.service";
import { prisma } from "../config/database";

async function main() {
  console.log("--- Testing Library Browse with Levels ---");

  // 1. Root Level
  console.log("\n1. Browsing Root:");
  const root = await libraryService.browse({});
  console.log("Root Next Level:", root.nextLevel);
  console.log("Root Folders:", root.folders);

  // 2. A/L Level
  console.log("\n2. Browsing A/L Subjects:");
  const al = await libraryService.browse({ level: "A/L Subjects" });
  console.log("A/L Next Level:", al.nextLevel);
  console.log("A/L Folders:", al.folders);
  
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
