
import { prisma } from "../config/database";

async function main() {
  console.log("Debugging DB for Lesson and Notes...");
  
  const lessonName = "Unit 01 - Inquires the basis of business and the environment in which it perform";
  const typeName = "Notes";

  // 1. Check Tags
  const lessonTag = await prisma.tag.findFirst({
    where: { name: lessonName, group: "LESSON" }
  });
  console.log("Lesson Tag:", lessonTag ? "FOUND" : "NOT FOUND");

  const typeTag = await prisma.tag.findFirst({
    where: { name: typeName, group: "RESOURCE_TYPE" } // Try specific group
  });
  console.log("Type Tag (Notes) in RESOURCE_TYPE:", typeTag ? "FOUND" : "NOT FOUND");

  if (!typeTag) {
      console.log("Searching for ANY tag named 'Notes'...");
      const anyTag = await prisma.tag.findMany({ where: { name: typeName } });
      console.log("Found tags:", anyTag);
  }


  if (!lessonTag || !typeTag) return;

  // 2. Check Resources with BOTH
  const resources = await prisma.resource.findMany({
    where: {
      tags: {
        every: {
           OR: [
             { id: lessonTag.id },
             { id: typeTag.id }
           ]
        } 
      }
      // Wait, 'every' means ALL tags must be in the list? No.
      // We want RESOURCES that have Tag A AND Tag B.
      // AND: [ { tags: { some: { id: A } } }, { tags: { some: { id: B } } } ]
    },
    include: { tags: true }
  });
  
  // Correct Query for AND logic
  const match = await prisma.resource.findMany({
      where: {
          AND: [
              { tags: { some: { id: lessonTag.id } } },
              { tags: { some: { id: typeTag.id } } }
          ]
      },
      include: { tags: true }
  });

  console.log(`Resources with BOTH tags: ${match.length}`);
  if (match.length > 0) {
      console.log("First match:", match[0].title);
      console.log("Tags:", match[0].tags.map(t => `${t.group}:${t.name}`).join(", "));
  } else {
      // 3. Debug Partial
      const lessonRes = await prisma.resource.count({
          where: { tags: { some: { id: lessonTag.id } } }
      });
      console.log(`Resources with Lesson only: ${lessonRes}`);
      
      const typeRes = await prisma.resource.count({
          where: { tags: { some: { id: typeTag.id } } }
      });
      console.log(`Resources with Notes only: ${typeRes}`);
  }
}

main();
