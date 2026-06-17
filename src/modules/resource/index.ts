export { validate } from "./resource.validation.js";
export {
  createPopularResourceSchema,
  updatePopularResourceSchema,
  popularResourceListQuerySchema,
  createProductUpdateSchema,
  updateProductUpdateSchema,
  productUpdateListQuerySchema,
  resourceSlugParamSchema,
} from "./resource.validation.js";
export * as resourceController from "./resource.controller.js";
export { default as adminResourceRouter } from "./adminResource.routes.js";
export { default as publicResourceRouter } from "./publicResource.routes.js";
