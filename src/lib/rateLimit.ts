import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis.js";

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
});