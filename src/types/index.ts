export interface JobOptions {
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  delay?: number;
  priority?: number;
  timeout?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  options: JobOptions;
  timestamp: number;
  status: JobStatus;
  returnValue?: any;
  failedReason?: string;
  stackTrace?: string[];
  attemptsMade: number;
}

export interface QueueOptions {
  connection?: {
    host?: string;
    port?: number;
    password?: string;
  };
  prefix?: string;
  defaultJobOptions?: JobOptions;
}

export interface WorkerOptions {
  concurrency?: number;
  maxJobsPerWorker?: number;
}
