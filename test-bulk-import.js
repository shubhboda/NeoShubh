// Test bulk import endpoint
async function testBulkImport() {
  try {
    console.log('Testing bulk import endpoint...');
    const res = await fetch('http://localhost:3000/api/neo4j/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        csvPath: 'sushruta_sam.csv',
        limit: 10  // Just test with 10 records first
      })
    });
    
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Raw response:', text);
    
    try {
      const data = JSON.parse(text);
      console.log('Parsed:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testBulkImport();
