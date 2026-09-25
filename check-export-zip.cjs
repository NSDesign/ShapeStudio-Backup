const fs = require('fs');
const JSZip = require('jszip');

(async () => {
  try {
    const zipPath = 'exports/batch-export-2025-10-24T23-16-17.zip';
    console.log(`Reading ZIP file: ${zipPath}`);
    
    const data = fs.readFileSync(zipPath);
    console.log(`ZIP file size: ${data.length} bytes`);
    
    const zip = await JSZip.loadAsync(data);
    const files = Object.keys(zip.files);
    
    console.log(`\nFiles in ZIP (${files.length} total):`);
    files.forEach(f => console.log(`  - ${f}`));
    
    // Check PNG files
    const pngFiles = files.filter(f => f.endsWith('.png'));
    console.log(`\nFound ${pngFiles.length} PNG files`);
    
    for (const filename of pngFiles) {
      const content = await zip.files[filename].async('nodebuffer');
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const fileSignature = content.slice(0, 8);
      const isValid = fileSignature.equals(pngSignature);
      
      console.log(`\n${filename}:`);
      console.log(`  Size: ${content.length} bytes`);
      console.log(`  Header: ${Array.from(fileSignature).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
      console.log(`  Valid PNG: ${isValid ? '✓' : '✗'}`);
      
      if (!isValid) {
        console.log(`  ERROR: Invalid PNG signature!`);
        console.log(`  Expected: ${Array.from(pngSignature).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
        console.log(`  First 50 bytes:`, content.slice(0, 50));
      }
    }
    
    console.log('\n✓ Verification complete');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
