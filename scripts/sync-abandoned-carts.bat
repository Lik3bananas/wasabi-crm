@echo off
cd /d "C:\Users\Usuario\Desktop\Nova pasta (3)\App Wasabi\wasabi-crm"
echo [%DATE% %TIME%] Iniciando sync carrinhos abandonados >> logs\sync-abandoned-carts-scheduler.log
node scripts\sync-abandoned-carts.mjs >> logs\sync-abandoned-carts-scheduler.log 2>&1
echo [%DATE% %TIME%] Sync finalizado >> logs\sync-abandoned-carts-scheduler.log
