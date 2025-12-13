
import { PrismaClient } from "@prisma/client";
import { log } from "../utils/logger";

const prisma = new PrismaClient();

// --- 1. Facets (Attributes) ---
// Flattened metadata tags (Parent = NULL)
const ATTRIBUTES = {
  MEDIUM: ["Sinhala Medium", "Tamil Medium", "English Medium"],
  RESOURCE_TYPE: [
    "Past Paper",
    "Marking Scheme",
    "Teachers Guide",
    "Short Note",
    "Syllabus",
    "Textbook",
    "Model Paper"
  ],
  EXAM: ["Term 1", "Term 2", "Term 3", "Final Exam"],
  YEAR: ["2023", "2024", "2025", "2026", "2022", "2021", "2020"]
};

// --- 2. Hierarchy Skeleton (Navigation) ---
// Defines the strictly enforced Folder Tree
const HIERARCHY_SKELETON = [
    // A. Advanced Level (Grade-First: Level > Grade > Stream)
    {
        name: "A/L", // Top Level (Folder Name match)
        alias: ["A/L Subjects", "Advanced Level"],
        children: [
            {
                name: "Grade 12",
                children: [
                    { name: "Science Stream" },
                    { name: "Maths Stream" }, // Sometimes mapped to Science/Combined Logic
                    { name: "Arts Stream" },
                    { name: "Commerce Stream" },
                    { name: "Technology Stream" },
                    { name: "Common Stream" } // English, GIT
                ]
            },
            {
                name: "Grade 13",
                children: [
                    { name: "Science Stream" },
                    { name: "Maths Stream" }, 
                    { name: "Arts Stream" },
                    { name: "Commerce Stream" },
                    { name: "Technology Stream" },
                    { name: "Common Stream" }
                ]
            }
        ]
    },
    // B. Ordinary Level (Level > Grade)
    {
        name: "O/L",
        alias: ["O/L Subjects", "Ordinary Level"],
        children: [
            { name: "Grade 10" },
            { name: "Grade 11" }
        ]
    },
    // C. Secondary (Level > Grade)
    {
        name: "Secondary",
        alias: ["6 - 9 Class Subjects", "Secondary Level"],
        children: [
            { name: "Grade 6" },
            { name: "Grade 7" },
            { name: "Grade 8" },
            { name: "Grade 9" }
        ]
    },
    // D. Primary (Level > Grade)
    {
        name: "Primary",
        alias: ["Primary Class Subjects", "Primary Level"],
        children: [
            { name: "Grade 1" },
            { name: "Grade 2" },
            { name: "Grade 3" },
            { name: "Grade 4" },
            { name: "Grade 5" } // Scholarship usually here or separate
        ]
    },
    // E. Scholarship (Special Level > Grade is implicit or Single)
    {
        name: "Scholarship",
        alias: ["Grade 5 Scholarship"],
        children: [
           { name: "Grade 5" }
        ]
    },
    // F. Custom Roots (Flexible)
    { name: "IELTS", children: [] },
    { name: "Korean", children: [] },
    { name: "English", children: [] } // General English
];

async function ensureTag(name: string, group: string, parentId: string | null, source: "SYSTEM" | "USER" = "SYSTEM") {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    
    // Check Existence
    let tag = await prisma.tag.findFirst({
        where: { 
            name: { equals: name, mode: "insensitive" },
            parentId: parentId // Hierarchy Aware Check
        }
    });

    if (!tag) {
        tag = await prisma.tag.create({
            data: {
                name,
                slug,
                group,
                parentId,
                source
            }
        });
        log.info(`   + Created: ${name} (Group: ${group}) under ${parentId ? "Parent" : "ROOT"}`);
    } else {
        // Allow updating source to SYSTEM if it was USER? No, keep safe.
    }
    return tag;
}

async function seedHierarchy(node: any, parentId: string | null = null, group: string = "LEVEL") {
    // Determine Group based on Depth/Context
    // Level -> Grade -> Stream -> Subject
    // Simple heuristic: If parent is NULL -> LEVEL.
    // If name starts with Grade -> GRADE.
    // If name ends with Stream -> STREAM.
    
    let currentGroup = group;
    if (!parentId) currentGroup = "LEVEL";
    else if (/^Grade \d+/.test(node.name)) currentGroup = "GRADE";
    else if (/Stream$/i.test(node.name)) currentGroup = "STREAM";
    
    const tag = await ensureTag(node.name, currentGroup, parentId);
    
    if (node.children) {
        for (const child of node.children) {
            await seedHierarchy(child, tag.id, "UNKNOWN"); // Group will be resolved inside
        }
    }
}

async function main() {
  log.info("🌱 Seeding Database Skeleton...");

  // 1. Seed Attributes (Facets)
  log.info("🔹 Seeding Attributes...");
  for (const [group, names] of Object.entries(ATTRIBUTES)) {
    for (const name of names) {
      await ensureTag(name, group, null);
    }
  }

  // 2. Seed Hierarchy (Navigation Tree)
  log.info("🔹 Seeding Hierarchy...");
  for (const root of HIERARCHY_SKELETON) {
      await seedHierarchy(root);
  }

  log.info("✅ Seeding Complete. Structure is ready for Migration.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
