import { ResourceStatus } from "@prisma/client";

export { ResourceStatus };

// ─── Popular Resource ───────────────────────────────────────────────────────

export interface PopularResourceDTO {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string;
  category: string;
  status: ResourceStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePopularResourceInput {
  title: string;
  description: string;
  image: string;
  category: string;
  status?: ResourceStatus;
}

export type UpdatePopularResourceInput = Partial<CreatePopularResourceInput>;

export interface PopularResourceListFilters {
  status?: ResourceStatus;
  category?: string;
  page: number;
  limit: number;
}

// ─── Product Update ─────────────────────────────────────────────────────────

export interface ProductUpdateDTO {
  id: string;
  slug: string;
  title: string;
  date: Date;
  description: string;
  version: string;
  status: ResourceStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductUpdateInput {
  title: string;
  date: Date;
  description: string;
  version: string;
  status?: ResourceStatus;
}

export type UpdateProductUpdateInput = Partial<CreateProductUpdateInput>;

export interface ProductUpdateListFilters {
  status?: ResourceStatus;
  page: number;
  limit: number;
}

// ─── Shared ──────────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}