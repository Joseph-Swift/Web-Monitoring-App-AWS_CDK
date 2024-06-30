const { exec } = require('child_process');

// Run the CDK deploy command
exec('cdk deploy', (err, stdout, stderr) => {
  if (err) {
    console.error(`Error: ${stderr}`);
  } else {
    console.log(`Output: ${stdout}`);
  }
});