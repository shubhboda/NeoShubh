// Test Neo4j endpoint
async function testNeo4j() {
  try {
    const response = await fetch('http://localhost:3000/api/neo4j/add-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        nodeType: 'Disease', 
        nodeName: 'TestDisease_' + Date.now() 
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers));
    
    const text = await response.text();
    console.log('Response text:', text);
    
    try {
      const data = JSON.parse(text);
      console.log('Parsed JSON:', data);
    } catch (e) {
      console.log('Failed to parse JSON:', e.message);
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

testNeo4j();
