# Jet Queue

A robust, Redis-backed job queue system for Node.js with TypeScript support. Features include delayed jobs, retries with backoff, concurrent processing, and event-based monitoring.

## Features

- 🚀 Redis-backed for reliability and persistence
- ⏰ Delayed job scheduling
- 🔄 Automatic retries with configurable backoff
- 👥 Concurrent job processing
- 📊 Job status monitoring
- 🎯 Type-safe job data with TypeScript
- 🔌 Event-driven architecture

## Installation

```bash
npm install jet-queue
```


Make sure you have Redis installed and running locally, or specify your Redis connection details in the configuration.

## Quick Start

Here's a basic example of how to use Jet Queue:

```typescript
import { Queue, Worker } from 'jet-queue';

// Create a queue instance
const queue = new Queue('email-queue', {
  prefix: 'myapp',
  connection: {
    host: 'localhost',
    port: 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 1000,
    },
  },
});

// Create a worker
const worker = new Worker(
  'email-queue',
  {
    prefix: 'myapp',
    connection: {
      host: 'localhost',
      port: 6379,
    },
  },
  {
    concurrency: 2,
  }
);

// Process jobs
worker.process(async (job) => {
  console.log('Processing job:', job.id);
  await sendEmail(job.data);
  return { sent: true };
});

// Add a job to the queue
await queue.add('send-welcome', {
  to: 'user@example.com',
  template: 'welcome',
  data: { name: 'John' },
});
```

## Advanced Usage

### Delayed Jobs

Schedule jobs to be processed in the future:

```typescript
await queue.add(
  'send-reminder',
  {
    to: 'user@example.com',
    template: 'reminder',
    data: { event: 'Meeting' },
  },
  {
    delay: 60000, // 1 minute delay
  }
);
```

### Retry Configuration

Configure job retry behavior:

```typescript
await queue.add('important-task', data, {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 1000, // Will increase exponentially with each retry
  },
});
```

### Worker Events

Monitor worker activity:

```typescript
worker.on('ready', () => {
  console.log('Worker is ready to process jobs');
});

worker.on('processing', (job) => {
  console.log(`Processing job ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.log(`Job ${job.id} failed:`, error.message);
});

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});
```

### Queue Management

Monitor and manage your queues:

```typescript
// Get queue size
const size = await queue.count();

// Pause/Resume queue
await queue.pause();
await queue.resume();

// Remove a specific job
await queue.removeJob(jobId);
```

## API Reference

### Queue Options

```typescript
interface QueueOptions {
  connection?: {
    host?: string;
    port?: number;
    password?: string;
  };
  prefix?: string;
  defaultJobOptions?: JobOptions;
}
```

### Job Options

```typescript
interface JobOptions {
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  delay?: number;
  timeout?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}
```

### Worker Options

```typescript
interface WorkerOptions {
  concurrency?: number;
  maxJobsPerWorker?: number;
}
```

## Requirements

- Node.js >= 14
- Redis >= 5
- TypeScript >= 4.5



