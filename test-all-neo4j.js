// Test all Neo4j endpoints
async function testAllEndpoints() {
  const timestamp = Date.now();
  
  try {
    // Test 1: Add Disease node
    console.log('\n=== Test 1: Add Disease Node ===');
    let res = await fetch('http://localhost:3000/api/neo4j/add-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeType: 'Disease', nodeName: `Fever_${timestamp}` })
    });
    let data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
    
    // Test 2: Add Symptom node
    console.log('\n=== Test 2: Add Symptom Node ===');
    res = await fetch('http://localhost:3000/api/neo4j/add-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeType: 'Symptom', nodeName: `HighTemp_${timestamp}` })
    });
    data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
    
    // Test 3: Create relationship
    console.log('\n=== Test 3: Create Relationship ===');
    res = await fetch('http://localhost:3000/api/neo4j/add-relationship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromType: 'Disease',
        fromName: `Fever_${timestamp}`,
        toType: 'Symptom',
        toName: `HighTemp_${timestamp}`,
        relationType: 'HAS_SYMPTOM'
      })
    });
    data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
    
    // Test 4: List all nodes
    console.log('\n=== Test 4: List All Nodes ===');
    res = await fetch('http://localhost:3000/api/neo4j/nodes');
    data = await res.json();
    console.log('Status:', res.status);
    console.log('Total nodes:', data.count);
    console.log('Sample nodes:', data.nodes.slice(0, 3));
    
    // Test 5: List Disease nodes only
    console.log('\n=== Test 5: List Disease Nodes ===');
    res = await fetch('http://localhost:3000/api/neo4j/nodes?nodeType=Disease');
    data = await res.json();
    console.log('Status:', res.status);
    console.log('Disease count:', data.count);
    console.log('Sample diseases:', data.nodes.slice(0, 3));
    
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

testAllEndpoints();
