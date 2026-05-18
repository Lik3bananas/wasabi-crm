/**
 * Instala o Wasabi CRM como Windows Service.
 * Execute UMA VEZ com: node install-service.js
 * Para desinstalar: node uninstall-service.js
 */
const Service = require('node-windows').Service

const svc = new Service({
  name: 'WasabiCRM',
  description: 'Wasabi CRM - Servidor Next.js (porta 3000)',
  script: require('path').join(__dirname, 'node_modules', '.bin', 'next'),
  scriptOptions: 'start --port 3000',
  nodeOptions: [],
  workingDirectory: __dirname,
  allowServiceLogon: true,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT',     value: '3000' },
  ],
})

svc.on('install', () => {
  console.log('✅ Serviço instalado. A iniciar...')
  svc.start()
})

svc.on('start', () => {
  console.log('✅ WasabiCRM está a correr como Windows Service.')
  console.log('   Acesse: http://localhost:3000')
  console.log('   Para ver no Windows: Services → WasabiCRM')
})

svc.on('error', (err) => {
  console.error('❌ Erro:', err)
})

svc.on('alreadyinstalled', () => {
  console.log('ℹ️  Serviço já instalado. A iniciar...')
  svc.start()
})

svc.install()
