const http = require('http');

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,apikey,authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`[Mock Supabase] ${req.method} ${req.url}`);

  if (req.url.startsWith('/auth/v1/signup') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      
      // Simulate success and create a session
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'mock_jwt_access_token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'mock_refresh_token',
        user: {
          id: '12345678-1234-1234-1234-123456789012',
          aud: 'authenticated',
          role: 'authenticated',
          email: payload.email,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {}
        }
      }));
    });
    return;
  }
  
  if (req.url.startsWith('/auth/v1/admin/users') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: [] }));
    return;
  }
  
  if (req.url.startsWith('/auth/v1/user') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: '12345678-1234-1234-1234-123456789012',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'qa.test@ccpatio.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}
    }));
    return;
  }

  if (req.url.startsWith('/auth/v1/admin/users') && req.method === 'DELETE') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(54321, () => {
  console.log('Mock Supabase server listening on port 54321');
});
