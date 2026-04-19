// Debug the node filtering endpoint
async function debugNodeFilter() {
  try {
    const res = await fetch('http://localhost:3000/api/neo4j/nodes?nodeType=Disease');
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text);
    try {
      const data = JSON.parse(text);
      console.log('Parsed:', data);
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

debugNodeFilter();
