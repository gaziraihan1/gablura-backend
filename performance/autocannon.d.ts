declare module 'autocannon' {
  export interface Options {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    connections?: number;
    amount?: number;
    duration?: number;
    pipelining?: number;
    timeout?: number;
    connectionRate?: number;
    maxConnectionRequests?: number;
    maxOverallRequests?: number;
    requests?: any[];
  }

  export interface Result {
    duration: number;
    requests: {
      total: number;
      mean: number;
      min: number;
      max: number;
      p50: number;
      p95: number;
      p99: number;
    };
    throughput: {
      mean: number;
      min: number;
      max: number;
    };
    latency: {
      mean: number;
      min: number;
      max: number;
      p50: number;
      p95: number;
      p99: number;
    };
    errors: number;
    non2xx: Record<number, number>;
  }

  export function run(options: Options, callback?: (err: Error, result: Result) => void): Promise<Result>;
  export default function autocannon(options: Options, callback?: (err: Error, result: Result) => void): Promise<Result>;
}
