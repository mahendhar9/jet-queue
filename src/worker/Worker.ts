import IORedis from 'ioredis';
import { EventEmitter } from 'eventemitter3';
import { RedisConnection } from '../utils/redis.js';
import { WorkerError } from '../errors/index.js';
import { calculateBackoff } from '../utils/backoff.js';
import { moveToActive, processDelayed } from '../utils/scripts.js';
import type { Job, QueueOptions, WorkerOptions, ProcessCallbackFunction } from '../types/index.js';

export class Worker<T = any> extends EventEmitter {
  private readonly name: string;
  private readonly prefix: string;
  private client!: IORedis;
  // Indicates if the worker is actively processing jobs.
  private isRunning: boolean = false;
  // The function that processes each job.
  private processFn?: ProcessCallbackFunction<T>;
  private readonly concurrency: number;
  private readonly maxJobsPerWorker: number;

  constructor(name: string, options: QueueOptions = {}, workerOptions: WorkerOptions = {}) {
    super();
    this.name = name;
    this.prefix = options.prefix || 'jet';
    this.concurrency = workerOptions.concurrency || 1;
    this.maxJobsPerWorker = workerOptions.maxJobsPerWorker || Infinity;

    this.initialize(options).catch((err) => {
      this.emit('error', err);
    });
  }

  private async initialize(options: QueueOptions): Promise<void> {
    try {
      this.client = await RedisConnection.createClient(options);

      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
      throw new WorkerError('Failed to initialize worker');
    }
  }

  private getQueueKey(type: string): string {
    return `${this.prefix}:${this.name}:${type}`;
  }

  async process(processFn: ProcessCallbackFunction<T>): Promise<void> {
    if (this.processFn) {
      throw new WorkerError('Cannot set multiple process functions');
    }

    this.processFn = processFn;
    this.isRunning = true;

    //Start processing jobs
    this.processJobs().catch((err) => this.emit('error', err));

    //Start delayed jobs processor
    this.processDelayedJobs().catch((err) => this.emit('error', err));
  }

  private async processJobs(): Promise<void> {
    const activeJobs: Set<Promise<void>> = new Set();
    let processedJobsCount = 0;

    while (this.isRunning && processedJobsCount < this.maxJobsPerWorker) {
      try {
        //Maintain the concurrency limit
        while (activeJobs.size >= this.concurrency) {
          await Promise.race(activeJobs);
        }

        const jobId = await this.getNextJob();
        if (!jobId) {
          await this.delay(100);
          continue;
        }

        processedJobsCount++;
        const jobPromise = this.processJob(jobId).catch((err) => {
          this.emit('error', err);
        });

        activeJobs.add(jobPromise.finally(() => activeJobs.delete(jobPromise)));
      } catch (error) {
        this.emit('error', error);
        await this.delay(100);
      }
    }

    // Wait for all active jobs to finish before exiting
    await Promise.all(activeJobs);
    if (processedJobsCount >= this.maxJobsPerWorker) {
      this.emit('completed', `Processed maximum number of jobs: ${this.maxJobsPerWorker}`);
      await this.close();
    }
  }

  private async getNextJob(): Promise<string | null> {
    if (!this.processFn) return null;

    const startedAt = Date.now().toString();
    const jobId = await (this.client as any).moveToActive(
      [this.getQueueKey('waiting'), this.getQueueKey('active'), this.getQueueKey('job')],
      [startedAt]
    );
    return jobId || null;
  }

  private async processJob(jobId: string): Promise<void> {
    if (!this.processFn) return;

    const jobKey = this.getQueueKey(`job:${jobId}`);

    try {
      const jobData = await this.client.hget(jobKey, 'data');
      if (!jobData) {
        return;
      }

      const job: Job<T> = JSON.parse(jobData);
      job.status = 'active';
      this.emit('processing', job);
      const result = await this.withTimeout(this.processFn(job), job.options.timeout || 0);

      // Job completed successfully
      await this.completeJob(job, result);
    } catch (error) {
      await this.failJob(jobId, error as Error);
    }
  }

  private async completeJob(job: Job<T>, result: any): Promise<void> {
    const jobKey = this.getQueueKey(`job:${job.id}`);

    job.status = 'completed';
    job.returnValue = result;

    const multi = this.client.multi();
    multi.lrem(this.getQueueKey('active'), 0, job.id);

    if (job.options.removeOnComplete) {
      multi.del(jobKey);
    } else {
      multi.hset(jobKey, 'data', JSON.stringify(job));
    }

    await multi.exec();
  }

  private async failJob(jobId: string, error: Error): Promise<void> {
    const jobKey = this.getQueueKey(`job:${jobId}`);
    const jobData = await this.client.hget(jobKey, 'data');

    if (!jobData) return;

    const job: Job<T> = JSON.parse(jobData);
    job.attemptsMade = (job.attemptsMade || 0) + 1;
    job.failedReason = error.message;
    job.stackTrace = job.stackTrace || [];
    job.stackTrace.push(error.stack || error.message);

    const shouldRetry = job.attemptsMade < (job.options.attempts || 1);

    if (shouldRetry) {
      const backoffDelay = calculateBackoff(job.attemptsMade, job.options);
      job.status = 'delayed';

      const multi = this.client.multi();
      multi.zadd(this.getQueueKey('delayed'), Date.now() + backoffDelay, job.id);
      multi.hset(jobKey, 'data', JSON.stringify(job));
      multi.lrem(this.getQueueKey('active'), 0, job.id);

      await multi.exec();
      this.emit('failed', job, error);
      this.emit('retrying', job);
    } else {
      job.status = 'failed';

      const multi = this.client.multi();

      multi.lrem(this.getQueueKey('active'), 0, job.id);

      if (job.options.removeOnFail) {
        multi.del(jobKey);
      } else {
        multi.hset(jobKey, 'data', JSON.stringify(job));
      }

      await multi.exec();
      this.emit('failed', job, error);
    }
  }

  private async processDelayedJobs(): Promise<void> {
    let processedJobsCount = 0;
    while (this.isRunning && processedJobsCount < this.maxJobsPerWorker) {
      try {
        const startedAt = Date.now().toString();
        const processedJobs = await (this.client as any).processDelayed(
          [this.getQueueKey('delayed'), this.getQueueKey('waiting')],
          [startedAt]
        );

        if (processedJobs && Array.isArray(processedJobs)) {
          processedJobsCount += processedJobs.length;
        }
        await this.delay(1000);
      } catch (error) {
        this.emit('error', error);
        await this.delay(1000);
      }
    }

    if (processedJobsCount >= this.maxJobsPerWorker) {
      this.emit('completed', `Processed maximum delayed jobs: ${this.maxJobsPerWorker}`);
      await this.close();
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    if (timeout <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Job timeout')), timeout);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async pause(): Promise<void> {
    this.isRunning = false;
    this.emit('paused');
  }

  async resume(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.emit('resumed');
    // Restart processing loops
    this.processJobs().catch((err) => this.emit('error', err));
    this.processDelayedJobs().catch((err) => this.emit('error', err));
  }

  async close(): Promise<void> {
    this.isRunning = false;
    this.emit('closed');

    await this.delay(100);
    // Close the Redis connection
    if (this.client) {
      await this.client.quit();
    }
  }
}
