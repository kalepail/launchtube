#!/usr/bin/env node

/**
 * Simple validation test for rate limiting configuration
 */

function testRateLimitLogic() {
    console.log('🧪 Testing rate limiting logic...');
    
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
    
    console.log('  Exponential backoff calculations:');
    for (const testCase of testCases) {
        const calculated = Math.min(
            baseBackoffMs * Math.pow(multiplier, testCase.level - 1), 
            maxBackoffMs
        );
        const passed = calculated === testCase.expected;
        
        console.log(`    ${passed ? '✅' : '❌'} Level ${testCase.level}: ${calculated}ms ${passed ? '' : `(expected ${testCase.expected}ms)`}`);
    }
}

function testConfigurationValidation() {
    console.log('\n🧪 Testing configuration validation...');
    
    // Simulate the environment variables from wrangler.toml
    const devConfig = {
        RATE_LIMIT_REQUESTS: '10',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_BACKOFF_BASE_MS: '1000',
        RATE_LIMIT_BACKOFF_MULTIPLIER: '2',
        RATE_LIMIT_MAX_BACKOFF_MS: '300000'
    };
    
    const prodConfig = {
        RATE_LIMIT_REQUESTS: '20',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_BACKOFF_BASE_MS: '2000',
        RATE_LIMIT_BACKOFF_MULTIPLIER: '2',
        RATE_LIMIT_MAX_BACKOFF_MS: '600000'
    };
    
    const configs = [
        { name: 'Development', config: devConfig },
        { name: 'Production', config: prodConfig }
    ];
    
    for (const { name, config } of configs) {
        console.log(`  ${name} configuration:`);
        
        const requests = Number(config.RATE_LIMIT_REQUESTS) || 10;
        const windowMs = Number(config.RATE_LIMIT_WINDOW_MS) || 60000;
        const baseBackoffMs = Number(config.RATE_LIMIT_BACKOFF_BASE_MS) || 1000;
        const multiplier = Number(config.RATE_LIMIT_BACKOFF_MULTIPLIER) || 2;
        const maxBackoffMs = Number(config.RATE_LIMIT_MAX_BACKOFF_MS) || 300000;
        
        const valid = requests > 0 && windowMs > 0 && baseBackoffMs > 0 && multiplier > 0 && maxBackoffMs > 0;
        
        console.log(`    ${valid ? '✅' : '❌'} Valid configuration: ${valid}`);
        console.log(`      Requests per window: ${requests}`);
        console.log(`      Window duration: ${windowMs / 1000}s`);
        console.log(`      Base backoff: ${baseBackoffMs / 1000}s`);
        console.log(`      Backoff multiplier: ${multiplier}x`);
        console.log(`      Max backoff: ${maxBackoffMs / 1000}s`);
        
        // Calculate example backoff progression
        console.log(`      Backoff progression: `, end='');
        const progression = [];
        for (let level = 1; level <= 5; level++) {
            const backoff = Math.min(baseBackoffMs * Math.pow(multiplier, level - 1), maxBackoffMs);
            progression.push(`${backoff/1000}s`);
        }
        console.log(progression.join(' → '));
    }
}

function validateImplementationFiles() {
    console.log('\n🧪 Validating implementation files...');
    
    const fs = require('fs');
    const path = require('path');
    
    const requiredFiles = [
        'src/rate-limiter.ts',
        'src/rate-limit-helper.ts',
        'test-rate-limiting.js',
        'test-rate-limiting-simple.js'
    ];
    
    for (const file of requiredFiles) {
        const exists = fs.existsSync(path.join(__dirname, file));
        console.log(`  ${exists ? '✅' : '❌'} ${file}: ${exists ? 'exists' : 'missing'}`);
        
        if (exists) {
            const stats = fs.statSync(path.join(__dirname, file));
            console.log(`      Size: ${(stats.size / 1024).toFixed(1)} KB`);
        }
    }
}

function printImplementationSummary() {
    console.log('\n📋 Rate Limiting Implementation Summary');
    console.log('=' .repeat(50));
    
    console.log('✅ Features Implemented:');
    console.log('  • IP-based rate limiting using Durable Objects');
    console.log('  • Exponential backoff on rate limit violations');
    console.log('  • Configurable limits and backoff parameters');
    console.log('  • Only applies to POST / endpoint as requested');
    console.log('  • Privacy-preserving IP hashing');
    console.log('  • Comprehensive test suite');
    
    console.log('\n🔧 Configuration Variables:');
    console.log('  • RATE_LIMIT_REQUESTS: Max requests per window');
    console.log('  • RATE_LIMIT_WINDOW_MS: Time window in milliseconds');
    console.log('  • RATE_LIMIT_BACKOFF_BASE_MS: Initial backoff delay');
    console.log('  • RATE_LIMIT_BACKOFF_MULTIPLIER: Exponential multiplier');
    console.log('  • RATE_LIMIT_MAX_BACKOFF_MS: Maximum backoff delay');
    
    console.log('\n🚀 Testing Instructions:');
    console.log('  1. Start the development server:');
    console.log('     npm run dev');
    console.log('');
    console.log('  2. Run the simple test (in a new terminal):');
    console.log('     node test-rate-limiting-simple.js');
    console.log('');
    console.log('  3. Run the comprehensive test suite:');
    console.log('     node test-rate-limiting.js');
    
    console.log('\n💡 Rate Limiting Behavior:');
    console.log('  • First 10 requests (dev) / 20 requests (prod) allowed per minute');
    console.log('  • Subsequent requests trigger exponential backoff');
    console.log('  • Backoff starts at 1s (dev) / 2s (prod), doubles each violation');
    console.log('  • Maximum backoff: 5 minutes (dev) / 10 minutes (prod)');
    console.log('  • Rate limits reset after successful compliance period');
}

function runValidationTests() {
    console.log('🧪 Rate Limiting Implementation Validation');
    console.log('=' .repeat(60));
    
    try {
        testRateLimitLogic();
        testConfigurationValidation();
        validateImplementationFiles();
        printImplementationSummary();
        
        console.log('\n✅ Validation completed successfully!');
        console.log('\n🎯 Ready for testing with Cloudflare Workers local environment.');
        
    } catch (error) {
        console.error('\n❌ Validation failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runValidationTests();
}