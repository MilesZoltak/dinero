const http = require('http');

async function testApiChatIntegration() {
  console.log('🚀 Running Strict API Integration Test on POST /api/chat...');

  const postData = JSON.stringify({
    messages: [{ role: 'user', content: 'What is my net worth?' }],
  });

  const options = {
    hostname: 'localhost',
    port: parseInt(process.env.TEST_PORT || process.env.PORT || '3000', 10),
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      console.log(`📡 Response HTTP Status Code: ${res.statusCode}`);
      console.log(`📋 Response Headers:`, res.headers);

      // STRICT 2XX ASSERTION
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errBody = '';
        res.on('data', (chunk) => (errBody += chunk));
        res.on('end', () => {
          console.error(`❌ INTEGRATION TEST FAILED: HTTP Status ${res.statusCode} (Expected 2xx)`);
          console.error(`Error Body:`, errBody);
          process.exit(1);
        });
        return;
      }

      // ASSERT CONTENT-TYPE
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/event-stream')) {
        console.error(`❌ INTEGRATION TEST FAILED: Expected Content-Type 'text/event-stream', got '${contentType}'`);
        process.exit(1);
      }

      let receivedChunks = 0;
      let hasDoneSignal = false;
      let fullText = '';

      res.on('data', (chunk) => {
        receivedChunks++;
        const str = chunk.toString();
        fullText += str;
        if (str.includes('[DONE]')) {
          hasDoneSignal = true;
        }
      });

      res.on('end', () => {
        console.log(`📥 Total Chunks Received: ${receivedChunks}`);
        console.log(`📄 Stream Payload Preview:\n${fullText.slice(0, 300)}...\n`);

        if (receivedChunks === 0) {
          console.error('❌ INTEGRATION TEST FAILED: Response stream was empty (0 chunks).');
          process.exit(1);
        }

        if (!hasDoneSignal) {
          console.error('❌ INTEGRATION TEST FAILED: Stream ended without [DONE] signal.');
          process.exit(1);
        }

        console.log('✅ PASS: API integration test passed with strict HTTP 200 OK & SSE streaming assertions!');
        resolve(true);
      });
    });

    req.on('error', (err) => {
      console.error('❌ INTEGRATION TEST FAILED: Network / Request Error:', err.message);
      process.exit(1);
    });

    req.write(postData);
    req.end();
  });
}

testApiChatIntegration().catch(() => process.exit(1));
