import loadtest from 'loadtest'

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0YzBhMDg5M2UxYWRhYjk0MzY5YWY0YmVkNjBiNTA3MDAwZjAzMDBmNDYzNDVmYzNmZTgyMTY0NTNiMGExOGQwIiwiZXhwIjoxNzIwNjM3OTYyLCJpYXQiOjE3MTgyMTg3NjJ9.j3D5wZpnFnSY1QiV0AUdi4dfI0GntbE9JM6DN5u_NZQ'

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