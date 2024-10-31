import { Queue } from './queue/Queue.js';

// Define an interface for your job data type
interface EmailJob {
  to: string;
  subject: string;
  body: string;
}

async function main() {
  try {
    // Create a new queue instance
    const emailQueue = new Queue<EmailJob>('email-queue', {
      prefix: 'myapp',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    // Wait for queue to be ready
    await new Promise((resolve) => emailQueue.once('ready', resolve));

    // Add a job to the queue
    const job = await emailQueue.add(
      'send-welcome-email',
      {
        to: 'user@example.com',
        subject: 'Welcome to Our Platform!',
        body: 'Thank you for joining us.',
      },
      {
        delay: 5000, // 5 second delay
      }
    );

    console.log('Job added:', job.id);

    // Get job status
    const jobStatus = await emailQueue.getJob(job.id);
    console.log('Job status:', jobStatus?.status);

    // Get queue length
    const queueLength = await emailQueue.count();
    console.log('Queue length:', queueLength);

    // Close the queue when done
    await emailQueue.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
