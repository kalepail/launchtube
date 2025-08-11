import { unstable_dev } from 'wrangler';

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhMTI2Zjc3MzYyMmU5ZGMwYzQxYmJiZTJiYTExOWQxYTRhZWNhOTY3ZDBmMzU3YzI2ZmMyNmJjMjkzNzdhZjY0IiwiZXhwIjoxNzIwNjUxNDAyLCJpYXQiOjE3MTgyMzIyMDJ9.ipgdrX3WPmyaFxndbP8fVf9qIK6V72XsziMUojLj0eo';

(async () => {
  const worker = await unstable_dev('src/index.ts', { experimental: { disableExperimentalWarning: true }, config: 'wrangler.toml' });
  try {
    const init = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'CF-Connecting-IP': '127.0.0.1'
      },
      body: 'mock=xdr'
    };
    for (let i = 0; i < 4; i++) {
      const res = await worker.fetch('/', init);
      console.log(i, res.status);
    }
  } finally {
    await worker.stop();
  }
})();
