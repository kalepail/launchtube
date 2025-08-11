#!/usr/bin/env node

/**
 * Rate Limiting Test Script for Launchtube
 * 
 * This script tests the rate limiting functionality by sending multiple requests
 * to the POST / endpoint and verifying that rate limiting works correctly.
 * 
 * Usage:
 *   node test-rate-limiting.js [url] [token]
 * 
 * Examples:
 *   node test-rate-limiting.js http://localhost:8787 your-jwt-token
 *   node test-rate-limiting.js https://your-worker.your-subdomain.workers.dev your-jwt-token
 */

const TOKEN = process.argv[3] || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhMTI2Zjc3MzYyMmU5ZGMwYzQxYmJiZTJiYTExOWQxYTRhZWNhOTY3ZDBmMzU3YzI2ZmMyNmJjMjkzNzdhZjY0IiwiZXhwIjoxNzIwNjUxNDAyLCJpYXQiOjE3MTgyMzIyMDJ9.ipgdrX3WPmyaFxndbP8fVf9qIK6V72XsziMUojLj0eo';
const BASE_URL = process.argv[2] || 'http://localhost:8787';

class RateLimitTester {
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.results = [];
    }

    async makeRequest(testName, options = {}) {
        const start = Date.now();
        
        try {
            const response = await fetch(`${this.baseUrl}/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'RateLimit-Test/1.0',
                    ...options.headers
                },
                body: new URLSearchParams({
                    mock: 'xdr',
                    sim: 'true',
                    ...options.body
                })
            });

            const end = Date.now();
            const responseTime = end - start;
            const text = await response.text();
            
            let body;
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }

            const result = {
                test: testName,
                status: response.status,
                statusText: response.statusText,
                responseTime,
                headers: Object.fromEntries(response.headers.entries()),
                body,
                timestamp: new Date().toISOString()
            };

            this.results.push(result);
            
            console.log(`[${testName}] ${response.status} ${response.statusText} (${responseTime}ms)`);
            if (response.status === 429) {
                console.log(`  └─ Rate limited: ${body.error || body.message || 'Too many requests'}`);
                if (response.headers.has('Retry-After')) {
                    console.log(`  └─ Retry after: ${response.headers.get('Retry-After')} seconds`);
                }
            } else if (response.status >= 400) {
                console.log(`  └─ Error: ${body.error || body.message || body}`);
            } else {
                console.log(`  └─ Success: ${body.hash ? body.hash.substring(0, 16) + '...' : 'OK'}`);
            }

            return result;
        } catch (error) {
            const result = {
                test: testName,
                status: 0,
                statusText: 'ERROR',
                responseTime: Date.now() - start,
                error: error.message,
                timestamp: new Date().toISOString()
            };
            
            this.results.push(result);
            console.log(`[${testName}] ERROR: ${error.message}`);
            return result;
        }
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async runBasicRateLimitTest() {
        console.log('\n🧪 Test 1: Basic Rate Limiting');
        console.log('Sending requests rapidly to trigger rate limiting...');
        
        // Send requests quickly to exceed rate limit
        const promises = [];
        for (let i = 1; i <= 15; i++) {
            promises.push(this.makeRequest(`Basic-${i}`));
            // Small delay to avoid overwhelming the server
            await this.sleep(100);
        }
        
        await Promise.all(promises);
    }

    async runExponentialBackoffTest() {
        console.log('\n🧪 Test 2: Exponential Backoff Verification');
        console.log('Testing exponential backoff behavior...');

        // Wait a bit to let any previous rate limits expire
        console.log('Waiting 5 seconds for rate limits to reset...');
        await this.sleep(5000);

        // Send enough requests to trigger multiple backoff levels
        for (let i = 1; i <= 20; i++) {
            await this.makeRequest(`Backoff-${i}`);
            await this.sleep(200); // Small delay between requests
        }
    }

    async runDifferentIPTest() {
        console.log('\n🧪 Test 3: Different IP Simulation');
        console.log('Testing with different IP headers (simulating different clients)...');

        // Test with different simulated IPs
        const testIPs = ['203.0.113.1', '203.0.113.2', '203.0.113.3'];
        
        for (const ip of testIPs) {
            console.log(`\n  Testing with simulated IP: ${ip}`);
            for (let i = 1; i <= 8; i++) {
                await this.makeRequest(`IP-${ip}-${i}`, {
                    headers: {
                        'CF-Connecting-IP': ip,
                        'X-Forwarded-For': ip,
                        'X-Real-IP': ip
                    }
                });
                await this.sleep(150);
            }
        }
    }

    async runRecoveryTest() {
        console.log('\n🧪 Test 4: Rate Limit Recovery');
        console.log('Testing recovery after rate limit expires...');

        // First, trigger rate limiting
        for (let i = 1; i <= 12; i++) {
            await this.makeRequest(`Recovery-Initial-${i}`);
            await this.sleep(100);
        }

        // Wait for rate limit to potentially expire
        console.log('Waiting 30 seconds for rate limits to potentially reset...');
        for (let i = 30; i > 0; i--) {
            process.stdout.write(`\r  Waiting... ${i}s remaining`);
            await this.sleep(1000);
        }
        console.log('\n  Continuing with recovery test...');

        // Try requests again
        for (let i = 1; i <= 5; i++) {
            await this.makeRequest(`Recovery-After-${i}`);
            await this.sleep(500);
        }
    }

    analyzResults() {
        console.log('\n📊 Test Results Analysis');
        console.log('=' .repeat(50));
        
        const successCount = this.results.filter(r => r.status >= 200 && r.status < 300).length;
        const rateLimitedCount = this.results.filter(r => r.status === 429).length;
        const errorCount = this.results.filter(r => r.status >= 400 && r.status !== 429).length;
        const networkErrorCount = this.results.filter(r => r.status === 0).length;
        
        console.log(`Total requests: ${this.results.length}`);
        console.log(`Successful (2xx): ${successCount}`);
        console.log(`Rate limited (429): ${rateLimitedCount}`);
        console.log(`Other errors (4xx/5xx): ${errorCount}`);
        console.log(`Network errors: ${networkErrorCount}`);
        
        // Analyze rate limiting patterns
        const rateLimitedResults = this.results.filter(r => r.status === 429);
        if (rateLimitedResults.length > 0) {
            console.log('\n🔍 Rate Limiting Analysis:');
            console.log(`First rate limit triggered at request: ${this.results.findIndex(r => r.status === 429) + 1}`);
            
            // Check for exponential backoff in retry-after headers
            const retryAfterTimes = rateLimitedResults
                .map(r => r.headers['retry-after'])
                .filter(r => r)
                .map(Number);
                
            if (retryAfterTimes.length > 0) {
                console.log('Retry-After times observed:', retryAfterTimes);
                
                // Check if retry times are increasing (exponential backoff)
                let isExponential = true;
                for (let i = 1; i < retryAfterTimes.length; i++) {
                    if (retryAfterTimes[i] < retryAfterTimes[i-1]) {
                        isExponential = false;
                        break;
                    }
                }
                
                if (isExponential && retryAfterTimes.length > 1) {
                    console.log('✅ Exponential backoff pattern detected');
                } else {
                    console.log('⚠️  No clear exponential backoff pattern');
                }
            }
        }
        
        // Response time analysis
        const responseTimes = this.results.map(r => r.responseTime);
        const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const maxResponseTime = Math.max(...responseTimes);
        const minResponseTime = Math.min(...responseTimes);
        
        console.log(`\n⏱️  Response Time Analysis:`);
        console.log(`Average: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`Min: ${minResponseTime}ms`);
        console.log(`Max: ${maxResponseTime}ms`);
        
        // Rate limiting headers analysis
        const rateLimitHeaders = this.results.filter(r => r.headers['x-ratelimit-limit']).length;
        if (rateLimitHeaders > 0) {
            console.log('\n📋 Rate Limiting Headers:');
            console.log(`Responses with rate limit headers: ${rateLimitHeaders}`);
        }
    }

    async runAllTests() {
        console.log('🚀 Starting Rate Limiting Tests for Launchtube');
        console.log(`Base URL: ${this.baseUrl}`);
        console.log(`Token: ${this.token.substring(0, 20)}...`);
        console.log('=' .repeat(60));

        try {
            await this.runBasicRateLimitTest();
            await this.runExponentialBackoffTest();
            await this.runDifferentIPTest();
            await this.runRecoveryTest();
            
            this.analyzResults();
            
        } catch (error) {
            console.error('\n❌ Test suite failed:', error.message);
        }

        // Save detailed results to file
        const fs = require('fs');
        const resultsFile = `rate-limit-test-results-${Date.now()}.json`;
        fs.writeFileSync(resultsFile, JSON.stringify({
            testRun: {
                timestamp: new Date().toISOString(),
                baseUrl: this.baseUrl,
                totalTests: this.results.length
            },
            results: this.results
        }, null, 2));
        
        console.log(`\n📄 Detailed results saved to: ${resultsFile}`);
        console.log('\n✅ Rate limiting test suite completed!');
    }
}

// Main execution
if (require.main === module) {
    const tester = new RateLimitTester(BASE_URL, TOKEN);
    tester.runAllTests().catch(console.error);
}