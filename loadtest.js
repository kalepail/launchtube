import loadtest from 'loadtest'

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3NjBhY2Y3YTBmODFkNGZiNDZhYmMyZmZkMWY4NjM3MmY2ZmYzZDA0YjU5ZTQ3ZWM0NGQxYmExM2NjNjNiMDMxIiwiZXhwIjoxNzIwNjMzMjMzLCJpYXQiOjE3MTgyMTQwMzN9._JCBu9W3GY-zT3eP6E89sU0KGHj4q3eEHrhkADGNqY8'

const options = {
  url: 'http://localhost:8787/seq/getSequence',
  method: 'POST',
  maxRequests: 50,
  requestsPerSecond: 10,
  concurrency: 5,
  statusCallback,
  headers: {
    'Authorization': `Bearer ${TOKEN}`
  },
  body: {
    mock: 'xdr'
  },
  contentType: 'application/x-www-form-urlencoded'
}

loadtest.loadTest(options, (error, result) => {
  // This blocks gets called when whole test is finished
  if (error) {
    console.log('Got an error: %s', error)
  }
  // console.log('Got the following result from the test>>\n', result)
})

function statusCallback(error, result, latency) {
  if (result) {
    const body = JSON.parse(result.body)
    console.log(body.hash, result.statusCode, result.requestElapsed)
  }

  else if (error)
    console.error(error)
}