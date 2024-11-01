// Script to safely move a job from waiting to active state
export const moveToActive = `
local waitingKey = KEYS[1]
local activeKey = KEYS[2]
local jobsKey = KEYS[3]
local timestamp = ARGV[1]

-- Get the next job from the waiting list
local jobId = redis.call('RPOP', waitingKey)
if jobId then
  -- Add to active list
  redis.call('LPUSH', activeKey, jobId)
  -- Update job hash with processing time
  redis.call('HSET', jobsKey .. ':' .. jobId, 'startedAt', timestamp)
  return jobId
end
return nil
`;

// Script to check and process delayed jobs
export const processDelayed = `
local delayedKey = KEYS[1]
local waitingKey = KEYS[2]
local timestamp = ARGV[1]

local jobs = redis.call('ZRANGEBYSCORE', delayedKey, 0, timestamp)
if #jobs > 0 then
  for _, jobId in ipairs(jobs) do
    redis.call('ZREM', delayedKey, jobId)
    redis.call('LPUSH', waitingKey, jobId)
  end
end
return jobs
`;
