import loadtest from 'loadtest'

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhMTI2Zjc3MzYyMmU5ZGMwYzQxYmJiZTJiYTExOWQxYTRhZWNhOTY3ZDBmMzU3YzI2ZmMyNmJjMjkzNzdhZjY0IiwiZXhwIjoxNzIwNjUxNDAyLCJpYXQiOjE3MTgyMzIyMDJ9.ipgdrX3WPmyaFxndbP8fVf9qIK6V72XsziMUojLj0eo'

const options = {
  url: 'http://localhost:8787',
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
  if (error)
    console.log('Got an error: %s', error)

  // console.log('Got the following result from the test>>\n', result)
})

function statusCallback(error, result, latency) {
  if (result) {
    const body = JSON.parse(result.body)

    if (body.hash)
      console.log(body.hash, result.statusCode, result.requestElapsed)
    else
      console.log(body, result.statusCode, result.requestElapsed)
  }

  else if (error)
    console.error(error)
}