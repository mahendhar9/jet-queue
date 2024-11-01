import IORedis from 'ioredis';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { RedisConnection } from '../utils/redis.js';
import { QueueError, JobError } from '../errors/index.js';
import type { Job, JobOptions, QueueOptions } from '../types/index.js';

export class Queue<T = any> extends EventEmitter {
  private readonly name: string;
  private readonly prefix: string;
  private readonly defaultJobOptions: JobOptions;
  private client!: IORedis;
  private isReady: boolean = false;

  constructor(name: string, options: QueueOptions = {}) {
    super();
    this.name = name;
    this.prefix = options.prefix || 'jet';
    this.defaultJobOptions = options.defaultJobOptions || {};

    this.initialize(options).catch((err) => {
      this.emit('error', err);
    });
  }

  private async initialize(options: QueueOptions): Promise<void> {
    try {
      this.client = await RedisConnection.createClient(options);
      this.isReady = true;
      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
      throw new QueueError('Failed to initialize queue');
    }
  }

  private getQueueKey(type: string): string {
    return `${this.prefix}:${this.name}:${type}`;
  }

  async add(name: string, data: T, options: JobOptions = {}): Promise<Job<T>> {
    if (!this.isReady) {
      throw new QueueError('Queue is not ready');
    }

    const job: Job<T> = {
      id: uuidv4(),
      name,
      data,
      options: { ...this.defaultJobOptions, ...options },
      createdAt: Date.now(),
      status: options.delay ? 'delayed' : 'waiting',
      attemptsMade: 0,
    };

    const multi = this.client.multi();

    // Store job data
    multi.hset(this.getQueueKey(`job:${job.id}`), 'data', JSON.stringify(job));

    if (job.status === 'delayed') {
      const processAt = Date.now() + (options.delay || 0);
      multi.zadd(this.getQueueKey('delayed'), processAt, job.id);
    } else {
      multi.lpush(this.getQueueKey('waiting'), job.id);
    }

    await multi.exec();
    this.emit('added', job);
    return job;
  }

  async getJob(jobId: string): Promise<Job<T> | null> {
    const jobData = await this.client.hget(this.getQueueKey(`job:${jobId}`), 'data');

    if (!jobData) {
      throw new JobError(`Job with id ${jobId} not found`);
    }

    return JSON.parse(jobData);
  }

  async removeJob(jobId: string): Promise<void> {
    const exists = await this.getJob(jobId);
    if (!exists) {
      return;
    }
    const multi = this.client.multi();

    //Remove from all possible states
    multi.lrem(this.getQueueKey('waiting'), 0, jobId);
    multi.lrem(this.getQueueKey('active'), 0, jobId);
    multi.zrem(this.getQueueKey('delayed'), jobId);
    multi.del(this.getQueueKey(`job:${jobId}`));

    await multi.exec();
    this.emit('removed', jobId);
  }

  async pause(): Promise<void> {
    await this.client.set(this.getQueueKey('paused'), '1');
    this.emit('paused');
  }

  async resume(): Promise<void> {
    await this.client.del(this.getQueueKey('paused'));
    this.emit('resumed');
  }

  async isPaused(): Promise<boolean> {
    return Boolean(await this.client.get(this.getQueueKey('paused')));
  }

  async close(): Promise<void> {
    if (this.isReady) {
      this.isReady = false;
      this.emit('closed');
    }
  }

  // Method to get queue length
  async count(): Promise<number> {
    const multi = this.client.multi();
    multi.llen(this.getQueueKey('waiting'));
    multi.llen(this.getQueueKey('active'));
    multi.zcard(this.getQueueKey('delayed'));

    const [waiting, active, delayed] = (await multi.exec()) as [null | Error, number][];
    return (waiting?.[1] || 0) + (active?.[1] || 0) + (delayed?.[1] || 0);
  }
}
