import IORedis from 'ioredis';
import { QueueError } from '../errors/index.js';
import type { QueueOptions } from '../types/index.js';
import { moveToActive, processDelayed } from './scripts.js';

export class RedisConnection {
  private static instances: Map<string, IORedis> = new Map();

  static async createClient(options: QueueOptions = {}): Promise<IORedis> {
    const connectionKey = this.getConnectionKey(options);

    if (this.instances.has(connectionKey)) {
      return this.instances.get(connectionKey)!;
    }

    const client = new IORedis({
      host: options.connection?.host || 'localhost',
      port: options.connection?.port || 6379,
      password: options.connection?.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    client.defineCommand('moveToActive', {
      numberOfKeys: 3,
      lua: moveToActive,
    });

    client.defineCommand('processDelayed', {
      numberOfKeys: 2,
      lua: processDelayed,
    });

    try {
      await new Promise((resolve, reject) => {
        client.once('ready', resolve);
        client.once('error', reject);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new QueueError(`Failed to connect to Redis: ${errorMessage}`);
    }

    this.instances.set(connectionKey, client);
    return client;
  }

  private static getConnectionKey(options: QueueOptions): string {
    const { host, port, password } = options.connection || {};
    return `${host || 'localhost'}:${port || 6379}:${password || ''}`;
  }

  static async closeAll(): Promise<void> {
    for (const client of this.instances.values()) {
      await client.quit();
    }
    this.instances.clear();
  }
}
