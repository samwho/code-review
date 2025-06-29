// Analyze frontend processing load
const response = await fetch('http://localhost:3000/api/diff?base=main&compare=feature/auth-improvements&order=bottom-up&repository=backend-service-refactor');
const data = await response.json();

console.log('📊 Frontend Processing Load:');
console.log('- API response size:', Math.round(JSON.stringify(data).length / 1024), 'KB');
console.log('- Files to render:', data.files.length);
console.log('- Total diff lines:', data.files.reduce((sum, f) => sum + f.lines.length, 0));
console.log('- Symbol files:', data.symbols?.length || 0);

const totalSymbols = data.symbols?.reduce((sum, f) => sum + f.symbols.length, 0) || 0;
console.log('- Total symbols:', totalSymbols);

const codeLines = data.files.reduce((sum, f) => sum + f.lines.filter(l => !l.isHunkHeader).length, 0);
console.log('- Lines of code to highlight:', codeLines);

// Estimate processing time based on complexity
const estimatedDOMOperations = totalSymbols * 5; // querySelectorAll calls per symbol
const estimatedPrismCalls = codeLines; // One highlight call per line
const estimatedTempDOMElements = totalSymbols * 2; // Temp elements for reference finding

console.log('\n🔧 Estimated Frontend Operations:');
console.log('- DOM queries for symbols:', estimatedDOMOperations);
console.log('- Prism.js highlight calls:', estimatedPrismCalls);
console.log('- Temporary DOM elements:', estimatedTempDOMElements);

console.log('\n⏱️ Estimated Processing Time (current implementation):');
console.log('- Symbol processing:', Math.round(totalSymbols * 15), 'ms');
console.log('- Syntax highlighting:', Math.round(codeLines * 2), 'ms');
console.log('- DOM operations:', Math.round(estimatedDOMOperations * 1), 'ms');
console.log('- Total estimated:', Math.round(totalSymbols * 15 + codeLines * 2 + estimatedDOMOperations * 1), 'ms');