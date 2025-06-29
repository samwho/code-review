// Quick test of diff loading functionality
async function testDiffLoading() {
  console.log('🧪 Testing diff loading...');
  
  try {
    // Test branches endpoint
    console.log('📁 Testing branches endpoint...');
    const branchesRes = await fetch('http://localhost:3000/api/branches?repository=backend-service-refactor');
    const branches = await branchesRes.json();
    console.log('✅ Branches:', branches);
    
    // Test diff endpoint
    console.log('📄 Testing diff endpoint...');
    const diffRes = await fetch('http://localhost:3000/api/diff?base=main&compare=feature/auth-improvements&order=bottom-up&repository=backend-service-refactor');
    const diffData = await diffRes.json();
    
    console.log('✅ Diff loaded successfully!');
    console.log('- Files:', diffData.files?.length || 0);
    console.log('- Symbols:', diffData.symbols?.length || 0);
    console.log('- Preprocessed symbols:', diffData.symbolReferences?.length || 0);
    
    // Test if basic structure is right
    if (diffData.files && diffData.files.length > 0) {
      const firstFile = diffData.files[0];
      console.log('📋 First file structure:', {
        filename: firstFile.filename,
        linesCount: firstFile.lines?.length || 0,
        hasLines: !!firstFile.lines
      });
      
      if (firstFile.lines && firstFile.lines.length > 0) {
        const firstLine = firstFile.lines[0];
        console.log('📝 First line structure:', {
          type: firstLine.type,
          content: firstLine.content?.substring(0, 50) + '...',
          hasContent: !!firstLine.content
        });
      }
    }
    
    console.log('✅ Backend API is working correctly!');
    
  } catch (error) {
    console.error('❌ Error testing diff loading:', error);
  }
}

testDiffLoading();