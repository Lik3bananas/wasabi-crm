@echo off
cd /d "D:\Arquivos Salvos\Desktop\Lik3bananans\Agentes\App Wasabi\wasabi-crm"
node scripts\sync-wbuy.mjs >> logs\sync-wbuy-scheduler.log 2>&1
