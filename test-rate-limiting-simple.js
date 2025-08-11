#!/usr/bin/env node

/**
 * Simple Rate Limiting Test for Local Development
 * 
 * This script performs a quick test of rate limiting functionality
 * by sending rapid requests to the local development server.
 */

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhMTI2Zjc3MzYyMmU5ZGMwYzQxYmJiZTJiYTExOWQxYTRhZWNhOTY3ZDBmMzU3YzI2ZmMyNmJjMjkzNzdhZjY0IiwiZXhwIjoxNzIwNjUxNDAyLCJpYXQiOjE3MTgyMzIyMDJ9.ipgdrX3WPmyaFxndbP8fVf9qIK6V72XsziMUojLj0eo';
const BASE_URL = 'http://localhost:8787';

async function makeRequest(requestNum) {
    const start = Date.now();
    
    try {
        const response = await fetch(`${BASE_URL}/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                mock: 'xdr',
                sim: 'true'
            })
        });

        const responseTime = Date.now() - start;
        const text = await response.text();
        
        console.log(`Request ${requestNum}: ${response.status} ${response.statusText} (${responseTime}ms)`);
        
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            console.log(`  └─ Rate limited! Retry after: ${retryAfter} seconds`);
        } else if (response.status >= 400) {
            console.log(`  └─ Error: ${text}`);
        } else {
            console.log(`  └─ Success`);
        }
        
        return {
            requestNum,
            status: response.status,
            responseTime,
            retryAfter: response.headers.get('Retry-After')
        };
        
    } catch (error) {
        console.log(`Request ${requestNum}: ERROR - ${error.message}`);
        return { requestNum, error: error.message };
    }
}

async function runQuickTest() {
    console.log('🧪 Quick Rate Limiting Test');
    console.log(`Testing ${BASE_URL}`);
    console.log('Sending 15 rapid requests to trigger rate limiting...\n');
    
    const results = [];
    
    for (let i = 1; i <= 15; i++) {
        const result = await makeRequest(i);
        results.push(result);
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('\n📊 Summary:');
    const successful = results.filter(r => r.status && r.status >= 200 && r.status < 300).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    const errors = results.filter(r => r.error || (r.status && r.status >= 400 && r.status !== 429)).length;
    
    console.log(`Successful: ${successful}`);
    console.log(`Rate Limited: ${rateLimited}`);
    console.log(`Errors: ${errors}`);
    
    if (rateLimited > 0) {
        console.log('\n✅ Rate limiting is working!');
        const firstRateLimit = results.findIndex(r => r.status === 429) + 1;
        console.log(`First rate limit triggered at request: ${firstRateLimit}`);
    } else {
        console.log('\n⚠️  No rate limiting detected. Check configuration or increase request volume.');
    }
}

if (require.main === module) {
    runQuickTest().catch(console.error);
}