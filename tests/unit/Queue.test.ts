import { Queue } from '../../src/queue/Queue.js';
import { RedisConnection } from '../../src/utils/redis.js';

describe('Queue', () => {
  let queue: Queue;

  beforeEach(async () => {
    queue = new Queue('test-queue');
    // Wait for queue to be ready
    await new Promise((resolve) => queue.once('ready', resolve));
  });

  afterEach(async () => {
    await queue.close();
    await RedisConnection.closeAll();
  });

  it('should add a job to the queue', async () => {
    const job = await queue.add('test-job', { foo: 'bar' });

    expect(job).toHaveProperty('id');
    expect(job.name).toBe('test-job');
    expect(job.data).toEqual({ foo: 'bar' });
    expect(job.status).toBe('waiting');
  });

  it('should add a delayed job', async () => {
    const job = await queue.add('delayed-job', { foo: 'bar' }, { delay: 1000 });

    expect(job.status).toBe('delayed');
  });

  it('should get a job by id', async () => {
    const addedJob = await queue.add('test-job', { foo: 'bar' });
    const fetchedJob = await queue.getJob(addedJob.id);

    expect(fetchedJob).toMatchObject(addedJob);
  });

  it('should remove a job', async () => {
    const job = await queue.add('test-job', { foo: 'bar' });
    await queue.removeJob(job.id);
    const fetchedJob = await queue.getJob(job.id);

    expect(fetchedJob).toBeNull();
  });

  it('should pause and resume the queue', async () => {
    await queue.pause();
    expect(await queue.isPaused()).toBe(true);

    await queue.resume();
    expect(await queue.isPaused()).toBe(false);
  });
});
