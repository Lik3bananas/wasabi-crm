/**
 * Remove o Wasabi CRM dos Windows Services.
 * Execute com: node uninstall-service.js
 */
const Service = require('node-windows').Service

const svc = new Service({
  name: 'WasabiCRM',
  script: require('path').join(__dirname, 'node_modules', '.bin', 'next'),
})

svc.on('uninstall', () => {
  console.log('✅ Serviço WasabiCRM removido.')
})

svc.uninstall()
