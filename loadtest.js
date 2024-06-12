import loadtest from 'loadtest'

let counter = 0

const options = {
  url: 'http://localhost:8787/seq/getSequence',
  method: 'POST',
  maxRequests: 50,
  requestsPerSecond: 10,
  concurrency: 5,
  statusCallback,
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