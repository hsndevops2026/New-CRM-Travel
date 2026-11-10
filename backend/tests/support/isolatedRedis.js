// Import this FIRST in a test that enqueues jobs. ES imports run in order, so this sets the
// Redis database before any module reads it. A dev server sharing this Redis keeps listening
// on database 0 and never sees (or processes) the jobs these tests create.
//
// Never database 0: that is where a live worker listens, and tests clean up after themselves
// by emptying their queues.
if (!process.env.REDIS_DB || process.env.REDIS_DB === '0') process.env.REDIS_DB = '14';
