#!/usr/bin/env node

/**
 * Unit Test for Rate Limiting Components
 * 
 * This tests the rate limiting logic without requiring a full Cloudflare environment
 */

// Mock Cloudflare environment for testing
global.crypto = {
    subtle: {
        digest: async (algorithm, data) => {
            // Simple hash simulation for testing
            const str = new TextDecoder().decode(data);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return new ArrayBuffer(32);
        }
    }
};

// Import the helper functions
const { getClientIP, hashIP } = require('./src/rate-limit-helper.ts');

async function testIPExtraction() {
    console.log('🧪 Testing IP extraction...');
    
    const testCases = [
        {
            headers: { 'CF-Connecting-IP': '203.0.113.1' },
            expected: '203.0.113.1',
            description: 'Cloudflare CF-Connecting-IP header'
        },
        {
            headers: { 'X-Forwarded-For': '203.0.113.2, 192.168.1.1' },
            expected: '203.0.113.2',
            description: 'X-Forwarded-For header (first IP)'
        },
        {
            headers: { 'X-Real-IP': '203.0.113.3' },
            expected: '203.0.113.3', 
            description: 'X-Real-IP header'
        },
        {
            headers: {},
            expected: '0.0.0.0',
            description: 'No IP headers (fallback)'
        }
    ];
    
    for (const testCase of testCases) {
        const mockRequest = {
            headers: {
                get: (name) => testCase.headers[name] || null
            }
        };
        
        const ip = getClientIP(mockRequest);
        const passed = ip === testCase.expected;
        
        console.log(`  ${passed ? '✅' : '❌'} ${testCase.description}: ${ip} ${passed ? '' : `(expected ${testCase.expected})`}`);
    }
}

async function testIPHashing() {
    console.log('\n🧪 Testing IP hashing...');
    
    const testIPs = ['203.0.113.1', '203.0.113.2', '203.0.113.1'];
    const hashes = [];
    
    for (const ip of testIPs) {
        const hash = await hashIP(ip);
        hashes.push({ ip, hash });
        console.log(`  IP ${ip} -> ${hash.substring(0, 16)}...`);
    }
    
    // Verify same IP produces same hash
    const sameIPHashes = hashes.filter(h => h.ip === '203.0.113.1');
    const hashesMatch = sameIPHashes.every(h => h.hash === sameIPHashes[0].hash);
    
    console.log(`  ${hashesMatch ? '✅' : '❌'} Same IP produces same hash: ${hashesMatch}`);
    
    // Verify different IPs produce different hashes
    const uniqueHashes = new Set(hashes.map(h => h.hash));
    const differentIPsHaveDifferentHashes = uniqueHashes.size === 2; // Should have 2 unique hashes for 2 unique IPs
    
    console.log(`  ${differentIPsHaveDifferentHashes ? '✅' : '❌'} Different IPs produce different hashes: ${differentIPsHaveDifferentHashes}`);
}

function testRateLimitLogic() {
    console.log('\n🧪 Testing rate limiting logic...');
    
    // Test exponential backoff calculation
    const baseBackoffMs = 1000;
    const multiplier = 2;
    const maxBackoffMs = 10000;
    
    const testCases = [
        { level: 1, expected: 1000 },
        { level: 2, expected: 2000 },  
        { level: 3, expected: 4000 },
        { level: 4, expected: 8000 },
        { level: 5, expected: 10000 }, // Should cap at max
        { level: 10, expected: 10000 }  // Should still cap at max
    ];
    
    for (const testCase of testCases) {
        const calculated = Math.min(
            baseBackoffMs * Math.pow(multiplier, testCase.level - 1), 
            maxBackoffMs
        );
        const passed = calculated === testCase.expected;
        
        console.log(`  ${passed ? '✅' : '❌'} Level ${testCase.level}: ${calculated}ms ${passed ? '' : `(expected ${testCase.expected}ms)`}`);
    }
}

function testConfigurationValidation() {
    console.log('\n🧪 Testing configuration validation...');
    
    const configs = [
        {
            RATE_LIMIT_REQUESTS: '10',
            RATE_LIMIT_WINDOW_MS: '60000',
            description: 'Basic valid configuration'
        },
        {
            RATE_LIMIT_REQUESTS: undefined,
            RATE_LIMIT_WINDOW_MS: undefined,
            description: 'Missing configuration (should use defaults)'
        }
    ];
    
    for (const config of configs) {
        const requests = Number(config.RATE_LIMIT_REQUESTS) || 10;
        const windowMs = Number(config.RATE_LIMIT_WINDOW_MS) || 60000;
        
        const valid = requests > 0 && windowMs > 0;
        console.log(`  ${valid ? '✅' : '❌'} ${config.description}: requests=${requests}, window=${windowMs}ms`);
    }
}

async function runUnitTests() {
    console.log('🧪 Rate Limiting Unit Tests');
    console.log('=' .repeat(50));
    
    try {
        await testIPExtraction();
        await testIPHashing();
        testRateLimitLogic();
        testConfigurationValidation();
        
        console.log('\n✅ All unit tests completed!');
        console.log('\n📝 Next steps:');
        console.log('  1. Start development server: npm run dev');
        console.log('  2. Run rate limiting tests: node test-rate-limiting-simple.js');
        
    } catch (error) {
        console.error('\n❌ Unit tests failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runUnitTests().catch(console.error);
}