/**
 * Standalone SSH Test Script
 * Run this directly to debug connection issues
 * 
 * Usage: node test-ssh-debug.js
 */

const { Client } = require('ssh2');

const VM_CONFIG = {
  hostname: '127.0.0.1',
  port: 2222,
  username: 'centos',
  password: 'centos',
};

console.log('='.repeat(60));
console.log('SSH Connection Debug Test');
console.log('='.repeat(60));
console.log(`Target: ${VM_CONFIG.hostname}:${VM_CONFIG.port}`);
console.log(`User: ${VM_CONFIG.username}`);
console.log('');

async function testConnection() {
  console.log('1️⃣  Creating SSH client...');
  const client = new Client();
  let resolved = false;

  return new Promise((resolve, reject) => {
    console.log('2️⃣  Setting up 5-second timeout...');
    const timeout = setTimeout(() => {
      console.log('');
      console.log('❌ TIMEOUT after 5 seconds');
      console.log('');
      console.log('Possible causes:');
      console.log('  • VM is not running');
      console.log('  • Port forwarding not configured (host 2222 → guest 22)');
      console.log('  • Firewall blocking connection');
      console.log('  • Wrong IP address (check VirtualBox network settings)');
      console.log('');
      
      if (!resolved) {
        resolved = true;
        client.end();
        client.destroy();
        reject(new Error('Connection timeout'));
      }
    }, 5000);

    console.log('3️⃣  Registering event handlers...');
    
    client
      .on('ready', () => {
        console.log('');
        console.log('✅ SSH READY!');
        
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          
          console.log('4️⃣  Testing command execution...');
          client.exec('echo "Hello from VM"', (err, stream) => {
            if (err) {
              console.log('❌ Command execution failed:', err.message);
              client.end();
              reject(err);
              return;
            }

            let output = '';
            
            stream
              .on('data', (data) => {
                output += data.toString();
              })
              .on('close', (code) => {
                console.log('✅ Command output:', output.trim());
                console.log('✅ Exit code:', code);
                console.log('');
                console.log('='.repeat(60));
                console.log('SUCCESS! VM is accessible');
                console.log('='.repeat(60));
                client.end();
                resolve(true);
              })
              .on('error', (streamErr) => {
                console.log('❌ Stream error:', streamErr.message);
                client.end();
                reject(streamErr);
              });
          });
        }
      })
      .on('error', (err) => {
        console.log('');
        console.log('❌ SSH ERROR:', err.message);
        console.log('');
        
        if (err.message.includes('ECONNREFUSED')) {
          console.log('Connection refused - possible causes:');
          console.log('  • VM is not running');
          console.log('  • SSH service not started on VM');
          console.log('  • Wrong port number');
        } else if (err.message.includes('ETIMEDOUT')) {
          console.log('Connection timed out - possible causes:');
          console.log('  • Firewall blocking port 2222');
          console.log('  • Network configuration issue');
        } else if (err.message.includes('authentication')) {
          console.log('Authentication failed - possible causes:');
          console.log('  • Wrong username or password');
          console.log('  • SSH key authentication required');
        }
        console.log('');
        
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      })
      .on('close', () => {
        console.log('🔍 SSH connection closed');
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('Connection closed unexpectedly'));
        }
      })
      .on('end', () => {
        console.log('🔍 SSH connection ended');
      });

    console.log('4️⃣  Attempting connection...');
    console.log('    (waiting for response...)');
    console.log('');
    
    try {
      client.connect({
        host: VM_CONFIG.hostname,
        port: VM_CONFIG.port,
        username: VM_CONFIG.username,
        password: VM_CONFIG.password,
        readyTimeout: 5000,
      });
    } catch (err) {
      console.log('❌ Connect threw exception:', err.message);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    }
  });
}

// Run the test
testConnection()
  .then(() => {
    console.log('');
    console.log('✅ All tests passed!');
    process.exit(0);
  })
  .catch((err) => {
    console.log('');
    console.log('❌ Test failed:', err.message);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Check VM is running: VBoxManage list runningvms');
    console.log('  2. Test SSH manually: ssh centos@127.0.0.1 -p 2222');
    console.log('  3. Check port forwarding in VirtualBox settings');
    process.exit(1);
  });