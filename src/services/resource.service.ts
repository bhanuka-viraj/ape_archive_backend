import { prisma } from "../config/database";
import { ResourceStatus, Prisma, CategoryType } from "@prisma/client";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { categoryService } from "./category.service";
import { Readable } from "stream";

interface GetResourcesQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  status?: ResourceStatus;
}

interface CreateResourceInput {
  title: string;
  description?: string;
  driveFileId: string;
  mimeType: string;
  fileSize: bigint;
  uploaderId: string;
  categories: string[]; // Category slugs or names
  status?: ResourceStatus;
}

export const resourceService = {
  /**
   * Get resources with pagination and filtering
   */
  getResources: async (query: GetResourcesQuery) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ResourceWhereInput = {
      status: query.status || ResourceStatus.APPROVED,
    };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ];
    }

    if (query.category) {
      where.categories = {
        some: {
          slug: query.category,
        },
      };
    }

    const [resources, total] = await Promise.all([
      prisma.resource.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          categories: true,
          uploader: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      }),
      prisma.resource.count({ where }),
    ]);

    return {
      data: resources,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get resource by ID
   */
  getResourceById: async (id: string) => {
    return await prisma.resource.findUnique({
      where: { id },
      include: {
        categories: true,
        uploader: {
          select: {
            id: true,
            name: true,
            role: true,
            email: true,
            imageUrl: true,
          },
        },
      },
    });
  },

  /**
   * Create a new resource
   */
  async createResource(input: CreateResourceInput) {
    try {
      // Get or create categories
      const categoryPromises = input.categories.map(async (catName) => {
        // Try to find by slug first
        let category = await prisma.category.findUnique({
          where: { slug: catName },
        });

        if (!category) {
          // Try to get or create by name
          // Default to TAG type if not specified
          category = await categoryService.getOrCreateCategory(
            catName,
            CategoryType.TAG
          );
        }

        return category;
      });

      const categories = await Promise.all(categoryPromises);

      // Create resource
      const resource = await prisma.resource.create({
        data: {
          title: input.title,
          description: input.description,
          driveFileId: input.driveFileId,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          uploaderId: input.uploaderId,
          status: input.status || ResourceStatus.PENDING,
          categories: {
            connect: categories.map((cat) => ({ id: cat.id })),
          },
        },
        include: {
          categories: true,
          uploader: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

      log.info("Resource created", {
        resourceId: resource.id,
        title: input.title,
      });
      return resource;
    } catch (error) {
      log.error("Error creating resource", error as Error);
      throw new AppError("Failed to create resource", 500);
    }
  },

  /**
   * Update resource status
   */
  async updateResourceStatus(id: string, status: ResourceStatus) {
    try {
      const resource = await prisma.resource.update({
        where: { id },
        data: { status },
        include: {
          categories: true,
          uploader: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

      log.info("Resource status updated", { resourceId: id, status });
      return resource;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new AppError("Resource not found", 404);
      }
      log.error("Error updating resource status", error as Error);
      throw new AppError("Failed to update resource", 500);
    }
  },

  /**
   * Increment view count
   */
  async incrementViewCount(id: string) {
    try {
      return await prisma.resource.update({
        where: { id },
        data: {
          views: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      log.error("Error incrementing view count", error as Error);
      // Don't throw - this is non-critical
    }
  },

  /**
   * Increment download count
   */
  async incrementDownloadCount(id: string) {
    try {
      return await prisma.resource.update({
        where: { id },
        data: {
          downloads: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      log.error("Error incrementing download count", error as Error);
      // Don't throw - this is non-critical
    }
  },
};
