import { Queue } from './queue/Queue.js';
import { Worker } from './worker/Worker.js';

async function main() {
  try {
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
        timeout: 5000,
      },
    });

    // Wait for queue to be ready
    await new Promise((resolve) => queue.once('ready', resolve));
    console.log('Queue is ready');

    // Create a worker to process jobs
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
        maxJobsPerWorker: 20,
      }
    );

    // Add more detailed worker logging
    worker.on('ready', () => {
      console.log('Worker is ready to process jobs');
    });

    worker.on('error', (error) => {
      console.error('Worker error:', error);
    });

    // Wait for worker to be ready
    await new Promise((resolve) => worker.once('ready', resolve));

    // Job processing
    worker.process(async (job) => {
      console.log('=== Starting job processing ===');
      console.log('Processing job:', job.id);
      console.log('Job data:', job.data);

      console.log('Attempting to send email...');
      try {
        await simulateEmailSending(job.data);
        console.log('Email sent successfully for job:', job.id);
        return { sent: true, timestamp: new Date() };
      } catch (error) {
        console.log('Email sending failed for job:', job.id);
        throw error;
      }
    });

    // Add event listeners to worker
    worker.on('processing', (job) => {
      console.log(`Started processing job ${job.id}`);
    });

    worker.on('failed', (job, error) => {
      console.log(`Job ${job.id} failed:`, error.message);
    });

    worker.on('retrying', (job) => {
      console.log(`Retrying job ${job.id}, attempt ${job.attemptsMade}`);
    });

    // Add different types of jobs to the queue
    console.log('Adding jobs to queue...');
    const regularJob = await queue.add('send-welcome', {
      to: 'user@example.com',
      template: 'welcome',
      data: { name: 'John' },
    });
    console.log('Added regular job:', regularJob.id);

    await new Promise((resolve) => setTimeout(resolve, 500)); // Add 500ms delay

    const delayedJob = await queue.add(
      'send-reminder',
      {
        to: 'user@example.com',
        template: 'reminder',
        data: { event: 'Meeting' },
      },
      {
        delay: 1000,
      }
    );
    console.log('Added delayed job:', delayedJob.id);

    // Monitor queue size
    const interval = setInterval(async () => {
      const count = await queue.count();
      console.log('Current queue size:', count);
    }, 1000);

    // Keep the process running
    await new Promise((resolve) => setTimeout(resolve, 10000));
    clearInterval(interval);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Helper function to simulate email sending
async function simulateEmailSending(data: any): Promise<void> {
  const randomTime = Math.random() * 100;
  const shouldFail = Math.random() < 0.1;

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) {
        reject(new Error('Failed to send email'));
      } else {
        console.log('Email sent:', data);
        resolve(void 0);
      }
    }, randomTime);
  });
}

main();
