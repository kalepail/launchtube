import loadtest from 'loadtest'

function requestGenerator(params, options, client, callback) {
  const request = client(options, callback)
  return request
}

function statusCallback(error, result, latency) {
  if (result)
    console.log(result.statusCode, result.requestElapsed)

  else if (error)
    console.error(error)
}

function handleError(error) {
  if (error)
    return console.error('Got an error: %s', error)
}

const options = {
  url: 'http://localhost:8787/seq/getSequence',
  method: 'GET',
  maxRequests: 50,
  requestsPerSecond: 10,
  concurrency: 5,
  agentKeepAlive: true,
  statusCallback,
  requestGenerator,
}

loadtest.loadTest(options, handleError)