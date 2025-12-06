import { prisma } from "../config/database";
import { ResourceStatus, Prisma } from "@prisma/client";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { convertBigIntsToStrings } from "../utils/bigint-handler";
import { Readable } from "stream";

interface GetResourcesQuery {
  page?: number;
  limit?: number;
  search?: string;
  tagId?: string;
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

    if (query.tagId) {
      where.tags = {
        some: {
          id: query.tagId,
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
          tags: true,
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
      data: convertBigIntsToStrings(resources),
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
    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        tags: true,
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
    return convertBigIntsToStrings(resource);
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
          tags: true,
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
      return convertBigIntsToStrings(resource);
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

  /**
   * Create a resource with tags (for admin upload)
   */
  async createResource(input: {
    title: string;
    description: string;
    driveFileId: string;
    mimeType: string;
    fileSize: bigint;
    status: ResourceStatus;
    uploaderId: string;
    tagIds: string[];
    source?: "SYSTEM" | "USER";
    storageNodeId?: number;
  }) {
    try {
      const resource = await prisma.resource.create({
        data: {
          title: input.title,
          description: input.description,
          driveFileId: input.driveFileId,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          status: input.status,
          source: input.source || "USER",
          uploaderId: input.uploaderId,
          storageNodeId: input.storageNodeId,
          tags: {
            connect: input.tagIds.map((id) => ({ id })),
          },
        },
        include: {
          tags: true,
          uploader: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return convertBigIntsToStrings(resource);
    } catch (error) {
      log.error("Error creating resource", error as Error);
      throw new AppError("Failed to create resource", 500);
    }
  },
};
