import { prisma } from "../config/database";
import { CategoryType, Category } from "@prisma/client";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";

export const categoryService = {
  /**
   * Get all categories
   */
  getAllCategories: async () => {
    return await prisma.category.findMany({
      orderBy: {
        name: "asc",
      },
    });
  },

  /**
   * Get category by slug
   */
  getCategoryBySlug: async (slug: string) => {
    return await prisma.category.findUnique({
      where: { slug },
    });
  },

  /**
   * Get or create a category by name and type
   * Used during resource uploads to ensure categories exist
   */
  async getOrCreateCategory(
    name: string,
    type: CategoryType
  ): Promise<Category> {
    if (!name || name.trim().length === 0) {
      throw new AppError(`Category name cannot be empty`, 400);
    }

    const slug = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "");

    try {
      // Try to find existing category
      let category = await prisma.category.findUnique({
        where: { slug },
      });

      if (category) {
        // Verify it matches the type
        if (category.type !== type) {
          log.warn("Category exists with different type", {
            name,
            requestedType: type,
            existingType: category.type,
          });
        }
        return category;
      }

      // Create new category
      category = await prisma.category.create({
        data: {
          name: name.trim(),
          slug,
          type,
        },
      });

      log.info("Category created", { name, slug, type });
      return category;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Unique constraint")
      ) {
        log.debug("Category slug collision, fetching existing");
        return await prisma.category.findUniqueOrThrow({
          where: { slug },
        });
      }
      log.error("Error creating category", error as Error);
      throw new AppError("Failed to create category", 500);
    }
  },

  /**
   * Get categories by type
   */
  async getCategoriesByType(type: CategoryType) {
    try {
      return await prisma.category.findMany({
        where: { type },
        orderBy: { name: "asc" },
      });
    } catch (error) {
      log.error("Error fetching categories", error as Error);
      throw new AppError("Failed to fetch categories", 500);
    }
  },

  /**
   * Get all categories grouped by type
   */
  async getAllCategoriesGrouped() {
    try {
      const categories = await prisma.category.findMany({
        orderBy: [{ type: "asc" }, { name: "asc" }],
      });

      const grouped: Record<CategoryType, Category[]> = {
        SUBJECT: [],
        GRADE: [],
        LESSON: [],
        MEDIUM: [],
        RESOURCE_TYPE: [],
        TAG: [],
      };

      categories.forEach((cat) => {
        grouped[cat.type].push(cat);
      });

      return grouped;
    } catch (error) {
      log.error("Error fetching grouped categories", error as Error);
      throw new AppError("Failed to fetch categories", 500);
    }
  },
};
