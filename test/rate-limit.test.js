import http from 'node:http'

const HOST = process.env.HOST || '127.0.0.1'
const PORT = process.env.PORT || 8787
const URL = `http://${HOST}:${PORT}/`

async function post(body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString()

    const req = http.request(URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => buf += chunk)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }))
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function run() {
  console.log('Sending a burst of POST / requests to', URL)

  const total = 50
  let num429 = 0

  for (let i = 0; i < total; i++) {
    const res = await post({ mock: 'xdr' })
    if (res.status === 429) {
      num429++
      console.log(`#${i} -> 429 Retry-After=${res.headers['retry-after']}s body=${res.body}`)
    } else {
      console.log(`#${i} -> ${res.status}`)
    }
  }

  console.log('Total 429 responses:', num429)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})